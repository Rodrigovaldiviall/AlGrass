-- ============================================================================
-- Doble salida · Guarda PENDING en create_order (pareja Match↔Rental)
-- ============================================================================
-- CREATE OR REPLACE de public.create_order partiendo EXACTAMENTE de la versión
-- VIGENTE (migrations/orders_allow_zero_amount_hold.sql — amount_total=0 válido,
-- INVALID_AMOUNT solo si < 0). Reemplaza y CORRIGE el draft antiguo
-- double_out_create_order_pair_hold.sql, que (a) partía de la create_order
-- PRE-zero-amount (rompía crédito/invited con `<= 0`) y (b) rechazaba nuevos
-- Orders del ganador cuando el gemelo estaba 'blocked'.
--
-- ÚNICO cambio funcional respecto a la vigente: para un game con
-- alternative_game_id se lockean AMBAS filas en ORDER BY id (determinista → dos
-- create_order de la misma pareja se serializan en el MISMO orden, sin deadlock) y,
-- SOLO mientras el game actual sigue CONTENDIENDO (status='published'), se trata al
-- gemelo como inventario incompatible: si el gemelo ya ganó (reserved/blocked/
-- booked) o tiene un PENDING vivo → NO_CAPACITY (misma UX; no abre PaymentSheet).
--
-- Regla del ganador (BUG 2 corregido): si el game actual YA está 'reserved' (ganó
-- la doble salida), sus nuevos Orders NO se re-contienden contra el gemelo — que
-- estará 'blocked' — y solo aplican la capacidad normal del propio game. La guarda
-- de gemelo se ejecuta EXCLUSIVAMENTE con status='published'.
--
-- INTACTO: R1, claimed_units, public_availability, referral/Shared Link, crédito,
-- invited, addGuests, rama rental, holds (solo PENDING vivo cuenta), idempotencia,
-- assert_game_reservable (blocked/paused/draft/terminal siguen sin poder iniciar
-- Order), y todos los mensajes de error. No toca Paso 1/2/3, game_players,
-- reservations, materializeReservation, confirm_order ni Admin. Singleton (sin
-- alternative_game_id): comportamiento byte a byte idéntico al actual.
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
  v_avail      integer;   -- public_availability: total − confirmados − R1_held
  v_holds      integer;   -- Σ claimed_units de holds vivos del recurso
  v_referral          uuid;         -- dueño del Shared Link (referral) del snapshot; null si no hay link
  v_referral_reserved integer := 0; -- effective_reserved_slots_remaining del grupo del capitán del link
  v_titular    boolean;
  v_order      public.orders%rowtype;
  v_alt          uuid;                     -- gemelo de Doble salida (o null)
  v_status       text;                     -- status del game actual (solo se lee en el camino con pareja)
  v_twin         public.games%rowtype;     -- fila del gemelo B (si pareja válida)
  v_twin_paired  boolean := false;         -- true solo si A↔B es bidireccional
begin
  -- 1) Sesión
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  -- 2) Idempotencia: si ya existe una Order para (payer, key) → devolverla
  select * into v_existing
    from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;

  -- 3) Entrada mínima. Un Order puede ser un HOLD de capacidad con amount_total = 0
  --    (crédito/invitado gratis). Solo se rechaza importe negativo o nulo.
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

  -- 5) Bloqueo del recurso. La adquisición es DETERMINISTA: se lee (sin lock)
  --    alternative_game_id para decidir el conjunto a lockear, y se lockea en
  --    ORDER BY id. Así create_order(A) y create_order(B) de la misma pareja se
  --    serializan en el MISMO orden (imposible que ambos creen PENDING incompatibles).
  select g.alternative_game_id into v_alt
    from public.games g
   where g.id = p_resource_id;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;

  if v_alt is null then
    -- Fast path singleton: lock de una sola fila + RE-LECTURA de alternative_game_id
    -- BAJO el lock. Cierra la carrera NULL→emparejado: si create_double_out emparejó A
    -- entre la lectura sin-lock (arriba) y este FOR UPDATE, aquí ya se ve el vínculo.
    select g.host_user_id, g.booked_by_user_id, g.alternative_game_id
      into v_host, v_booked_by, v_alt
      from public.games g
     where g.id = p_resource_id
     for update of g;
    -- A se emparejó bajo el lock → ABORTAR sin degradar a singleton. No se inserta
    -- Order, no se toca ningún status, no se bloquea nada, y NO se intenta lockear el
    -- gemelo (romperíamos el orden determinista A+B teniendo ya A lockeado). Al abortar,
    -- la tx libera el lock; el siguiente intento leerá la pareja desde el principio.
    if v_alt is not null then
      raise exception 'NO_CAPACITY';
    end if;
  else
    -- Doble salida: lock A+B en orden determinista por id.
    perform 1 from public.games
     where id in (p_resource_id, v_alt)
     order by id
     for update;
    -- Re-leer A (ya lockeado; incluye status para la regla del ganador) y el gemelo B.
    select g.host_user_id, g.booked_by_user_id, g.status
      into v_host, v_booked_by, v_status
      from public.games g
     where g.id = p_resource_id;
    select * into v_twin from public.games where id = v_alt;
    -- Conservador: un vínculo roto (gemelo inexistente o relación no bidireccional)
    -- NO degrada a singleton → se ABORTA con NO_CAPACITY (reusa capacityError; no
    -- abre PaymentSheet).
    if not found or v_twin.alternative_game_id is distinct from p_resource_id then
      raise exception 'NO_CAPACITY';
    end if;
    v_twin_paired := true;
  end if;

  -- 6) Precondiciones del recurso: FUENTE ÚNICA (misma guarda que reserve_slots).
  --    assert_game_reservable ya rechaza blocked/paused/draft/canceled/terminal:
  --    solo 'published'/'reserved' llegan más abajo.
  perform public.assert_game_reservable(p_resource_id, p_resource_type);
  -- host no reserva su propio partido (espeja createGamePlayer)
  if p_resource_type = 'match' and v_titular and v_host is not null and v_host = v_actor then
    raise exception 'HOST_CANNOT_RESERVE';
  end if;

  -- 7) Capacidad OFICIAL = confirmados + R1 activos + HOLDs vivos (INTACTA)
  if p_resource_type = 'match' then
    v_avail := public.public_availability(p_resource_id);
    -- RESTAURACIÓN pre-Orders (Shared Link): si el claim llega por referral, el usuario
    -- puede consumir los cupos RESERVADOS del capitán del link. Misma fuente que el
    -- checkout pre-Orders (get_slot_reservation_for_user → effective_reserved_slots_remaining).
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
    -- Reserva de Cupos: los cupos reservados (nueva R1) SOLO salen del pool público.
    if coalesce((p_claim_composition->>'reserved_slots')::integer, 0) > greatest(v_avail - v_holds, 0) then
      raise exception 'INSUFFICIENT_PUBLIC_SLOTS';
    end if;
    if (v_avail + v_referral_reserved - v_holds) < v_units then raise exception 'NO_CAPACITY'; end if;
  else
    -- rental: 1 unidad. Ocupado si ya está reservado o hay un hold vivo.
    if v_booked_by is not null then raise exception 'NO_CAPACITY'; end if;
    if exists (
      select 1 from public.orders o
       where o.resource_id = p_resource_id and o.status = 'pending' and o.pending_expires_at > now()
    ) then raise exception 'NO_CAPACITY'; end if;
  end if;

  -- 7b) Doble salida: el gemelo es inventario INCOMPATIBLE, pero SOLO mientras el
  --     game actual sigue CONTENDIENDO (status='published'). Si el gemelo ya ganó
  --     físicamente (reserved/blocked/booked) o tiene un HOLD vivo (PENDING) → MISMO
  --     error existente NO_CAPACITY. El primer PENDING de un lado gana la carrera; al
  --     expirar/fallar todos los PENDING de ese lado sin compromiso, esta comprobación
  --     (dinámica, solo PENDING vivos) deja de bloquear → el gemelo se recupera solo.
  --
  --     REGLA DEL GANADOR: si el game actual ya está 'reserved', NO se ejecuta esta
  --     guarda — sus nuevos Orders solo compiten por la capacidad del propio game
  --     (varios PENDING del mismo Match ganador siguen permitidos). No se cambia ningún
  --     status; el gemelo queda intacto (Paso 1 ya lo selló a 'blocked' al ganar).
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

-- Ejecutable desde el cliente: toda la autorización/validación se hace DENTRO.
grant execute on function public.create_order(text, text, uuid, jsonb, numeric, text, jsonb, timestamptz, text) to authenticated;
