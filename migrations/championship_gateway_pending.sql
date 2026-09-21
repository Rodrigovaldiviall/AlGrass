-- ============================================================================
-- Championship · GATEWAY (pending lógico multi-cancha) — order / confirm / fail / expire
-- ============================================================================
-- A diferencia de la TRANSFERENCIA (que reserva físicamente las canchas en el hold), el pago por
-- PASARELA adquiere un pending LÓGICO: las N rentals siguen 'published' + championship_id NULL; el claim
-- se representa con championship_reservation_games (CRG) + un order 'pending'. La reserva física ocurre
-- SOLO al confirmar el pago (published→reserved en una operación all-or-none).
--
-- ADITIVA. NO toca: create_championship_transfer_hold / confirm/approve/reject de transferencia,
-- reserve_slots, claim_rental_double_out_aware, materializeReservation, capacidad, wallet, rewards,
-- published_audience, triggers double-out. El guard cruzado en create_order va en migración aparte
-- (create_order_championship_gateway_guard.sql). NO crea tablas nuevas (reutiliza CRG).
-- ============================================================================


-- ── 0) championships.status: añadir 'gateway_hold' (conserva todos los valores actuales) ─────
alter table public.championships drop constraint if exists championships_status_check;
alter table public.championships
  add constraint championships_status_check
  check (status in (
    'transfer_hold',
    'gateway_hold',          -- NUEVO: pending lógico de pasarela (games siguen published; claim = CRG)
    'payment_validation',
    'pending_publish',
    'registration_open',
    'registration_closed',
    'in_progress',
    'completed',
    'canceled'
  ));


-- ── 1) create_championship_gateway_order — adquirir el pending lógico ALL-OR-NONE ────────────
-- Al pulsar PAGAR (antes de cobrar). Lockea {N rentals ∪ sus gemelos} ORDER BY id, revalida todo,
-- calcula precio server-side, crea championship 'gateway_hold' + 1 order 'pending' + N CRG. NO toca games.
-- TTL server-side (10 min, como la transferencia). Idempotente por (payer, idempotency_key).
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
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  -- Idempotencia (payer, key): reintentos devuelven el mismo hold.
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

  -- Championship en 'gateway_hold'. city/event_date/venue_id/registration_closes_at = autoridad backend.
  insert into public.championships (
    owner_user_id, status, payment_method, hold_expires_at, city,
    name, cover_theme, privacy, registration_key, results_public,
    event_date, start_time, end_time, venue_id, format_config, registration_closes_at
  ) values (
    v_actor, 'gateway_hold', coalesce(nullif(p_config->>'payment_method',''), 'gateway'), v_hold_exp, v_city,
    p_config->>'name', p_config->>'cover_theme',
    coalesce(p_config->>'privacy', 'private'), p_config->>'registration_key',
    coalesce((p_config->>'results_public')::boolean, true),
    (v_price->>'event_date')::date, nullif(p_config->>'start_time','')::time,
    nullif(p_config->>'end_time','')::time, (v_price->>'venue_id')::uuid,
    coalesce(p_config->'format_config', '{}'::jsonb), v_reg_close
  ) returning * into v_champ;

  -- Order del campeonato — pending (TTL = hold). financial_snapshot = breakdown congelado.
  insert into public.orders (
    idempotency_key, payer_user_id, resource_type, resource_id,
    claim_composition, claimed_units, pending_expires_at,
    amount_total, currency, financial_snapshot, payment_provider, status
  ) values (
    p_idempotency_key, v_actor, 'championship', v_champ.id,
    jsonb_build_object('kind', 'championship_gateway_hold', 'game_ids', to_jsonb(v_ids)),
    v_count, v_hold_exp,
    v_total, coalesce(v_price->>'currency', 'PEN'), v_price, nullif(p_config->>'payment_method',''),
    'pending'
  ) returning * into v_order;

  update public.championships set order_id = v_order.id, updated_at = now() where id = v_champ.id;

  -- Claim LÓGICO: N filas CRG. LAS GAMES NO SE TOCAN (siguen published, championship_id NULL, twins intactos).
  insert into public.championship_reservation_games (championship_id, game_id)
  select v_champ.id, unnest(v_ids);

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


-- ── 2) confirm_championship_gateway_payment — pago confirmado → materialización ALL-OR-NONE ──
-- order pending→confirmed, championship gateway_hold→pending_publish, N rentals published→reserved +
-- championship_id (dispara trg_block_double_out_twin → gemelos blocked), 1 reservations spend. Todo atómico.
-- Idempotente (gateway_hold guard + UNIQUE parcial reservations_championship_spend_uq). No wallet (externo).
create or replace function public.confirm_championship_gateway_payment(p_championship_id uuid)
returns public.championships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_champ   public.championships%rowtype;
  v_order   public.orders%rowtype;
  v_ids     uuid[];
  v_lockset uuid[];
  v_n       integer;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.owner_user_id <> v_actor then raise exception 'NOT_OWNER'; end if;

  -- Idempotencia VERIFICADA: 'pending_publish' no-op solo si order confirmed + spend existente.
  if v_champ.status = 'pending_publish' then
    if v_champ.order_id is null then raise exception 'INVALID_STATE'; end if;
    if not exists (select 1 from public.orders where id = v_champ.order_id and status = 'confirmed') then
      raise exception 'INVALID_STATE'; end if;
    if not exists (select 1 from public.reservations where championship_id = p_championship_id and status = 'spend') then
      raise exception 'INVALID_STATE'; end if;
    return v_champ;
  end if;
  if v_champ.status <> 'gateway_hold' then raise exception 'INVALID_STATE'; end if;
  if v_champ.order_id is null then raise exception 'ORDER_NOT_FOUND'; end if;

  select * into v_order from public.orders where id = v_champ.order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'pending' then raise exception 'INVALID_STATE'; end if;
  if v_order.pending_expires_at <= now() then raise exception 'ORDER_EXPIRED'; end if;

  -- Composición autoritativa = CRG. Lock de {games ∪ gemelos} ORDER BY id.
  select array_agg(game_id order by game_id) into v_ids
    from public.championship_reservation_games where championship_id = p_championship_id;
  if v_ids is null or array_length(v_ids, 1) is null then raise exception 'CHAMPIONSHIP_NO_GAMES'; end if;
  v_n := array_length(v_ids, 1);
  select array_agg(distinct x order by x) into v_lockset
    from (
      select unnest(v_ids) as x
      union
      select g.alternative_game_id from public.games g where g.id = any(v_ids) and g.alternative_game_id is not null
    ) s;
  perform 1 from public.games where id = any(v_lockset) order by id for update;

  -- Revalidar TODAS: siguen rentals published, libres y sin championship_id (all-or-none).
  if (select count(*) from public.games
        where id = any(v_ids) and type = 'rental' and status = 'published'
          and booked_by_user_id is null and championship_id is null) <> v_n then
    raise exception 'AVAILABILITY_CHANGED';
  end if;

  -- MATERIALIZAR (una sola sentencia atómica): published→reserved + championship_id. Dispara
  -- trg_block_double_out_twin por cada rental → sus gemelos Match pasan a 'blocked' (mecanismo existente).
  -- Si algún gemelo ya estaba tomado → el trigger lanza ALTERNATIVE_TAKEN → rollback TOTAL (ninguna reserved).
  update public.games set status = 'reserved', championship_id = v_champ.id where id = any(v_ids);

  -- order → confirmed; championship → pending_publish.
  update public.orders set status = 'confirmed', resolved_at = now(), updated_at = now() where id = v_order.id;
  update public.championships set status = 'pending_publish', updated_at = now()
   where id = p_championship_id returning * into v_champ;

  -- Asiento financiero: 1 spend (UNIQUE parcial reservations_championship_spend_uq = última barrera).
  insert into public.reservations (
    game_id, championship_id, user_id, order_id,
    status, reservation_type, source, payment_method,
    total_amount, subtotal_amount, credit_applied, reward_applied, promo_discount, promo_code_id,
    reserved_at
  ) values (
    null, v_champ.id, v_order.payer_user_id, v_order.id,
    'spend', 'championship', 'championship', coalesce(v_champ.payment_method, 'gateway'),
    v_order.amount_total, v_order.amount_total, 0, 0, 0, null,
    now()
  );

  return v_champ;
end;
$$;
revoke all on function public.confirm_championship_gateway_payment(uuid) from public, anon;
grant execute on function public.confirm_championship_gateway_payment(uuid) to authenticated;


-- ── 3) fail_championship_gateway — el cobro falló → cancelar el pending (sin tocar games) ─────
create or replace function public.fail_championship_gateway(p_championship_id uuid, p_reason text default null)
returns public.championships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.owner_user_id <> v_actor then raise exception 'NOT_OWNER'; end if;
  if v_champ.status = 'canceled' then return v_champ; end if;             -- idempotente
  if v_champ.status <> 'gateway_hold' then raise exception 'INVALID_STATE'; end if;

  if v_champ.order_id is not null then
    update public.orders
       set status = 'failed', terminal_reason = coalesce(nullif(btrim(p_reason), ''), 'payment_failed'),
           resolved_at = now(), updated_at = now()
     where id = v_champ.order_id and status = 'pending';
  end if;
  delete from public.championship_reservation_games where championship_id = p_championship_id;
  update public.championships set status = 'canceled', hold_expires_at = null, updated_at = now()
   where id = p_championship_id returning * into v_champ;
  return v_champ;   -- games siguen published, championship_id NULL, twins intactos; sin spend/refund/wallet
end;
$$;
revoke all on function public.fail_championship_gateway(uuid, text) from public, anon;
grant execute on function public.fail_championship_gateway(uuid, text) to authenticated;


-- ── 4) Barrido de gateway holds vencidos (cron). No toca games; borra CRG temporales. ────────
create or replace function public.expire_championship_gateway_holds()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_status text;
  v_exp    timestamptz;
  v_order  uuid;
  v_n      integer := 0;
begin
  for v_id in
    select id from public.championships
     where status = 'gateway_hold' and hold_expires_at is not null and hold_expires_at <= now()
     order by id
  loop
    select status, hold_expires_at, order_id into v_status, v_exp, v_order
      from public.championships where id = v_id for update;
    if v_status = 'gateway_hold' and v_exp is not null and v_exp <= now() then
      if v_order is not null then
        update public.orders set status = 'expired', terminal_reason = 'timeout',
               resolved_at = now(), updated_at = now()
         where id = v_order and status = 'pending';
      end if;
      delete from public.championship_reservation_games where championship_id = v_id;
      update public.championships set status = 'canceled', updated_at = now() where id = v_id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.expire_championship_gateway_holds() from public, anon, authenticated;
grant execute on function public.expire_championship_gateway_holds() to service_role;

-- Cron cada 1 minuto (mismo patrón que expire-championship-transfer-holds).
do $$
begin
  perform cron.unschedule('expire-championship-gateway-holds');
exception when others then
  null;
end $$;
select cron.schedule(
  'expire-championship-gateway-holds',
  '* * * * *',
  $$ select public.expire_championship_gateway_holds(); $$
);
