-- ============================================================================
-- Doble salida · Fase 2 · Capa 1 — create_order trata la pareja A+B como
-- inventario incompatible durante el HOLD (PENDING)
-- ============================================================================
-- CREATE OR REPLACE de public.create_order (no edita la migración histórica).
-- Cambios MÍNIMOS respecto a create_order.sql:
--   1) La adquisición de locks es DETERMINISTA desde el principio: para una Doble
--      salida (A↔B) se lockean AMBAS filas en ORDER BY id (nunca "A primero y
--      luego A+B", que permitiría a dos solicitudes A/B tomar locks en orden
--      contrario y deadlockear). Singleton: se conserva el lock de una sola fila.
--   2) Antes de insertar el PENDING de A, si el gemelo B ya ganó físicamente
--      (reserved/blocked/booked) o tiene un Order PENDING viva → se devuelve el
--      MISMO error existente NO_CAPACITY (el frontend ya lo mapea a capacityError
--      y no abre PaymentSheet).
--
-- Invariantes conservados: NO se cambia ningún status por un PENDING; B NO se
-- toca (no blocked, no Order espejo); el PENDING de A pertenece SOLO a A; la
-- relación se resuelve por orders.resource_id → games.alternative_game_id. Al
-- expirar el PENDING no hay que restaurar nada. La lógica de capacidad del
-- recurso solicitado (public_availability / claimed_units / holds / match / rental
-- / validaciones) queda INTACTA.
--
-- NO toca: double_out_gate_match_commit.sql, game_players, claim Rental,
-- materializeReservation, crédito/free, refunds, ConfirmReservation.jsx, triggers
-- Paso 1/2, Admin.
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

  -- 3) Entrada mínima. create_order es SOLO para pagos externos (amount > 0);
  --    el 100% crédito interno no llega aquí.
  if p_amount_total is null or p_amount_total <= 0 then raise exception 'INVALID_AMOUNT'; end if;
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

  -- 5) Bloqueo del recurso. La adquisición es DETERMINISTA desde el inicio: se lee
  --    (sin lock) alternative_game_id para decidir el conjunto a lockear, y luego
  --    se lockea en ORDER BY id. Así dos create_order (uno por A, otro por B) de la
  --    misma pareja se serializan en el MISMO orden (sin deadlock A↔B).
  select g.alternative_game_id into v_alt
    from public.games g
   where g.id = p_resource_id;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;

  if v_alt is null then
    -- Fast path singleton: lock de una sola fila (comportamiento actual EXACTO).
    select g.host_user_id, g.booked_by_user_id
      into v_host, v_booked_by
      from public.games g
     where g.id = p_resource_id
     for update of g;
  else
    -- Doble salida: lock A+B en orden determinista por id.
    perform 1 from public.games
     where id in (p_resource_id, v_alt)
     order by id
     for update;
    -- Re-leer A (ya lockeado) y el gemelo B; revalidar relación bidireccional.
    select g.host_user_id, g.booked_by_user_id
      into v_host, v_booked_by
      from public.games g
     where g.id = p_resource_id;
    select * into v_twin from public.games where id = v_alt;
    -- Conservador: un vínculo roto (el gemelo no existe, o la relación no es
    -- bidireccional) NO degrada a singleton → se ABORTA con NO_CAPACITY, reutilizando
    -- la UX existente (capacityError) y garantizando que no se abre PaymentSheet.
    if not found or v_twin.alternative_game_id is distinct from p_resource_id then
      raise exception 'NO_CAPACITY';
    end if;
    v_twin_paired := true;
  end if;

  -- 6) Precondiciones del recurso: FUENTE ÚNICA (misma guarda que reserve_slots)
  perform public.assert_game_reservable(p_resource_id, p_resource_type);
  -- host no reserva su propio partido (espeja createGamePlayer)
  if p_resource_type = 'match' and v_titular and v_host is not null and v_host = v_actor then
    raise exception 'HOST_CANNOT_RESERVE';
  end if;

  -- 7) Capacidad OFICIAL = confirmados + R1 activos + HOLDs vivos
  if p_resource_type = 'match' then
    v_avail := public.public_availability(p_resource_id);
    -- RESTAURACIÓN pre-Orders (Shared Link): si el claim llega por referral, el usuario
    -- puede consumir los cupos RESERVADOS del capitán del link. Se reutiliza la MISMA
    -- fuente que usaba el checkout pre-Orders — get_slot_reservation_for_user →
    -- effective_reserved_slots_remaining — y se suma a la capacidad, exactamente como
    -- effectiveAvailability = public_availability + effective_reserved_slots_remaining.
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
    -- Reserva de Cupos: los cupos reservados (nueva R1) SOLO pueden salir del pool
    -- público; el remaining del capitán del Shared Link es EXCLUSIVO de la inscripción
    -- (titular + invitados) y nunca puede fundar una reserva de cupos. Se rechaza ANTES
    -- de crear la Order para no dejar al usuario inscrito con la reserva fallida.
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

  -- 7b) Doble salida: el gemelo B es inventario INCOMPATIBLE. Si B ya ganó
  --     físicamente (reserved/blocked/booked) o tiene un HOLD vivo (Order PENDING),
  --     A no puede tomar su propio hold → MISMO error existente NO_CAPACITY. No se
  --     cambia ningún status; B queda intacto; el PENDING sigue siendo provisional.
  if v_twin_paired then
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
