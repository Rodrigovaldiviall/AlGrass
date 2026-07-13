-- ============================================================================
-- FASE 4 — reserve_slots(p_game_id uuid, p_reserved_slots_total integer)
-- ============================================================================
-- Gestiona la ÚNICA R1 del capitán (el GRUPO). Existe una sola fila por
-- (game_id, reserved_by_user_id) sin importar el estado. Se busca esa R1: si no
-- existe, se CREA; si existe, se ACTUALIZA la MISMA (nunca R2). El estado destino
-- depende de la cantidad: p_reserved_slots_total = 0 → 'inactive' (total=0);
-- > 0 → 'active' (total=N). Ciclo de vida: inactive / active / canceled.
-- Bloqueo de capacidad: retira cupos del público. Sin efecto económico.
--
-- Autorización (revalidada aquí; nunca se confía en el frontend):
--   rol global captain / captain_gold / algrass_staff / algrass_admin, o
--   Venue Owner del venue AL QUE PERTENECE el partido. Hosts NUNCA.
--
-- reserved_by_role = MOTIVO real del beneficio: owner del venue del partido →
--   'venue_owner' (prevalece, aun con rol global); si no, el rol global usado:
--   captain_gold → captain → algrass_admin → algrass_staff.
--
-- Disponibilidad = total_spots - confirmados - held_activo (misma lógica que
--   enforce_capacity()). Si p_reserved_slots_total no cabe → GAME_FULL.
--
-- No crea triggers. No modifica enforce_capacity() ni game_players. Toda la
-- lógica vive aquí.
-- ============================================================================

drop function if exists public.reserve_slots(uuid, integer);

create or replace function public.reserve_slots(p_game_id uuid, p_reserved_slots_total integer)
returns public.game_slot_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor            uuid := auth.uid();
  v_type             text;
  v_status           text;
  v_date_key         date;
  v_time             time;
  v_total_spots      integer;
  v_venue_owner_id   uuid;
  v_game_start       timestamptz;
  v_is_captain_gold  boolean;
  v_is_captain       boolean;
  v_is_admin         boolean;
  v_is_staff         boolean;
  v_is_owner         boolean;
  v_role             text;
  v_new_status       text;
  v_confirmed        integer;
  v_held             integer;
  v_public_available integer;
  v_existing         public.game_slot_reservations%rowtype;
  v_r1_exists        boolean;
  v_used             integer := 0;
  v_new_hold         integer;
  v_reservation      public.game_slot_reservations%rowtype;
begin
  -- 1) Sesión.
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- 2) Cantidad válida. 0 es válido (R1 nace/queda 'inactive'); negativo no.
  if p_reserved_slots_total is null or p_reserved_slots_total < 0 then
    raise exception 'INVALID_SLOT_COUNT';
  end if;

  -- 3) Bloqueo del partido (FOR UPDATE) + datos del venue para autorizar al owner.
  select g.type,
         g.status,
         g.date_key,
         g.time,
         coalesce(g.total_spots, f.total_spots),
         v.manager_user_id
    into v_type, v_status, v_date_key, v_time, v_total_spots, v_venue_owner_id
    from public.games g
    left join public.fields f on f.id = g.field_id
    left join public.venues v on v.id = f.venue_id
   where g.id = p_game_id
   for update of g;

  if not found then
    raise exception 'GAME_NOT_FOUND';
  end if;

  -- 4) Tipo y estado (partido publicado / reservable).
  if v_type is distinct from 'match' then
    raise exception 'GAME_NOT_RESERVABLE';
  end if;
  if v_status = 'canceled' then
    raise exception 'GAME_CANCELED';
  end if;
  if v_status not in ('published', 'reserved') then
    raise exception 'GAME_NOT_RESERVABLE';
  end if;

  -- 5) No iniciado (game_start anclado a America/Lima).
  v_game_start := (v_date_key + v_time) at time zone 'America/Lima';
  if v_game_start is null then
    raise exception 'GAME_NOT_RESERVABLE';
  end if;
  if now() >= v_game_start then
    raise exception 'GAME_ALREADY_STARTED';
  end if;

  -- 6) Autorización + reserved_by_role por precedencia.
  v_is_captain_gold := exists (select 1 from public.user_roles where user_id = v_actor and role = 'captain_gold');
  v_is_captain      := exists (select 1 from public.user_roles where user_id = v_actor and role = 'captain');
  v_is_admin        := exists (select 1 from public.user_roles where user_id = v_actor and role = 'algrass_admin');
  v_is_staff        := exists (select 1 from public.user_roles where user_id = v_actor and role = 'algrass_staff');
  v_is_owner        := v_venue_owner_id is not null and v_venue_owner_id = v_actor;

  -- reserved_by_role refleja el MOTIVO del beneficio: si es owner del venue del
  -- partido, prevalece 'venue_owner' (aunque además tenga rol global); si no, el rol global.
  if    v_is_owner        then v_role := 'venue_owner';
  elsif v_is_captain_gold then v_role := 'captain_gold';
  elsif v_is_captain      then v_role := 'captain';
  elsif v_is_admin        then v_role := 'algrass_admin';
  elsif v_is_staff        then v_role := 'algrass_staff';
  else
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- 7) Precondición general de reserve_slots(): solo un capitán INSCRITO
  --    (confirmado) en el partido puede crear o reactivar una reserva de cupos.
  if not exists (
    select 1 from public.game_players
     where game_id = p_game_id
       and user_id = v_actor
       and status = 'confirmed'
  ) then
    raise exception 'CAPTAIN_NOT_ENROLLED';
  end if;

  -- 8) R1 ÚNICA por (game_id, reserved_by_user_id): se busca SIN filtrar por estado
  --    (garantizado único por el índice incondicional). Se bloquea la fila si existe.
  select * into v_existing
    from public.game_slot_reservations
   where game_id = p_game_id
     and reserved_by_user_id = v_actor
   for update;

  -- Se captura AQUÍ si la R1 existía: los SELECT agregados posteriores (COUNT/SUM)
  -- sobrescriben FOUND, así que no se puede confiar en FOUND más abajo.
  v_r1_exists := found;

  -- Estado destino según la cantidad: 0 → 'inactive'; > 0 → 'active'.
  v_new_status := case when p_reserved_slots_total > 0 then 'active' else 'inactive' end;

  -- 9) Capacidad (GAME_FULL). held = remaining de OTROS grupos activos (se excluye la
  --    propia R1). Con total=0 el hold resultante es 0 → nunca falla. No se modifica
  --    reserved_slots_used (solo se lee para el cálculo).
  select count(*)::integer
    into v_confirmed
    from public.game_players
   where game_id = p_game_id and status = 'confirmed';

  select coalesce(sum(reserved_slots_remaining), 0)::integer
    into v_held
    from public.game_slot_reservations
   where game_id = p_game_id
     and status = 'active'
     and id is distinct from v_existing.id;

  v_public_available := coalesce(v_total_spots, 0) - v_confirmed - v_held;
  v_used             := coalesce(v_existing.reserved_slots_used, 0);
  v_new_hold         := greatest(p_reserved_slots_total - v_used, 0);
  if v_new_hold > v_public_available then
    raise exception 'GAME_FULL';
  end if;

  -- 10) Una única R1: si existe, se ACTUALIZA la misma fila; si no, se CREA.
  --     Nunca R2. No se toca reserved_slots_used ni reserved_slots_remaining (generada).
  if v_r1_exists then
    update public.game_slot_reservations
       set status               = v_new_status,
           reserved_slots_total = p_reserved_slots_total,
           updated_at           = now()
     where id = v_existing.id
    returning * into v_reservation;
    return v_reservation;
  end if;

  insert into public.game_slot_reservations (
    game_id,
    reserved_by_user_id,
    reserved_by_role,
    status,
    reserved_slots_total,
    created_at,
    updated_at
  ) values (
    p_game_id,
    v_actor,
    v_role,
    v_new_status,
    p_reserved_slots_total,
    now(),
    now()
  )
  returning * into v_reservation;

  return v_reservation;
end;
$$;

-- Ejecutable desde el cliente: la autorización se valida DENTRO de la función.
grant execute on function public.reserve_slots(uuid, integer) to authenticated;
