-- ============================================================================
-- Campeonatos · Crédito en la COMPRA INICIAL del App (pasarela) — cambio mínimo
-- ============================================================================
-- Extiende ÚNICAMENTE create_championship_gateway_order para aceptar crédito del
-- wallet en el checkout inicial del App, replicando el patrón YA PROBADO de
-- admin_create_championship (20261103130000). No toca nada más.
--
-- CÓMO: el crédito viaja en p_config.credit_applied (0 por defecto → la función se
-- comporta EXACTAMENTE como hoy, sin cambiar la aridez ni la firma). Se valida
-- 0 <= credit <= amount_total; external_amount = amount_total − credit; el snapshot
-- congela credit_applied + external_amount; y el débito lo hace spend_wallet_credit
-- SOLO en la rama de creación (el retorno idempotente de arriba nunca lo toca).
--
-- amount_total sigue siendo el BRUTO (topes de reembolso de Fase 1 intactos). El
-- asiento lo sigue escribiendo confirm_championship_gateway_payment SIN CAMBIOS: el
-- trigger trg_championship_spend_wallet (BEFORE INSERT) rellena credit_applied desde
-- el snapshot y contabiliza solo external_amount; trg_orders_credit_restore devuelve
-- el crédito si la order muere (pending→failed/expired).
--
-- DOS CAMINOS, decididos por external:
--   external > 0  (0 crédito o parcial) → IDÉNTICO a hoy: order 'pending', champ
--                 'gateway_hold', games sin tocar; la pasarela cobra external y
--                 confirm_championship_gateway_payment materializa.
--   external = 0  (100% crédito, total>0) → payment_method/provider = 'credit'. El
--                 App NO abre pasarela: llama create + confirm directamente (igual
--                 que payWithCredit de Games). El order nace 'pending' igual; al
--                 confirmar, el trigger no mueve nada externo (external=0) y el
--                 crédito ya se movió al crear la order.
--
-- Errores nuevos: INVALID_CREDIT · CREDIT_EXCEEDS_TOTAL · INSUFFICIENT_CREDIT.
-- Idempotente. Reaplicable. Envuelta en begin/commit.
-- ============================================================================

begin;

-- ── 0 · Comprobación previa: el núcleo de crédito ya está aplicado ───────────
do $pre$
begin
  if to_regprocedure('public.spend_wallet_credit(uuid, numeric)') is null then
    raise exception 'Abortado: falta spend_wallet_credit(uuid, numeric). Aplica antes 20261103120000_championship_credit_core.sql.';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.reservations'::regclass
       and tgname = 'trg_championship_spend_wallet' and not tgisinternal
  ) then
    raise exception 'Abortado: falta el trigger trg_championship_spend_wallet (núcleo de crédito).';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.orders'::regclass
       and tgname = 'trg_orders_credit_restore' and not tgisinternal
  ) then
    raise exception 'Abortado: falta el trigger trg_orders_credit_restore (restitución de crédito).';
  end if;
end $pre$;


-- ── create_championship_gateway_order — con crédito opcional en p_config ──────
-- COPIA FIEL de la versión vigente (championship_gateway_pending.sql) + crédito.
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
  -- importe recalculado aquí. amount_total sigue siendo el BRUTO.
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
  -- + la memoria del pago (credit_applied, external_amount), de donde leen los dos
  -- triggers del núcleo. amount_total = BRUTO.
  insert into public.orders (
    idempotency_key, payer_user_id, resource_type, resource_id,
    claim_composition, claimed_units, pending_expires_at,
    amount_total, currency, financial_snapshot, payment_provider, status
  ) values (
    p_idempotency_key, v_actor, 'championship', v_champ.id,
    jsonb_build_object('kind', 'championship_gateway_hold', 'game_ids', to_jsonb(v_ids)),
    v_count, v_hold_exp,
    v_total, coalesce(v_price->>'currency', 'PEN'),
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


-- ── Verificación estructural ─────────────────────────────────────────────────
do $verify$
declare
  v_def text;
begin
  select pg_get_functiondef(to_regprocedure('public.create_championship_gateway_order(uuid[], text, jsonb)')) into v_def;
  if v_def is null then raise exception 'VERIFY: no se recreó create_championship_gateway_order.'; end if;

  -- La aridez NO cambió: tres argumentos, uno NO opcional (p_config sin default aquí, igual que hoy).
  if (select p.pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'create_championship_gateway_order') <> 3 then
    raise exception 'VERIFY: la firma dejó de tener tres argumentos.';
  end if;

  -- Lee el crédito de p_config y lo acota.
  if v_def !~ 'p_config->>''credit_applied''' then
    raise exception 'VERIFY: no lee credit_applied de p_config.';
  end if;
  if v_def not like '%INVALID_CREDIT%' or v_def not like '%CREDIT_EXCEEDS_TOTAL%' then
    raise exception 'VERIFY: el crédito no está acotado (0 <= credit <= total).';
  end if;
  -- Debita con la primitiva (no a mano) y solo si hay crédito.
  if v_def !~ 'spend_wallet_credit\(v_actor, v_credito\)' then
    raise exception 'VERIFY: no debita con spend_wallet_credit al actor.';
  end if;
  if v_def ~ 'update public\.wallet_summary' then
    raise exception 'VERIFY: toca el wallet a mano; eso es de la primitiva.';
  end if;
  -- El débito va DESPUÉS del insert de la order (de donde cuelga la restitución).
  if position('into v_order' in v_def) > position('spend_wallet_credit' in v_def) then
    raise exception 'VERIFY: debita antes de crear la order.';
  end if;
  -- El snapshot guarda la memoria del pago.
  if v_def !~ '''credit_applied'', v_credito' or v_def !~ '''external_amount'', v_externo' then
    raise exception 'VERIFY: el snapshot no guarda credit_applied/external_amount.';
  end if;
  -- amount_total sigue siendo el bruto (v_total), no el externo.
  if v_def !~ 'v_count, v_hold_exp,\s*v_total, coalesce' then
    raise exception 'VERIFY: amount_total ya no es el bruto.';
  end if;
  -- 100% crédito → método 'credit'.
  if v_def !~ 'v_externo = 0 and v_total > 0 then ''credit''' then
    raise exception 'VERIFY: el 100%% crédito no marca el método credit.';
  end if;

  raise notice 'OK: create_championship_gateway_order acepta p_config.credit_applied (0 = comportamiento de hoy), congela credit_applied/external_amount, debita con spend_wallet_credit solo al crear la order, y amount_total sigue siendo el bruto. confirm/triggers/transferencia/Admin, intactos.';
end $verify$;

commit;
