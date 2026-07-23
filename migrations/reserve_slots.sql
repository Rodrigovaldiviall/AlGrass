-- ============================================================================
-- V6 — reserve_slots(p_game_id uuid, p_reserved_slots_total integer)
-- ============================================================================
-- Gestiona la ÚNICA R1 del capitán (el GRUPO). Una sola fila por
-- (game_id, reserved_by_user_id). Se busca esa R1: si no existe y se reservan
-- cupos (total>0) se CREA; si existe se ACTUALIZA la MISMA (nunca R2).
-- Estado destino: total = 0 → 'inactive'; total > 0 → 'active'. Ciclo de vida V6:
-- inactive / active (no hay canceled/released/expired).
--
-- V6 · caso total = 0: la R1 pasa a inactive con reserved_slots_total = 0 y
-- reserved_slots_used = 0, y TODOS los game_players del grupo pasan
-- counts_reserved_slot TRUE → FALSE (única escritura sobre game_players, y solo
-- ese flag). No se borra la fila; no se crea una nueva.
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
-- No crea triggers. No modifica enforce_capacity(). En el caso total = 0 la
-- liberación (incl. game_players.counts_reserved_slot) se delega en el PUNTO ÚNICO
-- release_slot_reservation(...), compartido con la expiración automática del cron.
-- Al NACER la R1 se fija expires_at (deadline de liberación automática); no se
-- recalcula después.
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

  -- V6 · Expiración automática: una R1 liberada por el cron (released_reason =
  -- 'automatic') NO puede volver a reservar cupos para ese partido; la prioridad
  -- terminó. Se bloquea crear/reactivar/modificar sobre ella (el front además
  -- deshabilita el botón; esto es la barrera de backend, autoritativa).
  if v_r1_exists and v_existing.released_reason = 'automatic' then
    raise exception 'SLOT_RESERVATION_EXPIRED';
  end if;

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

  -- 10) Escritura V6. Si existe R1 → UPDATE; si no y total>0 → INSERT.
  if v_r1_exists then
    if p_reserved_slots_total = 0 then
      -- V6 · reducir a 0: liberación MANUAL del capitán. Reutiliza el PUNTO ÚNICO de
      -- escritura de liberación (mismo resultado que la expiración automática; la
      -- única diferencia es released_reason). Toda la escritura (status/inactive,
      -- totales a 0, last_released_slots, released_reason/at, y counts_reserved_slot
      -- de los game_players) vive en release_slot_reservation.
      perform public.release_slot_reservation(v_existing.id, 'manual_cancel_slots');
      select * into v_reservation
        from public.game_slot_reservations
       where id = v_existing.id;
      return v_reservation;
    end if;

    -- total > 0: comportamiento actual (no toca reserved_slots_used ni counts).
    -- Ciclo de vida: peak conserva el mayor total histórico. NO se tocan
    -- released_reason ni released_at: representan la ÚLTIMA liberación (histórico),
    -- no el estado actual, y persisten aunque la R1 se reactive.
    update public.game_slot_reservations
       set status               = v_new_status,
           reserved_slots_total = p_reserved_slots_total,
           peak_reserved_slots  = greatest(coalesce(peak_reserved_slots, v_existing.reserved_slots_total), p_reserved_slots_total),
           updated_at           = now()
     where id = v_existing.id
    returning * into v_reservation;
    return v_reservation;
  end if;

  -- No existe R1: solo se CREA si se reservan cupos (total > 0). Con total=0 no se crea.
  if p_reserved_slots_total = 0 then
    return null;
  end if;

  insert into public.game_slot_reservations (
    game_id,
    reserved_by_user_id,
    reserved_by_role,
    status,
    reserved_slots_total,
    -- Ciclo de vida: initial se fija SOLO al nacer (nunca vuelve a cambiar);
    -- peak arranca igual al total inicial. released_reason/released_at/
    -- last_released_slots quedan NULL (la R1 nace activa, no liberada).
    initial_reserved_slots,
    peak_reserved_slots,
    -- expires_at: deadline FIJO de liberación automática, escrito SOLO al nacer y
    -- nunca recalculado. Ventana por reserved_by_role:
    --   captain_gold → game_start − 24h
    --   captain      → game_start − 48h
    --   venue_owner / algrass_admin / algrass_staff → game_start (sin adelanto)
    expires_at,
    created_at,
    updated_at
  ) values (
    p_game_id,
    v_actor,
    v_role,
    v_new_status,
    p_reserved_slots_total,
    p_reserved_slots_total,
    p_reserved_slots_total,
    v_game_start - (case v_role
                      when 'captain_gold' then interval '24 hours'
                      when 'captain'      then interval '48 hours'
                      else interval '0 hours'   -- venue_owner / algrass_admin / algrass_staff → game_start
                    end),
    now(),
    now()
  )
  returning * into v_reservation;

  return v_reservation;
end;
$$;

-- Ejecutable desde el cliente: la autorización se valida DENTRO de la función.
grant execute on function public.reserve_slots(uuid, integer) to authenticated;
