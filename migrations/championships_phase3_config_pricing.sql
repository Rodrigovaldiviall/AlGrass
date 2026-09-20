-- ============================================================================
-- Campeonatos · Fase 3 — SETTINGS POR CIUDAD (una tabla) + PRICING REAL + EXTRAS
-- ============================================================================
-- Modelo DEFINITIVO (el que consumirá Admin > Configuración > Campeonatos). NO provisional.
-- Hoy se cargan valores iniciales por SQL; mañana Admin lee/edita esta MISMA tabla sin migración.
--
-- UNA sola tabla nueva: championship_settings (1 fila por ciudad), que incluye:
--   · tarifas por HORA-CANCHA DE SERVICIO (referee/fee) + reglas operativas (lead/close/currency);
--   · extras (catálogo N extensible)          → columna extras jsonb;
--   · perfiles de formato (group→service_court_hours) → columna availability_formats jsonb (autoridad backend).
-- (Se DESCARTAN championship_city_settings / championship_extras / championship_format_groups.)
--
-- ADITIVA sobre Fase 1/2 (ya aplicadas): añade championships.city (nullable), crea championship_settings +
-- funciones pricing/quote y re-crea create_championship_transfer_hold con la MISMA lógica de hold + precio real.
-- NO toca Match/Rental/create_order/double-out/wallet/rewards/Profile. NO crea reservation/spend. NO teams/
-- players/matches/fixture. NO cron nuevo.
--
-- AUTORIDAD SERVER-SIDE: el cliente NUNCA decide tarifas, service_court_hours ni amount_total. Envía games.id
-- reales + group_id + extras (code, quantity). El backend deriva ciudad (games→fields→venues.city), lee
-- championship_settings, resuelve service_court_hours desde availability_formats[group_id], valida booking_lead_days
-- (America/Lima) y calcula court/referee/fee/extras. Sin config → error explícito; NUNCA fallback a 0.
-- ============================================================================


-- ── 1) championships.city — ciudad de negocio del campeonato (aditivo, nullable) ───────────────
alter table public.championships add column if not exists city text;


-- ── 2) championship_settings — UNA fila por ciudad (tarifas + reglas + extras + formatos) ───────
-- app_settings es GLOBAL (fila única id=1); Championship es POR CIUDAD → tabla dedicada. Extras y perfiles de
-- formato viven como jsonb en la MISMA fila (una sola tabla, extensible por Admin sin migración).
--   extras jsonb               = [{code,name,active,unit_price,units_per_item,min_quantity,max_quantity,sort_order}, …]
--   availability_formats jsonb = { "g1": {min_teams,max_teams,service_court_hours}, … } (autoridad de horas de servicio)
create table if not exists public.championship_settings (
  city                    text primary key,
  currency                text    not null default 'PEN',
  -- Pricing por HORA-CANCHA DE SERVICIO requerida por el formato (service_court_hours). NO por rental/duración.
  referee_hourly_rate     numeric(12,2) not null check (referee_hourly_rate >= 0),
  algrass_fee_hourly_rate numeric(12,2) not null check (algrass_fee_hourly_rate >= 0),
  -- Operación
  -- Anticipación mínima POR RANGO DE EQUIPOS del grupo (regla operativa; NO es la necesidad de canchas).
  --   [{min_teams,max_teams,days}, …] — el backend resuelve la regla que CONTIENE el rango del group_id.
  booking_lead_rules      jsonb   not null default '[]'::jsonb,
  registration_close_days integer not null check (registration_close_days >= 0),  -- cierre inscripciones (días antes)
  -- Catálogo de extras (N extensible) y perfiles de formato (autoridad backend de service_court_hours).
  extras                  jsonb   not null default '[]'::jsonb,
  availability_formats    jsonb   not null default '{}'::jsonb,
  active                  boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);


-- ── 3) Seed inicial (Arequipa + Lima; ciudades reales de venues) ────────────────────────────────
-- Tarifas 50/50, close 2, PEN. booking_lead_rules por rango de equipos (5/7/10). Extras: trophy (unidad, 50,
-- 1..3), medals (pack de 10, 100, 1..3), photography/filming (unitarios, INACTIVOS por ahora). Formatos g1..g6 =
-- defaults del frontend (RECOMMENDATION_GROUPS): horas de servicio 3/4/6/8/9/10 (autoridad backend; el cliente
-- solo elige group_id, y de availability_formats[group_id] salen min/max de equipos y service_court_hours).
insert into public.championship_settings
  (city, currency, referee_hourly_rate, algrass_fee_hourly_rate, booking_lead_rules, registration_close_days,
   extras, availability_formats)
values
  ('Arequipa', 'PEN', 50, 50,
   '[{"min_teams":4,"max_teams":6,"days":5},{"min_teams":7,"max_teams":14,"days":7},{"min_teams":15,"max_teams":16,"days":10}]'::jsonb,
   2,
   '[
      {"code":"trophy",     "name":"Trofeo",    "active":true,  "unit_price":50,  "units_per_item":1,  "min_quantity":1, "max_quantity":3, "sort_order":1},
      {"code":"medals",     "name":"Medallas",  "active":true,  "unit_price":100, "units_per_item":10, "min_quantity":1, "max_quantity":3, "sort_order":2},
      {"code":"photography","name":"Fotografía","active":false, "unit_price":90,  "units_per_item":1,  "min_quantity":1, "max_quantity":1, "sort_order":3},
      {"code":"filming",    "name":"Filmación", "active":false, "unit_price":120, "units_per_item":1,  "min_quantity":1, "max_quantity":1, "sort_order":4}
    ]'::jsonb,
   '{
      "g1":{"min_teams":4, "max_teams":4, "service_court_hours":3},
      "g2":{"min_teams":5, "max_teams":6, "service_court_hours":4},
      "g3":{"min_teams":7, "max_teams":8, "service_court_hours":6},
      "g4":{"min_teams":9, "max_teams":12,"service_court_hours":8},
      "g5":{"min_teams":13,"max_teams":14,"service_court_hours":9},
      "g6":{"min_teams":15,"max_teams":16,"service_court_hours":10}
    }'::jsonb),
  ('Lima', 'PEN', 50, 50,
   '[{"min_teams":4,"max_teams":6,"days":5},{"min_teams":7,"max_teams":14,"days":7},{"min_teams":15,"max_teams":16,"days":10}]'::jsonb,
   2,
   '[
      {"code":"trophy",     "name":"Trofeo",    "active":true,  "unit_price":50,  "units_per_item":1,  "min_quantity":1, "max_quantity":3, "sort_order":1},
      {"code":"medals",     "name":"Medallas",  "active":true,  "unit_price":100, "units_per_item":10, "min_quantity":1, "max_quantity":3, "sort_order":2},
      {"code":"photography","name":"Fotografía","active":false, "unit_price":90,  "units_per_item":1,  "min_quantity":1, "max_quantity":1, "sort_order":3},
      {"code":"filming",    "name":"Filmación", "active":false, "unit_price":120, "units_per_item":1,  "min_quantity":1, "max_quantity":1, "sort_order":4}
    ]'::jsonb,
   '{
      "g1":{"min_teams":4, "max_teams":4, "service_court_hours":3},
      "g2":{"min_teams":5, "max_teams":6, "service_court_hours":4},
      "g3":{"min_teams":7, "max_teams":8, "service_court_hours":6},
      "g4":{"min_teams":9, "max_teams":12,"service_court_hours":8},
      "g5":{"min_teams":13,"max_teams":14,"service_court_hours":9},
      "g6":{"min_teams":15,"max_teams":16,"service_court_hours":10}
    }'::jsonb)
on conflict (city) do nothing;


-- ── 4) RLS — championship_settings cerrada al cliente (mutación futura solo Admin vía backend) ──
-- Sin políticas para authenticated: el cliente NO lee ni escribe directo. Las funciones SECURITY DEFINER
-- (quote/hold) leen esta tabla y resuelven la UX (mismo criterio que cancellation/orders RPCs).
alter table public.championship_settings enable row level security;


-- ── 5) Función INTERNA de pricing — ÚNICA fuente de las fórmulas (la usan quote y hold) ─────────
-- court_amount = Σ games.price_total (rentals físicos únicos, ENTEROS; 60/90/120 permitidos; sin prorratear).
-- service_court_hours = championship_settings.availability_formats[group_id].service_court_hours (autoridad backend).
-- referee_amount = service_court_hours × referee_hourly_rate;  algrass_fee_amount = service_court_hours × algrass_fee_hourly_rate.
-- extras_amount = Σ (quantity × unit_price) del catálogo settings.extras (activo, dentro de min/max).
-- Deriva ciudad/venue/event_date de los games REALES (no del cliente). Devuelve el breakdown COMPLETO que se
-- congela en orders.financial_snapshot. NO crea championship/order, NO reserva, NO spend.
-- Errores: NO_GAMES, GAME_NOT_FOUND, NOT_RENTAL, CHAMPIONSHIP_PRICE_UNAVAILABLE, MULTIPLE_VENUES, MULTIPLE_DATES,
--   CHAMPIONSHIP_CONFIG_UNAVAILABLE, CHAMPIONSHIP_FORMAT_UNAVAILABLE, BOOKING_LEAD_NOT_MET, DUPLICATE_EXTRA,
--   EXTRA_NOT_AVAILABLE, EXTRA_QUANTITY_OUT_OF_RANGE.
create or replace function public._championship_compute_price(
  p_game_ids uuid[],
  p_group_id text,
  p_extras   jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ids            uuid[];
  v_count          integer;   -- rental_count (informativo; NO participa en referee/fee)
  v_venue_id       uuid;
  v_venue_n        integer;
  v_city           text;
  v_event_date     date;
  v_date_n         integer;
  v_set            public.championship_settings%rowtype;
  v_fmt            jsonb;
  v_service_hours  integer;
  v_group_min      integer;
  v_group_max      integer;
  v_lead_rule      jsonb;
  v_lead_days      integer;
  v_lead_n         integer;
  v_r              jsonb;
  v_rmin           numeric;
  v_rmax           numeric;
  v_rdays          numeric;
  v_cat            jsonb;
  v_found          boolean;
  v_court_amount   numeric := 0;
  v_referee_amount numeric := 0;
  v_fee_amount     numeric := 0;
  v_extras_amount  numeric := 0;
  v_extras_out     jsonb   := '[]'::jsonb;
  v_ex             jsonb;
  v_code           text;
  v_qty            integer;
  v_unit_price     numeric;
  v_units          integer;
  v_min            integer;
  v_max            integer;
  v_name           text;
  v_amt            numeric;
  v_reg_close      timestamptz;
  v_today_lima     date := (now() at time zone 'America/Lima')::date;
begin
  -- Dedupe (game.id duplicados NO se cuentan dos veces).
  select array_agg(x order by x) into v_ids from (select distinct unnest(p_game_ids) x) s;
  v_count := array_length(v_ids, 1);
  if v_count is null or v_count < 1 then raise exception 'NO_GAMES'; end if;

  -- Todos existen y son rentals. (NO se exige duration_min=60; los rentals van ENTEROS.)
  if (select count(*) from public.games where id = any(v_ids)) <> v_count then raise exception 'GAME_NOT_FOUND'; end if;
  if exists (select 1 from public.games where id = any(v_ids) and type <> 'rental') then raise exception 'NOT_RENTAL'; end if;

  -- Precio requerido (NULL → sin precio → abortar, sin subcotizar).
  if exists (select 1 from public.games where id = any(v_ids) and price_total is null) then
    raise exception 'CHAMPIONSHIP_PRICE_UNAVAILABLE';
  end if;

  -- Venue ÚNICO (games → fields → venues). city derivada del venue real (NO del cliente).
  select count(distinct v.id), min(v.id)
    into v_venue_n, v_venue_id
    from public.games g
    join public.fields f on f.id = g.field_id
    join public.venues v on v.id = f.venue_id
   where g.id = any(v_ids);
  if v_venue_n is null or v_venue_n = 0 or v_venue_id is null then raise exception 'GAME_NOT_FOUND'; end if;
  if v_venue_n > 1 then raise exception 'MULTIPLE_VENUES'; end if;
  select city into v_city from public.venues where id = v_venue_id;
  if v_city is null then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;

  -- Fecha de evento única (derivada de games).
  select count(distinct date_key), min(date_key) into v_date_n, v_event_date
    from public.games where id = any(v_ids);
  if v_date_n > 1 then raise exception 'MULTIPLE_DATES'; end if;

  -- Settings de la ciudad (SIN default oculto).
  select * into v_set from public.championship_settings where city = v_city and active = true;
  if not found then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;

  -- Perfil del FORMATO (AUTORIDAD BACKEND): service_court_hours + rango de equipos desde availability_formats[group_id].
  -- El cliente solo elige group_id; NUNCA envía service_court_hours ni min/max de equipos.
  -- Lectura DEFENSIVA (jsonb_typeof antes de castear → nunca un cast genérico de Postgres como error).
  v_fmt := v_set.availability_formats -> p_group_id;
  if v_fmt is null or jsonb_typeof(v_fmt) <> 'object'
     or jsonb_typeof(v_fmt->'service_court_hours') <> 'number'
     or jsonb_typeof(v_fmt->'min_teams') <> 'number'
     or jsonb_typeof(v_fmt->'max_teams') <> 'number' then
    raise exception 'CHAMPIONSHIP_FORMAT_UNAVAILABLE';
  end if;
  v_service_hours := floor((v_fmt->>'service_court_hours')::numeric)::int;
  v_group_min     := floor((v_fmt->>'min_teams')::numeric)::int;
  v_group_max     := floor((v_fmt->>'max_teams')::numeric)::int;
  if v_service_hours <= 0 or v_group_min < 1 or v_group_max < v_group_min then
    raise exception 'CHAMPIONSHIP_FORMAT_UNAVAILABLE';
  end if;

  -- Anticipación mínima POR RANGO DE EQUIPOS: EXACTAMENTE una booking_lead_rule bien formada que CONTENGA
  -- [group_min, group_max]. En esta etapa NO conocemos el nº final de equipos (se sabrá al cerrar inscripciones);
  -- se resuelve por el rango del formato, NO por team_count. Regla válida = object con min/max/days enteros,
  -- min≥1, max≥min, days≥0. Reglas malformadas se ignoran; 0 o ambigua → error explícito (nunca cast genérico).
  if v_set.booking_lead_rules is null or jsonb_typeof(v_set.booking_lead_rules) <> 'array' then
    raise exception 'CHAMPIONSHIP_BOOKING_LEAD_CONFIG_UNAVAILABLE';
  end if;
  v_lead_n := 0;
  v_lead_rule := null;
  for v_r in select value from jsonb_array_elements(v_set.booking_lead_rules) as t(value) loop
    if jsonb_typeof(v_r) <> 'object'
       or jsonb_typeof(v_r->'min_teams') <> 'number'
       or jsonb_typeof(v_r->'max_teams') <> 'number'
       or jsonb_typeof(v_r->'days') <> 'number' then
      continue;
    end if;
    v_rmin  := (v_r->>'min_teams')::numeric;
    v_rmax  := (v_r->>'max_teams')::numeric;
    v_rdays := (v_r->>'days')::numeric;
    if v_rmin <> trunc(v_rmin) or v_rmax <> trunc(v_rmax) or v_rdays <> trunc(v_rdays) then continue; end if;  -- enteros
    if v_rmin < 1 or v_rmax < v_rmin or v_rdays < 0 then continue; end if;
    if v_rmin <= v_group_min and v_group_max <= v_rmax then                                                   -- contiene el rango
      v_lead_n := v_lead_n + 1;
      v_lead_rule := jsonb_build_object('min_teams', v_rmin::int, 'max_teams', v_rmax::int, 'days', v_rdays::int);
    end if;
  end loop;
  if v_lead_n <> 1 or v_lead_rule is null then raise exception 'CHAMPIONSHIP_BOOKING_LEAD_CONFIG_UNAVAILABLE'; end if;
  v_lead_days := (v_lead_rule->>'days')::int;

  -- event_date >= HOY_LIMA + booking_lead_days (America/Lima).
  if v_event_date < v_today_lima + v_lead_days then raise exception 'BOOKING_LEAD_NOT_MET'; end if;

  -- COURT = Σ precio real de los rentals físicos únicos (ENTEROS, sin importar su duración).
  select coalesce(sum(price_total), 0) into v_court_amount from public.games where id = any(v_ids);
  -- REFEREE / FEE por HORAS-CANCHA DE SERVICIO del formato (NO por rental_count ni duración).
  v_referee_amount := round(v_service_hours * v_set.referee_hourly_rate, 2);
  v_fee_amount     := round(v_service_hours * v_set.algrass_fee_hourly_rate, 2);

  -- EXTRAS: catálogo en settings.extras. Sin duplicados por code; qty=0 se omite; qty≥1 dentro de [min,max];
  -- amount = quantity × unit_price. El cliente manda solo {code, quantity}; el precio/límites los pone el backend.
  if p_extras is not null and jsonb_typeof(p_extras) = 'array' then
    if (select count(*) from jsonb_array_elements(p_extras) e) <>
       (select count(distinct e->>'code') from jsonb_array_elements(p_extras) e) then
      raise exception 'DUPLICATE_EXTRA';
    end if;
    for v_ex in select value from jsonb_array_elements(p_extras) as t(value) loop
      v_code := v_ex->>'code';
      -- quantity del cliente: si no es número → 0 (se omite), nunca cast genérico.
      v_qty  := case when jsonb_typeof(v_ex->'quantity') = 'number' then floor((v_ex->>'quantity')::numeric)::int else 0 end;
      if v_qty <= 0 then continue; end if;   -- quantity=0/inválida se omite
      -- Buscar en el catálogo un extra ACTIVO y BIEN FORMADO con ese code (defensivo: jsonb_typeof antes de castear).
      v_found := false;
      for v_cat in select value from jsonb_array_elements(v_set.extras) as t(value) loop
        if jsonb_typeof(v_cat) <> 'object' or (v_cat->>'code') is distinct from v_code then continue; end if;
        if jsonb_typeof(v_cat->'active') <> 'boolean' or (v_cat->>'active')::boolean is not true then continue; end if; -- inactivo/mal formado
        if jsonb_typeof(v_cat->'unit_price') <> 'number' or jsonb_typeof(v_cat->'units_per_item') <> 'number'
           or jsonb_typeof(v_cat->'min_quantity') <> 'number' or jsonb_typeof(v_cat->'max_quantity') <> 'number' then continue; end if;
        v_unit_price := (v_cat->>'unit_price')::numeric;
        v_units      := floor((v_cat->>'units_per_item')::numeric)::int;
        v_min        := floor((v_cat->>'min_quantity')::numeric)::int;
        v_max        := floor((v_cat->>'max_quantity')::numeric)::int;
        if v_unit_price < 0 or v_units < 1 or v_min < 1 or v_max < v_min then continue; end if;  -- config rota → no ofertable
        v_name := coalesce(v_cat->>'name', v_code);
        v_found := true;
        exit;
      end loop;
      -- Extra inexistente / inactivo / mal configurado → error explícito (NO subcotizar silenciosamente).
      if not v_found then raise exception 'EXTRA_NOT_AVAILABLE: %', coalesce(v_code, '(null)'); end if;
      if v_qty < v_min or v_qty > v_max then
        raise exception 'EXTRA_QUANTITY_OUT_OF_RANGE: % (%..%)', coalesce(v_code, '(null)'), v_min, v_max;
      end if;
      v_amt := round(v_qty * v_unit_price, 2);
      v_extras_amount := v_extras_amount + v_amt;
      v_extras_out := v_extras_out || jsonb_build_object(
        'code', v_code, 'name', v_name,
        'quantity', v_qty, 'units_per_item', v_units, 'total_units', v_qty * v_units,
        'unit_price', v_unit_price, 'amount', v_amt);
    end loop;
  end if;

  -- Cierre de inscripciones = fin del día (23:59:59 Lima) de (event_date − registration_close_days).
  v_reg_close := ((v_event_date - v_set.registration_close_days)::timestamp at time zone 'America/Lima')
                 + interval '1 day' - interval '1 second';

  return jsonb_build_object(
    'city',                    v_city,
    'currency',                v_set.currency,
    'venue_id',                v_venue_id,
    'event_date',              to_char(v_event_date, 'YYYY-MM-DD'),
    'group_id',                p_group_id,
    'service_court_hours',     v_service_hours,
    'team_range',              jsonb_build_object('min_teams', v_group_min, 'max_teams', v_group_max),
    'booking_lead_rule',       jsonb_build_object('min_teams', (v_lead_rule->>'min_teams')::int, 'max_teams', (v_lead_rule->>'max_teams')::int, 'days', v_lead_days),
    'booking_lead_days',       v_lead_days,
    'registration_close_days', v_set.registration_close_days,
    'registration_closes_at',  v_reg_close,
    'court_amount',            round(v_court_amount, 2),
    'referee_hourly_rate',     v_set.referee_hourly_rate,
    'referee_amount',          v_referee_amount,
    'algrass_fee_hourly_rate', v_set.algrass_fee_hourly_rate,
    'algrass_fee_amount',      v_fee_amount,
    'extras',                  v_extras_out,
    'extras_amount',           round(v_extras_amount, 2),
    'amount_total',            round(v_court_amount + v_referee_amount + v_fee_amount + v_extras_amount, 2),
    'rental_count',            v_count,                      -- informativo (no participa en referee/fee)
    'game_ids',                to_jsonb(v_ids)
  );
end;
$$;
revoke all on function public._championship_compute_price(uuid[], text, jsonb) from public, anon, authenticated;


-- ── 6) quote_championship — precio REAL informativo, SIN crear nada (mismas fórmulas que el hold) ──
create or replace function public.quote_championship(
  p_game_ids uuid[],
  p_group_id text,
  p_extras   jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Solo cálculo (valida formato/ciudad/settings/lead-days/extras). NO championship, NO order, NO reserva, NO spend.
  return public._championship_compute_price(p_game_ids, p_group_id, coalesce(p_extras, '[]'::jsonb));
end;
$$;
grant execute on function public.quote_championship(uuid[], text, jsonb) to authenticated;


-- ── 7) create_championship_transfer_hold — RE-CREADO con PRECIO REAL (misma lógica de hold Fase 2) ──
-- Idéntico a Fase 2 salvo: (a) calcula el precio con _championship_compute_price (misma fn que quote);
-- (b) order.amount_total = TOTAL real (ya no 0) y financial_snapshot = breakdown congelado; (c) championship.city
-- / event_date / venue_id / registration_closes_at derivados del backend (no del cliente). Sigue sin reservation/spend.
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
  v_id           uuid;
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

  -- Dedupe + orden determinista (id asc) → lock ordenado.
  select array_agg(x order by x) into v_ids from (select distinct unnest(p_game_ids) x) s;
  v_count := array_length(v_ids, 1);
  if v_count is null or v_count < 1 then raise exception 'NO_GAMES'; end if;

  -- Lock de TODOS los games seleccionados.
  perform 1 from public.games where id = any(v_ids) order by id for update;

  -- Revalidar TODOS bajo lock: existen, rentals no empezados, publicados, sin booker y sin campeonato.
  if (select count(*) from public.games where id = any(v_ids)) <> v_count then
    raise exception 'AVAILABILITY_CHANGED';
  end if;
  foreach v_id in array v_ids loop
    perform public.assert_game_reservable(v_id, 'rental');
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
  -- Se recalcula aquí bajo lock; congela el snapshot. Si falta config → aborta (rollback total, sin reserva).
  v_price     := public._championship_compute_price(v_ids, p_config->>'group_id', coalesce(p_config->'extras', '[]'::jsonb));
  v_total     := (v_price->>'amount_total')::numeric;
  v_city      := v_price->>'city';
  v_reg_close := (v_price->>'registration_closes_at')::timestamptz;

  -- Crear el championship en 'transfer_hold'. city / event_date / venue_id / registration_closes_at =
  -- AUTORIDAD BACKEND (derivados de los games reales vía v_price); NO se confía el event_date/venue_id del cliente.
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
