-- ============================================================================
-- ROLLBACK QUIRÚRGICO · pre-Championship-Gateway guards
-- ============================================================================
-- Restaura EXACTAMENTE las dos funciones LIVE actuales (las que ya funcionan) SIN los guards CRG del
-- Championship Gateway. Úsalo SOLO si create_order_championship_gateway_guard.sql o
-- championship_transfer_hold_gateway_guard.sql produjeran una regresión.
--
-- Huellas LIVE que este archivo debe reproducir (auditoría read-only previa):
--   · public.create_order(text,text,uuid,jsonb,numeric,text,jsonb,timestamptz,text)
--         def_len = 8523   def_md5 = c293f0fa7ba2dc0a1f97c3e4109838aa
--   · public.create_championship_transfer_hold(uuid[],text,jsonb)
--         def_len = 6858   def_md5 = 75c59bd111335c182a7304bbc455ad97
--
-- FUENTES (no reconstruido de memoria):
--   A) create_order  = base de create_order_championship_gateway_guard.sql
--                      (= restore_create_order_double_out_pending_guard.sql, aplicado/commit 49b39e9)
--                      MENOS los bloques CAMBIO 1 y CAMBIO 2 (CRG gateway_hold).
--   C) create_championship_transfer_hold = championship_transfer_hold_pending_guard.sql (versión LIVE)
--                      es decir, base de championship_transfer_hold_gateway_guard.sql MENOS el bloque
--                      [CAMBIO GATEWAY] (CRG gateway_hold).
--
-- SOLO reemplaza estas DOS funciones + sus GRANT. No toca tablas, datos, constraints, cron, triggers,
-- otras funciones, ni introduce Gateway/mejoras. Verificar post-apply que md5(pg_get_functiondef(...))
-- vuelve a c293f0fa... y 75c59bd1... respectivamente.
-- ============================================================================


-- ── A) create_order — versión LIVE SIN guards CRG Gateway ────────────────────
create or replace function public.create_order(
  p_idempotency_key    text,
  p_resource_type      text,
  p_resource_id        uuid,
  p_claim_composition  jsonb,
  p_amount_total       numeric,
  p_currency           text,
  p_financial_snapshot jsonb,
  p_pending_expires_at timestamptz,
  p_payment_provider   text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_existing   public.orders%rowtype;
  v_units      integer;
  v_host       uuid;
  v_booked_by  uuid;
  v_champ_id   uuid;   -- [CHAMPIONSHIP GUARD] championship_id del game (Fase 2)
  v_avail      integer;
  v_holds      integer;
  v_referral          uuid;
  v_referral_reserved integer := 0;
  v_titular    boolean;
  v_order      public.orders%rowtype;
  v_alt          uuid;                     -- [DOUBLE-OUT] gemelo (o null)
  v_twin         public.games%rowtype;     -- [DOUBLE-OUT] fila del gemelo B (si pareja válida)
  v_status       text;                     -- [DOUBLE-OUT] status del game solicitado (solo rama con pareja)
  v_twin_paired  boolean := false;         -- [DOUBLE-OUT] true solo si A↔B es bidireccional
begin
  -- 1) Sesión
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  -- 2) Idempotencia
  select * into v_existing
    from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;

  -- 3) Entrada mínima (amount_total=0 válido para HOLD de crédito/invitado; solo < 0 se rechaza).
  if p_amount_total is null or p_amount_total < 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_pending_expires_at is null or p_pending_expires_at <= now() then raise exception 'INVALID_TTL'; end if;
  if p_resource_type not in ('match','rental') then raise exception 'INVALID_RESOURCE_TYPE'; end if;

  -- 4) Unidades del HOLD
  v_titular := coalesce((p_claim_composition->>'titular')::boolean, false);
  if p_resource_type = 'rental' then
    v_units := 1;
  else
    v_units := (case when v_titular then 1 else 0 end)
             + coalesce(jsonb_array_length(p_claim_composition->'guests'), 0)
             + coalesce((p_claim_composition->>'reserved_slots')::integer, 0);
  end if;
  if v_units < 1 then raise exception 'EMPTY_CLAIM'; end if;

  -- 5) Bloqueo DETERMINISTA (double-out): leer alternative_game_id y lockear A+B ORDER BY id.
  select g.alternative_game_id into v_alt
    from public.games g
   where g.id = p_resource_id;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;

  if v_alt is null then
    select g.host_user_id, g.booked_by_user_id, g.championship_id, g.alternative_game_id
      into v_host, v_booked_by, v_champ_id, v_alt
      from public.games g
     where g.id = p_resource_id
     for update of g;
    if v_alt is not null then
      raise exception 'NO_CAPACITY';
    end if;
  else
    perform 1 from public.games
     where id in (p_resource_id, v_alt)
     order by id
     for update;
    select g.host_user_id, g.booked_by_user_id, g.championship_id, g.status
      into v_host, v_booked_by, v_champ_id, v_status
      from public.games g
     where g.id = p_resource_id;
    select * into v_twin from public.games where id = v_alt;
    if not found or v_twin.alternative_game_id is distinct from p_resource_id then
      raise exception 'NO_CAPACITY';
    end if;
    v_twin_paired := true;
  end if;

  -- 6) Precondiciones
  perform public.assert_game_reservable(p_resource_id, p_resource_type);
  if p_resource_type = 'match' and v_titular and v_host is not null and v_host = v_actor then
    raise exception 'HOST_CANNOT_RESERVE';
  end if;

  -- 7) Capacidad OFICIAL (INTACTA)
  if p_resource_type = 'match' then
    v_avail := public.public_availability(p_resource_id);
    v_referral := nullif(p_financial_snapshot->>'referral', '')::uuid;
    if v_referral is not null then
      select coalesce(gsr.effective_reserved_slots_remaining, 0)
        into v_referral_reserved
        from public.get_slot_reservation_for_user(p_resource_id, v_referral) gsr;
    end if;
    select coalesce(sum(o.claimed_units), 0)::integer
      into v_holds
      from public.orders o
     where o.resource_id = p_resource_id
       and o.status = 'pending'
       and o.pending_expires_at > now();
    if coalesce((p_claim_composition->>'reserved_slots')::integer, 0) > greatest(v_avail - v_holds, 0) then
      raise exception 'INSUFFICIENT_PUBLIC_SLOTS';
    end if;
    if (v_avail + v_referral_reserved - v_holds) < v_units then raise exception 'NO_CAPACITY'; end if;
  else
    -- rental: 1 unidad.
    if v_booked_by is not null then raise exception 'NO_CAPACITY'; end if;
    if v_champ_id is not null then raise exception 'NO_CAPACITY'; end if;   -- [CHAMPIONSHIP GUARD, Fase 2]
    if exists (
      select 1 from public.orders o
       where o.resource_id = p_resource_id and o.status = 'pending' and o.pending_expires_at > now()
    ) then raise exception 'NO_CAPACITY'; end if;
  end if;

  -- 7b) DOUBLE-OUT (INTACTO): el gemelo es incompatible mientras el game solicitado sigue 'published'.
  if v_twin_paired and v_status = 'published' then
    if v_twin.status in ('reserved','blocked') or v_twin.booked_by_user_id is not null then
      raise exception 'NO_CAPACITY';
    end if;
    if exists (
      select 1 from public.orders o
       where o.resource_id = v_alt
         and o.status = 'pending'
         and o.pending_expires_at > now()
    ) then
      raise exception 'NO_CAPACITY';
    end if;
  end if;

  -- 8) Adquirir el HOLD (única escritura)
  insert into public.orders (
    idempotency_key, payer_user_id, resource_type, resource_id,
    claim_composition, claimed_units, pending_expires_at,
    amount_total, currency, financial_snapshot, payment_provider, status
  ) values (
    p_idempotency_key, v_actor, p_resource_type, p_resource_id,
    p_claim_composition, v_units, p_pending_expires_at,
    p_amount_total, coalesce(p_currency, 'PEN'), p_financial_snapshot, p_payment_provider, 'pending'
  )
  returning * into v_order;

  return v_order;

exception
  when unique_violation then
    select * into v_existing
      from public.orders
     where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
    return v_existing;
end;
$$;

-- B) GRANT create_order (actual)
grant execute on function public.create_order(text, text, uuid, jsonb, numeric, text, jsonb, timestamptz, text) to authenticated;


-- ── C) create_championship_transfer_hold — versión LIVE SIN guard CRG Gateway ─
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

-- D) GRANT create_championship_transfer_hold (actual)
grant execute on function public.create_championship_transfer_hold(uuid[], text, jsonb) to authenticated;
