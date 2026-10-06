-- ============================================================================
-- Campeonatos PÚBLICOS · compra de EQUIPO · bloquear SOLO por producto PAGADO incompatible
-- ============================================================================
-- PRINCIPIO: una participación GRATIS (free_member/free_individual/none) NO bloquea una compra
-- pagada. Solo se bloquea por producto PAGADO incompatible:
--   A) el actor tiene una inscripción individual pagada con SU plaza activa;
--   B) el actor es payer de una inscripción individual con ≥1 invitado activo (aunque haya cancelado
--      su propia plaza);
--   C) el actor ya es team_owner pagado en este campeonato.
-- A/B → ACTIVE_INDIVIDUAL_RESERVATION. C → ALREADY_ENROLLED (owner de equipo; mismo copy "cancela primero").
--
-- El guard GENÉRICO anterior (exists championship_players → ALREADY_ENROLLED) se ELIMINA: bloqueaba
-- incorrectamente a los gratuitos (gratis → pagado debe permitirse). El confirm MUEVE la única fila
-- championship_players del creador con UPSERT (de su equipo gratis al nuevo) — sin duplicado ni UNIQUE.
--
-- NO toca inscripción individual (create/confirm individual ya son correctos), "Unirme sin equipo",
-- cancelaciones, refunds, reward, invitados, registration_closed, privados, Admin, Match/Rental.
-- ============================================================================

begin;

do $pre$
begin
  if to_regprocedure('public.create_championship_team_registration_order(uuid, text, jsonb)') is null
     or to_regprocedure('public.confirm_championship_team_registration(uuid, text)') is null then
    raise exception 'Abortado: faltan las RPC de inscripcion de equipo (aplica antes championships_team_join_secret_plaintext.sql).';
  end if;
  if to_regprocedure('public._championship_participation(uuid, uuid)') is null then
    raise exception 'Abortado: falta _championship_participation (aplica antes championships_public_individual_itemized.sql).';
  end if;
end $pre$;


-- ── 1 · create · bloqueo SOLO por producto pagado incompatible (A/B/C) ───────────
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
  if v_secret is null or length(v_secret) < 4 then raise exception 'TEAM_SECRET_REQUIRED'; end if;   -- mínimo 4

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  -- SIN guard genérico por championship_players: una participación GRATIS no bloquea (gratis → pagado permitido).
  -- (C) team_owner pagado ya existente → no comprar OTRO equipo. (A/B los cubre ACTIVE_INDIVIDUAL_RESERVATION.)
  if public._championship_participation(p_championship_id, v_actor) = 'team_owner' then
    raise exception 'ALREADY_ENROLLED';
  end if;
  -- (A/B) el actor es PAYER de una inscripción individual confirmada con ≥1 plaza VIVA (propia o de invitados).
  -- Fuente viva: championship_players.registration_order_id → orders. Si la plaza se canceló, la fila viva se borró
  -- (deja de contar); una reinscripción apunta a otra order. Las participaciones GRATIS tienen registration_order_id
  -- NULL → no entran al JOIN → no bloquean.
  if exists (
    select 1 from public.championship_players cp
    join public.orders o on o.id = cp.registration_order_id
    where cp.championship_id = p_championship_id
      and o.payer_user_id = v_actor
      and o.status = 'confirmed'
      and coalesce(o.claim_composition->>'kind','') = 'championship_registration'
  ) then
    raise exception 'ACTIVE_INDIVIDUAL_RESERVATION';
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


-- ── 2 · confirm · revalida SOLO A/B/C y MUEVE la fila del creador con UPSERT ──────
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

  -- Revalidar bajo lock SOLO incompatibilidades PAGADAS (A/B/C). NO bloquear por existir en championship_players:
  -- un free_member/free_individual puede comprar equipo (su fila se MUEVE con el UPSERT de abajo).
  if public._championship_participation(p_championship_id, v_order.payer_user_id) = 'team_owner' then
    raise exception 'AVAILABILITY_CHANGED';
  end if;
  if exists (
    select 1 from public.championship_players cp
    join public.orders o2 on o2.id = cp.registration_order_id
    where cp.championship_id = p_championship_id
      and o2.payer_user_id = v_order.payer_user_id
      and o2.status = 'confirmed'
      and coalesce(o2.claim_composition->>'kind','') = 'championship_registration'
  ) then
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

  -- 2) Inscribir/MOVER al creador a SU equipo. UPSERT: si ya tenía fila gratuita (p.ej. free_member de otro
  --    equipo), su ÚNICA fila championship_players pasa al nuevo team_id (sin duplicado ni violación UNIQUE).
  --    registration_order_id = NULL EXPLÍCITO (invariante: owner de equipo pagado NO lleva order individual; la
  --    fuente del pago del equipo es championship_teams.order_id). Así un free_member que compra equipo no arrastra
  --    una registration_order_id individual.
  insert into public.championship_players (championship_id, user_id, team_id, registration_order_id)
  values (p_championship_id, v_order.payer_user_id, v_team_id, null)
  on conflict (championship_id, user_id) do update set team_id = excluded.team_id, registration_order_id = null;

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


-- ── 3 · Verificación ──────────────────────────────────────────────────────────
do $verify$
declare v_def text;
begin
  -- create: sin guard genérico; con ACTIVE_INDIVIDUAL_RESERVATION (A/B) y team_owner (C).
  select pg_get_functiondef(to_regprocedure('public.create_championship_team_registration_order(uuid, text, jsonb)')) into v_def;
  if v_def ~ 'where championship_id = p_championship_id and user_id = v_actor' then
    raise exception 'VERIFY: create conserva el guard GENERICO por championship_players (bloquearia gratis).';
  end if;
  if v_def !~ 'ACTIVE_INDIVIDUAL_RESERVATION' then raise exception 'VERIFY: create no bloquea A/B.'; end if;
  if v_def !~ '_championship_participation\(p_championship_id, v_actor\) = ''team_owner''' then
    raise exception 'VERIFY: create no bloquea C (team_owner).';
  end if;
  if v_def !~ 'cp.registration_order_id' then
    raise exception 'VERIFY: create no usa championship_players.registration_order_id (fuente viva) → falso positivo por reinscripcion.';
  end if;

  -- confirm: UPSERT del creador + revalidacion solo A/B/C (sin exists-generico).
  select pg_get_functiondef(to_regprocedure('public.confirm_championship_team_registration(uuid, text)')) into v_def;
  if v_def !~ 'on conflict \(championship_id, user_id\) do update set team_id = excluded.team_id' then
    raise exception 'VERIFY: confirm no hace UPSERT del creador (free_member romperia por UNIQUE).';
  end if;
  if v_def ~ 'where championship_id = p_championship_id and user_id = v_order.payer_user_id' then
    raise exception 'VERIFY: confirm conserva el exists-generico (bloquearia gratis).';
  end if;
  if v_def !~ 'team_owner' then raise exception 'VERIFY: confirm no revalida C.'; end if;

  raise notice 'OK: compra de equipo permite gratis->pagado (free_member/free_individual/none); bloquea A/B (ACTIVE_INDIVIDUAL_RESERVATION) y C (team_owner); confirm MUEVE la fila del creador con UPSERT.';
end $verify$;

commit;
