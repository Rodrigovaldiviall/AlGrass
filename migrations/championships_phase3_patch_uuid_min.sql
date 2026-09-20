-- ============================================================================
-- PATCH · Fase 3 — fix min(uuid) en _championship_compute_price (bug 42883)
-- ============================================================================
-- Runtime: POST /rpc/quote_championship → 42883 "function min(uuid) does not exist".
-- Causa: en _championship_compute_price se derivaba el venue único con min(v.id), pero Postgres NO tiene
-- agregado min()/max() para uuid. Afectaba a quote Y hold (ambos usan esta función interna).
-- Fix: tomar el representante único con (array_agg(distinct v.id))[1]; la unicidad la sigue garantizando
-- el check v_venue_n>1 → MULTIPLE_VENUES. NO cambia pricing, reglas ni ningún otro comportamiento.
-- min(date_key) NO se toca: date_key es text (min(text) es válido).
--
-- IDEMPOTENTE: solo CREATE OR REPLACE de la función + revoke. NO crea tablas. NO ALTER. Aplicar tras la
-- migración championships_phase3_app_config.sql (esta reemplaza esa misma función con la línea corregida).
-- ============================================================================

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
  -- FIX 42883: Postgres no tiene min()/max() para uuid → se toma el representante con array_agg(distinct)[1].
  -- La unicidad la garantiza el check v_venue_n>1 (MULTIPLE_VENUES) inmediatamente debajo.
  select count(distinct v.id), (array_agg(distinct v.id))[1]
    into v_venue_n, v_venue_id
    from public.games g
    join public.fields f on f.id = g.field_id
    join public.venues v on v.id = f.venue_id
   where g.id = any(v_ids);
  if v_venue_n is null or v_venue_n = 0 or v_venue_id is null then raise exception 'GAME_NOT_FOUND'; end if;
  if v_venue_n > 1 then raise exception 'MULTIPLE_VENUES'; end if;
  select city into v_city from public.venues where id = v_venue_id;
  if v_city is null then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;

  -- Fecha de evento única (derivada de games). date_key es text → min(text) es válido (no se toca).
  select count(distinct date_key), min(date_key) into v_date_n, v_event_date
    from public.games where id = any(v_ids);
  if v_date_n > 1 then raise exception 'MULTIPLE_DATES'; end if;

  -- Settings de la ciudad (SIN default oculto).
  select * into v_set from public.championship_settings where city = v_city and active = true;
  if not found then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;

  -- BLOQUEOS DE DISPONIBILIDAD (Championship): si algún game seleccionado se solapa con un availability_block
  -- vigente de la ciudad → aborta. Misma regla que la UX; los bloqueos se leen server-side (no del cliente).
  perform public._championship_assert_not_blocked(v_ids, v_set.availability_blocks, v_event_date);

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
