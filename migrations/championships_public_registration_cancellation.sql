-- ============================================================================
-- Campeonatos PÚBLICOS · "Gestionar mi reserva" · DETALLE + CANCELACIÓN de inscripción
-- ============================================================================
-- Reutiliza el núcleo financiero EXISTENTE (Admin): la ÚNICA puerta de dinero es
-- _championship_refund_one(champ, spend_id, amount, scope, actor), que:
--   · techo = subtotal_amount del asiento − refunds previos (BRUTO, ya neto de reward);
--   · inserta UNA fila status='refund' (append-only) ligada al spend;
--   · acredita SIEMPRE a orders.payer_user_id (nunca a quien pulsa) vía apply_wallet_refund;
--   · es idempotente por índice único parcial sobre refund_scope->>'key'.
-- Reward NUNCA se devuelve (la fila refund lleva reward_applied=0 y el techo es subtotal,
-- que ya excluye el reward). El crédito usado vuelve como crédito de wallet.
--
-- Estas RPC son security definer: aunque _championship_refund_one esté revocada de
-- authenticated, el OWNER de las funciones (rol de migración) sí tiene execute, igual que
-- _championship_cancel_core. NO tocan orders.status → el trigger trg_orders_credit_restore
-- (pending/validation→failed/expired) NUNCA dispara → imposible doble devolución.
--
-- Ventana: SOLO registration_open (regla de producto). NO tocan Match/Rental, privados,
-- pagos de creación, reward, claves/token, Admin.
-- ============================================================================

begin;

do $pre$
begin
  if to_regprocedure('public._championship_refund_one(uuid, uuid, numeric, jsonb, uuid)') is null then
    raise exception 'Abortado: falta _championship_refund_one (aplica antes el nucleo de cancelacion Admin).';
  end if;
  if to_regprocedure('public._championship_participation(uuid, uuid)') is null then
    raise exception 'Abortado: falta _championship_participation (aplica antes championships_public_individual_itemized.sql).';
  end if;
end $pre$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 1 · get_championship_my_reservation — DETALLE de MI reserva PAGADA (o null)
-- ══════════════════════════════════════════════════════════════════════════════
-- Devuelve null si el actor no tiene reserva PAGADA (free_member/free_individual → no ve
-- "Gestionar mi reserva"). kind: 'paid_individual_payer' | 'paid_individual_guest' | 'team_owner'.
create or replace function public.get_championship_my_reservation(p_championship_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_open  boolean;
  v_order public.orders%rowtype;
  v_spend public.reservations%rowtype;
  v_team  public.championship_teams%rowtype;
  v_snap  jsonb;
  v_unit  numeric;
  v_reward numeric;
  v_payer uuid;
  v_refunded numeric;
  v_plazas jsonb;
begin
  if v_actor is null then return null; end if;
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then return null; end if;
  v_open := (v_champ.status = 'registration_open');

  -- ── team_owner: equipo creado por el actor con order pagada ──
  select * into v_team from public.championship_teams
   where championship_id = p_championship_id and created_by_user_id = v_actor and order_id is not null
   limit 1;
  if found then
    select * into v_order from public.orders where id = v_team.order_id;
    select * into v_spend from public.reservations where order_id = v_team.order_id and status = 'spend' limit 1;
    v_snap := coalesce(v_order.financial_snapshot, '{}'::jsonb);
    select coalesce(sum(coalesce(total_amount, 0)), 0) into v_refunded
      from public.reservations where status = 'refund' and refund_of_reservation_id = v_spend.id;
    return jsonb_build_object(
      'kind', 'team_owner',
      'championship_id', p_championship_id, 'championship_status', v_champ.status,
      'currency', coalesce(v_order.currency, 'PEN'), 'order_id', v_order.id,
      'team_id', v_team.id, 'team_name', v_team.name,
      'member_count', (select count(*) from public.championship_players where team_id = v_team.id),
      'other_member_count', (select count(*) from public.championship_players where team_id = v_team.id and user_id <> v_actor),
      'unit_price', coalesce((v_snap->>'unit_price')::numeric, v_spend.unit_price),
      'reward_applied', coalesce((v_snap->>'reward_applied')::numeric, 0),
      'subtotal_amount', coalesce((v_snap->>'subtotal_amount')::numeric, v_spend.subtotal_amount),
      'credit_applied', coalesce((v_snap->>'credit_applied')::numeric, 0),
      'external_amount', coalesce((v_snap->>'external_amount')::numeric, v_spend.total_amount),
      'payment_method', v_spend.payment_method,
      'refundable_total', round(greatest(0, coalesce(v_spend.subtotal_amount, v_spend.total_amount, 0) - v_refunded), 2),
      'cancelable', v_open
    );
  end if;

  -- ── paid_individual: order confirmada de inscripción que incluye al actor ──
  select * into v_order from public.orders o
   where o.resource_type = 'championship' and o.resource_id = p_championship_id and o.status = 'confirmed'
     and coalesce(o.claim_composition->>'kind', '') = 'championship_registration'
     and (o.claim_composition->'user_ids') ? v_actor::text
   order by o.resolved_at desc nulls last
   limit 1;
  if not found then return null; end if;

  select * into v_spend from public.reservations where order_id = v_order.id and status = 'spend' limit 1;
  v_snap   := coalesce(v_order.financial_snapshot, '{}'::jsonb);
  v_unit   := coalesce((v_snap->>'unit_price')::numeric, 0);
  v_reward := coalesce((v_snap->>'reward_applied')::numeric, 0);
  v_payer  := v_order.payer_user_id;

  if v_payer = v_actor then
    -- PAYER: todas las plazas (titular primero), cada una con su monto reembolsable y si sigue inscrita.
    select jsonb_agg(jsonb_build_object(
        'user_id', q.uid,
        'full_name', coalesce(up.full_name, 'Jugador'),
        'is_payer', (q.uid = v_payer),
        'amount', case when q.uid = v_payer then round(v_unit - v_reward, 2) else round(v_unit, 2) end,
        'canceled', not exists (select 1 from public.championship_players cp
                                  where cp.championship_id = p_championship_id and cp.user_id = q.uid)
      ) order by (q.uid = v_payer) desc, up.full_name asc)
      into v_plazas
      from (select (jsonb_array_elements_text(v_order.claim_composition->'user_ids'))::uuid as uid) q
      left join public.users_public up on up.id = q.uid;
    return jsonb_build_object(
      'kind', 'paid_individual_payer',
      'championship_id', p_championship_id, 'championship_status', v_champ.status,
      'currency', coalesce(v_order.currency, 'PEN'), 'order_id', v_order.id,
      'unit_price', v_unit, 'reward_applied', v_reward,
      'player_count', coalesce((v_snap->>'player_count')::int, 1),
      'guest_total', coalesce((v_snap->>'guest_total')::numeric, 0),
      'subtotal_amount', coalesce((v_snap->>'subtotal_amount')::numeric, v_spend.subtotal_amount),
      'credit_applied', coalesce((v_snap->>'credit_applied')::numeric, 0),
      'external_amount', coalesce((v_snap->>'external_amount')::numeric, v_spend.total_amount),
      'payment_method', v_spend.payment_method,
      'plazas', coalesce(v_plazas, '[]'::jsonb),
      'cancelable', v_open
    );
  end if;

  -- INVITADO: solo su propia plaza (nunca lleva reward).
  return jsonb_build_object(
    'kind', 'paid_individual_guest',
    'championship_id', p_championship_id, 'championship_status', v_champ.status,
    'currency', coalesce(v_order.currency, 'PEN'), 'order_id', v_order.id,
    'unit_price', v_unit, 'my_amount', round(v_unit, 2),
    'payer_user_id', v_payer,
    'payer_name', (select full_name from public.users_public where id = v_payer),
    'my_canceled', not exists (select 1 from public.championship_players cp
                                where cp.championship_id = p_championship_id and cp.user_id = v_actor),
    'cancelable', v_open
  );
end $$;
revoke all on function public.get_championship_my_reservation(uuid) from public, anon;
grant execute on function public.get_championship_my_reservation(uuid) to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2 · cancel_championship_registration_plaza — cancelar plaza(s) individuales
-- ══════════════════════════════════════════════════════════════════════════════
-- PAYER cancela cualquier subconjunto de SU order (su plaza y/o la de sus invitados).
-- INVITADO cancela SOLO la suya. Refund por plaza al PAYER original. Idempotente.
create or replace function public.cancel_championship_registration_plaza(
  p_championship_id uuid,
  p_user_ids        uuid[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_order public.orders%rowtype;
  v_spend public.reservations%rowtype;
  v_snap  jsonb;
  v_unit  numeric;
  v_reward numeric;
  v_payer uuid;
  v_uids  jsonb;
  v_ids   uuid[];
  v_uid   uuid;
  v_amount numeric;
  v_key   text;
  v_refunded_total numeric := 0;
  v_canceled uuid[] := '{}';
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_user_ids, '{}'::uuid[])) x where x is not null;
  if v_ids is null or array_length(v_ids, 1) is null then raise exception 'NO_PLAYERS'; end if;

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.status <> 'registration_open' then raise exception 'CANCEL_WINDOW_CLOSED'; end if;

  select * into v_order from public.orders o
   where o.resource_type = 'championship' and o.resource_id = p_championship_id and o.status = 'confirmed'
     and coalesce(o.claim_composition->>'kind', '') = 'championship_registration'
     and (o.claim_composition->'user_ids') ? v_actor::text
   order by o.resolved_at desc nulls last
   limit 1;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  v_payer := v_order.payer_user_id;
  v_uids  := v_order.claim_composition->'user_ids';

  -- Autorización: invitado (no payer) solo puede cancelar SU propia plaza.
  if v_actor <> v_payer then
    if not (array_length(v_ids, 1) = 1 and v_ids[1] = v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  end if;
  -- Todas las plazas deben pertenecer a ESTA order.
  foreach v_uid in array v_ids loop
    if not (v_uids ? v_uid::text) then raise exception 'PLAYER_NOT_IN_ORDER'; end if;
  end loop;

  select * into v_spend from public.reservations where order_id = v_order.id and status = 'spend' limit 1;
  if not found then raise exception 'SPEND_NOT_FOUND'; end if;
  v_snap   := coalesce(v_order.financial_snapshot, '{}'::jsonb);
  v_unit   := coalesce((v_snap->>'unit_price')::numeric, 0);
  v_reward := coalesce((v_snap->>'reward_applied')::numeric, 0);

  foreach v_uid in array v_ids loop
    v_key := 'plaza:' || v_order.id::text || ':' || v_uid::text;
    -- Retira la inscripción individual (idempotente: delete no-op si ya no está).
    delete from public.championship_players
      where championship_id = p_championship_id and user_id = v_uid and team_id is null;
    -- Dinero: solo si esa plaza no fue reembolsada aún (guard por clave → nunca doble refund).
    if not exists (select 1 from public.reservations rr
                    where rr.status = 'refund' and rr.refund_scope->>'key' = v_key) then
      v_amount := case when v_uid = v_payer then round(v_unit - v_reward, 2) else round(v_unit, 2) end;
      if v_amount > 0 then
        perform public._championship_refund_one(p_championship_id, v_spend.id, v_amount,
          jsonb_build_object('kind', 'plaza', 'key', v_key, 'user_id', v_uid), v_actor);
        v_refunded_total := v_refunded_total + v_amount;
      end if;
    end if;
    v_canceled := array_append(v_canceled, v_uid);
  end loop;

  return jsonb_build_object('championship_id', p_championship_id, 'order_id', v_order.id,
    'canceled', to_jsonb(v_canceled), 'refunded_total', round(v_refunded_total, 2));
end $$;
revoke all on function public.cancel_championship_registration_plaza(uuid, uuid[]) from public, anon;
grant execute on function public.cancel_championship_registration_plaza(uuid, uuid[]) to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3 · cancel_championship_team_registration — owner cancela la reserva del EQUIPO
-- ══════════════════════════════════════════════════════════════════════════════
-- Owner financiero (created_by + order pagada). Si hay miembros además del owner y
-- p_confirm=false → TEAM_HAS_MEMBERS (el front avisa; con confirm=true cancela igual).
-- Refund del equipo completo al payer; retira a TODOS los miembros y elimina el equipo.
create or replace function public.cancel_championship_team_registration(
  p_championship_id uuid,
  p_team_id         uuid,
  p_confirm         boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_team  public.championship_teams%rowtype;
  v_spend public.reservations%rowtype;
  v_refunded numeric;
  v_techo numeric := 0;
  v_others int;
  v_removed int;
  v_key   text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.status <> 'registration_open' then raise exception 'CANCEL_WINDOW_CLOSED'; end if;

  select * into v_team from public.championship_teams
   where id = p_team_id and championship_id = p_championship_id for update;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  if v_team.created_by_user_id is distinct from v_actor or v_team.order_id is null then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select count(*) into v_others from public.championship_players
   where team_id = p_team_id and user_id <> v_actor;
  if v_others > 0 and not coalesce(p_confirm, false) then raise exception 'TEAM_HAS_MEMBERS'; end if;

  select * into v_spend from public.reservations where order_id = v_team.order_id and status = 'spend' limit 1;
  if not found then raise exception 'SPEND_NOT_FOUND'; end if;

  v_key := 'teamreg:' || v_team.order_id::text;
  if not exists (select 1 from public.reservations rr
                  where rr.status = 'refund' and rr.refund_scope->>'key' = v_key) then
    select coalesce(sum(coalesce(total_amount, 0)), 0) into v_refunded
      from public.reservations where status = 'refund' and refund_of_reservation_id = v_spend.id;
    v_techo := round(greatest(0, coalesce(v_spend.subtotal_amount, v_spend.total_amount, 0) - v_refunded), 2);
    if v_techo > 0 then
      perform public._championship_refund_one(p_championship_id, v_spend.id, v_techo,
        jsonb_build_object('kind', 'team', 'key', v_key, 'team_id', p_team_id), v_actor);
    end if;
  end if;

  delete from public.championship_players where team_id = p_team_id;
  get diagnostics v_removed = row_count;
  delete from public.championship_teams where id = p_team_id;

  return jsonb_build_object('championship_id', p_championship_id, 'team_id', p_team_id,
    'members_removed', v_removed, 'refunded', v_techo);
end $$;
revoke all on function public.cancel_championship_team_registration(uuid, uuid, boolean) from public, anon;
grant execute on function public.cancel_championship_team_registration(uuid, uuid, boolean) to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 4 · Verificación
-- ══════════════════════════════════════════════════════════════════════════════
do $verify$
declare v_def text;
begin
  if to_regprocedure('public.get_championship_my_reservation(uuid)') is null
     or to_regprocedure('public.cancel_championship_registration_plaza(uuid, uuid[])') is null
     or to_regprocedure('public.cancel_championship_team_registration(uuid, uuid, boolean)') is null then
    raise exception 'VERIFY: falta alguna RPC de gestion/cancelacion de reserva.';
  end if;

  -- Las dos cancelaciones deben pasar por la ÚNICA puerta de dinero y nunca tocar orders.status.
  foreach v_def in array array[
    pg_get_functiondef(to_regprocedure('public.cancel_championship_registration_plaza(uuid, uuid[])')),
    pg_get_functiondef(to_regprocedure('public.cancel_championship_team_registration(uuid, uuid, boolean)'))
  ] loop
    if v_def !~ '_championship_refund_one' then raise exception 'VERIFY: una cancelacion no usa _championship_refund_one (puerta unica de dinero).'; end if;
    if v_def ~ 'update public.orders set status' then raise exception 'VERIFY: una cancelacion toca orders.status (dispararia restauracion de credito = doble refund).'; end if;
    if v_def !~ 'registration_open' then raise exception 'VERIFY: una cancelacion no limita la ventana a registration_open.'; end if;
  end loop;

  raise notice 'OK: get_my_reservation + cancelaciones (plaza individual / equipo). Refund via _championship_refund_one (idempotente por key, al payer, reward=0). No tocan orders.status. Ventana registration_open.';
end $verify$;

commit;
