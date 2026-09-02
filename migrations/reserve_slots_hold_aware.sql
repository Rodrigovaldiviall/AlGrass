-- ============================================================================
-- reserve_slots() HOLD-aware — cerrar la carrera Order PENDING vs reserve_slots
-- ============================================================================
-- CREATE OR REPLACE partiendo EXACTAMENTE de la versión VIGENTE
-- (migrations/reserve_slots_adopt_existing_direct_guests.sql, V14). ÚNICO cambio:
-- reserve_slots ahora descuenta de la capacidad pública los Orders PENDING vivos
-- de OTROS usuarios (holds de pasarela/crédito en ventana de pago).
--
--   ANTES:  v_public_available = total − confirmados − Σ(otras R1 remaining)
--   AHORA:  v_public_available = total − confirmados − Σ(otras R1 remaining)
--                                       − Σ(claimed_units de PENDING vivos de OTROS)
--
-- Se excluye `payer_user_id <> v_actor` a propósito: al materializar, el propio
-- capitán convierte su hold en durable (game_players + R1); su Order en vuelo NO
-- debe contar contra sí mismo (evita GAME_FULL en su propia reserva pagada).
--
-- create_order y reserve_slots ya serializan por FOR UPDATE of g sobre la misma
-- fila games, así que el conteo de holds es consistente bajo concurrencia.
--
-- TODO lo demás es IDÉNTICO a V14: R1, piso/CLAMP, adopción, cancelación/release,
-- claim_composition, claimed_units, materialización y locks (FOR UPDATE of g +
-- FOR UPDATE de la R1 propia) permanecen intactos.
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
  v_holds            integer := 0;   -- Σ claimed_units de PENDING vivos de OTROS usuarios
  v_public_available integer;
  v_existing         public.game_slot_reservations%rowtype;
  v_r1_exists        boolean;
  v_floor            integer := 0;   -- V14: piso adoptable (titular + directos gsr null / ya propios)
  v_used_after       integer := 0;   -- V14: used PROYECTADO tras la adopción (reemplaza v_used de V13)
  v_new_hold         integer;
  v_reservation      public.game_slot_reservations%rowtype;
  v_cap_h            integer;    -- app_settings.captain_release_hours
  v_gold_h           integer;    -- app_settings.captain_gold_release_hours
  v_release_h        integer;    -- horas efectivas según rol (0 = expira en game_start)
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

  -- V14 · PISO adoptable + CLAMP N >= piso (solo p_total > 0). Piso = titular + directos
  -- confirmed con gsr NULL o ya en MI R1 (excluye directos en OTRA R1 y a los link).
  if p_reserved_slots_total > 0 then
    select count(*)::integer
      into v_floor
      from public.game_players
     where game_id  = p_game_id
       and status   = 'confirmed'
       and payer_id = v_actor
       and ( user_id = v_actor
             or game_slot_reservation_id is null
             or game_slot_reservation_id = v_existing.id );   -- v_existing.id es NULL en R1 nueva
    if p_reserved_slots_total < v_floor then
      p_reserved_slots_total := v_floor;                      -- auto-raise a piso (Sección 13)
    end if;
  end if;

  v_new_status := case when p_reserved_slots_total > 0 then 'active' else 'inactive' end;

  -- 9) Capacidad (GAME_FULL) con used PROYECTADO (acredita titular + directos a adoptar).
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

  -- HOLD-aware: Orders PENDING vivos de OTROS usuarios (holds de pasarela/crédito en
  -- ventana de pago). reserve_slots y create_order ya serializan por FOR UPDATE of g;
  -- sin esto, reserve_slots ignoraba estos holds y podía crear/aumentar R1 sobre
  -- capacidad ya retenida. Se excluye el hold en vuelo del propio actor (su Order se
  -- está materializando ahora: no debe contar contra sí mismo).
  select coalesce(sum(o.claimed_units), 0)::integer
    into v_holds
    from public.orders o
   where o.resource_id = p_game_id
     and o.status = 'pending'
     and o.pending_expires_at > now()
     and o.payer_user_id <> v_actor;

  v_public_available := coalesce(v_total_spots, 0) - v_confirmed - v_held - v_holds;

  -- used_after = conjunto counts=true que tendrá MI R1 tras la adopción:
  --   · miembros actuales de mi R1 (incl. links, counts=true), UNIÓN
  --   · titular + directos adoptables (payer=actor con user=actor / gsr null / gsr=mi R1).
  select count(*)::integer
    into v_used_after
    from public.game_players
   where game_id = p_game_id
     and status  = 'confirmed'
     and ( (game_slot_reservation_id = v_existing.id and counts_reserved_slot = true)
           or (payer_id = v_actor
               and (user_id = v_actor
                    or game_slot_reservation_id is null
                    or game_slot_reservation_id = v_existing.id)) );

  v_new_hold := greatest(p_reserved_slots_total - v_used_after, 0);
  if v_new_hold > v_public_available then
    raise exception 'GAME_FULL';
  end if;

  -- 10) Escritura V6. Si existe R1 → UPDATE; si no y total>0 → INSERT.
  if v_r1_exists then
    if p_reserved_slots_total = 0 then
      -- V6 · reducir a 0: liberación MANUAL (punto único). NO adopta ni reasigna a nadie.
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

    -- V14 · adopción: titular (SIEMPRE, aun desde otra R1) + invitados directos con gsr NULL
    -- o ya en MI R1. Los directos en OTRA R1 NO se tocan; los link (payer<>actor) tampoco.
    -- El trigger recomputa reserved_slots_used (destino y, para el titular, origen).
    update public.game_players
       set game_slot_reservation_id = v_reservation.id,
           counts_reserved_slot     = true
     where game_id  = p_game_id
       and status   = 'confirmed'
       and payer_id = v_actor
       and ( user_id = v_actor
             or game_slot_reservation_id is null
             or game_slot_reservation_id = v_reservation.id )
       and (game_slot_reservation_id is distinct from v_reservation.id
            or counts_reserved_slot is distinct from true);

    return v_reservation;
  end if;

  -- No existe R1: solo se CREA si se reservan cupos (total > 0).
  if p_reserved_slots_total = 0 then
    return null;
  end if;

  -- Ventana de liberación configurable (app_settings id=1). Se lee SOLO AQUÍ, en el
  -- punto de CREACIÓN de la R1 (materializa expires_at UNA vez). La rama UPDATE de una
  -- R1 existente retorna antes de llegar aquí → NUNCA recalcula expires_at. Roles no
  -- capitanes (admin/staff/owner) conservan 0h (expira en game_start), sin leer config.
  if v_role = 'captain_gold' or v_role = 'captain' then
    select s.captain_gold_release_hours, s.captain_release_hours
      into v_gold_h, v_cap_h
      from public.app_settings s
     where s.id = 1;

    v_release_h := case v_role
                     when 'captain_gold' then v_gold_h
                     when 'captain'      then v_cap_h
                   end;

    -- SIN fallback silencioso a 24/48: config ausente / NULL / fuera de 0..720 → abortar
    -- ANTES de escribir la R1. 0 es VÁLIDO (expira en game_start).
    if v_release_h is null or v_release_h < 0 or v_release_h > 720 then
      raise exception 'SLOT_RELEASE_CONFIG_UNAVAILABLE';
    end if;
  else
    v_release_h := 0;
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
    v_game_start - make_interval(hours => v_release_h),   -- config: captain(_gold)_release_hours; 0 ⇒ game_start
    now(),
    now()
  )
  returning * into v_reservation;

  -- V14 · adopción en la R1 recién creada (misma filosofía que la rama UPDATE).
  update public.game_players
     set game_slot_reservation_id = v_reservation.id,
         counts_reserved_slot     = true
   where game_id  = p_game_id
     and status   = 'confirmed'
     and payer_id = v_actor
     and ( user_id = v_actor
           or game_slot_reservation_id is null
           or game_slot_reservation_id = v_reservation.id )
     and (game_slot_reservation_id is distinct from v_reservation.id
          or counts_reserved_slot is distinct from true);

  return v_reservation;
end;
$$;

grant execute on function public.reserve_slots(uuid, integer, uuid) to authenticated;
