-- ============================================================================
-- V13 — reserve_slots(): el PROPIETARIO pertenece SIEMPRE a SU propia R1
-- ============================================================================
-- Reemplaza reserve_slots CONSERVANDO toda su lógica V6 (autorización, roles,
-- CAPTAIN_NOT_ENROLLED, lock FOR UPDATE, capacidad/GAME_FULL, expires_at, active/
-- inactive, aumento/reducción de total, p_total=0 → release_slot_reservation,
-- R1+públicos, errores, metadata). ÚNICO añadido: cuando la operación deja la R1
-- propia con p_total > 0 (crear / reactivar / actualizar), el creador/propietario
-- (reserved_by_user_id = actor) pasa a pertenecer a SU propia R1:
--     game_players.game_slot_reservation_id = <su R1>
--     game_players.counts_reserved_slot     = true
-- aunque antes estuviera NULL/NULL o perteneciera a la R1 de otro capitán.
--
-- Solo afecta a la fila del PROPIO actor (no toca herencia de invitados ni de
-- otros grupos). El trigger existente trg_game_players_reserved_slots_used
-- recomputa automáticamente el used del grupo ORIGEN (↓) y del DESTINO (↑).
-- NO aplica a p_total=0 (esa rama sigue liberando vía release_slot_reservation).
-- No toca enforce_capacity, public_availability, rebuild_reserved_slots_used ni
-- ningún trigger; el actor ya estaba 'confirmed' (ocupa plaza), así que la
-- reasignación solo re-etiqueta su R1, sin afectar capacidad.
-- ============================================================================

create or replace function public.reserve_slots(p_game_id uuid, p_reserved_slots_total integer, p_actor uuid default null)
returns public.game_slot_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor            uuid := coalesce(auth.uid(), p_actor);
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

  -- 4-5) Precondiciones del recurso (tipo / estado publicado-reservable / no iniciado).
  perform public.assert_game_reservable(p_game_id, 'match');
  v_game_start := (v_date_key + v_time) at time zone 'America/Lima';

  -- 6) Autorización + reserved_by_role por precedencia.
  v_is_captain_gold := exists (select 1 from public.user_roles where user_id = v_actor and role = 'captain_gold');
  v_is_captain      := exists (select 1 from public.user_roles where user_id = v_actor and role = 'captain');
  v_is_admin        := exists (select 1 from public.user_roles where user_id = v_actor and role = 'algrass_admin');
  v_is_staff        := exists (select 1 from public.user_roles where user_id = v_actor and role = 'algrass_staff');
  v_is_owner        := v_venue_owner_id is not null and v_venue_owner_id = v_actor;

  if    v_is_owner        then v_role := 'venue_owner';
  elsif v_is_captain_gold then v_role := 'captain_gold';
  elsif v_is_captain      then v_role := 'captain';
  elsif v_is_admin        then v_role := 'algrass_admin';
  elsif v_is_staff        then v_role := 'algrass_staff';
  else
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- 7) Precondición: solo un capitán INSCRITO (confirmado) puede crear/reactivar.
  if not exists (
    select 1 from public.game_players
     where game_id = p_game_id
       and user_id = v_actor
       and status = 'confirmed'
  ) then
    raise exception 'CAPTAIN_NOT_ENROLLED';
  end if;

  -- 8) R1 ÚNICA por (game_id, reserved_by_user_id). Se bloquea si existe.
  select * into v_existing
    from public.game_slot_reservations
   where game_id = p_game_id
     and reserved_by_user_id = v_actor
   for update;

  v_r1_exists := found;

  -- Una R1 liberada por el cron (released_reason='automatic') no puede reactivarse.
  if v_r1_exists and v_existing.released_reason = 'automatic' then
    raise exception 'SLOT_RESERVATION_EXPIRED';
  end if;

  v_new_status := case when p_reserved_slots_total > 0 then 'active' else 'inactive' end;

  -- 9) Capacidad (GAME_FULL).
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
      -- V6 · reducir a 0: liberación MANUAL (punto único). NO reasigna al propietario.
      perform public.release_slot_reservation(v_existing.id, 'manual_cancel_slots');
      select * into v_reservation
        from public.game_slot_reservations
       where id = v_existing.id;
      return v_reservation;
    end if;

    -- total > 0: actualizar la MISMA R1.
    update public.game_slot_reservations
       set status               = v_new_status,
           reserved_slots_total = p_reserved_slots_total,
           peak_reserved_slots  = greatest(coalesce(peak_reserved_slots, v_existing.reserved_slots_total), p_reserved_slots_total),
           updated_at           = now()
     where id = v_existing.id
    returning * into v_reservation;

    -- V13 · el propietario pertenece SIEMPRE a SU propia R1 (counts=true). Solo su fila;
    -- el trigger recomputa origen↓ y destino↑. Guard is-distinct → idempotente.
    update public.game_players
       set game_slot_reservation_id = v_reservation.id,
           counts_reserved_slot     = true
     where game_id = p_game_id
       and user_id = v_actor
       and status  = 'confirmed'
       and (game_slot_reservation_id is distinct from v_reservation.id
            or counts_reserved_slot is distinct from true);

    return v_reservation;
  end if;

  -- No existe R1: solo se CREA si se reservan cupos (total > 0).
  if p_reserved_slots_total = 0 then
    return null;
  end if;

  insert into public.game_slot_reservations (
    game_id,
    reserved_by_user_id,
    reserved_by_role,
    status,
    reserved_slots_total,
    initial_reserved_slots,
    peak_reserved_slots,
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
                      else interval '0 hours'
                    end),
    now(),
    now()
  )
  returning * into v_reservation;

  -- V13 · el propietario pertenece SIEMPRE a SU propia R1 recién creada (counts=true).
  update public.game_players
     set game_slot_reservation_id = v_reservation.id,
         counts_reserved_slot     = true
   where game_id = p_game_id
     and user_id = v_actor
     and status  = 'confirmed'
     and (game_slot_reservation_id is distinct from v_reservation.id
          or counts_reserved_slot is distinct from true);

  return v_reservation;
end;
$$;

grant execute on function public.reserve_slots(uuid, integer, uuid) to authenticated;
