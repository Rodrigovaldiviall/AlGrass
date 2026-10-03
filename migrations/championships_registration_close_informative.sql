-- ============================================================================
-- Campeonatos · registration_closes_at pasa a ser EXCLUSIVAMENTE INFORMATIVA
-- ============================================================================
-- CAMBIO DE REGLA: que llegue/supere registration_closes_at ya NO impide crear equipo, unirse ni inscribirse.
-- El cierre efectivo depende del ESTADO del campeonato (registration_closed vía set_championship_status),
-- NO del reloj. Esta migración:
--   1) Elimina EXCLUSIVAMENTE las validaciones "now() >= registration_closes_at" en las 4 RPC de inscripción
--      (reemitiendo su definición VIGENTE, sin tocar ninguna otra condición: estado registration_open, cupos,
--      permisos, host, validaciones de equipo/jugador, locks, seguridad).
--   2) Deja de GENERAR automáticamente registration_closes_at en _championship_compute_price: ahora devuelve
--      NULL (no se inventa fecha). Los campeonatos ya creados conservan el valor guardado (no se tocan filas).
--
-- NO crea estados nuevos, NO toca el cierre manual (set_championship_status), NO borra columnas (registration_
-- close_days permanece por compatibilidad), NO toca M1/M2/M3 de bloqueos operativos, precios/antelación/extras/
-- disponibilidad, pagos, órdenes, reservas ni fixture. Definiciones base reemitidas:
--   · create_championship_team          → Fase 10 (vigente)
--   · join_championship_team            → Fase 35 (vigente)
--   · join_championship_without_team    → Fase 35 (vigente)
--   · save_championship_team            → Fase 26 (vigente)
--   · _championship_compute_price       → championships_referee_optional_extra (vigente)
-- Único cambio en cada una: se quita el corte temporal (y, en compute_price, el cálculo de la fecha).
-- ============================================================================


-- ── 1) create_championship_team (BASE Fase 10) — sin corte por registration_closes_at ──────────────
create or replace function public.create_championship_team(
  p_championship_id uuid,
  p_name            text,
  p_color           text default null,
  p_design          text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
  v_cap   int; v_count int; v_team_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_name is null then raise exception 'INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.status <> 'registration_open' then raise exception 'NOT_OPEN'; end if;
  -- (ELIMINADO) corte por now() >= registration_closes_at.
  -- Crear equipo ≠ inscribirse: NO se comprueba membership ni se crea championship_player.

  v_cap := public._championship_team_capacity(v_champ.format_config);
  select count(*) into v_count from public.championship_teams where championship_id = p_championship_id;
  if v_count >= v_cap then raise exception 'CAPACITY_FULL'; end if;

  insert into public.championship_teams (championship_id, name, color, design, created_by_user_id)
    values (p_championship_id, v_name, nullif(btrim(coalesce(p_color, '')), ''), nullif(btrim(coalesce(p_design, '')), ''), v_actor)
    returning id into v_team_id;

  return jsonb_build_object('team_id', v_team_id, 'name', v_name);
end; $$;
revoke all on function public.create_championship_team(uuid, text, text, text) from public, anon;
grant execute on function public.create_championship_team(uuid, text, text, text) to authenticated;


-- ── 2) join_championship_team (BASE Fase 35) — sin corte por registration_closes_at ────────────────
create or replace function public.join_championship_team(
  p_championship_id uuid,
  p_team_id         uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_is_owner boolean;
  v_is_host  boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  v_is_owner := (v_champ.owner_user_id = v_actor);
  v_is_host  := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  -- El HOST NUNCA se inscribe como jugador, AUNQUE además sea owner (el rol Host tiene prioridad para SELF).
  if v_is_host then raise exception 'NOT_AUTHORIZED'; end if;

  -- Ventana SELF de auto-inscripción a EQUIPO (Fase 35):
  --   · RO, RC, in_progress PRE-LIVE → cualquiera (owner/player).
  --   · in_progress LIVE → SOLO owner.
  --   · pending_publish → SOLO owner (membership anticipada).
  if not (
       v_champ.status = 'registration_open'
       or v_champ.status = 'registration_closed'
       or (v_champ.status = 'in_progress' and v_champ.live_started_at is null)
       or (v_champ.status = 'in_progress' and v_champ.live_started_at is not null and v_is_owner)
       or (v_champ.status = 'pending_publish' and v_is_owner)
     ) then
    raise exception 'NOT_OPEN';
  end if;
  -- (ELIMINADO) corte por now() >= registration_closes_at en registration_open.
  if not exists (select 1 from public.championship_teams where id = p_team_id and championship_id = p_championship_id) then
    raise exception 'TEAM_NOT_FOUND';
  end if;

  insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, v_actor, p_team_id)
  on conflict (championship_id, user_id) do update set team_id = excluded.team_id;

  return jsonb_build_object('championship_id', p_championship_id, 'team_id', p_team_id);
end; $$;
revoke all on function public.join_championship_team(uuid, uuid) from public, anon;
grant execute on function public.join_championship_team(uuid, uuid) to authenticated;


-- ── 3) join_championship_without_team (BASE Fase 35) — sin corte por registration_closes_at ────────
create or replace function public.join_championship_without_team(p_championship_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_is_owner boolean;
  v_is_host  boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  v_is_owner := (v_champ.owner_user_id = v_actor);
  v_is_host  := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  if v_is_host then raise exception 'NOT_AUTHORIZED'; end if;   -- Host NUNCA (aunque sea owner)

  -- "Sin equipo" SOLO en registration_open (cualquiera) o pending_publish (SOLO owner). En closed+ no aplica.
  if not (v_champ.status = 'registration_open'
          or (v_champ.status = 'pending_publish' and v_is_owner)) then
    raise exception 'NOT_OPEN';
  end if;
  -- (ELIMINADO) corte por now() >= registration_closes_at en registration_open.

  insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, v_actor, null)
  on conflict (championship_id, user_id) do update set team_id = null;

  return jsonb_build_object('championship_id', p_championship_id, 'team_id', null);
end; $$;
revoke all on function public.join_championship_without_team(uuid) from public, anon;
grant execute on function public.join_championship_without_team(uuid) to authenticated;


-- ── 4) save_championship_team (BASE Fase 26) — sin corte por registration_closes_at (CREATE y edición) ──
create or replace function public.save_championship_team(
  p_championship_id uuid,
  p_team_id         uuid,
  p_name            text,
  p_color           text default null,
  p_design          text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor   uuid := auth.uid();
  v_champ   public.championships%rowtype;
  v_team    public.championship_teams%rowtype;
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_color   text := nullif(btrim(coalesce(p_color, '')), '');
  v_design  text := nullif(btrim(coalesce(p_design, '')), '');
  v_is_owner   boolean;
  v_is_host    boolean;
  v_is_algrass boolean;
  v_is_creator boolean;
  v_creator_priv boolean;
  v_captain    uuid;
  v_is_captain boolean;
  v_can_full   boolean;
  v_can_create boolean;
  v_can_edit   boolean;
  v_can_rename boolean;
  v_cap int; v_count int; v_team_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_name is null then raise exception 'INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  v_is_owner   := (v_champ.owner_user_id = v_actor);
  v_is_host    := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  v_is_algrass := public._is_algrass_staff(v_actor);

  if p_team_id is null then
    -- ── CREATE ── administrativa (owner/host/AlGrass en ventana create_team) o self-service normal en open.
    v_can_create := public._champ_can_manage_roster(p_championship_id, v_actor, 'create_team');
    if not (v_can_create or v_champ.status = 'registration_open') then
      raise exception 'NOT_OPEN';
    end if;
    -- (ELIMINADO) corte por now() >= registration_closes_at para la vía no administrativa en open.
    v_cap := public._championship_team_capacity(v_champ.format_config);
    select count(*) into v_count from public.championship_teams where championship_id = p_championship_id;
    if v_count >= v_cap then raise exception 'CAPACITY_FULL'; end if;

    insert into public.championship_teams (championship_id, name, color, design, created_by_user_id)
      values (p_championship_id, v_name, v_color, v_design, v_actor)
      returning id into v_team_id;
    return jsonb_build_object('team_id', v_team_id, 'name', v_name);
  end if;

  -- ── UPDATE ──
  select * into v_team from public.championship_teams
   where id = p_team_id and championship_id = p_championship_id for update;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  v_is_creator := (v_team.created_by_user_id = v_actor);
  v_creator_priv := (v_team.created_by_user_id = v_champ.owner_user_id)
                    or public._is_algrass_staff(v_team.created_by_user_id);

  select count(*) into v_count from public.championship_players where team_id = p_team_id;
  select user_id into v_captain from public.championship_players
   where team_id = p_team_id order by joined_at asc, user_id asc limit 1;
  v_is_captain := (v_captain is not null and v_captain = v_actor);

  v_can_full := (v_count = 0 and (not v_creator_priv or v_is_owner or v_is_algrass))
                or (v_count >= 1 and v_is_captain);
  v_can_edit := public._champ_can_manage_roster(p_championship_id, v_actor, 'edit_team');
  -- RENAME (solo nombre): owner/host/AlGrass en cualquier fase operativa (incluye in_progress y completed).
  v_can_rename := (v_is_owner or v_is_host or v_is_algrass) and v_champ.status <> 'canceled';

  if not (v_can_edit or v_can_full or v_can_rename) then raise exception 'NOT_AUTHORIZED'; end if;
  if v_can_edit or (v_can_full and v_champ.status = 'registration_open') then
    -- Edición COMPLETA (nombre+color+diseño).
    -- (ELIMINADO) corte por now() >= registration_closes_at para la vía no administrativa en open.
    update public.championship_teams
       set name = v_name, color = v_color, design = v_design, updated_at = now()
     where id = p_team_id;
  elsif v_can_rename then
    -- RENAME administrativo: SOLO nombre (color/diseño intactos), cualquier fase salvo canceled.
    update public.championship_teams
       set name = v_name, updated_at = now()
     where id = p_team_id;
  else
    raise exception 'NOT_OPEN';
  end if;

  return jsonb_build_object('team_id', p_team_id, 'name', v_name);
end; $$;
revoke all on function public.save_championship_team(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.save_championship_team(uuid, uuid, text, text, text) to authenticated;


-- ── 5) _championship_compute_price (BASE championships_referee_optional_extra) ─────────────────────
-- ÚNICO cambio: ya NO se genera registration_closes_at (antes = event_date − registration_close_days).
-- Ahora devuelve NULL. Todo lo demás (court/referee/fee/extras/booking_lead/disponibilidad) IDÉNTICO.
-- registration_close_days se conserva en el output (informativo); la columna/tabla M1 no se tocan.
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
  v_count          integer;
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
  v_referee_sel    boolean := false;
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
  v_today_lima     date := (now() at time zone 'America/Lima')::date;
begin
  -- Dedupe (game.id duplicados NO se cuentan dos veces).
  select array_agg(x order by x) into v_ids from (select distinct unnest(p_game_ids) x) s;
  v_count := array_length(v_ids, 1);
  if v_count is null or v_count < 1 then raise exception 'NO_GAMES'; end if;

  if (select count(*) from public.games where id = any(v_ids)) <> v_count then raise exception 'GAME_NOT_FOUND'; end if;
  if exists (select 1 from public.games where id = any(v_ids) and type <> 'rental') then raise exception 'NOT_RENTAL'; end if;

  if exists (select 1 from public.games where id = any(v_ids) and price_total is null) then
    raise exception 'CHAMPIONSHIP_PRICE_UNAVAILABLE';
  end if;

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

  select count(distinct date_key), min(date_key) into v_date_n, v_event_date
    from public.games where id = any(v_ids);
  if v_date_n > 1 then raise exception 'MULTIPLE_DATES'; end if;

  select * into v_set from public.championship_settings where city = v_city and active = true;
  if not found then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;

  perform public._championship_assert_not_blocked(v_ids, v_set.availability_blocks, v_event_date);

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
    if v_rmin <> trunc(v_rmin) or v_rmax <> trunc(v_rmax) or v_rdays <> trunc(v_rdays) then continue; end if;
    if v_rmin < 1 or v_rmax < v_rmin or v_rdays < 0 then continue; end if;
    if v_rmin <= v_group_min and v_group_max <= v_rmax then
      v_lead_n := v_lead_n + 1;
      v_lead_rule := jsonb_build_object('min_teams', v_rmin::int, 'max_teams', v_rmax::int, 'days', v_rdays::int);
    end if;
  end loop;
  if v_lead_n <> 1 or v_lead_rule is null then raise exception 'CHAMPIONSHIP_BOOKING_LEAD_CONFIG_UNAVAILABLE'; end if;
  v_lead_days := (v_lead_rule->>'days')::int;

  if v_event_date < v_today_lima + v_lead_days then raise exception 'BOOKING_LEAD_NOT_MET'; end if;

  select coalesce(sum(price_total), 0) into v_court_amount from public.games where id = any(v_ids);
  v_fee_amount := round(v_service_hours * v_set.algrass_fee_hourly_rate, 2);

  if p_extras is not null and jsonb_typeof(p_extras) = 'array' then
    if (select count(*) from jsonb_array_elements(p_extras) e) <>
       (select count(distinct e->>'code') from jsonb_array_elements(p_extras) e) then
      raise exception 'DUPLICATE_EXTRA';
    end if;
    for v_ex in select value from jsonb_array_elements(p_extras) as t(value) loop
      v_code := v_ex->>'code';
      v_qty  := case when jsonb_typeof(v_ex->'quantity') = 'number' then floor((v_ex->>'quantity')::numeric)::int else 0 end;
      if v_qty <= 0 then continue; end if;
      if v_code = 'referee' then v_referee_sel := true; continue; end if;
      v_found := false;
      for v_cat in select value from jsonb_array_elements(v_set.extras) as t(value) loop
        if jsonb_typeof(v_cat) <> 'object' or (v_cat->>'code') is distinct from v_code then continue; end if;
        if jsonb_typeof(v_cat->'active') <> 'boolean' or (v_cat->>'active')::boolean is not true then continue; end if;
        if jsonb_typeof(v_cat->'unit_price') <> 'number' or jsonb_typeof(v_cat->'units_per_item') <> 'number'
           or jsonb_typeof(v_cat->'min_quantity') <> 'number' or jsonb_typeof(v_cat->'max_quantity') <> 'number' then continue; end if;
        v_unit_price := (v_cat->>'unit_price')::numeric;
        v_units      := floor((v_cat->>'units_per_item')::numeric)::int;
        v_min        := floor((v_cat->>'min_quantity')::numeric)::int;
        v_max        := floor((v_cat->>'max_quantity')::numeric)::int;
        if v_unit_price < 0 or v_units < 1 or v_min < 1 or v_max < v_min then continue; end if;
        v_name := coalesce(v_cat->>'name', v_code);
        v_found := true;
        exit;
      end loop;
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

  v_referee_amount := case when v_referee_sel then round(v_service_hours * v_set.referee_hourly_rate, 2) else 0 end;

  -- (ELIMINADO) cálculo automático de registration_closes_at. Ahora es informativa y la fija Admin manualmente.
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
    'registration_closes_at',  null,
    'court_amount',            round(v_court_amount, 2),
    'referee_hourly_rate',     v_set.referee_hourly_rate,
    'referee_amount',          v_referee_amount,
    'algrass_fee_hourly_rate', v_set.algrass_fee_hourly_rate,
    'algrass_fee_amount',      v_fee_amount,
    'extras',                  v_extras_out,
    'extras_amount',           round(v_extras_amount, 2),
    'amount_total',            round(v_court_amount + v_referee_amount + v_fee_amount + v_extras_amount, 2),
    'rental_count',            v_count,
    'game_ids',                to_jsonb(v_ids)
  );
end;
$$;
revoke all on function public._championship_compute_price(uuid[], text, jsonb) from public, anon, authenticated;

do $$
begin
  raise notice 'OK: registration_closes_at informativa. 4 RPC de inscripción sin corte temporal; compute_price devuelve registration_closes_at = NULL (no se autogenera). Cierre efectivo = estado registration_closed.';
end $$;
