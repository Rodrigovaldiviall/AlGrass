-- ============================================================================
-- Campeonatos PÚBLICOS · championship_players.registration_order_id (fuente VIVA order↔plaza)
-- ============================================================================
-- Añade championship_players.registration_order_id (uuid null, FK orders) para saber DIRECTAMENTE qué order
-- pagó/originó la plaza VIVA de cada jugador. Con esto, la relación viva order↔player no depende de refund_scope.
--
--   · Inscripción individual pagada (confirm) → cada jugador materializado lleva registration_order_id = order.
--     Reinscripción: O1 viejo cancelado (fila borrada) → O2 nuevo deja la fila con registration_order_id = O2.
--   · Participaciones GRATIS (join por clave/token, owner-add, "sin equipo" gratis) → registration_order_id = null.
--   · Equipo pagado → la fuente sigue siendo championship_teams.order_id; la fila del owner NO duplica aquí.
--
-- Reemite (todas SECURITY DEFINER; funciones ya aplicadas en otras migraciones → se reemiten aquí, no se editan):
--   · confirm_championship_registration → guarda registration_order_id en el UPSERT.
--   · cancel_championship_registration_plaza → localiza la plaza por (champ,user,registration_order_id) y autoriza
--     por payer/self; refund/ledger como hoy (refund_scope sigue para dinero/idempotencia e historial).
--   · get_championship_my_reservation → gestión del payer vía JOIN cp→orders (soporta multi-order por reinscripción).
--
-- NO toca: add players, pagos, reward, wallet, checkout visual, privados, Admin, Match/Rental, registration_closed,
-- team secret/token, ni el resto del flujo individual.
-- ============================================================================

begin;

do $pre$
begin
  if to_regprocedure('public.confirm_championship_registration(uuid, text)') is null
     or to_regprocedure('public.cancel_championship_registration_plaza(uuid, uuid[])') is null
     or to_regprocedure('public.get_championship_my_reservation(uuid)') is null then
    raise exception 'Abortado: faltan RPC base (aplica antes itemized + registration_cancellation).';
  end if;
  if to_regprocedure('public._championship_refund_one(uuid, uuid, numeric, jsonb, uuid)') is null then
    raise exception 'Abortado: falta _championship_refund_one (nucleo de cancelacion Admin).';
  end if;
end $pre$;


-- ── 0 · Schema ───────────────────────────────────────────────────────────────
alter table public.championship_players
  add column if not exists registration_order_id uuid references public.orders(id) on delete set null;
-- Índice para el JOIN de gestión (cp.registration_order_id → orders) y el bloqueo de crear equipo.
create index if not exists championship_players_reg_order_idx
  on public.championship_players (registration_order_id) where registration_order_id is not null;


-- ── 0b · Backfill SEGURO de las plazas individuales pagadas YA existentes ────────
-- Debe correr ANTES de que cancel/getter/team-guard dependan de la columna. Solo plazas INDIVIDUALES vivas
-- (team_id null, registration_order_id null): un miembro de equipo (team_id no nulo) y el owner (fuente
-- championship_teams.order_id) quedan NULL por diseño.
-- Candidata = order championship confirmed kind='championship_registration' con cp.user_id en user_ids y SIN
-- marca de cancelación order-specific (refund_scope key 'plaza:<order>:<user>'). Resolución SEGURA:
--   · exactamente 1 candidata → asignar;  · 0 → gratis, dejar NULL;  · ≥2 → ABORTAR (ambigüedad → revisión manual).
-- NO heurísticas (sin resolved_at/LIMIT) para desempatar.
do $backfill$
declare
  r       record;
  v_cands uuid[];
  v_n     int;
begin
  for r in
    select cp.championship_id, cp.user_id
      from public.championship_players cp
     where cp.registration_order_id is null and cp.team_id is null
  loop
    select array_agg(o.id) into v_cands
      from public.orders o
     where o.resource_type = 'championship' and o.resource_id = r.championship_id
       and o.status = 'confirmed'
       and coalesce(o.claim_composition->>'kind','') = 'championship_registration'
       and (o.claim_composition->'user_ids') ? r.user_id::text
       and not exists (select 1 from public.reservations rr
                        where rr.status = 'refund'
                          and rr.refund_scope->>'key' = 'plaza:' || o.id::text || ':' || r.user_id::text);
    v_n := coalesce(array_length(v_cands, 1), 0);
    if v_n = 0 then
      continue;                                   -- participación gratuita (sin equipo gratis u otra) → NULL
    elsif v_n = 1 then
      update public.championship_players
         set registration_order_id = v_cands[1]
       where championship_id = r.championship_id and user_id = r.user_id;
    else
      raise exception 'BACKFILL_AMBIGUOUS: championship=% user=% tiene % ordenes individuales candidatas; requiere revision manual.',
        r.championship_id, r.user_id, v_n;
    end if;
  end loop;
end $backfill$;


-- ── 1 · confirm individual · guarda registration_order_id en el UPSERT ───────────
create or replace function public.confirm_championship_registration(
  p_championship_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order  public.orders%rowtype;
  v_champ  public.championships%rowtype;
  v_ids    uuid[];
  v_uid    uuid;
  v_snap   jsonb;
  v_unit   numeric;
  v_count  integer;
  v_guests numeric;
  v_reward numeric;
  v_subtotal numeric;
  v_credito  numeric;
  v_external numeric;
  v_method text;
  v_resv_id uuid;
  v_applied boolean;
  v_reason  text;
  v_part   text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_order from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.resource_type <> 'championship' or v_order.resource_id <> p_championship_id
     or coalesce(v_order.claim_composition->>'kind','') <> 'championship_registration' then
    raise exception 'INVALID_STATE';
  end if;

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  if v_order.status = 'confirmed' then
    if exists (select 1 from public.reservations where order_id = v_order.id and status = 'spend') then
      return jsonb_build_object('order_id', v_order.id, 'status', 'confirmed', 'already', true);
    end if;
    raise exception 'INVALID_STATE';
  end if;
  if v_order.status <> 'pending' then raise exception 'INVALID_STATE'; end if;
  if v_order.pending_expires_at <= now() then raise exception 'ORDER_EXPIRED'; end if;

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.status <> 'registration_open' then raise exception 'AVAILABILITY_CHANGED'; end if;

  select array(select jsonb_array_elements_text(v_order.claim_composition->'user_ids'))::uuid[] into v_ids;
  if v_ids is null or array_length(v_ids,1) is null then raise exception 'INVALID_STATE'; end if;

  foreach v_uid in array v_ids loop
    v_part := public._championship_participation(p_championship_id, v_uid);
    if v_part in ('paid_individual','team_owner') then raise exception 'AVAILABILITY_CHANGED'; end if;
    if v_uid <> v_actor and v_part = 'free_member' then raise exception 'AVAILABILITY_CHANGED'; end if;
  end loop;

  -- Materializar: cada jugador queda como inscripción individual (team_id null) de ESTA order.
  -- registration_order_id = v_order.id → fuente viva order↔plaza (reinscripción pisa con la order nueva).
  foreach v_uid in array v_ids loop
    insert into public.championship_players (championship_id, user_id, team_id, registration_order_id)
    values (p_championship_id, v_uid, null, v_order.id)
    on conflict (championship_id, user_id) do update set team_id = null, registration_order_id = v_order.id;
  end loop;

  v_snap     := v_order.financial_snapshot;
  v_unit     := round(coalesce((v_snap->>'unit_price')::numeric, v_order.amount_total), 2);
  v_count    := coalesce((v_snap->>'player_count')::int, array_length(v_ids,1));
  v_guests   := round(coalesce((v_snap->>'guest_total')::numeric, 0), 2);
  v_reward   := round(coalesce((v_snap->>'reward_applied')::numeric, 0), 2);
  v_subtotal := round(coalesce((v_snap->>'subtotal_amount')::numeric, v_order.amount_total), 2);
  v_credito  := round(coalesce((v_snap->>'credit_applied')::numeric, 0), 2);
  v_external := round(coalesce((v_snap->>'external_amount')::numeric, v_subtotal - v_credito), 2);

  v_method := case when coalesce((v_snap->>'external_amount')::numeric, v_order.amount_total) = 0
                        and v_order.amount_total > 0
                   then 'credit' else coalesce(v_order.payment_provider, 'gateway') end;

  insert into public.reservations (
    game_id, championship_id, user_id, order_id,
    status, reservation_type, source, payment_method,
    unit_price, players_count, guest_total,
    total_amount, subtotal_amount, credit_applied, reward_applied, promo_discount, promo_code_id,
    reserved_at
  ) values (
    null, p_championship_id, v_order.payer_user_id, v_order.id,
    'spend', 'championship', 'championship_registration', v_method,
    v_unit, v_count, v_guests,
    v_external, v_subtotal, v_credito, v_reward, 0, null,
    now()
  ) returning id into v_resv_id;

  if v_reward > 0 then
    select applied, reason into v_applied, v_reason
      from public.consume_reward(v_order.payer_user_id, v_resv_id, v_reward);
    if not coalesce(v_applied, false) then
      raise exception 'REWARD_%', coalesce(v_reason, 'UNAVAILABLE');
    end if;
  end if;

  update public.orders set status = 'confirmed', resolved_at = now(), updated_at = now()
   where id = v_order.id;

  return jsonb_build_object('order_id', v_order.id, 'status', 'confirmed',
    'players', array_length(v_ids,1), 'subtotal_amount', v_subtotal,
    'external_amount', round(coalesce((v_snap->>'external_amount')::numeric, v_subtotal - v_credito), 2),
    'reward_applied', v_reward, 'already', false);
end $$;
revoke all on function public.confirm_championship_registration(uuid, text) from public, anon;
grant execute on function public.confirm_championship_registration(uuid, text) to authenticated;


-- ── 2 · cancel plaza · localiza por registration_order_id + autoriza payer/self ──
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
  v_cp    public.championship_players%rowtype;
  v_order public.orders%rowtype;
  v_spend public.reservations%rowtype;
  v_snap  jsonb;
  v_unit  numeric;
  v_reward numeric;
  v_oid   uuid;
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

  foreach v_uid in array v_ids loop
    -- Fila VIVA de la plaza; si ya no está, idempotente → siguiente.
    select * into v_cp from public.championship_players
     where championship_id = p_championship_id and user_id = v_uid;
    if not found then continue; end if;
    v_oid := v_cp.registration_order_id;
    if v_oid is null then raise exception 'PLAYER_NOT_IN_ORDER'; end if;   -- plaza gratis no se cancela por aquí

    select * into v_order from public.orders where id = v_oid;
    if not found or v_order.status <> 'confirmed'
       or v_order.resource_id <> p_championship_id
       or coalesce(v_order.claim_composition->>'kind','') <> 'championship_registration' then
      raise exception 'INVALID_STATE';
    end if;

    -- Autorización: el PAYER de esa order puede cancelar cualquier plaza suya; un invitado solo la propia.
    if v_actor <> v_order.payer_user_id and v_actor <> v_uid then raise exception 'NOT_AUTHORIZED'; end if;

    select * into v_spend from public.reservations where order_id = v_oid and status = 'spend' limit 1;
    if not found then raise exception 'SPEND_NOT_FOUND'; end if;
    v_snap   := coalesce(v_order.financial_snapshot, '{}'::jsonb);
    v_unit   := coalesce((v_snap->>'unit_price')::numeric, 0);
    v_reward := coalesce((v_snap->>'reward_applied')::numeric, 0);
    v_key    := 'plaza:' || v_oid::text || ':' || v_uid::text;

    -- Retira la fila VIVA (fuente de participación). El histórico queda en el ledger (refund_scope).
    delete from public.championship_players where championship_id = p_championship_id and user_id = v_uid;

    -- Refund económico SOLO si hay importe (reward NUNCA vuelve). Idempotente por refund_scope key.
    v_amount := case when v_uid = v_order.payer_user_id then round(v_unit - v_reward, 2) else round(v_unit, 2) end;
    if v_amount > 0 and not exists (select 1 from public.reservations rr
                                     where rr.status = 'refund' and rr.refund_scope->>'key' = v_key) then
      perform public._championship_refund_one(p_championship_id, v_spend.id, v_amount,
        jsonb_build_object('kind', 'plaza', 'key', v_key, 'user_id', v_uid), v_actor);
      v_refunded_total := v_refunded_total + v_amount;
    end if;
    v_canceled := array_append(v_canceled, v_uid);
  end loop;

  return jsonb_build_object('championship_id', p_championship_id,
    'canceled', to_jsonb(v_canceled), 'refunded_total', round(v_refunded_total, 2));
end $$;
revoke all on function public.cancel_championship_registration_plaza(uuid, uuid[]) from public, anon;
grant execute on function public.cancel_championship_registration_plaza(uuid, uuid[]) to authenticated;


-- ── 3 · get_championship_my_reservation · gestión del payer vía JOIN cp→orders ───
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
  v_oid   uuid;
  v_refunded numeric;
  v_plazas jsonb;
  v_orders jsonb;
begin
  if v_actor is null then return null; end if;
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then return null; end if;
  v_open := (v_champ.status = 'registration_open');

  -- ── team_owner (fuente: championship_teams.order_id; registration_order_id NO aplica al owner) ──
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

  -- ── paid individual · order CABECERA (fuente viva) ──
  -- (a) mi propia plaza viva → su registration_order_id; (b) sin plaza propia pero soy payer de órdenes con
  --     plazas vivas (gestiono invitados) → la order propia más reciente con plazas vivas.
  select cp.registration_order_id into v_oid
    from public.championship_players cp
   where cp.championship_id = p_championship_id and cp.user_id = v_actor
     and cp.registration_order_id is not null
   limit 1;
  if v_oid is not null then
    select * into v_order from public.orders where id = v_oid;
  else
    select o.* into v_order
      from public.orders o
     where o.resource_type = 'championship' and o.resource_id = p_championship_id and o.status = 'confirmed'
       and coalesce(o.claim_composition->>'kind','') = 'championship_registration'
       and o.payer_user_id = v_actor
       and exists (select 1 from public.championship_players cp
                    where cp.championship_id = p_championship_id and cp.registration_order_id = o.id)
     order by o.resolved_at desc nulls last
     limit 1;
    if not found then return null; end if;
  end if;

  select * into v_spend from public.reservations where order_id = v_order.id and status = 'spend' limit 1;
  v_snap   := coalesce(v_order.financial_snapshot, '{}'::jsonb);
  v_unit   := coalesce((v_snap->>'unit_price')::numeric, 0);
  v_reward := coalesce((v_snap->>'reward_applied')::numeric, 0);

  if v_order.payer_user_id = v_actor then
    -- PAYER: plazas de TODAS mis órdenes individuales confirmadas en este campeonato (multi-order por reinscripción).
    -- Se muestra cada (order, user); se oculta un (order,user) cancelado si ese user ya tiene plaza VIVA en otra
    -- de mis órdenes (evita duplicar al titular tras reinscribirse). `canceled` = sin fila viva para esa (order,user).
    select jsonb_agg(x order by (x->>'is_payer')::boolean desc, x->>'full_name')
      into v_plazas
      from (
        select jsonb_build_object(
          'user_id', base.uid,
          'full_name', coalesce(up.full_name, 'Jugador'),
          'is_payer', (base.uid = v_actor),
          'order_id', base.oid,
          'amount', case when base.uid = v_actor
                         then round(coalesce((base.snap->>'unit_price')::numeric,0) - coalesce((base.snap->>'reward_applied')::numeric,0), 2)
                         else round(coalesce((base.snap->>'unit_price')::numeric,0), 2) end,
          'canceled', not l.live
        ) as x
        from (
          select o2.id as oid, o2.financial_snapshot as snap,
                 (jsonb_array_elements_text(o2.claim_composition->'user_ids'))::uuid as uid
          from public.orders o2
          where o2.resource_type='championship' and o2.resource_id=p_championship_id and o2.status='confirmed'
            and coalesce(o2.claim_composition->>'kind','')='championship_registration'
            and o2.payer_user_id = v_actor
        ) base
        cross join lateral (
          select exists (select 1 from public.championship_players cp
                          where cp.championship_id=p_championship_id and cp.user_id=base.uid
                            and cp.registration_order_id=base.oid) as live,
                 exists (select 1 from public.championship_players cp
                          where cp.championship_id=p_championship_id and cp.user_id=base.uid) as live_any
        ) l
        left join public.users_public up on up.id = base.uid
        where l.live or not l.live_any   -- viva, o cancelada sin plaza viva en otra order (no duplicar titular)
      ) agg;
    -- Detalle financiero POR order: una entrada por cada order mía con ≥1 plaza VIVA (cada una conserva su propio
    -- snapshot; NUNCA se suman reward/crédito entre orders). El front muestra un bloque por order si hay >1.
    select jsonb_agg(jsonb_build_object(
        'order_id', q.oid,
        'unit_price', coalesce((q.snap->>'unit_price')::numeric, 0),
        'reward_applied', coalesce((q.snap->>'reward_applied')::numeric, 0),
        'player_count', coalesce((q.snap->>'player_count')::int, 1),
        'guest_total', coalesce((q.snap->>'guest_total')::numeric, 0),
        'subtotal_amount', coalesce((q.snap->>'subtotal_amount')::numeric, 0),
        'credit_applied', coalesce((q.snap->>'credit_applied')::numeric, 0),
        'external_amount', coalesce((q.snap->>'external_amount')::numeric, 0),
        'payment_method', q.pm
      ) order by q.resolved asc nulls first)
      into v_orders
      from (
        select o3.id as oid, o3.financial_snapshot as snap, o3.resolved_at as resolved,
               (select r.payment_method from public.reservations r where r.order_id = o3.id and r.status = 'spend' limit 1) as pm
        from public.orders o3
        where o3.resource_type='championship' and o3.resource_id=p_championship_id and o3.status='confirmed'
          and coalesce(o3.claim_composition->>'kind','')='championship_registration'
          and o3.payer_user_id = v_actor
          and exists (select 1 from public.championship_players cp
                       where cp.championship_id = p_championship_id and cp.registration_order_id = o3.id)
      ) q;
    return jsonb_build_object(
      'kind', 'paid_individual_payer',
      'orders', coalesce(v_orders, '[]'::jsonb),
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

  -- INVITADO (plaza propia financiada por otro): solo su plaza; `my_canceled` = ya no tiene fila viva de esa order.
  return jsonb_build_object(
    'kind', 'paid_individual_guest',
    'championship_id', p_championship_id, 'championship_status', v_champ.status,
    'currency', coalesce(v_order.currency, 'PEN'), 'order_id', v_order.id,
    'unit_price', v_unit, 'my_amount', round(v_unit, 2),
    'payer_user_id', v_order.payer_user_id,
    'payer_name', (select full_name from public.users_public where id = v_order.payer_user_id),
    'my_canceled', not exists (select 1 from public.championship_players cp
                                where cp.championship_id = p_championship_id and cp.user_id = v_actor
                                  and cp.registration_order_id = v_order.id),
    'cancelable', v_open
  );
end $$;
revoke all on function public.get_championship_my_reservation(uuid) from public, anon;
grant execute on function public.get_championship_my_reservation(uuid) to authenticated;


-- ── 4 · Verificación ──────────────────────────────────────────────────────────
do $verify$
declare v_def text;
begin
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='championship_players' and column_name='registration_order_id') then
    raise exception 'VERIFY: falta championship_players.registration_order_id.';
  end if;

  select pg_get_functiondef(to_regprocedure('public.confirm_championship_registration(uuid, text)')) into v_def;
  if v_def !~ 'registration_order_id = v_order.id' then
    raise exception 'VERIFY: confirm individual no guarda registration_order_id.';
  end if;

  select pg_get_functiondef(to_regprocedure('public.cancel_championship_registration_plaza(uuid, uuid[])')) into v_def;
  if v_def !~ 'v_cp.registration_order_id' then
    raise exception 'VERIFY: cancel no localiza la plaza por registration_order_id.';
  end if;
  if v_def ~ 'order by o.resolved_at desc nulls last' then
    raise exception 'VERIFY: cancel sigue usando la ultima order (LIMIT 1) en vez de registration_order_id.';
  end if;

  select pg_get_functiondef(to_regprocedure('public.get_championship_my_reservation(uuid)')) into v_def;
  if v_def !~ 'registration_order_id' then
    raise exception 'VERIFY: get_my_reservation no usa registration_order_id.';
  end if;

  raise notice 'OK: registration_order_id como fuente viva; confirm lo guarda; cancel localiza por el; get_my_reservation gestiona multi-order.';
end $verify$;

commit;
