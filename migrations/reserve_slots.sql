-- ============================================================================
-- FASE 4 — reserve_slots(p_game_id uuid, p_reserved_slots_total integer)
-- ============================================================================
-- Reserva cupos (el GRUPO del capitán). Reutiliza la reserva REUTILIZABLE
-- existente si la hay: ACTIVE → la devuelve tal cual; RELEASED → la reactiva
-- ("volver a reservar cupos"). Solo crea una fila NUEVA (R2) si para ese
-- (partido, capitán) únicamente hay reservas terminales (expired/canceled) o ninguna.
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
-- expires_at: Venue Owner del venue del partido → NULL (prevalece, aun con rol
--   global); captain/captain_gold que NO es owner → game_start - 48h; staff/admin
--   que NO es owner → NULL.
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
  v_expires_at       timestamptz;
  v_confirmed        integer;
  v_held             integer;
  v_public_available integer;
  v_existing         public.game_slot_reservations%rowtype;
  v_reuse            boolean := false;
  v_used             integer := 0;
  v_new_hold         integer;
  v_reservation      public.game_slot_reservations%rowtype;
begin
  -- 1) Sesión.
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- 2) Cantidad válida.
  if p_reserved_slots_total is null or p_reserved_slots_total <= 0 then
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

  -- 7) expires_at. Solo captain/captain_gold (que por tanto NO son owner de este
  --    venue) expiran a -48h. venue_owner, staff y admin → NULL.
  if v_role in ('captain', 'captain_gold') then
    v_expires_at := v_game_start - interval '48 hours';
  else
    v_expires_at := null;
  end if;

  -- 8) Ventana: no crear una reserva que nacería ya expirada (owner/staff/admin exentos por NULL).
  if v_expires_at is not null and now() >= v_expires_at then
    raise exception 'RESERVATION_WINDOW_CLOSED';
  end if;

  -- 9) Precondición general de reserve_slots(): solo un capitán INSCRITO
  --    (confirmado) en el partido puede crear o reactivar una reserva de cupos.
  if not exists (
    select 1 from public.game_players
     where game_id = p_game_id
       and user_id = v_actor
       and status = 'confirmed'
  ) then
    raise exception 'CAPTAIN_NOT_ENROLLED';
  end if;

  -- 10) Reutilización. Como MÁXIMO una reserva REUTILIZABLE (status active|released)
  --     por (game_id, actor), garantizado por el índice único parcial. Se bloquea.
  select * into v_existing
    from public.game_slot_reservations
   where game_id = p_game_id
     and reserved_by_user_id = v_actor
     and status in ('active', 'released')
   for update;

  if found then
    if v_existing.status = 'active' then
      -- Ya tiene reserva ACTIVA → se reutiliza tal cual (idempotente). Cambiar el
      -- total es competencia de modify_reserved_slots() (futura).
      return v_existing;
    end if;
    -- status = 'released' → se reactivará ("volver a reservar cupos"), misma R1.
    v_reuse := true;
    v_used  := v_existing.reserved_slots_used;   -- conserva su grupo actual
  end if;

  -- 11) Disponibilidad pública = total - confirmados - held de OTROS grupos que
  --     retienen (solo status='active'; se excluye la propia reserva).
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

  -- Cupos GARANTIZADOS a retener tras (re)reservar = remaining resultante. En una
  -- reactivación de grupo ya poblado (used>0) solo se retiene lo que falte.
  v_new_hold := greatest(p_reserved_slots_total - v_used, 0);
  if v_new_hold > v_public_available then
    raise exception 'GAME_FULL';
  end if;

  if v_reuse then
    -- 12a) Reactivar la reserva RELEASED (misma R1: mismo link, grupo y used).
    --      Se limpia el snapshot released_* porque vuelve a retener cupos.
    update public.game_slot_reservations
       set status                            = 'active',
           released_at                       = null,
           released_by_user_id               = null,
           released_reserved_slots_used      = null,
           released_reserved_slots_remaining = null,
           reserved_slots_total              = p_reserved_slots_total,
           expires_at                        = v_expires_at,
           updated_at                        = now()
     where id = v_existing.id
    returning * into v_reservation;
    return v_reservation;
  end if;

  -- 12b) No hay reutilizable (solo terminales expired/canceled, o ninguna) →
  --      nueva reserva R2. reserved_slots_remaining es GENERADA (used=0 → =total).
  insert into public.game_slot_reservations (
    game_id,
    reserved_by_user_id,
    reserved_by_role,
    status,
    reserved_slots_total,
    reserved_slots_used,
    expires_at,
    released_at,
    created_at,
    updated_at
  ) values (
    p_game_id,
    v_actor,
    v_role,
    'active',
    p_reserved_slots_total,
    0,
    v_expires_at,
    null,
    now(),
    now()
  )
  returning * into v_reservation;

  return v_reservation;
end;
$$;

-- Ejecutable desde el cliente: la autorización se valida DENTRO de la función.
grant execute on function public.reserve_slots(uuid, integer) to authenticated;
