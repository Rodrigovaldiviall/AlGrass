-- ============================================================================
-- Rewards · FASE 3 — Recompensa AUTOMÁTICA por referido (primer partido)
-- ============================================================================
-- Otorga UNA Recompensa al referrer directo cuando su referido cumple su PRIMERA
-- ACTIVIDAD HISTÓRICA y esa actividad es un match referido. Reutiliza TODA la
-- infraestructura de Fase 1/2 (reward_transactions = único ledger, wallet_summary.
-- reward_balance, grant_reward() = único punto que incrementa el saldo). NO crea
-- tablas ni ledgers nuevos.
--
-- Definición única de "primera actividad" → vista player_first_completed_activity:
--   MATCH:  games.type='match'  AND games.status='completed' AND game_players.status='confirmed'
--   RENTAL: games.type='rental' AND games.status='completed' AND booked_by_user_id=user  (referred_by=NULL)
--   Orden:  (date_key ASC, time ASC, game_id ASC)  → primera actividad = rn 1
--   Newcomer: first_type='match' AND first_referred_by IS NOT NULL AND first_referred_by<>user_id
-- Reglas congeladas:
--   · rental 'reserved' NO cuenta (solo 'completed').
--   · primera actividad rental → nunca reward; primer match sin referred_by → nunca reward.
--   · OFF/amount=0 al evaluarse → se marca y NUNCA hay backfill.
--
-- NO toca: consume_reward, checkout, cancelaciones/refunds, Credit/cash, promociones,
-- game_players.amount, reservations, orders, ni el invariante financiero
-- (total_amount = reserved_balance + credit_balance). reward_balance queda fuera de él.
--
-- Seguridad: la rama grant_referral de grant_reward SOLO acepta session_user='postgres'
-- (contexto pg_cron/definer); las funciones automáticas se revocan a toda vía de API.
--
-- IMPORTANTE: aplicar como rol 'postgres' (SQL editor) para que el job de cron quede con
-- username='postgres' y el gate de grant_referral coincida en tiempo de ejecución.
-- ============================================================================


-- ── M1 · app_settings — configuración por rol (aditiva, CHECK >= 0) ──────────
alter table public.app_settings
  add column if not exists reward_referral_player_enabled       boolean not null default false,
  add column if not exists reward_referral_player_amount        numeric not null default 0,
  add column if not exists reward_referral_captain_enabled      boolean not null default false,
  add column if not exists reward_referral_captain_amount       numeric not null default 0,
  add column if not exists reward_referral_captain_gold_enabled boolean not null default false,
  add column if not exists reward_referral_captain_gold_amount  numeric not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_reward_referral_amounts_nonneg') then
    alter table public.app_settings
      add constraint app_settings_reward_referral_amounts_nonneg
      check (reward_referral_player_amount       >= 0
         and reward_referral_captain_amount      >= 0
         and reward_referral_captain_gold_amount >= 0);
  end if;
end $$;


-- ── M2 · game_players.referral_reward_evaluated_at + índice + semilla one-time ─
-- La semilla corre SOLO al crear la columna (primera instalación). Cierra las
-- participaciones referidas cuyo match ya FINALIZÓ físicamente al desplegar (misma
-- regla temporal que update_game_lifecycle: inicio + duration en America/Lima). Un
-- match EN CURSO (fin futuro) NO se marca → se evaluará cuando lifecycle lo complete.
do $$
declare v_new_column boolean;
begin
  v_new_column := not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'game_players'
       and column_name  = 'referral_reward_evaluated_at');

  if v_new_column then
    alter table public.game_players add column referral_reward_evaluated_at timestamptz;

    update public.game_players gp
       set referral_reward_evaluated_at = now()
      from public.games g
      join public.fields f on f.id = g.field_id
     where gp.game_id = g.id
       and gp.status = 'confirmed'
       and gp.referred_by_user_id is not null
       and g.type = 'match'
       and g.status not in ('canceled','expired')                 -- solo actividades reales
       and ( ((g.date_key || ' ' || g.time)::timestamp
              + coalesce(g.duration_min, f.duration_min, 60) * interval '1 minute')
             at time zone 'America/Lima' ) < now();               -- FIN físico ya pasó
  end if;
end $$;

create index if not exists game_players_referral_pending_idx
  on public.game_players (game_id)
  where referral_reward_evaluated_at is null and referred_by_user_id is not null;


-- ── M3 · Vista única player_first_completed_activity (security_invoker) ───────
create or replace view public.player_first_completed_activity
with (security_invoker = true) as
with actividades as (
  -- A) MATCH: participación confirmada en match completado (conserva el referido)
  select gp.user_id, g.id as game_id, 'match'::text as type,
         g.date_key, g.time, gp.referred_by_user_id as referred_by
    from public.game_players gp
    join public.games g on g.id = gp.game_id
   where gp.status = 'confirmed' and g.type = 'match' and g.status = 'completed'
  union all
  -- B) RENTAL: booker de un rental completado (sin referido)
  select g.booked_by_user_id, g.id, 'rental'::text,
         g.date_key, g.time, null::uuid
    from public.games g
   where g.type = 'rental' and g.status = 'completed' and g.booked_by_user_id is not null
),
ordenadas as (
  select a.*,
         row_number() over (
           partition by a.user_id
           order by a.date_key asc, a.time asc, a.game_id asc
         ) as rn
    from actividades a
)
select
  o.user_id,
  o.game_id                                          as first_game_id,
  o.type                                             as first_type,
  o.date_key                                         as first_date_key,
  o.time                                             as first_time,
  (o.date_key + o.time) at time zone 'America/Lima'  as first_started_at,
  o.referred_by                                      as first_referred_by,
  (o.type = 'match' and o.referred_by is not null and o.referred_by <> o.user_id) as is_referred_newcomer
from ordenadas o
where o.rn = 1;

revoke all on public.player_first_completed_activity from public, anon;
grant select on public.player_first_completed_activity to service_role;


-- ── M4 · grant_reward — habilita grant_referral (gate session_user='postgres') ─
-- ÚNICO punto que incrementa reward_balance. grant_manual intacto (admin-gated).
create or replace function public.grant_reward(
  p_user_id uuid, p_amount numeric, p_type text default 'grant_manual',
  p_referred_user_id uuid default null, p_idempotency_key text default null
) returns table (applied boolean, transaction_id uuid, new_reward_balance numeric)
language plpgsql security definer set search_path = public as $$
declare v_tx_id uuid; v_balance numeric;
begin
  if p_user_id is null then raise exception 'INVALID_USER'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  if p_type = 'grant_manual' then
    if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'algrass_admin')
      then raise exception 'NOT_AUTHORIZED'; end if;

  elsif p_type = 'grant_referral' then
    -- SOLO contexto de servidor: pg_cron corre como postgres (session_user='postgres').
    -- Toda llamada de API PostgREST (anon/authenticated/service_role) tiene
    -- session_user='authenticator' → RECHAZADA. NO se usa auth.uid() IS NULL.
    if session_user <> 'postgres' then raise exception 'NOT_AUTHORIZED'; end if;
    if p_referred_user_id is null then raise exception 'INVALID_REFERRED_USER'; end if;

  else
    raise exception 'INVALID_GRANT_TYPE';
  end if;

  insert into public.reward_transactions (user_id, type, amount, granted_by, referred_user_id, idempotency_key)
  values (p_user_id, p_type, p_amount,
          case when p_type = 'grant_manual'   then auth.uid()         end,
          case when p_type = 'grant_referral' then p_referred_user_id end,
          p_idempotency_key)
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  returning id into v_tx_id;

  if v_tx_id is null then                        -- ya procesada → NO reacredita
    select reward_balance into v_balance from public.wallet_summary where user_id = p_user_id;
    return query select false, null::uuid, coalesce(v_balance, 0::numeric); return;
  end if;

  insert into public.wallet_summary (user_id, total_amount, reserved_balance, credit_balance, reward_balance)
  values (p_user_id, 0, 0, 0, p_amount)
  on conflict (user_id) do update set reward_balance = public.wallet_summary.reward_balance + p_amount
  returning reward_balance into v_balance;

  return query select true, v_tx_id, v_balance;
end $$;

revoke all on function public.grant_reward(uuid, numeric, text, uuid, text) from public, anon;
grant execute on function public.grant_reward(uuid, numeric, text, uuid, text) to authenticated;


-- ── M5 · process_referral_rewards — barrido (consume la vista; claim atómico) ─
-- Sin FOR UPDATE (evita el bloqueo a través de una vista con UNION/window). El
-- UPDATE condicional actúa como claim + anti-doble-proceso. NO reimplementa la
-- definición de newcomer (vive en la vista).
create or replace function public.process_referral_rewards()
returns integer language plpgsql security definer set search_path = public as $$
declare v_granted int := 0; v_cfg record; p record; v_enabled boolean; v_amount numeric; v_res record;
begin
  select reward_referral_player_enabled, reward_referral_player_amount,
         reward_referral_captain_enabled, reward_referral_captain_amount,
         reward_referral_captain_gold_enabled, reward_referral_captain_gold_amount
    into v_cfg from public.app_settings where id = 1;
  if not found then raise exception 'REFERRAL_CONFIG_UNAVAILABLE'; end if;  -- no marca: reintenta

  for p in
    select v.user_id as referred_user_id, v.first_referred_by as referrer_id, gp.id as gp_id
      from public.player_first_completed_activity v
      join public.game_players gp
        on gp.user_id = v.user_id and gp.game_id = v.first_game_id and gp.status = 'confirmed'
     where v.is_referred_newcomer = true
       and gp.referral_reward_evaluated_at is null
       -- Guardia de orden (timing): difiere si hay una actividad de INICIO anterior aún sin
       -- resolver (podría ser la verdadera primera actividad cuando complete).
       and not exists (
         select 1 from public.games ge
          where ge.status not in ('completed','canceled','expired')
            and (ge.date_key, ge.time, ge.id) < (v.first_date_key, v.first_time, v.first_game_id)
            and ( (ge.type = 'rental' and ge.booked_by_user_id = v.user_id)
               or (ge.type = 'match'  and exists (select 1 from public.game_players gpe
                                                   where gpe.game_id = ge.id and gpe.user_id = v.user_id
                                                     and gpe.status = 'confirmed')) )
       )
  loop
    -- Claim atómico: lock + anti-doble-proceso sin FOR UPDATE sobre la vista.
    update public.game_players
       set referral_reward_evaluated_at = now()
     where id = p.gp_id and referral_reward_evaluated_at is null;
    if not found then continue; end if;                 -- otra corrida ya la tomó

    -- Rol ACTUAL del referrer (precedencia captain_gold > captain > jugador).
    if    exists (select 1 from public.user_roles where user_id = p.referrer_id and role = 'captain_gold')
      then v_enabled := v_cfg.reward_referral_captain_gold_enabled; v_amount := v_cfg.reward_referral_captain_gold_amount;
    elsif exists (select 1 from public.user_roles where user_id = p.referrer_id and role = 'captain')
      then v_enabled := v_cfg.reward_referral_captain_enabled;      v_amount := v_cfg.reward_referral_captain_amount;
    else       v_enabled := v_cfg.reward_referral_player_enabled;   v_amount := v_cfg.reward_referral_player_amount;
    end if;

    -- ON + amount>0 → paga vía grant_reward (único punto). OFF → ya quedó marcado (sin backfill).
    if v_enabled and v_amount > 0 then
      select * into v_res from public.grant_reward(
        p.referrer_id, v_amount, 'grant_referral', p.referred_user_id,
        'referral_first_match:' || p.referred_user_id::text);
      if v_res.applied then v_granted := v_granted + 1; end if;
    end if;
  end loop;
  return v_granted;
end $$;

revoke all on function public.process_referral_rewards() from public, anon, authenticated, service_role;


-- ── M6 · Cron (postgres; +2 min tras game-lifecycle 00/15/30/45) ─────────────
do $$ begin perform cron.unschedule('process-referral-rewards'); exception when others then null; end $$;
select cron.schedule('process-referral-rewards', '2,17,32,47 * * * *',
  $$ select public.process_referral_rewards(); $$);
