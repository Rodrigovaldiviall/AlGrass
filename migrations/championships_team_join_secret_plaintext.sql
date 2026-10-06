-- ============================================================================
-- Campeonatos PÚBLICOS · Equipo · CLAVE EN TEXTO PLANO (como registration_key)
-- ============================================================================
-- DECISIÓN FINAL: la clave del equipo pasa a funcionar IGUAL que
-- championships.registration_key (texto plano, legible por el owner, editable). La
-- SOURCE OF TRUTH definitiva es championship_teams.join_secret (text).
--
-- join_secret_hash (bcrypt) queda físicamente por compatibilidad, pero NINGÚN flujo
-- nuevo lo crea, lee, valida ni depende de él. SIN backfill (equipos de prueba: los
-- que no tengan join_secret quedan "sin clave" hasta recrearse/editarse).
--
-- Reemite (M2/M3 ya aplicadas → migración NUEVA, no se editan en sitio):
--   · create_championship_team_registration_order → congela la clave en claim_composition.join_secret (texto).
--   · confirm_championship_team_registration → persiste championship_teams.join_secret (texto). Mantiene
--     unit_price, join_token, reservation spend, consume_reward (sin cambios de dinero).
--   · join_championship_team_with_secret → valida btrim(secret) = btrim(join_secret) (patrón registration_key).
--   · update_championship_team_secret → escribe join_secret (texto).
--   · get_championship_team_secret(uuid) → NUEVO getter owner-only para leer la clave.
--
-- NO toca: M1, join por TOKEN, owner add-player, Match/Rental, privados, pagos,
-- reward/crédito, cancelaciones, fixture.
-- ============================================================================

begin;

do $pre$
begin
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='championship_teams' and column_name='join_token') then
    raise exception 'Abortado: falta championship_teams.join_token (aplica antes championships_public_team_registration.sql).';
  end if;
  if to_regprocedure('public.confirm_championship_team_registration(uuid, text)') is null
     or to_regprocedure('public._championship_participation(uuid, uuid)') is null then
    raise exception 'Abortado: faltan RPCs base de inscripcion de equipo (aplica antes team_registration + itemized).';
  end if;
end $pre$;

-- ── 1 · Columna de la clave en texto plano (source of truth) ──────────────────
alter table public.championship_teams add column if not exists join_secret text;


-- ── 2 · create · congela la clave EN TEXTO en la order (sin hash) ─────────────
create or replace function public.create_championship_team_registration_order(
  p_championship_id uuid,
  p_idempotency_key text,
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
  v_name     text;
  v_color    text;
  v_design   text;
  v_secret   text;
  v_unit     numeric;
  v_reward   numeric := 0;
  v_total    numeric;
  v_credito  numeric := 0;
  v_externo  numeric;
  v_method   text;
  v_order    public.orders%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_existing from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('order_id', v_existing.id, 'amount_total', v_existing.amount_total,
      'external_amount', coalesce((v_existing.financial_snapshot->>'external_amount')::numeric, v_existing.amount_total),
      'status', v_existing.status);
  end if;

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if not (v_champ.order_id is null and v_champ.public_team_price is not null) then
    raise exception 'NOT_PUBLIC';
  end if;
  if v_champ.status <> 'registration_open' then raise exception 'NOT_OPEN'; end if;

  v_name   := nullif(btrim(coalesce(p_config->>'team_name', '')), '');
  v_color  := nullif(btrim(coalesce(p_config->>'team_color', '')), '');
  v_design := nullif(btrim(coalesce(p_config->>'team_design', '')), '');
  v_secret := nullif(btrim(coalesce(p_config->>'team_secret', '')), '');
  if v_name is null then raise exception 'TEAM_NAME_REQUIRED'; end if;
  if v_secret is null or length(v_secret) < 4 then raise exception 'TEAM_SECRET_REQUIRED'; end if;   -- mínimo 4 (igual que update_championship_team_secret)
  -- La clave viaja EN TEXTO (source of truth = championship_teams.join_secret al confirmar). SIN hash.

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  if exists (select 1 from public.championship_players
              where championship_id = p_championship_id and user_id = v_actor) then
    raise exception 'ALREADY_ENROLLED';
  end if;

  v_unit  := v_champ.public_team_price;
  v_reward := least(greatest(0, round(coalesce((p_config->>'reward_applied')::numeric, 0), 2)), round(v_unit, 2));
  v_total  := round(v_unit - v_reward, 2);

  v_credito := round(coalesce((p_config->>'credit_applied')::numeric, 0), 2);
  if v_credito < 0 then raise exception 'INVALID_CREDIT'; end if;
  if v_credito > v_total then raise exception 'CREDIT_EXCEEDS_TOTAL: % > %', v_credito, v_total; end if;
  v_externo := round(v_total - v_credito, 2);
  v_method  := case when v_externo = 0 then 'credit' else 'gateway' end;

  insert into public.orders (
    idempotency_key, payer_user_id, resource_type, resource_id,
    claim_composition, claimed_units, pending_expires_at,
    amount_total, currency, financial_snapshot, payment_provider, status
  ) values (
    p_idempotency_key, v_actor, 'championship', p_championship_id,
    jsonb_build_object('kind', 'championship_team_registration',
      'team_name', v_name, 'team_color', v_color, 'team_design', v_design, 'join_secret', v_secret),
    1, now() + interval '10 minutes',
    v_externo, 'PEN',
    jsonb_build_object('source','championship_team_registration','unit_price',v_unit,
      'reward_applied', v_reward, 'subtotal_amount', v_total,
      'credit_applied', v_credito, 'external_amount', v_externo),
    v_method,
    'pending'
  ) returning * into v_order;

  if v_credito > 0 then perform public.spend_wallet_credit(v_actor, v_credito); end if;

  return jsonb_build_object('order_id', v_order.id, 'amount_total', v_externo,
    'subtotal_amount', v_total, 'external_amount', v_externo, 'reward_applied', v_reward,
    'credit_applied', v_credito, 'status', 'pending', 'payment_method', v_method);
end $$;
revoke all on function public.create_championship_team_registration_order(uuid, text, jsonb) from public, anon;
grant execute on function public.create_championship_team_registration_order(uuid, text, jsonb) to authenticated;


-- ── 3 · confirm · persiste championship_teams.join_secret (texto) ─────────────
-- Igual que la versión con unit_price salvo: el team guarda join_secret (texto) en vez de join_secret_hash.
create or replace function public.confirm_championship_team_registration(
  p_championship_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_order   public.orders%rowtype;
  v_champ   public.championships%rowtype;
  v_cc      jsonb;
  v_team_id uuid;
  v_token   text;
  v_method  text;
  v_reward  numeric;
  v_unit    numeric;
  v_subtotal numeric;
  v_credito  numeric;
  v_external numeric;
  v_resv_id uuid;
  v_applied boolean;
  v_reason  text;
  v_existing_team public.championship_teams%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_order from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.resource_type <> 'championship' or v_order.resource_id <> p_championship_id
     or coalesce(v_order.claim_composition->>'kind','') <> 'championship_team_registration' then
    raise exception 'INVALID_STATE';
  end if;

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  if v_order.status = 'confirmed' then
    select * into v_existing_team from public.championship_teams where order_id = v_order.id;
    if found then
      return jsonb_build_object('order_id', v_order.id, 'status', 'confirmed',
        'team_id', v_existing_team.id, 'team_name', v_existing_team.name,
        'join_token', v_existing_team.join_token, 'already', true);
    end if;
    raise exception 'INVALID_STATE';
  end if;
  if v_order.status <> 'pending' then raise exception 'INVALID_STATE'; end if;
  if v_order.pending_expires_at <= now() then raise exception 'ORDER_EXPIRED'; end if;

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.status <> 'registration_open' then raise exception 'AVAILABILITY_CHANGED'; end if;

  if exists (select 1 from public.championship_players
              where championship_id = p_championship_id and user_id = v_order.payer_user_id) then
    raise exception 'AVAILABILITY_CHANGED';
  end if;

  v_cc := v_order.claim_composition;

  -- 1) Crear el equipo (creator = payer; CLAVE EN TEXTO + token opaco del link + vínculo a la order).
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.championship_teams (championship_id, name, color, design, created_by_user_id, join_secret, join_token, order_id)
  values (p_championship_id,
          v_cc->>'team_name', nullif(v_cc->>'team_color',''), nullif(v_cc->>'team_design',''),
          v_order.payer_user_id, nullif(v_cc->>'join_secret',''), v_token, v_order.id)
  returning id into v_team_id;

  -- 2) Inscribir al creador DENTRO de su equipo.
  insert into public.championship_players (championship_id, user_id, team_id)
  values (p_championship_id, v_order.payer_user_id, v_team_id);

  v_method := case when coalesce((v_order.financial_snapshot->>'external_amount')::numeric, v_order.amount_total) = 0
                   then 'credit' else coalesce(v_order.payment_provider, 'gateway') end;
  v_reward   := round(coalesce((v_order.financial_snapshot->>'reward_applied')::numeric, 0), 2);
  v_subtotal := round(coalesce((v_order.financial_snapshot->>'subtotal_amount')::numeric, v_order.amount_total), 2);
  v_credito  := round(coalesce((v_order.financial_snapshot->>'credit_applied')::numeric, 0), 2);
  v_external := round(coalesce((v_order.financial_snapshot->>'external_amount')::numeric, v_subtotal - v_credito), 2);
  v_unit     := round(coalesce((v_order.financial_snapshot->>'unit_price')::numeric, v_subtotal), 2);

  -- 3) Asiento financiero (1 spend por order). subtotal=bruto, total=externo, credit del snapshot, unit_price base.
  insert into public.reservations (
    game_id, championship_id, user_id, order_id,
    status, reservation_type, source, payment_method,
    unit_price, total_amount, subtotal_amount, credit_applied, reward_applied, promo_discount, promo_code_id,
    reserved_at
  ) values (
    null, p_championship_id, v_order.payer_user_id, v_order.id,
    'spend', 'championship', 'championship_team_registration', v_method,
    v_unit, v_external, v_subtotal, v_credito, v_reward, 0, null,
    now()
  ) returning id into v_resv_id;

  -- 4) Consumo de Reward (solo en éxito, contra la reserva spend).
  if v_reward > 0 then
    select applied, reason into v_applied, v_reason
      from public.consume_reward(v_order.payer_user_id, v_resv_id, v_reward);
    if not coalesce(v_applied, false) then
      raise exception 'REWARD_%', coalesce(v_reason, 'UNAVAILABLE');
    end if;
  end if;

  -- 5) Order → confirmed.
  update public.orders set status = 'confirmed', resolved_at = now(), updated_at = now()
   where id = v_order.id;

  return jsonb_build_object('order_id', v_order.id, 'status', 'confirmed',
    'team_id', v_team_id, 'team_name', v_cc->>'team_name', 'join_token', v_token,
    'reward_applied', v_reward, 'already', false);
end $$;
revoke all on function public.confirm_championship_team_registration(uuid, text) from public, anon;
grant execute on function public.confirm_championship_team_registration(uuid, text) to authenticated;


-- ── 4 · join por clave · comparación de TEXTO (patrón registration_key) ───────
create or replace function public.join_championship_team_with_secret(
  p_team_id uuid,
  p_secret  text,
  p_confirm_change boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_team  public.championship_teams%rowtype;
  v_champ public.championships%rowtype;
  v_is_host boolean;
  v_part     text;
  v_cur_team uuid;
  v_in  text := nullif(btrim(coalesce(p_secret, '')), '');
  v_key text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_team from public.championship_teams where id = p_team_id;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || v_team.championship_id::text)::bigint);

  select * into v_champ from public.championships where id = v_team.championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  v_is_host := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  if v_is_host then raise exception 'NOT_AUTHORIZED'; end if;

  if v_champ.status <> 'registration_open' then raise exception 'NOT_OPEN'; end if;

  -- Clave EN TEXTO (igual que registration_key): vacía → INVALID_SECRET; equipo sin clave → NO_TEAM_SECRET;
  -- no coincide → INVALID_SECRET. (join_secret_hash YA NO se usa.)
  v_key := nullif(btrim(coalesce(v_team.join_secret, '')), '');
  if v_in is null then raise exception 'INVALID_SECRET'; end if;
  if v_key is null then raise exception 'NO_TEAM_SECRET'; end if;
  if v_in <> v_key then raise exception 'INVALID_SECRET'; end if;

  v_part := public._championship_participation(v_team.championship_id, v_actor);
  if v_part = 'none' then
    insert into public.championship_players (championship_id, user_id, team_id)
      values (v_team.championship_id, v_actor, p_team_id);
    return jsonb_build_object('championship_id', v_team.championship_id, 'team_id', p_team_id);
  end if;

  select cp.team_id into v_cur_team from public.championship_players cp
   where cp.championship_id = v_team.championship_id and cp.user_id = v_actor;
  if v_cur_team = p_team_id then
    return jsonb_build_object('championship_id', v_team.championship_id, 'team_id', p_team_id, 'already', true);
  end if;
  if v_part in ('paid_individual','team_owner') then
    raise exception 'PAID_REGISTRATION_MUST_CANCEL_FIRST';
  end if;
  if not coalesce(p_confirm_change, false) then raise exception 'CONFIRM_TEAM_CHANGE_REQUIRED'; end if;
  update public.championship_players set team_id = p_team_id
   where championship_id = v_team.championship_id and user_id = v_actor;
  return jsonb_build_object('championship_id', v_team.championship_id, 'team_id', p_team_id, 'changed', true);
end $$;
revoke all on function public.join_championship_team_with_secret(uuid, text, boolean) from public, anon;
grant execute on function public.join_championship_team_with_secret(uuid, text, boolean) to authenticated;


-- ── 5 · update · escribe join_secret (texto) ─────────────────────────────────
create or replace function public.update_championship_team_secret(
  p_team_id uuid,
  p_secret  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_team   public.championship_teams%rowtype;
  v_champ  public.championships%rowtype;
  v_secret text := nullif(btrim(coalesce(p_secret, '')), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_secret is null or length(v_secret) < 4 then raise exception 'TEAM_SECRET_REQUIRED'; end if;

  select * into v_team from public.championship_teams where id = p_team_id;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  if v_team.created_by_user_id is distinct from v_actor then raise exception 'NOT_AUTHORIZED'; end if;

  select * into v_champ from public.championships where id = v_team.championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if not (v_champ.order_id is null and (v_champ.public_individual_price is not null or v_champ.public_team_price is not null)) then
    raise exception 'NOT_PUBLIC';
  end if;
  if v_champ.status <> 'registration_open' then raise exception 'NOT_OPEN'; end if;

  update public.championship_teams set join_secret = v_secret, updated_at = now()
   where id = p_team_id;

  return jsonb_build_object('team_id', p_team_id, 'status', 'ok');
end $$;
revoke all on function public.update_championship_team_secret(uuid, text) from public, anon;
grant execute on function public.update_championship_team_secret(uuid, text) to authenticated;


-- ── 6 · getter owner-only · leer la clave actual de SU equipo ─────────────────
create or replace function public.get_championship_team_secret(
  p_team_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_team  public.championship_teams%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_team from public.championship_teams where id = p_team_id;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  if v_team.created_by_user_id is distinct from v_actor then raise exception 'NOT_AUTHORIZED'; end if;
  return jsonb_build_object('team_id', v_team.id, 'join_secret', v_team.join_secret);
end $$;
revoke all on function public.get_championship_team_secret(uuid) from public, anon;
grant execute on function public.get_championship_team_secret(uuid) to authenticated;


-- ── 7 · Verificación ──────────────────────────────────────────────────────────
do $verify$
declare v_def text;
begin
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='championship_teams' and column_name='join_secret') then
    raise exception 'VERIFY: falta championship_teams.join_secret.';
  end if;

  select pg_get_functiondef(to_regprocedure('public.create_championship_team_registration_order(uuid, text, jsonb)')) into v_def;
  if v_def ~ 'join_secret_hash' or v_def ~ '_championship_hash_secret' then raise exception 'VERIFY: create sigue usando el hash.'; end if;
  if v_def !~ '''join_secret'', v_secret' then raise exception 'VERIFY: create no congela la clave en texto.'; end if;

  select pg_get_functiondef(to_regprocedure('public.confirm_championship_team_registration(uuid, text)')) into v_def;
  if v_def ~ 'join_secret_hash' then raise exception 'VERIFY: confirm sigue escribiendo join_secret_hash.'; end if;
  if v_def !~ 'join_secret, join_token, order_id' then raise exception 'VERIFY: confirm no persiste join_secret en el team.'; end if;
  if v_def !~ 'unit_price, total_amount' then raise exception 'VERIFY: confirm perdio unit_price en el asiento.'; end if;

  select pg_get_functiondef(to_regprocedure('public.join_championship_team_with_secret(uuid, text, boolean)')) into v_def;
  if v_def ~ '_championship_verify_secret' then raise exception 'VERIFY: join-by-secret sigue usando el hash.'; end if;
  if v_def !~ 'v_in <> v_key' then raise exception 'VERIFY: join-by-secret no compara texto.'; end if;

  select pg_get_functiondef(to_regprocedure('public.update_championship_team_secret(uuid, text)')) into v_def;
  if v_def ~ '_championship_hash_secret' then raise exception 'VERIFY: update sigue hasheando.'; end if;
  if v_def !~ 'join_secret = v_secret' then raise exception 'VERIFY: update no escribe join_secret en texto.'; end if;

  if to_regprocedure('public.get_championship_team_secret(uuid)') is null then raise exception 'VERIFY: falta get_championship_team_secret.'; end if;
  select pg_get_functiondef(to_regprocedure('public.get_championship_team_secret(uuid)')) into v_def;
  if v_def !~ 'created_by_user_id is distinct from v_actor' then raise exception 'VERIFY: el getter no es owner-only.'; end if;

  raise notice 'OK: source of truth = championship_teams.join_secret (texto). create/confirm/join/update usan texto; getter owner-only; join_secret_hash deprecado (no se usa). Join por token intacto.';
end $verify$;

commit;
