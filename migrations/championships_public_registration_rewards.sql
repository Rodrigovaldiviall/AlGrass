-- ============================================================================
-- Campeonatos PÚBLICOS · REWARDS en inscripción pagada (individual + base equipo)
-- ============================================================================
-- Incremental SOBRE championships_public_individual_registration.sql (reemite
-- create/confirm con soporte de Reward). NO edita esa migración ni ninguna aplicada.
--
-- Política de Reward = EXACTA de Match (ConfirmReservation + materializeReservation
-- + consume_reward):
--   · OPCIONAL (el App decide enviarlo o no vía p_config.reward_applied);
--   · SOLO el PAYER/titular (saldo del comprador); invitados NO aportan reward;
--   · TOPE por operación = min(reward_balance_del_payer, unit_price) → una unidad;
--   · ORDEN de aplicación: reward descuenta el TOTAL primero, luego crédito sobre el
--     restante, luego monto externo  (reward → crédito → externo, igual que Match:
--     titularNet = unit − reward; subtotal; credit = min(saldo, subtotal); externo);
--   · SNAPSHOT: order.financial_snapshot.reward_applied, acotado server-side a unit_price
--     (clamp inline least(req, unit); NUNCA se confía en el monto crudo). El SALDO lo valida
--     de forma AUTORITATIVA consume_reward en el confirm (igual que Match: create_order no
--     capea por saldo; la autoridad del saldo es consume_reward);
--   · CONSUMO: consume_reward (la MISMA RPC de Match) ejecutada en la CONFIRMACIÓN
--     exitosa, contra la reserva `spend` de la order (p_reservation_id). Idempotente
--     por idempotency_key 'spend:<reservation_id>'; decremento condicional por saldo.
--   · FALLO/EXPIRACIÓN antes de confirmar: el reward NO se consume (solo se consume en
--     confirm). No requiere restitución de reward. El crédito sí se restituye por el
--     trigger trg_orders_credit_restore (se debitó al crear la order).
--
-- EQUIPO (public_team_price): el checkout pagado por equipo AÚN NO EXISTE (no hay RPC
-- create_championship_team_registration_order / confirm). NO se construye aquí. Reutiliza
-- las MISMAS piezas que Match: el clamp inline a unit_price en el create y consume_reward
-- en el confirm. No hace falta ningún helper nuevo. Punto de integración en §3.
--
-- NO toca: privados, create_order/confirm_order (match/rental), game_players, fixture,
-- Admin, publicación, registration_key, lógica de Match, reglas de capitán/R1. Idempotente.
--
-- Errores nuevos: REWARD_INSUFFICIENT_REWARD · REWARD_REWARD_CONFLICT · REWARD_UNAVAILABLE
--   (del gate consume_reward en confirm). Resto de errores = los de la migración base.
-- ============================================================================

begin;

-- ── 0 · Pre-checks ───────────────────────────────────────────────────────────
do $pre$
begin
  if to_regprocedure('public.consume_reward(uuid, uuid, numeric)') is null then
    raise exception 'Abortado: falta consume_reward (aplica antes migrations/consume_reward.sql).';
  end if;
  if to_regprocedure('public.create_championship_registration_order(uuid, text, uuid[], jsonb)') is null
     or to_regprocedure('public.confirm_championship_registration(uuid, text)') is null then
    raise exception 'Abortado: falta la base de inscripcion (aplica antes championships_public_individual_registration.sql).';
  end if;
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='wallet_summary' and column_name='reward_balance') then
    raise exception 'Abortado: falta wallet_summary.reward_balance (nucleo de rewards).';
  end if;
end $pre$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 1 · create_championship_registration_order · + Reward (opcional, payer, cap Match)
-- ══════════════════════════════════════════════════════════════════════════════
-- Idéntica a la base salvo: lee p_config.reward_applied, lo ACOTA a unit_price con un clamp
-- inline least(req, unit) (nunca confía en el monto crudo), lo descuenta del total ANTES del
-- crédito y lo snapshotea. El saldo lo valida consume_reward en el confirm.
create or replace function public.create_championship_registration_order(
  p_championship_id uuid,
  p_idempotency_key text,
  p_user_ids        uuid[],
  p_config          jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid := auth.uid();
  v_existing public.orders%rowtype;
  v_champ    public.championships%rowtype;
  v_ids      uuid[];
  v_count    integer;
  v_unit     numeric;
  v_gross    numeric;
  v_reward   numeric := 0;
  v_total    numeric;
  v_credito  numeric := 0;
  v_externo  numeric;
  v_method   text;
  v_order    public.orders%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  -- Idempotencia (payer, key): reintentos devuelven la MISMA order (sin re-debitar).
  select * into v_existing from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('order_id', v_existing.id, 'amount_total', v_existing.amount_total,
      'external_amount', coalesce((v_existing.financial_snapshot->>'external_amount')::numeric, v_existing.amount_total),
      'status', v_existing.status);
  end if;

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  -- PÚBLICO = sin order de contrato + con precio individual. (No depende de privacy.)
  if not (v_champ.order_id is null and v_champ.public_individual_price is not null) then
    raise exception 'NOT_PUBLIC';
  end if;
  -- Ventana de inscripción: solo con inscripciones abiertas.
  if v_champ.status <> 'registration_open' then raise exception 'NOT_OPEN'; end if;

  -- Personas pagadas: dedup, el COMPRADOR debe ir incluido, y todas usuarios reales.
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_user_ids, '{}'::uuid[])) x where x is not null;
  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count = 0 then raise exception 'NO_PLAYERS'; end if;
  if not (v_actor = any(v_ids)) then raise exception 'PAYER_NOT_INCLUDED'; end if;
  if (select count(*) from public.users_public u where u.id = any(v_ids)) <> v_count then
    raise exception 'INVALID_INPUT';
  end if;

  -- Serializa contra join/leave/manage y contra otra inscripción del mismo campeonato.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  -- Nadie del grupo puede estar ya inscrito (individual o en equipo): all-or-none.
  if exists (select 1 from public.championship_players
              where championship_id = p_championship_id and user_id = any(v_ids)) then
    raise exception 'ALREADY_ENROLLED';
  end if;

  -- PRECIO (autoridad backend). unit = precio individual del campeonato.
  v_unit  := v_champ.public_individual_price;
  v_gross := round(v_unit * v_count, 2);

  -- REWARD (opcional, SOLO payer). Clamp server-side a unit_price (NUNCA se confía en el
  -- monto crudo del frontend). El SALDO no se valida aquí: lo hace de forma autoritativa
  -- consume_reward en el confirm (idéntico a Match: create_order no capea por saldo).
  -- Descuenta el total ANTES del crédito (orden Match). Se CONSUME en el confirm.
  v_reward := least(greatest(0, round(coalesce((p_config->>'reward_applied')::numeric, 0), 2)), round(v_unit, 2));
  v_total  := round(v_gross - v_reward, 2);

  -- Crédito del comprador (p_config.credit_applied), acotado al total YA neto de reward.
  v_credito := round(coalesce((p_config->>'credit_applied')::numeric, 0), 2);
  if v_credito < 0 then raise exception 'INVALID_CREDIT'; end if;
  if v_credito > v_total then raise exception 'CREDIT_EXCEEDS_TOTAL: % > %', v_credito, v_total; end if;
  v_externo := round(v_total - v_credito, 2);
  -- Método EFECTIVO fijado por el backend, SIN confiar en p_config.payment_method. SIN importe
  -- externo (external=0) → 'credit' SIEMPRE: cubre 100% crédito, reward+crédito total y 100% reward
  -- (no existe payment_method='reward'; se reutiliza la clasificación existente). external>0 →
  -- 'gateway' (única vía externa de esta fase). transfer/cash/yape NO pueden entrar.
  v_method  := case when v_externo = 0 then 'credit' else 'gateway' end;

  -- Order pending (TTL 10 min). resource_type='championship'; la distingue claim_composition.kind.
  insert into public.orders (
    idempotency_key, payer_user_id, resource_type, resource_id,
    claim_composition, claimed_units, pending_expires_at,
    amount_total, currency, financial_snapshot, payment_provider, status
  ) values (
    p_idempotency_key, v_actor, 'championship', p_championship_id,
    jsonb_build_object('kind', 'championship_registration', 'user_ids', to_jsonb(v_ids)),
    v_count, now() + interval '10 minutes',
    v_total, 'PEN',
    jsonb_build_object('source','championship_registration','unit_price',v_unit,'player_count',v_count,
      'user_ids', to_jsonb(v_ids), 'reward_applied', v_reward, 'credit_applied', v_credito, 'external_amount', v_externo),
    v_method,   -- 'credit' (external=0) o 'gateway' (external>0). Nunca transfer/otros.
    'pending'
  ) returning * into v_order;

  -- Débito de crédito SOLO al crear (nunca en el retorno idempotente). Si falla, rollback total.
  if v_credito > 0 then perform public.spend_wallet_credit(v_actor, v_credito); end if;

  return jsonb_build_object('order_id', v_order.id, 'amount_total', v_total,
    'external_amount', v_externo, 'reward_applied', v_reward, 'credit_applied', v_credito,
    'status', 'pending', 'payment_method', v_method);
end $$;
revoke all on function public.create_championship_registration_order(uuid, text, uuid[], jsonb) from public, anon;
grant execute on function public.create_championship_registration_order(uuid, text, uuid[], jsonb) to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2 · confirm_championship_registration · + consumo de Reward (en éxito)
-- ══════════════════════════════════════════════════════════════════════════════
-- Idéntica a la base salvo: lee reward_applied del snapshot, lo graba en la reserva
-- spend y lo CONSUME con consume_reward (la MISMA RPC de Match) tras crear la reserva.
-- Si el gate no aplica (saldo insuficiente / conflicto) → RAISE → rollback total de la
-- confirmación (sin membership, sin order confirmada, reward NO consumido). Idempotente.
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
  v_method text;
  v_reward numeric;
  v_resv_id uuid;
  v_applied boolean;
  v_reason  text;
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

  -- Idempotencia verificada: ya confirmada + asiento existente → no-op (NO reconsume reward).
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

  -- Revalidar bajo lock: ninguno inscrito entretanto (all-or-none).
  if exists (select 1 from public.championship_players
              where championship_id = p_championship_id and user_id = any(v_ids)) then
    raise exception 'AVAILABILITY_CHANGED';
  end if;

  -- Materializar: una fila por persona, SIN equipo. El UNIQUE(champ,user) aborta ante carrera.
  foreach v_uid in array v_ids loop
    insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, v_uid, null);
  end loop;

  -- Método del asiento: SIN importe externo (external_amount=0) → 'credit' SIEMPRE (crédito total,
  -- reward+crédito o 100% reward); si hay externo → el provider de la order ('gateway').
  v_method := case when coalesce((v_order.financial_snapshot->>'external_amount')::numeric, v_order.amount_total) = 0
                   then 'credit' else coalesce(v_order.payment_provider, 'gateway') end;
  v_reward := round(coalesce((v_order.financial_snapshot->>'reward_applied')::numeric, 0), 2);

  -- Asiento financiero: 1 spend por order (UNIQUE parcial reservations_championship_order_spend_uq).
  -- El trigger trg_championship_spend_wallet rellena credit_applied desde el snapshot y contabiliza
  -- external_amount; el crédito ya se movió al crear la order. reward_applied informativo + gate.
  insert into public.reservations (
    game_id, championship_id, user_id, order_id,
    status, reservation_type, source, payment_method,
    total_amount, subtotal_amount, credit_applied, reward_applied, promo_discount, promo_code_id,
    reserved_at
  ) values (
    null, p_championship_id, v_order.payer_user_id, v_order.id,
    'spend', 'championship', 'championship_registration', v_method,
    v_order.amount_total, v_order.amount_total, 0, v_reward, 0, null,
    now()
  ) returning id into v_resv_id;

  -- CONSUMO de Reward (solo en éxito, contra la reserva spend). MISMA RPC que Match.
  -- Falla el gate (saldo insuficiente / conflicto) → RAISE → rollback de TODA la confirmación.
  if v_reward > 0 then
    select applied, reason into v_applied, v_reason
      from public.consume_reward(v_order.payer_user_id, v_resv_id, v_reward);
    if not coalesce(v_applied, false) then
      raise exception 'REWARD_%', coalesce(v_reason, 'UNAVAILABLE');
    end if;
  end if;

  -- Order → confirmed (al final: cualquier fallo del gate deja la order pending).
  update public.orders set status = 'confirmed', resolved_at = now(), updated_at = now()
   where id = v_order.id;

  return jsonb_build_object('order_id', v_order.id, 'status', 'confirmed',
    'players', array_length(v_ids,1), 'reward_applied', v_reward, 'already', false);
end $$;
revoke all on function public.confirm_championship_registration(uuid, text) from public, anon;
grant execute on function public.confirm_championship_registration(uuid, text) to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3 · INTEGRACIÓN FUTURA · checkout pagado por EQUIPO (public_team_price)
-- ══════════════════════════════════════════════════════════════════════════════
-- Cuando se implemente create_championship_team_registration_order / confirm:
--   · create: v_reward := least(greatest(0, p_config.reward_applied), unit_team_price);
--             v_total := gross_equipo - v_reward; crédito sobre v_total; snapshot.reward_applied.
--   · confirm: tras insertar la reserva `spend` del equipo → consume_reward(payer, reserva_id, reward)
--             (idéntico patrón que §2). Mismo orden reward→crédito→externo. Mismo modelo de fallo.
-- Nada que crear hoy: consume_reward ya es la pieza compartida (la misma que usa Match).


-- ══════════════════════════════════════════════════════════════════════════════
-- 4 · Verificación
-- ══════════════════════════════════════════════════════════════════════════════
do $verify$
declare v_def text;
begin
  -- create: acota el reward a unit_price inline (no confía en el monto crudo) y lo snapshotea.
  select pg_get_functiondef(to_regprocedure('public.create_championship_registration_order(uuid, text, uuid[], jsonb)')) into v_def;
  if v_def !~ 'least\(greatest\(0' then
    raise exception 'VERIFY: create no acota el reward a unit_price inline (podria confiar en el monto crudo).';
  end if;
  if v_def !~ '''reward_applied'', v_reward' then
    raise exception 'VERIFY: create no snapshotea reward_applied en la order.';
  end if;
  -- El método externo SIGUE forzado a gateway (no se perdió al reemitir).
  if v_def !~ '''credit'' else ''gateway''' then
    raise exception 'VERIFY: el metodo externo dejo de forzarse a gateway.';
  end if;
  if v_def ~ 'p_config->>''payment_method''' then
    raise exception 'VERIFY: create volvio a leer p_config.payment_method.';
  end if;

  -- confirm: consume reward con consume_reward SOLO si reward>0, y aborta si el gate no aplica.
  select pg_get_functiondef(to_regprocedure('public.confirm_championship_registration(uuid, text)')) into v_def;
  if v_def !~ 'consume_reward' then
    raise exception 'VERIFY: confirm no consume el reward via consume_reward.';
  end if;
  if v_def !~ 'if v_reward > 0 then' then
    raise exception 'VERIFY: confirm consume reward incondicionalmente (deberia ser solo reward>0).';
  end if;
  if v_def !~ 'REWARD_%' then
    raise exception 'VERIFY: confirm no aborta cuando el gate de reward no aplica.';
  end if;

  raise notice 'OK: reward opcional del payer (clamp inline a unit_price) en inscripcion individual; consumo idempotente via consume_reward en confirm (pieza compartida, lista para el futuro checkout de equipo).';
end $verify$;

commit;
