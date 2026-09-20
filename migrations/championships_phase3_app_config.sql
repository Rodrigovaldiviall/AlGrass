-- ============================================================================
-- Campeonatos · Fase 3 (App config) — RPC de LECTURA para la UX (get_championship_config)
-- ============================================================================
-- championship_settings tiene RLS y NO se lee directo desde React. Esta RPC authenticated, SECURITY DEFINER,
-- devuelve SOLO lo que la UX necesita para construir la pantalla (precios unitarios de extras, reglas de
-- lead/close, perfiles de formato). NO es autoridad: quote_championship y create_championship_transfer_hold
-- recalculan SIEMPRE server-side (precio, service_court_hours, city, amount_total, registration_closes_at).
--
-- ADITIVA: NO toca la migración Fase 3 ya aplicada. Añade una columna a championship_settings (ALTER
-- idempotente, NO crea tablas), re-crea el pricing interno para validar bloqueos y expone la config a la UX.
-- Config inexistente/inactiva → CHAMPIONSHIP_CONFIG_UNAVAILABLE (sin fallback).
-- extras devueltos: SOLO active=true, campos mínimos, ordenados por sort_order.
-- ============================================================================

-- ── 0) availability_blocks — bloqueos de disponibilidad de CANCHAS para Championship, POR CIUDAD ────
-- ARRAY de bloqueos [{date, all_day} | {date, from, to}]; 0..N sin límite. Significa "en ese período NO
-- ofrecer automáticamente rentals a Championship" (NO ocupa el rental; Rental/Match no cambian). Editable
-- luego desde Admin. ALTER idempotente: championship_settings YA existe por Fase 3. NO se crea tabla nueva.
-- Filas existentes (Arequipa/Lima) quedan en '[]' (sin bloqueos) por el DEFAULT.
alter table public.championship_settings
  add column if not exists availability_blocks jsonb not null default '[]'::jsonb;

create or replace function public.get_championship_config(p_city text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_set        public.championship_settings%rowtype;
  v_extras_out jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_city is null or length(btrim(p_city)) = 0 then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;

  select * into v_set from public.championship_settings where city = p_city and active = true;
  if not found then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;

  -- Extras para la UX: SOLO active=true y bien formados (jsonb_typeof antes de castear), ordenados por sort_order.
  -- Campos mínimos (no se expone toda la fila). unit_price es solo para PINTAR; NO es autoridad de precio.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'code',           e->>'code',
             'name',           e->>'name',
             'unit_price',     (e->>'unit_price')::numeric,
             'units_per_item', floor((e->>'units_per_item')::numeric)::int,
             'min_quantity',   floor((e->>'min_quantity')::numeric)::int,
             'max_quantity',   floor((e->>'max_quantity')::numeric)::int,
             'sort_order',     floor((e->>'sort_order')::numeric)::int
           )
           order by floor((e->>'sort_order')::numeric)::int, e->>'code'
         ), '[]'::jsonb)
    into v_extras_out
    from jsonb_array_elements(v_set.extras) e
   where jsonb_typeof(e) = 'object'
     and jsonb_typeof(e->'active') = 'boolean' and (e->>'active')::boolean = true
     and jsonb_typeof(e->'unit_price') = 'number'
     and jsonb_typeof(e->'units_per_item') = 'number'
     and jsonb_typeof(e->'min_quantity') = 'number'
     and jsonb_typeof(e->'max_quantity') = 'number'
     and jsonb_typeof(e->'sort_order') = 'number';

  return jsonb_build_object(
    'city',                    v_set.city,
    'currency',                v_set.currency,
    'registration_close_days', v_set.registration_close_days,
    'booking_lead_rules',      v_set.booking_lead_rules,
    'availability_formats',    v_set.availability_formats,
    -- Bloqueos para que la UX filtre disponibilidad ANTES de armar el grid. Lectura defensiva: si la columna
    -- no es un array (config rota), se devuelve '[]' aquí (la UX no puede sub-bloquear a ciegas), PERO la
    -- autoridad es el hold: _championship_assert_not_blocked aborta con CHAMPIONSHIP_CONFIG_UNAVAILABLE.
    'availability_blocks',     case when jsonb_typeof(v_set.availability_blocks) = 'array'
                                    then v_set.availability_blocks else '[]'::jsonb end,
    'extras',                  v_extras_out
  );
end;
$$;
grant execute on function public.get_championship_config(text) to authenticated;


-- ── 1) Validación de bloqueos — ÚNICA fuente de la regla de solapamiento (la usa el pricing interno) ─
-- Recibe los games ya deduplicados, los availability_blocks de la ciudad (leídos server-side, NUNCA del
-- cliente) y la event_date derivada de los games. Regla de solapamiento por intervalo semiabierto:
--   rental_start < block_end  AND  rental_end > block_start   (los límites que solo se tocan NO solapan).
-- all_day=true → todo el día de esa fecha. Evalúa TODOS los bloqueos (no "solo el primero"). Si CUALQUIER
-- game se solapa con CUALQUIER bloqueo vigente → CHAMPIONSHIP_AVAILABILITY_BLOCKED.
-- DEFENSIVO / fail-safe (§9): un bloqueo malformado (no-objeto, date inválida, o from/to inválidos con
-- all_day≠true) NO se ignora silenciosamente (podría dejar pasar una reserva que debía bloquearse): aborta
-- con CHAMPIONSHIP_CONFIG_UNAVAILABLE. Un bloqueo con date válida pero horas inválidas se trata como all_day
-- (sobre-bloquea, nunca sub-bloquea). Si la columna entera no es un array → CHAMPIONSHIP_CONFIG_UNAVAILABLE.
create or replace function public._championship_assert_not_blocked(
  p_game_ids   uuid[],
  p_blocks     jsonb,
  p_event_date date
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_blk  jsonb;
  v_from integer;
  v_to   integer;
  v_tf   time;
  v_tt   time;
begin
  if p_game_ids is null or array_length(p_game_ids, 1) is null then return; end if;
  if p_blocks is null or jsonb_typeof(p_blocks) <> 'array' then
    raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE';   -- columna rota → fail-safe (no reservar)
  end if;

  for v_blk in select value from jsonb_array_elements(p_blocks) as t(value) loop
    begin
      if jsonb_typeof(v_blk) <> 'object' then raise exception 'BAD_BLOCK'; end if;
      -- date obligatoria y válida (cast crudo protegido por el sub-bloque de excepción).
      if (v_blk->>'date')::date = p_event_date then
        if jsonb_typeof(v_blk->'all_day') = 'boolean' and (v_blk->>'all_day')::boolean = true then
          v_from := 0; v_to := 1440;                     -- todo el día
        else
          v_tf := (v_blk->>'from')::time;                -- from/to obligatorios y válidos
          v_tt := (v_blk->>'to')::time;
          v_from := extract(hour from v_tf)::int * 60 + extract(minute from v_tf)::int;
          v_to   := extract(hour from v_tt)::int * 60 + extract(minute from v_tt)::int;
          if v_to <= v_from then raise exception 'BAD_BLOCK'; end if;   -- from<to obligatorio
        end if;
        -- Solapamiento por intervalo semiabierto contra CADA game de la event_date.
        if exists (
          select 1 from public.games g
           where g.id = any(p_game_ids)
             and g.date_key = to_char(p_event_date, 'YYYY-MM-DD')
             and (extract(hour from g.time)::int * 60 + extract(minute from g.time)::int) < v_to
             and (extract(hour from g.time)::int * 60 + extract(minute from g.time)::int
                  + coalesce(g.duration_min, 60)) > v_from
        ) then
          raise exception 'CHAMPIONSHIP_AVAILABILITY_BLOCKED';
        end if;
      end if;
    exception
      when others then
        -- Propaga el bloqueo real; cualquier otra falla (BAD_BLOCK, cast de date/time malformado) → fail-safe.
        if sqlerrm like 'CHAMPIONSHIP_AVAILABILITY_BLOCKED%' then raise;
        else raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;
    end;
  end loop;
end;
$$;
revoke all on function public._championship_assert_not_blocked(uuid[], jsonb, date) from public, anon, authenticated;


-- ── 2) Re-creación de _championship_compute_price — AÑADE la validación de bloqueos en el punto ÚNICO ─
-- que comparten quote y hold (ambos llaman a esta función). Copia FIEL de la versión Fase 3 aplicada + una
-- sola línea `perform _championship_assert_not_blocked(...)`. En el hold corre BAJO el lock de los games
-- (revalidación server-side ante la carrera "Admin bloquea después de abrir la pantalla"). CREATE OR REPLACE
-- aditivo: NO edita la migración Fase 3 ya aplicada; esta versión gana al aplicarse esta migración.
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
  -- NOTA: Postgres no tiene min()/max() para uuid → se toma el representante con array_agg(distinct)[1].
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

  -- Fecha de evento única (derivada de games).
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
