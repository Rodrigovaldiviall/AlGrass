-- ============================================================================
-- FIX mínimo · create_championship_transfer_hold — guard pending Rental / Match double-out
-- ============================================================================
-- BASE: versión VIGENTE = championships_phase3_config_pricing.sql (misma firma/idempotencia/pricing/
-- CRG/reserva física). Antes de aplicar, confirmar en la DB que la función viva es esa (con
-- _championship_compute_price + games→reserved + CRG). NO reconstruir desde una versión anterior.
--
-- ÚNICOS cambios funcionales respecto a la base (nada más):
--   CAMBIO 1: el conjunto a lockear pasa a ser {N rentals ∪ sus alternative_game_id (twins)}, ORDER BY id.
--   CAMBIO 2: por cada rental, si existe un order 'pending' vivo (resource_id=rental) → AVAILABILITY_CHANGED.
--   CAMBIO 3: por cada rental con twin double-out, si el Match twin tiene order 'pending' vivo →
--             AVAILABILITY_CHANGED.
-- Todo lo demás (idempotencia, dedupe, assert_game_reservable, check físico status/booked/championship_id,
-- pricing, insert championship+order, reserva física games→reserved+championship_id, CRG, disparo de los
-- triggers double-out al reservar, exception unique_violation, TTL) queda IDÉNTICO. La transferencia sigue
-- reservando físicamente ANTES de la validación manual. NO toca create_order, gateway, confirm/approve/reject,
-- reservations, wallet, triggers double-out, assert_game_reservable, Captain-only, published_audience ni frontend.
-- ============================================================================

create or replace function public.create_championship_transfer_hold(
  p_game_ids        uuid[],
  p_idempotency_key text,
  p_config          jsonb default '{}'::jsonb
)
returns public.championships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor        uuid := auth.uid();
  v_hold_expires timestamptz := now() + interval '10 minutes';
  v_existing     public.orders%rowtype;
  v_champ        public.championships%rowtype;
  v_order        public.orders%rowtype;
  v_ids          uuid[];
  v_lockset      uuid[];   -- [CAMBIO 1] N rentals ∪ twins → lock determinista
  v_id           uuid;
  v_twin         uuid;     -- [CAMBIO 3] gemelo Match de una rental (o null)
  v_count        integer;
  v_price        jsonb;
  v_total        numeric;
  v_city         text;
  v_reg_close    timestamptz;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_game_ids is null or array_length(p_game_ids, 1) is null then raise exception 'NO_GAMES'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then raise exception 'MISSING_IDEMPOTENCY_KEY'; end if;

  -- Idempotencia (payer, idempotency_key). Reintentos devuelven el mismo hold.
  select * into v_existing from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    select * into v_champ from public.championships where order_id = v_existing.id;
    if found then return v_champ; end if;
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;

  -- Dedupe + orden determinista (id asc).
  select array_agg(x order by x) into v_ids from (select distinct unnest(p_game_ids) x) s;
  v_count := array_length(v_ids, 1);
  if v_count is null or v_count < 1 then raise exception 'NO_GAMES'; end if;

  -- [CAMBIO 1] Conjunto a lockear = N rentals ∪ sus gemelos (double-out). Lock ORDER BY id (orden
  -- determinista, compatible con create_order → sin deadlock entre flujos).
  select array_agg(distinct x order by x) into v_lockset
    from (
      select unnest(v_ids) as x
      union
      select g.alternative_game_id from public.games g
       where g.id = any(v_ids) and g.alternative_game_id is not null
    ) s;
  perform 1 from public.games where id = any(v_lockset) order by id for update;

  -- Revalidar TODOS bajo lock: existen, rentals no empezados, publicados, sin booker y sin campeonato.
  if (select count(*) from public.games where id = any(v_ids)) <> v_count then
    raise exception 'AVAILABILITY_CHANGED';
  end if;
  foreach v_id in array v_ids loop
    perform public.assert_game_reservable(v_id, 'rental');
    -- [CAMBIO 2] order 'pending' vivo sobre ESTA rental (hold de pasarela/crédito de Match/Rental) → conflicto.
    if exists (
      select 1 from public.orders o
       where o.resource_id = v_id and o.status = 'pending' and o.pending_expires_at > now()
    ) then
      raise exception 'AVAILABILITY_CHANGED';
    end if;
    -- [CAMBIO 3] si la rental tiene gemelo double-out (Match), su twin no puede tener order 'pending' vivo.
    -- (La detección FÍSICA del twin ya ganado —reserved/blocked/booked— la sigue haciendo el trigger
    --  trg_block_double_out_twin al reservar; aquí SOLO se añade el pending vivo, que el trigger no ve.)
    select alternative_game_id into v_twin from public.games where id = v_id;
    if v_twin is not null then
      if exists (
        select 1 from public.orders o
         where o.resource_id = v_twin and o.status = 'pending' and o.pending_expires_at > now()
      ) then
        raise exception 'AVAILABILITY_CHANGED';
      end if;
    end if;
  end loop;
  if exists (
    select 1 from public.games
     where id = any(v_ids)
       and (status <> 'published' or booked_by_user_id is not null or championship_id is not null)
  ) then
    raise exception 'AVAILABILITY_CHANGED';
  end if;

  -- PRECIO REAL (autoridad final) con la MISMA función que quote. group_id lo elige el cliente (p_config),
  -- pero service_court_hours/tarifas los posee el backend. Valida formato/ciudad/settings/lead-days/extras.
  v_price     := public._championship_compute_price(v_ids, p_config->>'group_id', coalesce(p_config->'extras', '[]'::jsonb));
  v_total     := (v_price->>'amount_total')::numeric;
  v_city      := v_price->>'city';
  v_reg_close := (v_price->>'registration_closes_at')::timestamptz;

  -- Crear el championship en 'transfer_hold'. city/event_date/venue_id/registration_closes_at = autoridad backend.
  insert into public.championships (
    owner_user_id, status, payment_method, hold_expires_at, city,
    name, cover_theme, privacy, registration_key, results_public,
    event_date, start_time, end_time, venue_id, format_config, registration_closes_at
  ) values (
    v_actor, 'transfer_hold', 'transfer', v_hold_expires, v_city,
    p_config->>'name', p_config->>'cover_theme',
    coalesce(p_config->>'privacy', 'private'), p_config->>'registration_key',
    coalesce((p_config->>'results_public')::boolean, true),
    (v_price->>'event_date')::date, nullif(p_config->>'start_time','')::time,
    nullif(p_config->>'end_time','')::time, (v_price->>'venue_id')::uuid,
    coalesce(p_config->'format_config', '{}'::jsonb), v_reg_close
  ) returning * into v_champ;

  -- Order del campeonato — amount_total = TOTAL REAL; financial_snapshot = breakdown congelado.
  insert into public.orders (
    idempotency_key, payer_user_id, resource_type, resource_id,
    claim_composition, claimed_units, pending_expires_at,
    amount_total, currency, financial_snapshot, status
  ) values (
    p_idempotency_key, v_actor, 'championship', v_champ.id,
    jsonb_build_object('kind', 'championship_transfer_hold', 'game_ids', to_jsonb(v_ids)),
    v_count, v_hold_expires,
    v_total, coalesce(v_price->>'currency', 'PEN'), v_price,
    'pending'
  ) returning * into v_order;

  update public.championships set order_id = v_order.id, updated_at = now() where id = v_champ.id;

  -- Adquirir: published → reserved + championship_id (booked_by permanece NULL). Dispara double-out block.
  update public.games set status = 'reserved', championship_id = v_champ.id where id = any(v_ids);

  insert into public.championship_reservation_games (championship_id, game_id)
  select v_champ.id, unnest(v_ids);

  select * into v_champ from public.championships where id = v_champ.id;
  return v_champ;

exception
  when unique_violation then
    select * into v_existing from public.orders where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
    if found then
      select * into v_champ from public.championships where order_id = v_existing.id;
      if found then return v_champ; end if;
    end if;
    raise exception 'AVAILABILITY_CHANGED';
end;
$$;
grant execute on function public.create_championship_transfer_hold(uuid[], text, jsonb) to authenticated;
