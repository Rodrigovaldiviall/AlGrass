-- ============================================================================
-- create_order · DELTA Championship Gateway (dos guards, nada más)
-- ============================================================================
-- BASE: la versión VIGENTE CORRECTA = restore_create_order_double_out_pending_guard.sql
-- (contiene alternative_game_id, lock A+B ORDER BY id, twin pending guard, guard championship_id,
-- capacidad/idempotencia). Antes de aplicar ESTA migración, confirmar en la DB:
--     select pg_get_functiondef('public.create_order(text,text,uuid,jsonb,numeric,text,jsonb,timestamptz,text)'::regprocedure)
--            ~* 'alternative_game_id';   -- debe ser TRUE (restore vivo). Si FALSE → DETENERSE, no aplicar.
--
-- ÚNICO cambio funcional respecto a la base (restore):
--   CAMBIO 1 (rental): además de los guards actuales, si ESTA Rental aparece en CRG de un Championship
--                      en 'gateway_hold' con order pending vivo → NO_CAPACITY.
--   CAMBIO 2 (match con double-out): además del twin pending guard actual, si el Rental GEMELO (v_alt)
--                      aparece en CRG de un Championship 'gateway_hold' con order pending vivo → NO_CAPACITY.
-- Match SIN alternative_game_id → NO consulta Championship (cero cambio). Consulta O(1) por CRG.game_id (UNIQUE).
-- Todo lo demás (lock A+B, twin pending Match↔Rental, capacidad, idempotencia, championship_id) INTACTO.
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

  -- 2) Idempotencia
  select * into v_existing
    from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;

  -- 3) Entrada mínima (amount_total=0 válido para HOLD de crédito/invitado; solo < 0 se rechaza).
  if p_amount_total is null or p_amount_total < 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_pending_expires_at is null or p_pending_expires_at <= now() then raise exception 'INVALID_TTL'; end if;
  if p_resource_type not in ('match','rental') then raise exception 'INVALID_RESOURCE_TYPE'; end if;

  -- 4) Unidades del HOLD
  v_titular := coalesce((p_claim_composition->>'titular')::boolean, false);
  if p_resource_type = 'rental' then
    v_units := 1;
  else
    v_units := (case when v_titular then 1 else 0 end)
             + coalesce(jsonb_array_length(p_claim_composition->'guests'), 0)
             + coalesce((p_claim_composition->>'reserved_slots')::integer, 0);
  end if;
  if v_units < 1 then raise exception 'EMPTY_CLAIM'; end if;

  -- 5) Bloqueo DETERMINISTA (double-out): leer alternative_game_id y lockear A+B ORDER BY id.
  select g.alternative_game_id into v_alt
    from public.games g
   where g.id = p_resource_id;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;

  if v_alt is null then
    select g.host_user_id, g.booked_by_user_id, g.championship_id, g.alternative_game_id
      into v_host, v_booked_by, v_champ_id, v_alt
      from public.games g
     where g.id = p_resource_id
     for update of g;
    if v_alt is not null then
      raise exception 'NO_CAPACITY';
    end if;
  else
    perform 1 from public.games
     where id in (p_resource_id, v_alt)
     order by id
     for update;
    select g.host_user_id, g.booked_by_user_id, g.championship_id, g.status
      into v_host, v_booked_by, v_champ_id, v_status
      from public.games g
     where g.id = p_resource_id;
    select * into v_twin from public.games where id = v_alt;
    if not found or v_twin.alternative_game_id is distinct from p_resource_id then
      raise exception 'NO_CAPACITY';
    end if;
    v_twin_paired := true;
  end if;

  -- 6) Precondiciones
  perform public.assert_game_reservable(p_resource_id, p_resource_type);
  if p_resource_type = 'match' and v_titular and v_host is not null and v_host = v_actor then
    raise exception 'HOST_CANNOT_RESERVE';
  end if;

  -- 7) Capacidad OFICIAL (INTACTA)
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
    -- rental: 1 unidad.
    if v_booked_by is not null then raise exception 'NO_CAPACITY'; end if;
    if v_champ_id is not null then raise exception 'NO_CAPACITY'; end if;   -- [CHAMPIONSHIP GUARD, Fase 2]
    if exists (
      select 1 from public.orders o
       where o.resource_id = p_resource_id and o.status = 'pending' and o.pending_expires_at > now()
    ) then raise exception 'NO_CAPACITY'; end if;
    -- ── CAMBIO 1 [CHAMPIONSHIP GATEWAY] ──────────────────────────────────────────────
    -- Esta Rental reclamada por un Championship en 'gateway_hold' con order pending vivo → NO_CAPACITY.
    -- CRG.game_id es UNIQUE (sonda O(1)); NO JSON, NO GIN, NO tabla nueva.
    if exists (
      select 1
        from public.championship_reservation_games crg
        join public.championships c on c.id = crg.championship_id
        join public.orders o on o.id = c.order_id
       where crg.game_id = p_resource_id
         and c.status = 'gateway_hold'
         and o.status = 'pending'
         and o.pending_expires_at > now()
    ) then raise exception 'NO_CAPACITY'; end if;
  end if;

  -- 7b) DOUBLE-OUT (INTACTO): el gemelo es incompatible mientras el game solicitado sigue 'published'.
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
    -- ── CAMBIO 2 [CHAMPIONSHIP GATEWAY] ──────────────────────────────────────────────
    -- El Rental GEMELO (v_alt) reclamado por un Championship 'gateway_hold' con order pending vivo →
    -- NO_CAPACITY. (Para un match-order v_alt es su Rental gemelo; para un rental-order v_alt es un
    -- match, que nunca está en CRG → no-op. Championship jamás reclama Matches directamente.)
    if exists (
      select 1
        from public.championship_reservation_games crg
        join public.championships c on c.id = crg.championship_id
        join public.orders o on o.id = c.order_id
       where crg.game_id = v_alt
         and c.status = 'gateway_hold'
         and o.status = 'pending'
         and o.pending_expires_at > now()
    ) then raise exception 'NO_CAPACITY'; end if;
  end if;

  -- 8) Adquirir el HOLD (única escritura)
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
  when unique_violation then
    select * into v_existing
      from public.orders
     where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
    return v_existing;
end;
$$;

grant execute on function public.create_order(text, text, uuid, jsonb, numeric, text, jsonb, timestamptz, text) to authenticated;
