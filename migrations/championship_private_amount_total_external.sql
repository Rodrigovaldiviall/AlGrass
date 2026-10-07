-- Campeonatos PRIVADOS (creación/host) · orders.amount_total = EXTERNO (paridad con el flujo público)
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Cierre de la corrección financiera del campeonato propio. championship_private_spend_financial_parity.sql
-- ya dejó el asiento `reservations` correcto (unit_price/subtotal=bruto, total=externo, credit del snapshot).
-- Queda la ÚLTIMA inconsistencia: orders.amount_total guardaba el BRUTO (diseño histórico de
-- championship_gateway_credit.sql). El flujo PÚBLICO usa orders.amount_total = EXTERNO
-- (championships_public_individual_itemized.sql:24, championships_public_team_registration.sql:37). Unificamos.
--
-- AUDITORÍA de lectores de orders.amount_total en el flujo privado y qué asumen:
--   · create_championship_gateway_order (gateway_credit, ACTIVA) → ESCRIBE amount_total = v_total (BRUTO).  ← se cambia
--   · create_championship_transfer_hold (gateway_guard, ACTIVA)  → ESCRIBE amount_total = v_total; SIN crédito
--       (su snapshot es la cotización cruda, sin credit_applied/external_amount) ⇒ externo == bruto ⇒ YA es externo.
--   · confirm_championship_gateway_payment / approve_championship_transfer (parity, ACTIVAS) → el BRUTO lo leen de
--       financial_snapshot.amount_total (coalesce antes de v_order.amount_total); el externo de external_amount ⇒ NO dependen del bruto en la columna.
--   · get_championship_my_reservation / cancelaciones / techos de reembolso → leen reservations.subtotal_amount y
--       financial_snapshot (external_amount), NUNCA orders.amount_total.
--   · triggers del núcleo trg_championship_spend_wallet (BEFORE INSERT: rellena credit_applied y contabiliza
--       external_amount desde el SNAPSHOT) y trg_orders_credit_restore (restituye credit_applied del SNAPSHOT en
--       cancelación) → leen el SNAPSHOT, NUNCA orders.amount_total.
--   · fail/expire gateway → status→failed/canceled; el crédito vuelve por trigger (snapshot). Sin lectura de amount_total.
--
-- CONCLUSIÓN: el ÚNICO lector que asume "amount_total = bruto" y produce la inconsistencia es la ESCRITURA en
-- create_championship_gateway_order. Cambiarla a v_externo es SEGURO: todo lo demás ya usa snapshot/reservations.
-- El BRUTO sigue disponible en financial_snapshot.amount_total (la cotización) y en reservations.subtotal_amount.
--
-- ADITIVA. Reemite SOLO create_championship_gateway_order (idéntica salvo amount_total: v_total → v_externo).
-- NO toca: transfer (ya externo, sin crédito), confirm/approve (parity), público, Match, Rental, rewards, promos,
-- refunds, triggers del núcleo, ni frontend.

begin;

do $pre$
begin
  if to_regprocedure('public.create_championship_gateway_order(uuid[], text, jsonb)') is null then
    raise exception 'Abortado: falta create_championship_gateway_order (aplica antes championship_gateway_credit.sql).';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'reservations' and t.tgname = 'trg_championship_spend_wallet' and not t.tgisinternal) then
    raise exception 'Abortado: falta trg_championship_spend_wallet (núcleo de crédito).';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'orders' and t.tgname = 'trg_orders_credit_restore' and not t.tgisinternal) then
    raise exception 'Abortado: falta trg_orders_credit_restore (restitución de crédito).';
  end if;
end $pre$;


create or replace function public.create_championship_gateway_order(
  p_game_ids        uuid[],
  p_idempotency_key text,
  p_config          jsonb
)
returns public.championships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor     uuid := auth.uid();
  v_existing  public.orders%rowtype;
  v_champ     public.championships%rowtype;
  v_order     public.orders%rowtype;
  v_ids       uuid[];
  v_lockset   uuid[];
  v_count     integer;
  v_id        uuid;
  v_twin      uuid;
  v_rec       record;
  v_price     jsonb;
  v_total     numeric;
  v_city      text;
  v_reg_close timestamptz;
  v_hold_exp  timestamptz := now() + interval '10 minutes';
  -- ── Pago con saldo ──
  v_credito   numeric := 0;   -- crédito del usuario que se aplica (p_config.credit_applied)
  v_externo   numeric;        -- lo que queda por cobrar fuera (bruto − crédito)
  v_method    text;           -- método de pago: 'credit' si el saldo lo cubre todo
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  -- Idempotencia (payer, key): reintentos devuelven el mismo hold. NUNCA se debita
  -- crédito aquí: el débito vive SOLO en la rama de creación, más abajo.
  select * into v_existing from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    select * into v_champ from public.championships where order_id = v_existing.id;
    if found then return v_champ; end if;
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;

  -- Dedupe + orden determinista.
  select array_agg(x order by x) into v_ids from (select distinct unnest(p_game_ids) x) s;
  v_count := array_length(v_ids, 1);
  if v_count is null or v_count < 1 then raise exception 'NO_GAMES'; end if;

  -- Conjunto a lockear = N rentals ∪ sus gemelos (double-out). Lock ORDER BY id (serializa carreras
  -- Championship↔Rental, Championship↔Match double-out y Championship↔Championship).
  select array_agg(distinct x order by x) into v_lockset
    from (
      select unnest(v_ids) as x
      union
      select g.alternative_game_id from public.games g
       where g.id = any(v_ids) and g.alternative_game_id is not null
    ) s;
  perform 1 from public.games where id = any(v_lockset) order by id for update;

  -- Revalidar TODAS las rentals bajo lock.
  if (select count(*) from public.games where id = any(v_ids)) <> v_count then
    raise exception 'AVAILABILITY_CHANGED';
  end if;
  foreach v_id in array v_ids loop
    perform public.assert_game_reservable(v_id, 'rental');
    -- rental, published, libre, sin championship_id (published_audience NO se usa para rechazar).
    if not exists (
      select 1 from public.games g
       where g.id = v_id and g.type = 'rental'
         and g.status = 'published' and g.booked_by_user_id is null and g.championship_id is null
    ) then
      raise exception 'AVAILABILITY_CHANGED';
    end if;
    -- Rental pending vivo (Match/Rental normal) sobre esta rental → conflicto.
    if exists (
      select 1 from public.orders o
       where o.resource_id = v_id and o.status = 'pending' and o.pending_expires_at > now()
    ) then
      raise exception 'AVAILABILITY_CHANGED';
    end if;
    -- CRG: ¿ya reclamada por otro Championship?  (UNIQUE(game_id) → 0/1 fila)
    --   canceled            → CRG huérfana: lazy reclaim (borrar) bajo lock.
    --   gateway_hold        → si su order sigue pending vivo → conflicto; si muerto → lazy reclaim.
    --   cualquier otro vivo → conflicto (transfer/payment_validation/pending_publish/registration_*/…).
    select c.status as cstatus, c.order_id as corder into v_rec
      from public.championship_reservation_games crg
      join public.championships c on c.id = crg.championship_id
     where crg.game_id = v_id;
    if found then
      if v_rec.cstatus = 'canceled' then
        delete from public.championship_reservation_games where game_id = v_id;
      elsif v_rec.cstatus = 'gateway_hold' then
        if exists (select 1 from public.orders o
                    where o.id = v_rec.corder and o.status = 'pending' and o.pending_expires_at > now()) then
          raise exception 'AVAILABILITY_CHANGED';
        else
          delete from public.championship_reservation_games where game_id = v_id;   -- gateway muerto → reclaim
        end if;
      else
        raise exception 'AVAILABILITY_CHANGED';
      end if;
    end if;
    -- Double-out: si la rental tiene gemelo (match), el gemelo no puede haber ganado ni tener pending vivo.
    select alternative_game_id into v_twin from public.games where id = v_id;
    if v_twin is not null then
      if exists (select 1 from public.games g
                  where g.id = v_twin and (g.status in ('reserved','blocked') or g.booked_by_user_id is not null)) then
        raise exception 'AVAILABILITY_CHANGED';
      end if;
      if exists (select 1 from public.orders o
                  where o.resource_id = v_twin and o.status = 'pending' and o.pending_expires_at > now()) then
        raise exception 'AVAILABILITY_CHANGED';
      end if;
    end if;
  end loop;

  -- PRECIO REAL (autoridad backend; misma función que quote/transfer). Valida ciudad/formato/lead/blocks.
  v_price     := public._championship_compute_price(v_ids, p_config->>'group_id', coalesce(p_config->'extras', '[]'::jsonb));
  v_total     := (v_price->>'amount_total')::numeric;
  v_city      := v_price->>'city';
  v_reg_close := (v_price->>'registration_closes_at')::timestamptz;

  -- ── El crédito que se aplica ──
  -- Viaja en p_config para no cambiar la aridez. Sin la clave, 0: comportamiento de
  -- siempre. Se acota contra el total que acaba de decir la cotización, no contra un
  -- importe recalculado aquí.
  v_credito := round(coalesce((p_config->>'credit_applied')::numeric, 0), 2);
  if v_credito < 0 then raise exception 'INVALID_CREDIT'; end if;
  if v_credito > v_total then
    raise exception 'CREDIT_EXCEEDS_TOTAL: % > %', v_credito, v_total;
  end if;
  v_externo := round(v_total - v_credito, 2);
  -- Si el saldo lo cubre todo, el método es 'credit' (no habrá cobro externo); si no,
  -- se conserva EXACTAMENTE el método de hoy ('gateway' por defecto).
  v_method  := case when v_externo = 0 and v_total > 0 then 'credit'
                    else coalesce(nullif(p_config->>'payment_method',''), 'gateway') end;

  -- Championship en 'gateway_hold'. city/event_date/venue_id/registration_closes_at = autoridad backend.
  insert into public.championships (
    owner_user_id, status, payment_method, hold_expires_at, city,
    name, cover_theme, privacy, registration_key, results_public,
    event_date, start_time, end_time, venue_id, format_config, registration_closes_at
  ) values (
    v_actor, 'gateway_hold', v_method, v_hold_exp, v_city,
    p_config->>'name', p_config->>'cover_theme',
    coalesce(p_config->>'privacy', 'private'), p_config->>'registration_key',
    coalesce((p_config->>'results_public')::boolean, true),
    (v_price->>'event_date')::date, nullif(p_config->>'start_time','')::time,
    nullif(p_config->>'end_time','')::time, (v_price->>'venue_id')::uuid,
    coalesce(p_config->'format_config', '{}'::jsonb), v_reg_close
  ) returning * into v_champ;

  -- Order del campeonato — pending (TTL = hold). financial_snapshot = breakdown congelado
  -- + la memoria del pago (credit_applied, external_amount), de donde leen los dos triggers del núcleo.
  -- amount_total = EXTERNO (bruto − crédito), paridad con el flujo público. El BRUTO vive en
  -- financial_snapshot.amount_total (cotización) y en reservations.subtotal_amount (techo de reembolso).
  insert into public.orders (
    idempotency_key, payer_user_id, resource_type, resource_id,
    claim_composition, claimed_units, pending_expires_at,
    amount_total, currency, financial_snapshot, payment_provider, status
  ) values (
    p_idempotency_key, v_actor, 'championship', v_champ.id,
    jsonb_build_object('kind', 'championship_gateway_hold', 'game_ids', to_jsonb(v_ids)),
    v_count, v_hold_exp,
    v_externo, coalesce(v_price->>'currency', 'PEN'),
    v_price || jsonb_build_object('credit_applied', v_credito, 'external_amount', v_externo),
    case when v_externo = 0 and v_total > 0 then 'credit' else nullif(p_config->>'payment_method','') end,
    'pending'
  ) returning * into v_order;

  update public.championships set order_id = v_order.id, updated_at = now() where id = v_champ.id;

  -- Claim LÓGICO: N filas CRG. LAS GAMES NO SE TOCAN (siguen published, championship_id NULL, twins intactos).
  insert into public.championship_reservation_games (championship_id, game_id)
  select v_champ.id, unnest(v_ids);

  -- ── El crédito, DESPUÉS de crear la order (de donde cuelga la restitución) ──
  -- SOLO en la rama de creación: el retorno idempotente de arriba no llega aquí, así
  -- que un reintento con la misma key no descuenta dos veces. Condicional: sin saldo
  -- lanza INSUFFICIENT_CREDIT y toda la transacción (champ+order+CRG) se revierte.
  if v_credito > 0 then
    perform public.spend_wallet_credit(v_actor, v_credito);
  end if;

  select * into v_champ from public.championships where id = v_champ.id;
  return v_champ;

exception
  when unique_violation then
    -- Carrera de idempotencia O choque de CRG.UNIQUE(game_id): otro ganó → sin claim parcial (rollback).
    select * into v_existing from public.orders where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
    if found then
      select * into v_champ from public.championships where order_id = v_existing.id;
      if found then return v_champ; end if;
    end if;
    raise exception 'AVAILABILITY_CHANGED';
end;
$$;
revoke all on function public.create_championship_gateway_order(uuid[], text, jsonb) from public, anon;
grant execute on function public.create_championship_gateway_order(uuid[], text, jsonb) to authenticated;


-- ── Verificación: amount_total ahora es el EXTERNO; el snapshot sigue congelando credit/external ──
do $verify$
declare v_def text;
begin
  select pg_get_functiondef(to_regprocedure('public.create_championship_gateway_order(uuid[], text, jsonb)')) into v_def;
  if v_def is null then raise exception 'VERIFY: no se recreó create_championship_gateway_order.'; end if;
  if v_def !~ 'v_count, v_hold_exp,\s*v_externo, coalesce' then
    raise exception 'VERIFY: amount_total NO quedó en v_externo (externo).';
  end if;
  if v_def !~ '''credit_applied'', v_credito' or v_def !~ '''external_amount'', v_externo' then
    raise exception 'VERIFY: el snapshot dejó de congelar credit_applied/external_amount.';
  end if;
  if v_def !~ 'spend_wallet_credit\(v_actor, v_credito\)' then
    raise exception 'VERIFY: dejó de debitar el crédito con la primitiva.';
  end if;
  raise notice 'OK: create_championship_gateway_order → orders.amount_total = EXTERNO (paridad con público). BRUTO vive en snapshot.amount_total + reservations.subtotal_amount. Triggers/confirm/transfer/refund intactos.';
end $verify$;

commit;
