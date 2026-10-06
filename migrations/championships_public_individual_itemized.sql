-- ============================================================================
-- Campeonatos PÚBLICOS · Inscripción INDIVIDUAL · ITEMIZADO del asiento + snapshot
-- ============================================================================
-- Incremental SOBRE championships_public_individual_registration.sql + _rewards.
-- Reemite create/confirm (individual) para que la ORDER y el ASIENTO guarden el
-- DESGLOSE completo (unit_price, players_count, guest_total, subtotal_amount,
-- reward_applied, credit_applied, external_amount), no solo totales agregados.
--
-- HALLAZGO DE LA AUDITORÍA (importante): la MATEMÁTICA del reward YA ERA CORRECTA.
-- El reward se topea a UNA unidad (unit_price) y se resta del BRUTO:
--   v_total = unit_price*N - reward  ==  (unit_price - reward) + (N-1)*unit_price
--           ==  titularNet + guestsTotal
-- es decir, el reward reduce SOLO el titular; los invitados NUNCA se descuentan.
-- Las 6 casillas de la matriz (A-F) dan exactamente el resultado esperado con esta
-- fórmula. No había bug financiero en el wallet. Lo que faltaba era ITEMIZAR el
-- asiento (unit_price/players_count/guest_total/subtotal_amount quedaban NULL).
--
-- CONTRATO FINANCIERO ÚNICO (igual que Match/Rental; requiere la migración Admin
-- 20261106130000_championship_wallet_subtotal_as_gross, que hace que el trigger lea el
-- BRUTO de subtotal_amount):
--   · subtotal_amount = BRUTO = (unit - reward) + guestsTotal   [neto tras reward, PRE-crédito]
--   · credit_applied  = crédito usado
--   · total_amount    = IMPORTE FINAL externo = subtotal_amount - credit   [POST-crédito]
--   · order.amount_total = total_amount (externo)
--   · snapshot.external_amount = externo (lo que cobra la pasarela)
-- El trigger contabiliza v_externo = subtotal_amount - credit = total_amount. La cancelación
-- no procesa inscripciones (ver migración Admin). NO poner credit en total_amount: el bruto
-- reembolsable vive en subtotal_amount y el crédito en credit_applied.
--
-- NO toca: Match/Rental, consume_reward, create_order/confirm_order, equipo, Admin,
-- privados, fixture, registration_key, ni el trigger. Idempotente.
-- ============================================================================

begin;

-- ── 0 · Pre-checks ───────────────────────────────────────────────────────────
do $pre$
begin
  if to_regprocedure('public.create_championship_registration_order(uuid, text, uuid[], jsonb)') is null
     or to_regprocedure('public.confirm_championship_registration(uuid, text)') is null then
    raise exception 'Abortado: falta la base de inscripcion individual (aplica antes _registration + _rewards).';
  end if;
  -- Columnas itemizadas del asiento (las usa Match; deben existir).
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='reservations' and column_name='guest_total') then
    raise exception 'Abortado: reservations.guest_total no existe.';
  end if;
end $pre$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 0b · Helper REUTILIZABLE · clasificación de participación (pagada vs gratuita)
-- ══════════════════════════════════════════════════════════════════════════════
-- Deriva el tipo de participación de un usuario SOLO de estructuras existentes (sin
-- columna nueva). Lo usan create/confirm de inscripción individual y los join de equipo.
--   'none'            → no inscrito.
--   'paid_individual' → aparece en los user_ids de una order CONFIRMADA de inscripción
--                       individual (payer O invitado: ambos son PAGADOS).
--   'team_owner'      → su championship_player apunta a un equipo que él creó y que tiene
--                       order_id (equipo PAGADO).
--   'free_member'     → está en un equipo pero no lo creó / no pagó (miembro gratuito).
--   'free_individual' → inscrito sin equipo y sin order pagada (caso privado; en público no
--                       ocurre porque "sin equipo" público siempre es pagado).
create or replace function public._championship_participation(
  p_championship_id uuid,
  p_user_id         uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_has  boolean;
  v_team uuid;
  v_paid boolean;
  v_own  boolean;
begin
  select true, cp.team_id into v_has, v_team
    from public.championship_players cp
   where cp.championship_id = p_championship_id and cp.user_id = p_user_id;
  if not coalesce(v_has, false) then return 'none'; end if;

  select exists (
    select 1 from public.orders o
     where o.resource_type = 'championship' and o.resource_id = p_championship_id
       and o.status = 'confirmed'
       and coalesce(o.claim_composition->>'kind','') = 'championship_registration'
       and (o.claim_composition->'user_ids') ? p_user_id::text
  ) into v_paid;
  if v_paid then return 'paid_individual'; end if;

  if v_team is not null then
    select exists (
      select 1 from public.championship_teams t
       where t.id = v_team and t.created_by_user_id = p_user_id and t.order_id is not null
    ) into v_own;
    if v_own then return 'team_owner'; end if;
    return 'free_member';
  end if;

  return 'free_individual';
end $$;
revoke all on function public._championship_participation(uuid, uuid) from public, anon, authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 1 · create_championship_registration_order · + desglose en el snapshot
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.create_championship_registration_order(
  p_championship_id uuid,
  p_idempotency_key text,
  p_user_ids        uuid[],
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
  v_ids      uuid[];
  v_count    integer;
  v_unit     numeric;
  v_reward   numeric := 0;
  v_titular  numeric;
  v_guests   numeric;
  v_subtotal numeric;
  v_credito  numeric := 0;
  v_externo  numeric;
  v_method   text;
  v_order    public.orders%rowtype;
  v_uid      uuid;
  v_part     text;
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
  if not (v_champ.order_id is null and v_champ.public_individual_price is not null) then
    raise exception 'NOT_PUBLIC';
  end if;
  if v_champ.status <> 'registration_open' then raise exception 'NOT_OPEN'; end if;

  select array_agg(distinct x) into v_ids from unnest(coalesce(p_user_ids, '{}'::uuid[])) x where x is not null;
  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count = 0 then raise exception 'NO_PLAYERS'; end if;
  if not (v_actor = any(v_ids)) then raise exception 'PAYER_NOT_INCLUDED'; end if;
  if (select count(*) from public.users_public u where u.id = any(v_ids)) <> v_count then
    raise exception 'INVALID_INPUT';
  end if;

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  -- Regla por persona (NO se toca championship_players aquí):
  --   · PAGADO ('paid_individual'/'team_owner') → bloqueado para TODOS (debe cancelar primero).
  --   · PAYER (v_uid = v_actor): permitido none/free_member/free_individual. Si es free_member,
  --     pasará Team→Sin equipo SOLO al confirmar SU propio pago (self-service, lo inicia él).
  --   · INVITADO (v_uid <> v_actor): 'free_member' BLOQUEADO — moverlo a team_id=NULL lo sacaría
  --     de su equipo sin que él lo inicie. 'free_individual' permitido (no está en ningún equipo:
  --     el upsert a NULL es no-op; solo pasa de sin-equipo gratis a pagado). 'none' permitido.
  foreach v_uid in array v_ids loop
    v_part := public._championship_participation(p_championship_id, v_uid);
    if v_part in ('paid_individual','team_owner') then
      raise exception 'ALREADY_ENROLLED';
    end if;
    if v_uid <> v_actor and v_part = 'free_member' then
      raise exception 'ALREADY_ENROLLED';
    end if;
  end loop;

  -- DESGLOSE (autoridad backend). unit = precio individual del campeonato.
  v_unit := v_champ.public_individual_price;
  -- REWARD: SOLO el titular, tope = unit_price (clamp inline; nunca confía en el monto crudo).
  v_reward   := least(greatest(0, round(coalesce((p_config->>'reward_applied')::numeric, 0), 2)), round(v_unit, 2));
  v_titular  := round(v_unit - v_reward, 2);                 -- titularNet (reward solo aquí)
  v_guests   := round((v_count - 1) * v_unit, 2);            -- guestsTotal (NUNCA descontado)
  v_subtotal := round(v_titular + v_guests, 2);              -- == unit*N - reward

  v_credito := round(coalesce((p_config->>'credit_applied')::numeric, 0), 2);
  if v_credito < 0 then raise exception 'INVALID_CREDIT'; end if;
  if v_credito > v_subtotal then raise exception 'CREDIT_EXCEEDS_TOTAL: % > %', v_credito, v_subtotal; end if;
  v_externo := round(v_subtotal - v_credito, 2);
  v_method  := case when v_externo = 0 then 'credit' else 'gateway' end;

  -- amount_total = EXTERNO (post-crédito) = contrato único. El bruto va en snapshot.subtotal_amount
  -- y en reservation.subtotal_amount; el trigger lo usa como v_bruto.
  insert into public.orders (
    idempotency_key, payer_user_id, resource_type, resource_id,
    claim_composition, claimed_units, pending_expires_at,
    amount_total, currency, financial_snapshot, payment_provider, status
  ) values (
    p_idempotency_key, v_actor, 'championship', p_championship_id,
    jsonb_build_object('kind', 'championship_registration', 'user_ids', to_jsonb(v_ids)),
    v_count, now() + interval '10 minutes',
    v_externo, 'PEN',
    jsonb_build_object('source','championship_registration',
      'unit_price', v_unit, 'player_count', v_count, 'guest_total', v_guests,
      'user_ids', to_jsonb(v_ids),
      'reward_applied', v_reward, 'subtotal_amount', v_subtotal,
      'credit_applied', v_credito, 'external_amount', v_externo),
    v_method,
    'pending'
  ) returning * into v_order;

  if v_credito > 0 then perform public.spend_wallet_credit(v_actor, v_credito); end if;

  return jsonb_build_object('order_id', v_order.id, 'amount_total', v_externo,
    'subtotal_amount', v_subtotal, 'external_amount', v_externo, 'reward_applied', v_reward,
    'credit_applied', v_credito, 'status', 'pending', 'payment_method', v_method);
end $$;
revoke all on function public.create_championship_registration_order(uuid, text, uuid[], jsonb) from public, anon;
grant execute on function public.create_championship_registration_order(uuid, text, uuid[], jsonb) to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2 · confirm_championship_registration · asiento ITEMIZADO desde el snapshot
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.confirm_championship_registration(
  p_championship_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order  public.orders%rowtype;
  v_champ  public.championships%rowtype;
  v_ids    uuid[];
  v_uid    uuid;
  v_snap   jsonb;
  v_unit   numeric;
  v_count  integer;
  v_guests numeric;
  v_reward numeric;
  v_subtotal numeric;
  v_credito  numeric;
  v_external numeric;
  v_method text;
  v_resv_id uuid;
  v_applied boolean;
  v_reason  text;
  v_part   text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_order from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.resource_type <> 'championship' or v_order.resource_id <> p_championship_id
     or coalesce(v_order.claim_composition->>'kind','') <> 'championship_registration' then
    raise exception 'INVALID_STATE';
  end if;

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  if v_order.status = 'confirmed' then
    if exists (select 1 from public.reservations where order_id = v_order.id and status = 'spend') then
      return jsonb_build_object('order_id', v_order.id, 'status', 'confirmed', 'already', true);
    end if;
    raise exception 'INVALID_STATE';
  end if;
  if v_order.status <> 'pending' then raise exception 'INVALID_STATE'; end if;
  if v_order.pending_expires_at <= now() then raise exception 'ORDER_EXPIRED'; end if;

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.status <> 'registration_open' then raise exception 'AVAILABILITY_CHANGED'; end if;

  select array(select jsonb_array_elements_text(v_order.claim_composition->'user_ids'))::uuid[] into v_ids;
  if v_ids is null or array_length(v_ids,1) is null then raise exception 'INVALID_STATE'; end if;

  -- Revalidar bajo lock la MISMA regla por persona que el create (no debe cambiar entretanto):
  --   PAGADO → aborta (todos). INVITADO free_member → aborta (no se le saca de su equipo).
  --   PAYER free_member/free_individual e INVITADO free_individual/none → permitidos.
  foreach v_uid in array v_ids loop
    v_part := public._championship_participation(p_championship_id, v_uid);
    if v_part in ('paid_individual','team_owner') then
      raise exception 'AVAILABILITY_CHANGED';
    end if;
    if v_uid <> v_actor and v_part = 'free_member' then
      raise exception 'AVAILABILITY_CHANGED';
    end if;
  end loop;

  -- Materializar inscripción individual (team_id NULL). Solo el PAYER free_member pasa Team→Sin
  -- equipo aquí (atómico con el pago, nunca antes); los invitados permitidos no están en equipo
  -- (free_individual=no-op, none=insert). No crea un segundo championship_player: el upsert
  -- mueve/deja el existente. Los PAGADOS y los invitados en equipo ya abortaron.
  foreach v_uid in array v_ids loop
    insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, v_uid, null)
    on conflict (championship_id, user_id) do update set team_id = null;
  end loop;

  -- Desglose AUTORITATIVO desde el snapshot congelado (no se recalcula con otra fórmula).
  v_snap     := v_order.financial_snapshot;
  v_unit     := round(coalesce((v_snap->>'unit_price')::numeric, v_order.amount_total), 2);
  v_count    := coalesce((v_snap->>'player_count')::int, array_length(v_ids,1));
  v_guests   := round(coalesce((v_snap->>'guest_total')::numeric, 0), 2);
  v_reward   := round(coalesce((v_snap->>'reward_applied')::numeric, 0), 2);
  v_subtotal := round(coalesce((v_snap->>'subtotal_amount')::numeric, v_order.amount_total), 2);
  v_credito  := round(coalesce((v_snap->>'credit_applied')::numeric, 0), 2);
  v_external := round(coalesce((v_snap->>'external_amount')::numeric, v_subtotal - v_credito), 2);

  v_method := case when coalesce((v_snap->>'external_amount')::numeric, v_order.amount_total) = 0
                        and v_order.amount_total > 0
                   then 'credit' else coalesce(v_order.payment_provider, 'gateway') end;

  -- Asiento ITEMIZADO (contrato único): subtotal_amount = BRUTO (= v_bruto del trigger),
  -- total_amount = EXTERNO (post-crédito), credit_applied = crédito. El trigger contabiliza
  -- external = subtotal_amount - credit y valida que credit_applied coincida con el snapshot.
  insert into public.reservations (
    game_id, championship_id, user_id, order_id,
    status, reservation_type, source, payment_method,
    unit_price, players_count, guest_total,
    total_amount, subtotal_amount, credit_applied, reward_applied, promo_discount, promo_code_id,
    reserved_at
  ) values (
    null, p_championship_id, v_order.payer_user_id, v_order.id,
    'spend', 'championship', 'championship_registration', v_method,
    v_unit, v_count, v_guests,
    v_external, v_subtotal, v_credito, v_reward, 0, null,
    now()
  ) returning id into v_resv_id;

  if v_reward > 0 then
    select applied, reason into v_applied, v_reason
      from public.consume_reward(v_order.payer_user_id, v_resv_id, v_reward);
    if not coalesce(v_applied, false) then
      raise exception 'REWARD_%', coalesce(v_reason, 'UNAVAILABLE');
    end if;
  end if;

  update public.orders set status = 'confirmed', resolved_at = now(), updated_at = now()
   where id = v_order.id;

  return jsonb_build_object('order_id', v_order.id, 'status', 'confirmed',
    'players', array_length(v_ids,1), 'subtotal_amount', v_subtotal,
    'external_amount', round(coalesce((v_snap->>'external_amount')::numeric, v_subtotal - v_credito), 2),
    'reward_applied', v_reward, 'already', false);
end $$;
revoke all on function public.confirm_championship_registration(uuid, text) from public, anon;
grant execute on function public.confirm_championship_registration(uuid, text) to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3 · Verificación
-- ══════════════════════════════════════════════════════════════════════════════
do $verify$
declare v_def text;
begin
  if to_regprocedure('public._championship_participation(uuid, uuid)') is null then
    raise exception 'VERIFY: falta el helper _championship_participation.';
  end if;

  -- create: snapshot itemizado (guest_total + subtotal_amount), reward topeado a unit inline,
  -- y clasificación de participación (permite free_member, bloquea pagados).
  select pg_get_functiondef(to_regprocedure('public.create_championship_registration_order(uuid, text, uuid[], jsonb)')) into v_def;
  if v_def !~ '''guest_total'', v_guests' then raise exception 'VERIFY: el snapshot no guarda guest_total.'; end if;
  if v_def !~ '''subtotal_amount'', v_subtotal' then raise exception 'VERIFY: el snapshot no guarda subtotal_amount.'; end if;
  if v_def !~ 'least\(greatest\(0' then raise exception 'VERIFY: el reward no esta topeado a unit inline.'; end if;
  if v_def !~ 'v_externo, ''PEN''' then raise exception 'VERIFY: amount_total no es el externo (contrato unico).'; end if;
  if v_def !~ '_championship_participation' then raise exception 'VERIFY: create no clasifica participacion (deberia permitir free_member y bloquear pagados).'; end if;
  if v_def !~ 'v_uid <> v_actor and v_part = ''free_member''' then raise exception 'VERIFY: create no bloquea invitado free_member (lo sacaria de su equipo).'; end if;

  -- confirm: asiento itemizado; subtotal_amount = bruto, total_amount = externo, credit del snapshot;
  -- revalida participación y mueve al miembro gratuito a Sin equipo (upsert team_id NULL).
  select pg_get_functiondef(to_regprocedure('public.confirm_championship_registration(uuid, text)')) into v_def;
  if v_def !~ 'unit_price, players_count, guest_total' then raise exception 'VERIFY: el asiento no itemiza unit/players/guest.'; end if;
  if v_def !~ 'v_external, v_subtotal, v_credito, v_reward' then raise exception 'VERIFY: el asiento no usa externo como total_amount, bruto como subtotal ni el credito del snapshot.'; end if;
  if v_def !~ 'consume_reward' then raise exception 'VERIFY: confirm no consume reward.'; end if;
  if v_def !~ '_championship_participation' then raise exception 'VERIFY: confirm no revalida participacion.'; end if;
  if v_def !~ 'v_uid <> v_actor and v_part = ''free_member''' then raise exception 'VERIFY: confirm no revalida el bloqueo de invitado free_member.'; end if;
  if v_def !~ 'do update set team_id = null' then raise exception 'VERIFY: confirm no mueve al miembro gratuito a Sin equipo (upsert team_id null).'; end if;

  raise notice 'OK: inscripcion individual (contrato unico): subtotal_amount=bruto, total_amount=amount_total=externo. reward solo al titular. Permite que un miembro gratuito compre individual (team->NULL atomico en confirm); bloquea pagados. Requiere Admin 20261106130000.';
end $verify$;

commit;
