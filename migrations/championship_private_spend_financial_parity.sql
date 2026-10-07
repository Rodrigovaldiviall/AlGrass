-- Campeonatos PRIVADOS (creación/host) · asiento financiero `reservations` con la MISMA semántica del flujo público
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- BUG observado al crear campeonato privado (gateway o transferencia):
--   1) reservations.unit_price queda NULL (la columna ni se escribía en el insert).
--   2) reservations.subtotal_amount == total_amount aunque se usó crédito (ambos = amount_total bruto).
--   3) el crédito aplicado no se refleja (credit_applied = 0 fijo).
--
-- CAUSA: confirm_championship_gateway_payment y approve_championship_transfer insertan el spend con
--   (unit_price ausente), total_amount = subtotal_amount = v_order.amount_total (BRUTO) y credit_applied = 0,
--   IGNORANDO el breakdown ya congelado en orders.financial_snapshot (que SÍ trae credit_applied y
--   external_amount — lo escribe create_championship_gateway_order / el hold de transferencia).
--
-- SEMÁNTICA CORRECTA (idéntica a create/confirm_championship_team_registration, flujo público ya corregido):
--   unit_price      = precio base del producto (aquí = bruto; la creación no tiene reward/promo)
--   subtotal_amount = neto ANTES de crédito (= bruto)
--   credit_applied  = crédito AlGrass realmente usado (del snapshot)
--   total_amount    = importe EXTERNO tras crédito (= external_amount del snapshot = bruto − crédito)
-- Ejemplo (bruto 100, crédito 30): unit_price=100, subtotal_amount=100, credit_applied=30, total_amount=70.
--
-- orders.amount_total se mantiene BRUTO A PROPÓSITO (diseño de championship_gateway_credit.sql: los triggers del
-- núcleo leen credit_applied/external_amount del snapshot, y los techos de reembolso leen reservations.subtotal_amount
-- — NUNCA orders.amount_total). Por eso NO se toca aquí: el "externo" ya vive en financial_snapshot.external_amount
-- y ahora también en reservations.total_amount.
--
-- ADITIVA. Reemite SOLO las dos funciones de materialización del campeonato propio. NO toca: registro público
-- (team/individual), Match, Rental, refunds, reward, cancelaciones, wallet helpers, pricing/quote, create/hold,
-- otros reservation_type, ni contratos/columnas.

begin;

-- ── 1 · GATEWAY (tarjeta/crédito) — confirm_championship_gateway_payment ─────────────────────
create or replace function public.confirm_championship_gateway_payment(p_championship_id uuid)
returns public.championships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_champ   public.championships%rowtype;
  v_order   public.orders%rowtype;
  v_ids     uuid[];
  v_lockset uuid[];
  v_n       integer;
  v_snap    jsonb;
  v_bruto   numeric;
  v_credito numeric;
  v_externo numeric;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.owner_user_id <> v_actor then raise exception 'NOT_OWNER'; end if;

  -- Idempotencia VERIFICADA: 'pending_publish' no-op solo si order confirmed + spend existente.
  if v_champ.status = 'pending_publish' then
    if v_champ.order_id is null then raise exception 'INVALID_STATE'; end if;
    if not exists (select 1 from public.orders where id = v_champ.order_id and status = 'confirmed') then
      raise exception 'INVALID_STATE'; end if;
    if not exists (select 1 from public.reservations where championship_id = p_championship_id and status = 'spend') then
      raise exception 'INVALID_STATE'; end if;
    return v_champ;
  end if;
  if v_champ.status <> 'gateway_hold' then raise exception 'INVALID_STATE'; end if;
  if v_champ.order_id is null then raise exception 'ORDER_NOT_FOUND'; end if;

  select * into v_order from public.orders where id = v_champ.order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'pending' then raise exception 'INVALID_STATE'; end if;
  if v_order.pending_expires_at <= now() then raise exception 'ORDER_EXPIRED'; end if;

  -- Composición autoritativa = CRG. Lock de {games ∪ gemelos} ORDER BY id.
  select array_agg(game_id order by game_id) into v_ids
    from public.championship_reservation_games where championship_id = p_championship_id;
  if v_ids is null or array_length(v_ids, 1) is null then raise exception 'CHAMPIONSHIP_NO_GAMES'; end if;
  v_n := array_length(v_ids, 1);
  select array_agg(distinct x order by x) into v_lockset
    from (
      select unnest(v_ids) as x
      union
      select g.alternative_game_id from public.games g where g.id = any(v_ids) and g.alternative_game_id is not null
    ) s;
  perform 1 from public.games where id = any(v_lockset) order by id for update;

  -- Revalidar TODAS: siguen rentals published, libres y sin championship_id (all-or-none).
  if (select count(*) from public.games
        where id = any(v_ids) and type = 'rental' and status = 'published'
          and booked_by_user_id is null and championship_id is null) <> v_n then
    raise exception 'AVAILABILITY_CHANGED';
  end if;

  -- MATERIALIZAR (una sola sentencia atómica): published→reserved + championship_id. Dispara
  -- trg_block_double_out_twin por cada rental → sus gemelos Match pasan a 'blocked' (mecanismo existente).
  -- Si algún gemelo ya estaba tomado → el trigger lanza ALTERNATIVE_TAKEN → rollback TOTAL (ninguna reserved).
  update public.games set status = 'reserved', championship_id = v_champ.id where id = any(v_ids);

  -- order → confirmed; championship → pending_publish.
  update public.orders set status = 'confirmed', resolved_at = now(), updated_at = now() where id = v_order.id;
  update public.championships set status = 'pending_publish', updated_at = now()
   where id = p_championship_id returning * into v_champ;

  -- Breakdown congelado (fuente única del dinero). bruto = amount_total; credit/external del snapshot.
  v_snap    := coalesce(v_order.financial_snapshot, '{}'::jsonb);
  v_bruto   := round(coalesce((v_snap->>'amount_total')::numeric, v_order.amount_total, 0), 2);
  v_credito := round(coalesce((v_snap->>'credit_applied')::numeric, 0), 2);
  v_externo := round(coalesce((v_snap->>'external_amount')::numeric, v_bruto - v_credito), 2);

  -- Asiento financiero: 1 spend (UNIQUE parcial reservations_championship_spend_uq = última barrera).
  -- unit_price=subtotal=bruto; total=externo; credit del snapshot (semántica del flujo público).
  insert into public.reservations (
    game_id, championship_id, user_id, order_id,
    status, reservation_type, source, payment_method,
    unit_price, total_amount, subtotal_amount, credit_applied, reward_applied, promo_discount, promo_code_id,
    reserved_at
  ) values (
    null, v_champ.id, v_order.payer_user_id, v_order.id,
    'spend', 'championship', 'championship', coalesce(v_champ.payment_method, 'gateway'),
    v_bruto, v_externo, v_bruto, v_credito, 0, 0, null,
    now()
  );

  return v_champ;
end;
$$;
revoke all on function public.confirm_championship_gateway_payment(uuid) from public, anon;
grant execute on function public.confirm_championship_gateway_payment(uuid) to authenticated;


-- ── 2 · TRANSFERENCIA (Admin aprueba) — approve_championship_transfer ─────────────────────────
create or replace function public.approve_championship_transfer(p_championship_id uuid)
returns public.championships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_order public.orders%rowtype;
  v_snap    jsonb;
  v_bruto   numeric;
  v_credito numeric;
  v_externo numeric;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.user_roles
     where user_id = v_actor and role in ('algrass_admin', 'algrass_staff')
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- Lock championship PRIMERO (mismo orden que reject → mutuamente excluyentes, sin deadlock).
  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- Idempotencia VERIFICADA: 'pending_publish' es no-op SOLO si la operación financiera quedó COMPLETA.
  if v_champ.status = 'pending_publish' then
    if v_champ.order_id is null then raise exception 'INVALID_STATE'; end if;
    if not exists (select 1 from public.orders where id = v_champ.order_id and status = 'confirmed') then
      raise exception 'INVALID_STATE';
    end if;
    if not exists (select 1 from public.reservations where championship_id = p_championship_id and status = 'spend') then
      raise exception 'INVALID_STATE';
    end if;
    return v_champ;
  end if;
  if v_champ.status <> 'payment_validation' then raise exception 'INVALID_STATE'; end if;
  if v_champ.order_id is null then raise exception 'ORDER_NOT_FOUND'; end if;

  -- Lock order y validar transición.
  select * into v_order from public.orders where id = v_champ.order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'validation' then raise exception 'INVALID_STATE'; end if;

  -- orders: validation → confirmed (terminal, fija resolved_at).
  update public.orders
     set status = 'confirmed', resolved_at = now(), updated_at = now()
   where id = v_order.id;

  -- championships: payment_validation → pending_publish (puede publicar; NO se auto-publica).
  update public.championships
     set status = 'pending_publish', updated_at = now()
   where id = p_championship_id
  returning * into v_champ;

  -- games: NO se tocan (siguen reserved + championship_id). championship_reservation_games: NO se tocan.

  -- Breakdown congelado (fuente única del dinero). bruto = amount_total; credit/external del snapshot.
  v_snap    := coalesce(v_order.financial_snapshot, '{}'::jsonb);
  v_bruto   := round(coalesce((v_snap->>'amount_total')::numeric, v_order.amount_total, 0), 2);
  v_credito := round(coalesce((v_snap->>'credit_applied')::numeric, 0), 2);
  v_externo := round(coalesce((v_snap->>'external_amount')::numeric, v_bruto - v_credito), 2);

  -- Asiento financiero (spend) — 1 por campeonato. unit_price=subtotal=bruto; total=externo; credit del snapshot.
  insert into public.reservations (
    game_id, championship_id, user_id, order_id,
    status, reservation_type, source, payment_method,
    unit_price, total_amount, subtotal_amount, credit_applied, reward_applied, promo_discount, promo_code_id,
    reserved_at
  ) values (
    null, v_champ.id, v_order.payer_user_id, v_order.id,
    'spend', 'championship', 'championship', coalesce(v_champ.payment_method, 'transfer'),
    v_bruto, v_externo, v_bruto, v_credito, 0, 0, null,
    now()
  );

  return v_champ;
end;
$$;
revoke all on function public.approve_championship_transfer(uuid) from public, anon;
grant execute on function public.approve_championship_transfer(uuid) to authenticated;


-- ── 3 · Verificación ──────────────────────────────────────────────────────────────────────────
do $verify$
declare v_def text;
begin
  select pg_get_functiondef(to_regprocedure('public.confirm_championship_gateway_payment(uuid)')) into v_def;
  if v_def !~ 'external_amount' or v_def !~ 'credit_applied' then
    raise exception 'VERIFY: gateway confirm no usa external_amount/credit_applied del snapshot.';
  end if;
  if v_def !~ 'unit_price, total_amount, subtotal_amount, credit_applied' then
    raise exception 'VERIFY: gateway confirm no escribe unit_price en el spend.';
  end if;

  select pg_get_functiondef(to_regprocedure('public.approve_championship_transfer(uuid)')) into v_def;
  if v_def !~ 'external_amount' or v_def !~ 'credit_applied' then
    raise exception 'VERIFY: transfer approve no usa external_amount/credit_applied del snapshot.';
  end if;
  if v_def !~ 'unit_price, total_amount, subtotal_amount, credit_applied' then
    raise exception 'VERIFY: transfer approve no escribe unit_price en el spend.';
  end if;

  raise notice 'OK: creación de campeonato privado (gateway + transferencia) escribe unit_price/subtotal=bruto, total=externo y credit_applied del snapshot (paridad con el flujo público). orders.amount_total sigue BRUTO por diseño.';
end $verify$;

commit;
