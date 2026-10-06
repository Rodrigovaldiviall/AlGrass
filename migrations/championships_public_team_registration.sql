-- ============================================================================
-- Campeonatos PÚBLICOS · Inscripción PAGADA por EQUIPO (crear equipo) — backend
-- ============================================================================
-- Reutiliza el patrón ya aplicado de inscripción individual
-- (championships_public_individual_registration + _rewards): tabla `orders` +
-- wallet/crédito + consume_reward, SIN tocar create_order/confirm_order (match/rental)
-- ni game_players. El producto es UNA inscripción de equipo = public_team_price
-- (NO N jugadores): el payer = creador del equipo paga una unidad.
--
-- NO se crea el equipo hasta CONFIRMAR el pago. Los datos del equipo (nombre, color,
-- diseño y el HASH de la clave secreta) viajan congelados en la order; confirm_* los
-- materializa atómicamente: championship_teams + championship_players(creator) +
-- reservation spend + consume_reward + order confirmed.
--
-- DOS MECANISMOS SEPARADOS de unión de miembros (gratis; la inscripción del equipo ya la
-- pagó el creador). NUNCA se mete la clave manual en una URL:
--   A) CLAVE MANUAL: championship_teams.join_secret_hash (bcrypt vía pgcrypto). El usuario
--      ESCRIBE la clave; join_championship_team_with_secret(team_id, secret) la verifica con
--      crypt(). El hash NO se devuelve por ninguna RPC ni select. NO es
--      championships.registration_key (clave del campeonato PRIVADO; un público no tiene).
--   B) LINK DE INVITACIÓN: championship_teams.join_token = token OPACO aleatorio (no es la
--      clave). El link identifica al equipo y autoriza vía ese token:
--      join_championship_team_with_token(token). El token se genera al CONFIRMAR y se
--      devuelve al creador; get_championship_team_share(team_id) lo expone SOLO al owner.
-- Nota de producto: un bearer-link SIEMPRE es copiable por quien lo recibe (no afirmamos lo
-- contrario). Lo que garantiza la App: solo el owner ve Compartir / el token / la clave; a un
-- miembro normal no se le expone el token ni la clave ni se le genera un link nuevo (gating de
-- UI + RPC owner-only). El join gratuito DIRECTO sigue bloqueado
-- (PUBLIC_CHAMPIONSHIP_TEAM_PAYMENT_REQUIRED): la única vía de miembro es clave o token.
--
-- CONTRATO FINANCIERO ÚNICO (idéntico a individual y a Match/Rental; requiere la migración
-- Admin 20261106130000_championship_wallet_subtotal_as_gross, que hace que el trigger lea el
-- BRUTO de subtotal_amount):
--   · subtotal_amount = BRUTO = public_team_price − reward   [neto tras reward, PRE-crédito]
--   · credit_applied  = crédito usado
--   · total_amount    = IMPORTE FINAL externo = subtotal − credit   [POST-crédito]
--   · order.amount_total = total_amount (externo)  ·  snapshot.external_amount = lo que cobra la pasarela
-- El trigger contabiliza v_externo = subtotal_amount − credit = total_amount. El bruto reembolsable
-- vive en subtotal_amount y el crédito en credit_applied.
--
-- NO toca: privados, create_order/confirm_order, game_players, fixture, Admin,
-- publicación, registration_key, Match/Rental, rol global captain. Idempotente.
-- Capacidad/carreras: SIN límites estrictos de nº de equipos (fuera de alcance). Solo
-- se preservan: idempotencia de la order, un equipo por order, no doble consumo
-- crédito/reward, y UNIQUE(championship_id,user_id) contra doble inscripción.
--
-- Errores: AUTH_REQUIRED · CHAMPIONSHIP_NOT_FOUND · NOT_PUBLIC · NOT_OPEN ·
--   INVALID_INPUT · TEAM_NAME_REQUIRED · TEAM_SECRET_REQUIRED · ALREADY_ENROLLED ·
--   INVALID_CREDIT · CREDIT_EXCEEDS_TOTAL · ORDER_NOT_FOUND · INVALID_STATE ·
--   ORDER_EXPIRED · AVAILABILITY_CHANGED · REWARD_* · TEAM_NOT_FOUND ·
--   NO_TEAM_SECRET · INVALID_SECRET · INVALID_LINK · PAID_REGISTRATION_MUST_CANCEL_FIRST ·
--   CONFIRM_TEAM_CHANGE_REQUIRED.
-- ============================================================================

begin;

-- ── 0 · Pre-checks ───────────────────────────────────────────────────────────
-- pgcrypto (bcrypt) para hashear la clave. En Supabase vive en el esquema `extensions`.
create extension if not exists pgcrypto with schema extensions;

do $pre$
begin
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='championships' and column_name='public_team_price') then
    raise exception 'Abortado: falta championships.public_team_price (aplica antes 20261105120000_admin_create_championship_public.sql).';
  end if;
  if to_regprocedure('public.consume_reward(uuid, uuid, numeric)') is null then
    raise exception 'Abortado: falta consume_reward.';
  end if;
  if to_regprocedure('public.spend_wallet_credit(uuid, numeric)') is null then
    raise exception 'Abortado: falta spend_wallet_credit (nucleo de credito).';
  end if;
  if to_regprocedure('public._championship_participation(uuid, uuid)') is null then
    raise exception 'Abortado: falta _championship_participation (aplica antes championships_public_individual_itemized.sql).';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.reservations'::regclass
    and tgname='trg_championship_spend_wallet' and not tgisinternal) then
    raise exception 'Abortado: falta trg_championship_spend_wallet.';
  end if;
  -- bcrypt resolvible (crypt/gen_salt) con el search_path de los helpers (public, extensions).
  if to_regprocedure('extensions.crypt(text, text)') is null
     or to_regprocedure('extensions.gen_salt(text)') is null
     or to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception 'Abortado: pgcrypto no expone crypt/gen_salt/gen_random_bytes en el esquema extensions.';
  end if;
end $pre$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 1 · Columnas nuevas en championship_teams (clave hash + vínculo a la order)
-- ══════════════════════════════════════════════════════════════════════════════
alter table public.championship_teams add column if not exists join_secret_hash text;  -- A) clave manual (bcrypt)
alter table public.championship_teams add column if not exists join_token text;         -- B) token opaco del link
alter table public.championship_teams add column if not exists order_id uuid references public.orders(id) on delete set null;
-- Un equipo por order (idempotencia + evita duplicar el mismo team por la misma order).
create unique index if not exists championship_teams_order_uq
  on public.championship_teams (order_id) where order_id is not null;
-- El token de link es único (lookup directo y seguro).
create unique index if not exists championship_teams_join_token_uq
  on public.championship_teams (join_token) where join_token is not null;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2 · Helpers de clave (bcrypt). search_path incluye extensions para resolver pgcrypto.
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public._championship_hash_secret(p_secret text)
returns text language sql security definer set search_path = public, extensions as $$
  select crypt(p_secret, gen_salt('bf'));
$$;
revoke all on function public._championship_hash_secret(text) from public, anon, authenticated;

create or replace function public._championship_verify_secret(p_secret text, p_hash text)
returns boolean language sql security definer set search_path = public, extensions as $$
  select p_hash is not null and p_secret is not null and p_hash = crypt(p_secret, p_hash);
$$;
revoke all on function public._championship_verify_secret(text, text) from public, anon, authenticated;

-- Roundtrip de verificación (hash ≠ texto plano y verify OK).
do $v$
declare h text;
begin
  h := public._championship_hash_secret('probe-123');
  if h is null or h = 'probe-123' then raise exception 'VERIFY: el hash de clave no se genero (pgcrypto).'; end if;
  if not public._championship_verify_secret('probe-123', h) then raise exception 'VERIFY: verify_secret no valida el hash correcto.'; end if;
  if public._championship_verify_secret('otra', h) then raise exception 'VERIFY: verify_secret acepto una clave incorrecta.'; end if;
end $v$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3 · Crear la ORDER de inscripción de EQUIPO (pending) + débito de crédito
-- ══════════════════════════════════════════════════════════════════════════════
-- NO crea el equipo. Congela nombre/color/diseño + HASH de la clave en la order.
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
  v_hash     text;
  v_unit     numeric;
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
  -- PÚBLICO = sin order de contrato + con precio de equipo.
  if not (v_champ.order_id is null and v_champ.public_team_price is not null) then
    raise exception 'NOT_PUBLIC';
  end if;
  if v_champ.status <> 'registration_open' then raise exception 'NOT_OPEN'; end if;

  -- Datos del equipo (autoridad de precio = backend). Nombre y clave OBLIGATORIOS.
  v_name   := nullif(btrim(coalesce(p_config->>'team_name', '')), '');
  v_color  := nullif(btrim(coalesce(p_config->>'team_color', '')), '');
  v_design := nullif(btrim(coalesce(p_config->>'team_design', '')), '');
  v_secret := nullif(btrim(coalesce(p_config->>'team_secret', '')), '');
  if v_name is null then raise exception 'TEAM_NAME_REQUIRED'; end if;
  if v_secret is null then raise exception 'TEAM_SECRET_REQUIRED'; end if;
  v_hash := public._championship_hash_secret(v_secret);   -- solo el HASH viaja/se guarda

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  -- El creador no puede estar ya inscrito (individual o en otro equipo): UNIQUE(champ,user).
  if exists (select 1 from public.championship_players
              where championship_id = p_championship_id and user_id = v_actor) then
    raise exception 'ALREADY_ENROLLED';
  end if;

  -- PRECIO: una unidad = public_team_price.
  v_unit  := v_champ.public_team_price;

  -- REWARD (opcional, SOLO payer/creador). Clamp inline a unit (misma regla que individual).
  v_reward := least(greatest(0, round(coalesce((p_config->>'reward_applied')::numeric, 0), 2)), round(v_unit, 2));
  v_total  := round(v_unit - v_reward, 2);

  -- Crédito del comprador, acotado al total YA neto de reward.
  v_credito := round(coalesce((p_config->>'credit_applied')::numeric, 0), 2);
  if v_credito < 0 then raise exception 'INVALID_CREDIT'; end if;
  if v_credito > v_total then raise exception 'CREDIT_EXCEEDS_TOTAL: % > %', v_credito, v_total; end if;
  v_externo := round(v_total - v_credito, 2);
  -- Método EFECTIVO (sin confiar en p_config.payment_method): external=0 → 'credit'; else 'gateway'.
  v_method  := case when v_externo = 0 then 'credit' else 'gateway' end;

  insert into public.orders (
    idempotency_key, payer_user_id, resource_type, resource_id,
    claim_composition, claimed_units, pending_expires_at,
    amount_total, currency, financial_snapshot, payment_provider, status
  ) values (
    p_idempotency_key, v_actor, 'championship', p_championship_id,
    jsonb_build_object('kind', 'championship_team_registration',
      'team_name', v_name, 'team_color', v_color, 'team_design', v_design, 'join_secret_hash', v_hash),
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


-- ══════════════════════════════════════════════════════════════════════════════
-- 4 · Confirmar → materializar team + creator + reservation + consumo de reward
-- ══════════════════════════════════════════════════════════════════════════════
-- MODELO DE CONFIANZA: idéntico al gateway/individual (pasarela MOCK app-wide; el
-- crédito SÍ es autoritativo). Todo en una transacción: si algo falla, rollback total.
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

  -- Idempotencia: ya confirmada → devolver el equipo ya creado (vínculo order_id).
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

  -- El creador no puede haberse inscrito entretanto (all-or-none).
  if exists (select 1 from public.championship_players
              where championship_id = p_championship_id and user_id = v_order.payer_user_id) then
    raise exception 'AVAILABILITY_CHANGED';
  end if;

  v_cc := v_order.claim_composition;

  -- 1) Crear el equipo (creator = payer; HASH de la clave + token opaco del link + vínculo a la order).
  v_token := encode(extensions.gen_random_bytes(24), 'hex');   -- 192-bit, opaco; NO es la clave
  insert into public.championship_teams (championship_id, name, color, design, created_by_user_id, join_secret_hash, join_token, order_id)
  values (p_championship_id,
          v_cc->>'team_name', nullif(v_cc->>'team_color',''), nullif(v_cc->>'team_design',''),
          v_order.payer_user_id, nullif(v_cc->>'join_secret_hash',''), v_token, v_order.id)
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

  -- 3) Asiento financiero (1 spend por order). Contrato único: subtotal_amount = BRUTO (v_bruto del
  -- trigger), total_amount = EXTERNO (post-crédito), credit_applied = crédito del snapshot.
  insert into public.reservations (
    game_id, championship_id, user_id, order_id,
    status, reservation_type, source, payment_method,
    total_amount, subtotal_amount, credit_applied, reward_applied, promo_discount, promo_code_id,
    reserved_at
  ) values (
    null, p_championship_id, v_order.payer_user_id, v_order.id,
    'spend', 'championship', 'championship_team_registration', v_method,
    v_external, v_subtotal, v_credito, v_reward, 0, null,
    now()
  ) returning id into v_resv_id;

  -- 4) Consumo de Reward (solo en éxito, contra la reserva spend). MISMA RPC que Match.
  if v_reward > 0 then
    select applied, reason into v_applied, v_reason
      from public.consume_reward(v_order.payer_user_id, v_resv_id, v_reward);
    if not coalesce(v_applied, false) then
      raise exception 'REWARD_%', coalesce(v_reason, 'UNAVAILABLE');
    end if;
  end if;

  -- 5) Order → confirmed (al final: cualquier fallo deja la order pending y revierte todo).
  update public.orders set status = 'confirmed', resolved_at = now(), updated_at = now()
   where id = v_order.id;

  return jsonb_build_object('order_id', v_order.id, 'status', 'confirmed',
    'team_id', v_team_id, 'team_name', v_cc->>'team_name', 'join_token', v_token,
    'reward_applied', v_reward, 'already', false);
end $$;
revoke all on function public.confirm_championship_team_registration(uuid, text) from public, anon;
grant execute on function public.confirm_championship_team_registration(uuid, text) to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 5 · Fallo de pasarela → matar la order (crédito se restituye por trigger)
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.fail_championship_team_registration(
  p_championship_id uuid,
  p_idempotency_key text,
  p_reason          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_order from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status = 'failed' then return jsonb_build_object('order_id', v_order.id, 'status', 'failed'); end if;
  if v_order.status <> 'pending' then raise exception 'INVALID_STATE'; end if;
  update public.orders
     set status = 'failed', terminal_reason = coalesce(nullif(btrim(p_reason),''),'payment_failed'),
         resolved_at = now(), updated_at = now()
   where id = v_order.id and status = 'pending';
  return jsonb_build_object('order_id', v_order.id, 'status', 'failed');
end $$;
revoke all on function public.fail_championship_team_registration(uuid, text, text) from public, anon;
grant execute on function public.fail_championship_team_registration(uuid, text, text) to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 6 · Unirse a un equipo mediante su CLAVE SECRETA (o link del owner que la lleva)
-- ══════════════════════════════════════════════════════════════════════════════
-- Miembro se une GRATIS (la inscripción del equipo ya la pagó el creador). Única vía de
-- miembro en públicos (el join gratis directo sigue bloqueado). El owner comparte la
-- clave/link; un miembro normal NO conoce la clave → no puede propagar acceso.
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
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_team from public.championship_teams where id = p_team_id;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || v_team.championship_id::text)::bigint);

  select * into v_champ from public.championships where id = v_team.championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- Host nunca se inscribe como jugador (mismo criterio que join_championship_team).
  v_is_host := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  if v_is_host then raise exception 'NOT_AUTHORIZED'; end if;

  -- Self-service público SOLO con inscripciones abiertas (NO registration_closed/in_progress).
  if v_champ.status <> 'registration_open' then raise exception 'NOT_OPEN'; end if;

  -- Clave: el equipo debe tenerla y debe coincidir (bcrypt).
  if nullif(btrim(coalesce(v_team.join_secret_hash,'')),'') is null then raise exception 'NO_TEAM_SECRET'; end if;
  if not public._championship_verify_secret(nullif(btrim(coalesce(p_secret,'')),''), v_team.join_secret_hash) then
    raise exception 'INVALID_SECRET';
  end if;

  v_part := public._championship_participation(v_team.championship_id, v_actor);
  if v_part = 'none' then
    -- Nuevo: insert simple (bajo lock; UNIQUE(champ,user) cubre carreras).
    insert into public.championship_players (championship_id, user_id, team_id)
      values (v_team.championship_id, v_actor, p_team_id);
    return jsonb_build_object('championship_id', v_team.championship_id, 'team_id', p_team_id);
  end if;

  select cp.team_id into v_cur_team from public.championship_players cp
   where cp.championship_id = v_team.championship_id and cp.user_id = v_actor;
  if v_cur_team = p_team_id then                                   -- ya en ESTE equipo → idempotente
    return jsonb_build_object('championship_id', v_team.championship_id, 'team_id', p_team_id, 'already', true);
  end if;
  -- Participación PAGADA (individual payer/invitado, u owner de equipo): no se cambia por un join.
  if v_part in ('paid_individual','team_owner') then
    raise exception 'PAID_REGISTRATION_MUST_CANCEL_FIRST';
  end if;
  -- GRATUITO (miembro de otro equipo o sin equipo sin pago) → cambio SOLO con confirmación explícita.
  if not coalesce(p_confirm_change, false) then raise exception 'CONFIRM_TEAM_CHANGE_REQUIRED'; end if;
  update public.championship_players set team_id = p_team_id
   where championship_id = v_team.championship_id and user_id = v_actor;
  return jsonb_build_object('championship_id', v_team.championship_id, 'team_id', p_team_id, 'changed', true);
end $$;
revoke all on function public.join_championship_team_with_secret(uuid, text, boolean) from public, anon;
grant execute on function public.join_championship_team_with_secret(uuid, text, boolean) to authenticated;


-- ── 6b · Unirse mediante el TOKEN del link (opaco; NO lleva la clave). ──────────
-- Mecanismo B, separado de la clave manual: el token autoriza el join por sí mismo.
create or replace function public.join_championship_team_with_token(
  p_token text,
  p_confirm_change boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tok   text := nullif(btrim(coalesce(p_token,'')),'');
  v_team  public.championship_teams%rowtype;
  v_champ public.championships%rowtype;
  v_is_host boolean;
  v_part     text;
  v_cur_team uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_tok is null then raise exception 'INVALID_LINK'; end if;

  select * into v_team from public.championship_teams where join_token = v_tok;
  if not found then raise exception 'INVALID_LINK'; end if;   -- token desconocido: no se filtra nada

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || v_team.championship_id::text)::bigint);

  select * into v_champ from public.championships where id = v_team.championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  v_is_host := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  if v_is_host then raise exception 'NOT_AUTHORIZED'; end if;

  -- Self-service público SOLO con inscripciones abiertas (NO registration_closed/in_progress).
  if v_champ.status <> 'registration_open' then raise exception 'NOT_OPEN'; end if;

  v_part := public._championship_participation(v_team.championship_id, v_actor);
  if v_part = 'none' then
    insert into public.championship_players (championship_id, user_id, team_id)
      values (v_team.championship_id, v_actor, v_team.id);
    return jsonb_build_object('championship_id', v_team.championship_id, 'team_id', v_team.id);
  end if;

  select cp.team_id into v_cur_team from public.championship_players cp
   where cp.championship_id = v_team.championship_id and cp.user_id = v_actor;
  if v_cur_team = v_team.id then                                  -- ya en ESTE equipo → idempotente
    return jsonb_build_object('championship_id', v_team.championship_id, 'team_id', v_team.id, 'already', true);
  end if;
  if v_part in ('paid_individual','team_owner') then
    raise exception 'PAID_REGISTRATION_MUST_CANCEL_FIRST';
  end if;
  -- GRATUITO (miembro de otro equipo o sin equipo sin pago) → cambio SOLO con confirmación explícita.
  if not coalesce(p_confirm_change, false) then raise exception 'CONFIRM_TEAM_CHANGE_REQUIRED'; end if;
  update public.championship_players set team_id = v_team.id
   where championship_id = v_team.championship_id and user_id = v_actor;
  return jsonb_build_object('championship_id', v_team.championship_id, 'team_id', v_team.id, 'changed', true);
end $$;
revoke all on function public.join_championship_team_with_token(text, boolean) from public, anon;
grant execute on function public.join_championship_team_with_token(text, boolean) to authenticated;


-- ── 6c · Obtener el token de compartir — SOLO el owner/creator del equipo. ──────
-- Expone el token del link al owner para construir el enlace. NUNCA devuelve el
-- join_secret_hash. Un no-owner recibe NOT_AUTHORIZED (sin filtrar el token).
create or replace function public.get_championship_team_share(
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
  return jsonb_build_object('team_id', v_team.id, 'championship_id', v_team.championship_id,
    'join_token', v_team.join_token);
end $$;
revoke all on function public.get_championship_team_share(uuid) from public, anon;
grant execute on function public.get_championship_team_share(uuid) to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 7 · Verificación
-- ══════════════════════════════════════════════════════════════════════════════
do $verify$
declare v_def text;
begin
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='championship_teams' and column_name='join_secret_hash') then
    raise exception 'VERIFY: falta championship_teams.join_secret_hash.';
  end if;
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='championship_teams' and column_name='order_id') then
    raise exception 'VERIFY: falta championship_teams.order_id.';
  end if;
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='championship_teams' and column_name='join_token') then
    raise exception 'VERIFY: falta championship_teams.join_token.';
  end if;

  -- create: precio autoritativo (public_team_price), clamp de reward inline, gateway forzado, NO crea team.
  select pg_get_functiondef(to_regprocedure('public.create_championship_team_registration_order(uuid, text, jsonb)')) into v_def;
  if v_def !~ 'public_team_price' then raise exception 'VERIFY: create no usa public_team_price.'; end if;
  if v_def !~ 'least\(greatest\(0' then raise exception 'VERIFY: create no acota el reward inline.'; end if;
  if v_def !~ '''credit'' else ''gateway''' then raise exception 'VERIFY: create no fuerza el metodo externo a gateway.'; end if;
  if v_def ~ 'insert into public\.championship_teams' then raise exception 'VERIFY: create NO debe crear el equipo (solo la order).'; end if;
  if v_def !~ '_championship_hash_secret' then raise exception 'VERIFY: create no hashea la clave del equipo.'; end if;

  -- confirm: crea team + creator + reservation + consume_reward, y vincula order_id.
  select pg_get_functiondef(to_regprocedure('public.confirm_championship_team_registration(uuid, text)')) into v_def;
  if v_def !~ 'insert into public\.championship_teams' then raise exception 'VERIFY: confirm no crea el equipo.'; end if;
  if v_def !~ 'insert into public\.championship_players' then raise exception 'VERIFY: confirm no inscribe al creador.'; end if;
  if v_def !~ 'consume_reward' then raise exception 'VERIFY: confirm no consume reward.'; end if;
  if v_def !~ 'order_id' then raise exception 'VERIFY: confirm no vincula la order al equipo.'; end if;

  -- confirm: genera el token opaco del link.
  if v_def !~ 'gen_random_bytes' then raise exception 'VERIFY: confirm no genera el token opaco del link.'; end if;

  -- join-by-secret: verifica bcrypt, clasifica participación, solo registration_open, cambio A→B con confirm.
  select pg_get_functiondef(to_regprocedure('public.join_championship_team_with_secret(uuid, text, boolean)')) into v_def;
  if v_def !~ '_championship_verify_secret' then raise exception 'VERIFY: join-by-secret no verifica el hash.'; end if;
  if v_def !~ '_championship_participation' then raise exception 'VERIFY: join-by-secret no clasifica participacion.'; end if;
  if v_def !~ 'PAID_REGISTRATION_MUST_CANCEL_FIRST' then raise exception 'VERIFY: join-by-secret no bloquea participaciones pagadas.'; end if;
  if v_def !~ 'CONFIRM_TEAM_CHANGE_REQUIRED' then raise exception 'VERIFY: join-by-secret no exige confirmacion para cambiar de equipo.'; end if;
  if v_def !~ 'status <> ''registration_open''' then raise exception 'VERIFY: join-by-secret admite estados fuera de registration_open.'; end if;

  -- join-by-token: mecanismo separado por token opaco (sin clave en la URL).
  if to_regprocedure('public.join_championship_team_with_token(text, boolean)') is null then
    raise exception 'VERIFY: falta join_championship_team_with_token.';
  end if;
  select pg_get_functiondef(to_regprocedure('public.join_championship_team_with_token(text, boolean)')) into v_def;
  if v_def ~ '_championship_verify_secret' then raise exception 'VERIFY: el join por token NO debe usar la clave.'; end if;
  if v_def !~ '_championship_participation' then raise exception 'VERIFY: join-by-token no clasifica participacion.'; end if;
  if v_def !~ 'status <> ''registration_open''' then raise exception 'VERIFY: join-by-token admite estados fuera de registration_open.'; end if;

  -- getter de compartir: owner-only y NO expone el hash de la clave.
  if to_regprocedure('public.get_championship_team_share(uuid)') is null then
    raise exception 'VERIFY: falta get_championship_team_share.';
  end if;
  select pg_get_functiondef(to_regprocedure('public.get_championship_team_share(uuid)')) into v_def;
  if v_def !~ 'created_by_user_id is distinct from v_actor' then raise exception 'VERIFY: el getter de compartir no restringe al owner.'; end if;
  if v_def ~ 'join_secret_hash' then raise exception 'VERIFY: el getter de compartir NO debe exponer el hash de la clave.'; end if;

  raise notice 'OK: inscripcion pagada de equipo (una unidad=public_team_price); team creado solo al confirmar; clave hasheada (bcrypt) y token de link opaco SEPARADOS; union por clave o token; reward+credito reutilizan consume_reward/spend_wallet_credit.';
end $verify$;

commit;
