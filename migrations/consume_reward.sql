-- ============================================================================
-- Rewards · FASE 2 — consume_reward (gate atómico del consumo de Reward)
-- ============================================================================
-- ÚNICO responsable de consumir Reward: (1) descontar wallet_summary.reward_balance
-- y (2) registrar reward_transactions(type='spend'), de forma ATÓMICA.
--
-- Se ejecuta como GATE dentro de materializeReservation ANTES de applySpend, solo
-- cuando rewardApplied>0. Si falla (INSUFFICIENT_REWARD / REWARD_CONFLICT / error),
-- el materializador aborta y NO se aplica el descuento (no free discount).
--
-- NO toca: total_amount / reserved_balance / credit_balance (Credit/cash), cancelaciones,
-- apply_wallet_refund, grant_reward, ni ningún objeto de Fase 1 (reusa su índice único
-- parcial reward_transactions_idempotency_key y la constraint de proveniencia).
--
-- Autorización (validada en runtime, Test 1): service_role (materializador confiable de
-- confirm_order) o el propio usuario (auth.uid()=p_user_id). NO se usa auth.uid() IS NULL
-- como sustituto de service_role.
--
-- NO hardcodea elegibilidad de Rewards (capitán/usuario): opera solo sobre el saldo.
-- ============================================================================

create or replace function public.consume_reward(
  p_user_id        uuid,
  p_reservation_id uuid,
  p_amount         numeric
) returns table(applied boolean, reason text, new_reward_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key   text := 'spend:' || p_reservation_id::text;
  v_tx    public.reward_transactions%rowtype;
  v_new   numeric;
  v_owner uuid;
begin
  -- Validaciones básicas
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_reservation_id is null then raise exception 'INVALID_RESERVATION'; end if;

  -- Autorización: service_role (confirm_order) o el propio usuario. Comprobación POSITIVA
  -- de service_role vía auth.role() (claim 'role'); nunca auth.uid() IS NULL por sí solo.
  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is not null and auth.uid() = p_user_id then
    null;
  else
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- La reserva debe pertenecer a p_user_id (evita consumir contra reserva ajena)
  select user_id into v_owner from public.reservations where id = p_reservation_id;
  if v_owner is null or v_owner <> p_user_id then raise exception 'RESERVATION_MISMATCH'; end if;

  -- Reclamo idempotente ATÓMICO ligado a la reserva. Reusa el índice único PARCIAL de
  -- Fase 1 (reward_transactions_idempotency_key WHERE idempotency_key IS NOT NULL); por eso
  -- el ON CONFLICT repite el predicado para inferir el índice.
  insert into public.reward_transactions (user_id, type, amount, reservation_id, idempotency_key)
  values (p_user_id, 'spend', p_amount, p_reservation_id, v_key)
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  returning * into v_tx;

  if v_tx.id is null then
    -- Ya existía un asiento para esta reserva → verificación ESTRICTA de los 4 campos.
    select * into v_tx from public.reward_transactions where idempotency_key = v_key;
    if v_tx.id is not null
       and v_tx.user_id        = p_user_id
       and v_tx.reservation_id = p_reservation_id
       and v_tx.amount         = p_amount
       and v_tx.type           = 'spend' then
      -- Éxito idempotente: NO vuelve a descontar.
      select reward_balance into v_new from public.wallet_summary where user_id = p_user_id;
      return query select true, 'ALREADY_CONSUMED', coalesce(v_new, 0::numeric);
    else
      -- Cualquier diferencia = conflicto → FALLO.
      select reward_balance into v_new from public.wallet_summary where user_id = p_user_id;
      return query select false, 'REWARD_CONFLICT', coalesce(v_new, 0::numeric);
    end if;
    return;
  end if;

  -- Asiento nuevo → decremento CONDICIONAL por saldo. NO toca total/reserved/credit.
  update public.wallet_summary
     set reward_balance = reward_balance - p_amount
   where user_id = p_user_id and reward_balance >= p_amount
  returning reward_balance into v_new;

  if not found then
    -- Saldo insuficiente: deshacer el asiento provisional (misma transacción) y reportar
    -- FALLO sin excepción (el materializador aborta y NO aplica descuento).
    delete from public.reward_transactions where id = v_tx.id;
    select reward_balance into v_new from public.wallet_summary where user_id = p_user_id;
    return query select false, 'INSUFFICIENT_REWARD', coalesce(v_new, 0::numeric);
    return;
  end if;

  return query select true, 'CONSUMED', v_new;
end;
$$;

-- Ejecutable por el propio usuario (cliente) y por service_role (confirm_order). La
-- autorización real vive DENTRO de la función. anon/public sin acceso.
revoke all on function public.consume_reward(uuid, uuid, numeric) from public, anon;
grant execute on function public.consume_reward(uuid, uuid, numeric) to authenticated, service_role;
