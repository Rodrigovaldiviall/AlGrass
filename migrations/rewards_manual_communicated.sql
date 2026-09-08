-- ============================================================================
-- Rewards · Comunicación de recompensas MANUALES (grant_manual)
-- ============================================================================
-- Amplía la comunicación de "recompensa nueva" (hoy solo grant_referral) para incluir
-- también grant_manual, reutilizando el MISMO estado communicated_at y la MISMA RPC.
-- 'spend' NUNCA entra. No crea tablas/estado nuevo.
--
-- ANTI-RETROACTIVIDAD (crítico): los grant_manual que YA existen con communicated_at
-- IS NULL se marcan como comunicados ANTES de que la App empiece a tratarlos como
-- pendientes, para que recompensas manuales históricas NO aparezcan como "nuevas".
-- Tras la migración, los grant_manual NUEVOS nacen NULL y sí se comunican una vez.
--
-- NO toca: grant_reward, process_referral_rewards, reward_balance, wallet_summary,
-- cron, checkout, refunds ni Admin. Solo backfill + índice + predicado de la RPC.
-- ============================================================================

-- (1) Backfill anti-retroactividad: cerrar los grant_manual históricos no comunicados.
update public.reward_transactions
   set communicated_at = now()
 where type = 'grant_manual'
   and communicated_at is null;

-- (2) Índice de pendientes de comunicación ampliado a (grant_referral, grant_manual).
drop index if exists public.reward_transactions_referral_uncommunicated_idx;
create index if not exists reward_transactions_uncommunicated_idx
  on public.reward_transactions (user_id)
  where communicated_at is null and type in ('grant_referral', 'grant_manual');

-- (3) RPC (misma firma/nombre; solo se amplía el predicado de type). SECURITY DEFINER,
--     auth.uid() obligatorio, solo IDs recibidos, solo filas propias, communicated_at
--     IS NULL, idempotente. authenticated sigue SIN UPDATE directo sobre la tabla.
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
     and type in ('grant_referral', 'grant_manual')   -- 'spend' nunca
     and communicated_at is null;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.mark_referral_rewards_communicated(uuid[]) from public, anon;
grant execute on function public.mark_referral_rewards_communicated(uuid[]) to authenticated;
