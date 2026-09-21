-- ============================================================================
-- FIX · Restaurar el guard DOUBLE-OUT (pre-pago) en create_order
-- ============================================================================
-- Regresión: championships_phase2_transfer_hold.sql re-creó create_order y, al hacerlo, PERDIÓ el
-- guard double-out que había añadido double_out_create_order_pending_guard.sql. Verificado en DB:
--   pg_get_functiondef(create_order) ~* 'alternative_game_id'  →  FALSE
-- Sin ese guard, dos usuarios en lados opuestos de una Doble salida (Match A ↔ Rental B) crean cada
-- uno su pending sin verse (locks sobre filas distintas), ambos cobran, y solo el trigger de
-- materialización (trg_block_double_out_twin) frena al segundo — demasiado tarde (post-cobro).
--
-- Esta migración es ADITIVA: CREATE OR REPLACE de create_order tomando como BASE la versión VIGENTE
-- (Fase 2, con el guard championship_id y todo lo posterior) y RE-INTRODUCIENDO ÚNICAMENTE el bloque
-- double-out de double_out_create_order_pending_guard.sql:
--   · lock determinista de A+B (ORDER BY games.id) cuando hay alternative_game_id;
--   · rechazo NO_CAPACITY si el gemelo está reserved/blocked/booked o tiene un pending vivo.
-- Games SIN alternative_game_id → comportamiento funcional IDÉNTICO al de Fase 2 (fast path singleton).
--
-- NO toca: reserve_slots, claim_rental_double_out_aware, assert_game_reservable, materializeReservation,
-- confirm_order, triggers double-out, championship transfer hold/approve/reject, capacidad, wallet,
-- reservations, frontend. NO añade todavía la comprobación futura de championship_reservation_games
-- pending (eso es del Championship Gateway).
-- ============================================================================

create or replace function public.create_order(
  p_idempotency_key    text,
  p_resource_type      text,
  p_resource_id        uuid,
  p_claim_composition  jsonb,
  p_amount_total       numeric,
  p_currency           text,
  p_financial_snapshot jsonb,
  p_pending_expires_at timestamptz,
  p_payment_provider   text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_existing   public.orders%rowtype;
  v_units      integer;
  v_host       uuid;
  v_booked_by  uuid;
  v_champ_id   uuid;   -- [CHAMPIONSHIP GUARD] championship_id del game (Fase 2)
  v_avail      integer;
  v_holds      integer;
  v_referral          uuid;
  v_referral_reserved integer := 0;
  v_titular    boolean;
  v_order      public.orders%rowtype;
  v_alt          uuid;                     -- [DOUBLE-OUT] gemelo (o null)
  v_twin         public.games%rowtype;     -- [DOUBLE-OUT] fila del gemelo B (si pareja válida)
  v_status       text;                     -- [DOUBLE-OUT] status del game solicitado (solo rama con pareja)
  v_twin_paired  boolean := false;         -- [DOUBLE-OUT] true solo si A↔B es bidireccional
begin
  -- 1) Sesión
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  -- 2) Idempotencia: si ya existe una Order para (payer, key) → devolverla
  select * into v_existing
    from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;

  -- 3) Entrada mínima (amount_total=0 válido para HOLD de crédito/invitado; solo < 0 se rechaza).
  if p_amount_total is null or p_amount_total < 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_pending_expires_at is null or p_pending_expires_at <= now() then raise exception 'INVALID_TTL'; end if;
  if p_resource_type not in ('match','rental') then raise exception 'INVALID_RESOURCE_TYPE'; end if;

  -- 4) Unidades que el HOLD consume (derivadas de claim_composition)
  v_titular := coalesce((p_claim_composition->>'titular')::boolean, false);
  if p_resource_type = 'rental' then
    v_units := 1;
  else
    v_units := (case when v_titular then 1 else 0 end)
             + coalesce(jsonb_array_length(p_claim_composition->'guests'), 0)
             + coalesce((p_claim_composition->>'reserved_slots')::integer, 0);
  end if;
  if v_units < 1 then raise exception 'EMPTY_CLAIM'; end if;

  -- 5) Bloqueo del recurso. Adquisición DETERMINISTA (recuperado de double_out_create_order_pending_guard):
  --    se lee (sin lock) alternative_game_id para decidir el conjunto a lockear, y se lockea en
  --    ORDER BY games.id. Así create_order(A) y create_order(B) de la MISMA pareja se serializan en el
  --    mismo orden (imposible que dos usuarios creen PENDING incompatibles). Se lee championship_id bajo
  --    el lock en AMBAS ramas (lo necesita el guard Championship de Fase 2).
  select g.alternative_game_id into v_alt
    from public.games g
   where g.id = p_resource_id;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;

  if v_alt is null then
    -- Fast path singleton: lock de una sola fila + RE-LECTURA de alternative_game_id BAJO el lock
    -- (cierra la carrera NULL→emparejado). Funcionalmente idéntico a Fase 2 para games normales.
    select g.host_user_id, g.booked_by_user_id, g.championship_id, g.alternative_game_id
      into v_host, v_booked_by, v_champ_id, v_alt
      from public.games g
     where g.id = p_resource_id
     for update of g;
    -- Si se emparejó bajo el lock, abortar sin degradar a singleton (no rompemos el orden A+B).
    if v_alt is not null then
      raise exception 'NO_CAPACITY';
    end if;
  else
    -- Doble salida: lock A+B en orden determinista por id.
    perform 1 from public.games
     where id in (p_resource_id, v_alt)
     order by id
     for update;
    -- Re-leer A (ya lockeado; incluye status y championship_id) y el gemelo B.
    select g.host_user_id, g.booked_by_user_id, g.championship_id, g.status
      into v_host, v_booked_by, v_champ_id, v_status
      from public.games g
     where g.id = p_resource_id;
    select * into v_twin from public.games where id = v_alt;
    -- Vínculo roto (gemelo inexistente o no bidireccional) → NO degrada a singleton: NO_CAPACITY.
    if not found or v_twin.alternative_game_id is distinct from p_resource_id then
      raise exception 'NO_CAPACITY';
    end if;
    v_twin_paired := true;
  end if;

  -- 6) Precondiciones del recurso (FUENTE ÚNICA, igual que reserve_slots)
  perform public.assert_game_reservable(p_resource_id, p_resource_type);
  if p_resource_type = 'match' and v_titular and v_host is not null and v_host = v_actor then
    raise exception 'HOST_CANNOT_RESERVE';
  end if;

  -- 7) Capacidad OFICIAL = confirmados + R1 activos + HOLDs vivos (Fase 2, INTACTA)
  if p_resource_type = 'match' then
    v_avail := public.public_availability(p_resource_id);
    v_referral := nullif(p_financial_snapshot->>'referral', '')::uuid;
    if v_referral is not null then
      select coalesce(gsr.effective_reserved_slots_remaining, 0)
        into v_referral_reserved
        from public.get_slot_reservation_for_user(p_resource_id, v_referral) gsr;
    end if;
    select coalesce(sum(o.claimed_units), 0)::integer
      into v_holds
      from public.orders o
     where o.resource_id = p_resource_id
       and o.status = 'pending'
       and o.pending_expires_at > now();
    if coalesce((p_claim_composition->>'reserved_slots')::integer, 0) > greatest(v_avail - v_holds, 0) then
      raise exception 'INSUFFICIENT_PUBLIC_SLOTS';
    end if;
    if (v_avail + v_referral_reserved - v_holds) < v_units then raise exception 'NO_CAPACITY'; end if;
  else
    -- rental: 1 unidad. Ocupado si ya está reservado o hay un hold vivo…
    if v_booked_by is not null then raise exception 'NO_CAPACITY'; end if;
    -- [CHAMPIONSHIP GUARD, Fase 2] …o si el game está retenido/reservado por un Campeonato
    -- (reserved + championship_id, booked_by NULL). Sin este guard, el gate rental lo dejaría pasar.
    if v_champ_id is not null then raise exception 'NO_CAPACITY'; end if;
    if exists (
      select 1 from public.orders o
       where o.resource_id = p_resource_id and o.status = 'pending' and o.pending_expires_at > now()
    ) then raise exception 'NO_CAPACITY'; end if;
  end if;

  -- 7b) DOUBLE-OUT (recuperado de double_out_create_order_pending_guard, semántica idéntica): el gemelo
  --     es inventario INCOMPATIBLE, pero SOLO mientras el game solicitado sigue CONTENDIENDO
  --     (status='published'). Si el gemelo ya ganó físicamente (reserved/blocked/booked) o tiene un HOLD
  --     vivo (PENDING) → NO_CAPACITY (antes de insertar el segundo pending). Dinámico (solo PENDING vivos):
  --     al expirar/fallar los PENDING del otro lado sin compromiso, deja de bloquear (se auto-recupera).
  --     REGLA DEL GANADOR: si el game ya está 'reserved', esta guarda NO corre (sus nuevos Orders solo
  --     compiten por su propia capacidad; el gemelo ya quedó 'blocked' por el Paso 1).
  if v_twin_paired and v_status = 'published' then
    if v_twin.status in ('reserved','blocked') or v_twin.booked_by_user_id is not null then
      raise exception 'NO_CAPACITY';
    end if;
    if exists (
      select 1 from public.orders o
       where o.resource_id = v_alt
         and o.status = 'pending'
         and o.pending_expires_at > now()
    ) then
      raise exception 'NO_CAPACITY';
    end if;
  end if;

  -- 8) Adquirir el HOLD: insertar la Order PENDING (única escritura)
  insert into public.orders (
    idempotency_key, payer_user_id, resource_type, resource_id,
    claim_composition, claimed_units, pending_expires_at,
    amount_total, currency, financial_snapshot, payment_provider, status
  ) values (
    p_idempotency_key, v_actor, p_resource_type, p_resource_id,
    p_claim_composition, v_units, p_pending_expires_at,
    p_amount_total, coalesce(p_currency, 'PEN'), p_financial_snapshot, p_payment_provider, 'pending'
  )
  returning * into v_order;

  return v_order;

exception
  -- Carrera de idempotencia (misma key insertada en paralelo): devolver la existente.
  when unique_violation then
    select * into v_existing
      from public.orders
     where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
    return v_existing;
end;
$$;

grant execute on function public.create_order(text, text, uuid, jsonb, numeric, text, jsonb, timestamptz, text) to authenticated;
