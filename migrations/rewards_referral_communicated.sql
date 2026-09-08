-- ============================================================================
-- Rewards · Comunicación de recompensas por referido (estado "comunicada")
-- ============================================================================
-- Añade el estado PERSISTENTE mínimo para saber qué grant_referral ya se le comunicó
-- al usuario (mensaje en el modal de rating o banner de Perfil). Reutiliza el ledger
-- existente reward_transactions; NO crea tablas/ledgers paralelos.
--
-- NO toca: grant_reward, process_referral_rewards, reward_balance, wallet_summary,
-- cron, checkout, refunds ni el motor de referidos. Solo columna aditiva + índice + RPC.
-- El usuario NO obtiene UPDATE directo sobre reward_transactions: el marcado va por la
-- RPC SECURITY DEFINER (auth.uid() obligatorio, solo sus propias filas grant_referral,
-- solo los IDs recibidos, solo si communicated_at IS NULL).
-- ============================================================================

-- (1) Estado de comunicación (nullable; NULL = no comunicada). Aditivo.
alter table public.reward_transactions
  add column if not exists communicated_at timestamptz;

-- (2) Índice parcial para el barrido de pendientes por usuario (grant_referral no comunicadas).
create index if not exists reward_transactions_referral_uncommunicated_idx
  on public.reward_transactions (user_id)
  where communicated_at is null and type = 'grant_referral';

-- (3) RPC de marcado. SECURITY DEFINER + search_path fijo. Idempotente y acotada:
--     solo filas del propio usuario, type='grant_referral', de los IDs recibidos y aún
--     no comunicadas. Devuelve cuántas marcó (0 si nada aplica).
create or replace function public.mark_referral_rewards_communicated(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;

  update public.reward_transactions
     set communicated_at = now()
   where id = any(p_ids)
     and user_id = auth.uid()
     and type = 'grant_referral'
     and communicated_at is null;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.mark_referral_rewards_communicated(uuid[]) from public, anon;
grant execute on function public.mark_referral_rewards_communicated(uuid[]) to authenticated;
