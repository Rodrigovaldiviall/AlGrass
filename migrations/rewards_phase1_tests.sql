-- ============================================================================
-- Rewards · FASE 1 — Verificación A–M (ejecutar DESPUÉS de rewards_phase1.sql)
-- ============================================================================
-- Reemplaza los UUID placeholder por reales de tu proyecto:
--   :normal_user  = un usuario SIN rol admin
--   :admin_user   = un usuario con user_roles.role = 'algrass_admin'
--   :other_user   = un tercer usuario (para aislamiento de lectura)
-- En el SQL editor de Supabase corres como postgres (bypassa RLS); para C/D/E/F se
-- SIMULA un usuario autenticado con SET LOCAL role + request.jwt.claims.
-- ============================================================================

-- A. reward_balance existe y default = 0
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema='public' and table_name='wallet_summary' and column_name='reward_balance';
-- Esperado: 1 fila, numeric, NO, '0'.

-- B. reward_applied existe y default = 0
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema='public' and table_name='reservations' and column_name='reward_applied';
-- Esperado: 1 fila, numeric, NO, '0'.

-- K/L (baseline). Guarda el estado del wallet ANTES de otorgar, para comparar en K/L.
select user_id, total_amount, reserved_balance, credit_balance, reward_balance
  from public.wallet_summary where user_id = '00000000-normal-user-uuid';
-- Anota total_amount / reserved_balance / credit_balance (deben quedar IDÉNTICOS tras G/H).

-- ── F. usuario normal NO puede grant_manual ────────────────────────────────
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"00000000-normal-user-uuid"}';
  select * from public.grant_reward('00000000-normal-user-uuid', 10, 'grant_manual', null, null);
  -- Esperado: ERROR 'NOT_AUTHORIZED'.
rollback;

-- ── G/H/I. algrass_admin otorga S/10 manual ────────────────────────────────
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"00000000-admin-user-uuid"}';
  select * from public.grant_reward('00000000-normal-user-uuid', 10, 'grant_manual', null, 'test-key-001');
  -- Esperado: applied=true, transaction_id no nulo, new_reward_balance = (saldo previo)+10.
commit;

-- H. reward_balance aumentó exactamente 10
select reward_balance from public.wallet_summary where user_id = '00000000-normal-user-uuid';
-- Esperado: baseline_reward + 10.

-- I. exactamente UNA transacción grant_manual de 10
select count(*) as n, min(amount) as amount, min(granted_by) as granted_by
  from public.reward_transactions
 where user_id='00000000-normal-user-uuid' and type='grant_manual' and idempotency_key='test-key-001';
-- Esperado: n=1, amount=10, granted_by=admin uuid.

-- ── J. misma idempotency_key NO reacredita ─────────────────────────────────
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"00000000-admin-user-uuid"}';
  select * from public.grant_reward('00000000-normal-user-uuid', 10, 'grant_manual', null, 'test-key-001');
  -- Esperado: applied=false, transaction_id=null, new_reward_balance SIN cambios.
commit;
select reward_balance from public.wallet_summary where user_id='00000000-normal-user-uuid';   -- igual que en H (no subió otra vez)
select count(*) from public.reward_transactions where idempotency_key='test-key-001';          -- Esperado: 1 (no duplicó)

-- ── K/L. total/reserved/credit intactos; invariante intacto ────────────────
select user_id, total_amount, reserved_balance, credit_balance, reward_balance,
       (total_amount = reserved_balance + credit_balance) as invariante_ok
  from public.wallet_summary where user_id='00000000-normal-user-uuid';
-- Esperado: total/reserved/credit IDÉNTICOS al baseline; invariante_ok = true.

-- ── C. usuario lee SUS reward_transactions ─────────────────────────────────
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"00000000-normal-user-uuid"}';
  select id, type, amount from public.reward_transactions;   -- Esperado: ve su grant de 10.
rollback;

-- ── E. usuario NO ve movimientos de otro ───────────────────────────────────
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"00000000-other-user-uuid"}';
  select count(*) from public.reward_transactions where user_id='00000000-normal-user-uuid';
  -- Esperado: 0 (RLS filtra; no ve las del normal_user).
rollback;

-- ── D. usuario NO puede insertar/modificar/borrar ──────────────────────────
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"00000000-normal-user-uuid"}';
  insert into public.reward_transactions (user_id, type, amount, granted_by)
    values ('00000000-normal-user-uuid','grant_manual',999,'00000000-normal-user-uuid');
  -- Esperado: ERROR permission denied (no hay grant INSERT a authenticated).
rollback;

begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"00000000-normal-user-uuid"}';
  update public.reward_transactions set amount = 999 where user_id='00000000-normal-user-uuid';
  -- Esperado: ERROR permission denied (sin grant UPDATE).
rollback;

begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"00000000-normal-user-uuid"}';
  delete from public.reward_transactions where user_id='00000000-normal-user-uuid';
  -- Esperado: ERROR permission denied (sin grant DELETE).
rollback;

-- M. (revisión estructural) ningún objeto existente fue modificado por esta migración:
--    solo se añadieron columnas (reward_balance/reward_applied), la tabla reward_transactions,
--    su índice/policy y la función grant_reward. Verificar en el diff del editor que no hay
--    ALTER sobre triggers/RLS/columnas existentes de wallet_summary/reservations.
