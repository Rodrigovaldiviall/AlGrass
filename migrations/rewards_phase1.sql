-- ============================================================================
-- Rewards · FASE 1 — Infraestructura de datos (PURAMENTE ADITIVA)
-- ============================================================================
-- Rewards = saldo PROMOCIONAL, NO reembolsable, tratado como descuento en checkout
-- (Fase 2). Esta fase SOLO crea la infraestructura de datos; NO toca ningún flujo
-- operativo (checkout, applySpend, materialización, confirm_order, cancelaciones,
-- refunds, promociones, invitados, matches/rentals).
--
-- `reward_balance` queda FUERA del invariante financiero existente:
--     total_amount = reserved_balance + credit_balance
--
-- Todo aquí es idempotente (IF NOT EXISTS / guards) y no destructivo.
--
-- NOTA DE AUDITORÍA: public.wallet_summary NO tiene DDL en el repo (se creó en el
-- dashboard de Supabase). Este ALTER es aditivo (ADD COLUMN IF NOT EXISTS + DEFAULT 0)
-- y no altera columnas/triggers/RLS existentes. Verificar en Supabase, antes de aplicar,
-- que wallet_summary no tenga un CHECK del invariante ni un trigger sensible a columnas
-- nuevas (improbable). El resto de columnas se cerrará en la auditoría de seguridad
-- conjunta posterior (total/reserved/credit/reward).
-- ============================================================================


-- ── (1) wallet_summary.reward_balance ───────────────────────────────────────
-- Aditivo: nueva columna con default 0. NO se tocan total_amount/reserved_balance/
-- credit_balance ni triggers/RLS. Fuera del invariante.
-- numeric(10,2) para igualar total_amount/reserved_balance/credit_balance (verificado
-- contra el esquema real de Supabase; reservations.reward_applied queda numeric como
-- promo_discount/credit_applied).
alter table public.wallet_summary
  add column if not exists reward_balance numeric(10,2) not null default 0;

-- CHECK >= 0 (aditivo; todas las filas existentes quedaron en 0 → válido). Idempotente.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'wallet_summary_reward_balance_nonneg'
  ) then
    alter table public.wallet_summary
      add constraint wallet_summary_reward_balance_nonneg check (reward_balance >= 0);
  end if;
end $$;


-- ── (2) reservations.reward_applied ─────────────────────────────────────────
-- Informativo/auditoría. NO participa en refunds ni cambia la semántica de
-- subtotal_amount. Aditivo, default 0.
alter table public.reservations
  add column if not exists reward_applied numeric not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reservations_reward_applied_nonneg'
  ) then
    alter table public.reservations
      add constraint reservations_reward_applied_nonneg check (reward_applied >= 0);
  end if;
end $$;


-- ── (3) reward_transactions — ledger append-only de Rewards ─────────────────
-- Convención: amount SIEMPRE positivo. La DIRECCIÓN la da el type:
--   grant_manual / grant_referral → suma ;  spend → resta.
-- Mismos tipos/FKs/timestamps que el resto del proyecto (uuid, references users(id),
-- timestamptz default now()).
create table if not exists public.reward_transactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  type              text not null
                      check (type in ('grant_manual', 'grant_referral', 'spend')),
  amount            numeric not null check (amount > 0),

  -- Proveniencia según type (nullable; solo se llena el que corresponde):
  reservation_id    uuid references public.reservations(id) on delete set null, -- solo spend (Fase 2)
  granted_by        uuid references public.users(id),                            -- solo grant_manual (admin)
  referred_user_id  uuid references public.users(id),                            -- solo grant_referral (Fase 2)

  -- Idempotencia: evita doble acreditación (p. ej. referido procesado dos veces).
  idempotency_key   text,

  created_at        timestamptz not null default now(),

  -- Integridad mínima: cada campo de proveniencia solo puede aparecer en su type.
  constraint reward_tx_provenance check (
        (type = 'grant_manual'   and granted_by       is not null and referred_user_id is null and reservation_id is null)
     or (type = 'grant_referral' and referred_user_id is not null and granted_by       is null and reservation_id is null)
     or (type = 'spend'          and reservation_id   is not null and granted_by       is null and referred_user_id is null)
  )
);

-- Idempotencia a nivel BD: a lo sumo UNA transacción por key (nulls distintos → los
-- grants manuales sin key siempre aplican). ON CONFLICT en grant_reward se apoya aquí.
create unique index if not exists reward_transactions_idempotency_key
  on public.reward_transactions (idempotency_key)
  where idempotency_key is not null;

-- Índices de lectura (historial propio / futuro Admin por usuario).
create index if not exists reward_transactions_user_created
  on public.reward_transactions (user_id, created_at desc);


-- ── (4) RLS de reward_transactions ──────────────────────────────────────────
alter table public.reward_transactions enable row level security;

-- Grants EXPLÍCITOS (no depender de defaults de Supabase). El usuario SOLO lee lo suyo:
-- sin INSERT/UPDATE/DELETE (las escrituras van por grant_reward SECURITY DEFINER / Fase 2).
-- service_role intacto (bypassa RLS; backoffice/RPC).
revoke all on table public.reward_transactions from public, anon, authenticated;
grant select on table public.reward_transactions to authenticated;

-- SELECT: solo movimientos propios.
drop policy if exists reward_transactions_select_own on public.reward_transactions;
create policy reward_transactions_select_own
  on public.reward_transactions for select
  to authenticated
  using (user_id = auth.uid());

-- ── Lectura administrativa (FASE POSTERIOR — NO incluida aquí) ──────────────
-- No hay policy de SELECT admin ni INSERT/UPDATE/DELETE para authenticated a propósito.
-- El historial admin global irá por RPC SECURITY DEFINER admin-gated, reutilizando el
-- patrón de rol ya existente (mismo que cancel_match / reserve_slots / venue_manager):
--   exists(select 1 from public.user_roles
--            where user_id = auth.uid() and role in ('algrass_admin','algrass_staff'))


-- ── (5) RPC grant_reward — otorgar rewards (atómica, admin-gated) ────────────
-- SECURITY DEFINER + search_path fijo. Idempotente por idempotency_key.
--   grant_manual   → SOLO algrass_admin (no staff). granted_by = auth.uid().
--   grant_referral → PREPARADO pero deshabilitado en Fase 1 (raise). Sin automatización.
--   spend          → NO se otorga aquí (se rechaza).
-- Devuelve: applied (false si la key ya estaba procesada → NO reacredita),
--           transaction_id, new_reward_balance.
create or replace function public.grant_reward(
  p_user_id          uuid,
  p_amount           numeric,
  p_type             text default 'grant_manual',
  p_referred_user_id uuid default null,
  p_idempotency_key  text default null
)
returns table (applied boolean, transaction_id uuid, new_reward_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx_id   uuid;
  v_balance numeric;
begin
  -- Validaciones básicas
  if p_user_id is null then raise exception 'INVALID_USER'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  if p_type = 'grant_manual' then
    -- Autorización: SOLO algrass_admin (patrón real user_roles). Ningún usuario normal
    -- puede auto-otorgarse rewards por esta vía.
    if not exists (
      select 1 from public.user_roles
       where user_id = auth.uid() and role = 'algrass_admin'
    ) then
      raise exception 'NOT_AUTHORIZED';
    end if;

  elsif p_type = 'grant_referral' then
    -- Modelo listo, automatización NO implementada en Fase 1 → nadie (incl. usuarios) la usa aún.
    raise exception 'REFERRAL_GRANT_NOT_ENABLED';

  else
    -- 'spend' u otros no se otorgan por esta RPC.
    raise exception 'INVALID_GRANT_TYPE';
  end if;

  -- Inserción idempotente del asiento. Si la key ya existe → do nothing → v_tx_id NULL.
  -- El índice único es PARCIAL (where idempotency_key is not null), así que el ON CONFLICT
  -- repite ese predicado para que Postgres infiera el índice. Con key NULL no hay conflicto
  -- (fuera del índice) → los grants manuales sin key siempre aplican.
  insert into public.reward_transactions (user_id, type, amount, granted_by, idempotency_key)
  values (p_user_id, 'grant_manual', p_amount, auth.uid(), p_idempotency_key)
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  returning id into v_tx_id;

  if v_tx_id is null then
    -- Ya procesada: NO reacredita, NO duplica. Devuelve el saldo actual sin cambios.
    select reward_balance into v_balance from public.wallet_summary where user_id = p_user_id;
    return query select false, null::uuid, coalesce(v_balance, 0::numeric);
    return;
  end if;

  -- Acredita el saldo (misma fila; NO toca total_amount/reserved_balance/credit_balance).
  -- Crea la fila wallet_summary si el usuario aún no la tenía (defaults 0 en las demás columnas).
  insert into public.wallet_summary (user_id, total_amount, reserved_balance, credit_balance, reward_balance)
  values (p_user_id, 0, 0, 0, p_amount)
  on conflict (user_id) do update
    set reward_balance = public.wallet_summary.reward_balance + p_amount
  returning reward_balance into v_balance;

  return query select true, v_tx_id, v_balance;
end;
$$;

-- Nadie llama la RPC sin pasar por Supabase Auth; la autorización vive DENTRO (admin-gate).
revoke all on function public.grant_reward(uuid, numeric, text, uuid, text) from public, anon;
grant execute on function public.grant_reward(uuid, numeric, text, uuid, text) to authenticated;
