-- ============================================================================
-- Campeonatos PÚBLICOS · Equipo · reservation.unit_price en el asiento de confirmación
-- ============================================================================
-- Incremental SOBRE championships_public_team_registration.sql. Reemite SOLO
-- confirm_championship_team_registration añadiendo unit_price al asiento `spend`:
-- hoy queda NULL porque el insert no lo incluía. La inscripción de equipo es UNA
-- unidad y su precio base congelado ya vive en financial_snapshot.unit_price
-- (= public_team_price al crear la order). Byte-idéntica al original salvo:
--   · declare: v_unit numeric;
--   · v_unit := round(coalesce(snapshot.unit_price, v_subtotal), 2);
--   · el insert de reservations ahora lista/valora unit_price.
-- NO cambia ninguna otra matemática (subtotal=bruto post-reward pre-crédito,
-- total_amount=externo, credit_applied=crédito, reward_applied=reward). players_count
-- y guest_total NO se inventan (una inscripción de equipo no son N jugadores) → quedan
-- en su default. NO-OP para Match/Rental y privados: solo redefine una RPC de
-- inscripción de equipo PÚBLICO; no toca create_order/confirm_order, triggers, ni
-- ninguna función de privados.
-- ============================================================================

begin;

do $pre$
begin
  if to_regprocedure('public.confirm_championship_team_registration(uuid, text)') is null then
    raise exception 'Abortado: falta confirm_championship_team_registration (aplica antes championships_public_team_registration.sql).';
  end if;
end $pre$;

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
  v_unit     := round(coalesce((v_order.financial_snapshot->>'unit_price')::numeric, v_subtotal), 2);   -- precio base congelado (public_team_price)

  -- 3) Asiento financiero (1 spend por order). Contrato único: subtotal_amount = BRUTO (v_bruto del
  -- trigger), total_amount = EXTERNO (post-crédito), credit_applied = crédito; unit_price = precio base.
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

do $verify$
declare v_def text;
begin
  select pg_get_functiondef(to_regprocedure('public.confirm_championship_team_registration(uuid, text)')) into v_def;
  -- El asiento ahora LISTA unit_price y lo VALORA desde el snapshot.
  if v_def !~ 'unit_price, total_amount, subtotal_amount, credit_applied' then
    raise exception 'VERIFY: el asiento de equipo no incluye unit_price en el insert.';
  end if;
  if v_def !~ 'v_unit\s*:=\s*round\(coalesce\(\(v_order\.financial_snapshot->>''unit_price''' then
    raise exception 'VERIFY: unit_price no se toma de financial_snapshot.unit_price.';
  end if;
  if v_def !~ 'v_unit, v_external, v_subtotal, v_credito, v_reward' then
    raise exception 'VERIFY: el asiento no valora unit_price/external/subtotal/credito/reward en orden.';
  end if;
  raise notice 'OK: confirm_championship_team_registration graba reservation.unit_price = snapshot.unit_price (public_team_price). Resto de la matematica intacto.';
end $verify$;

commit;
