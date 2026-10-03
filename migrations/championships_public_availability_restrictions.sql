-- ============================================================================
-- Campeonatos · Lectura PÚBLICA de restricciones de disponibilidad (antelación + bloqueos)
-- ============================================================================
-- PROBLEMA: en ChampionshipOrganize un visitante SIN sesión puede explorar (ciudad/formato/fechas/canchas),
-- pero get_championship_config exige auth.uid() y solo está concedida a `authenticated`. Sin sesión falla →
-- champCfg = null → (a) sin booking_lead_rules → NO se aplica la antelación mínima; (b) sin availability_blocks
-- → NO se ocultan las canchas bloqueadas. Tras el login ambas restricciones sí aparecen.
--
-- SOLUCIÓN (mínima): una RPC SECURITY DEFINER de SOLO LECTURA que expone EXCLUSIVAMENTE lo necesario para
-- calcular esas dos restricciones en la App, accesible por anon + authenticated. NO abre acceso directo a
-- championship_settings (RLS intacta), NO expone extras/tarifas/registration_close_days ni metadatos internos
-- de los bloqueos (id/reason/created_by/created_at). NO toca M1/M2/M3 ni ninguna otra función (nombre nuevo).
-- NO cambia cuándo se exige login ni el flujo de contratación: el hold backend sigue siendo la autoridad final.
--
-- FAIL-SAFE (igual criterio que _championship_assert_not_blocked): una configuración AUSENTE, no-array o con
-- CUALQUIER regla/bloqueo MALFORMADO → CHAMPIONSHIP_CONFIG_UNAVAILABLE. NUNCA se convierte un error de config
-- en [] ni se descarta una restricción en silencio (eso haría que la App mostrara disponibilidad como libre).
--
-- Compatible con ambos formatos de bloqueo (se proyecta a claves UI-safe): v2 {starts_at, ends_at} (instantes
-- UTC, intervalo semiabierto) y v1 {date, all_day} / {date, from, to}. Las horas Lima las interpreta el App.
-- ============================================================================

create or replace function public.get_championship_availability_restrictions(p_city text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_set    public.championship_settings%rowtype;
  v_blocks jsonb := '[]'::jsonb;
  v_r      jsonb;
  v_rmin   numeric;
  v_rmax   numeric;
  v_rdays  numeric;
  v_b      jsonb;
  v_ts1    timestamptz;
  v_ts2    timestamptz;
  v_date   date;
  v_tf     time;
  v_tt     time;
begin
  -- Ciudad inválida o sin settings activa → ERROR explícito (el App NO debe presentar fechas como libres;
  -- distingue "sin restricciones" de "no pude leer la configuración").
  if p_city is null or length(btrim(p_city)) = 0 then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;
  select * into v_set from public.championship_settings where city = p_city and active = true;
  if not found then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;

  -- ── booking_lead_rules: array OBLIGATORIO; cada regla bien formada (min/max/days enteros, min≥1, max≥min,
  --    days≥0). Cualquier cosa fuera de forma → CONFIG_UNAVAILABLE (no se descarta en silencio). ──
  if v_set.booking_lead_rules is null or jsonb_typeof(v_set.booking_lead_rules) <> 'array' then
    raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE';
  end if;
  for v_r in select value from jsonb_array_elements(v_set.booking_lead_rules) as t(value) loop
    if jsonb_typeof(v_r) <> 'object'
       or jsonb_typeof(v_r->'min_teams') <> 'number'
       or jsonb_typeof(v_r->'max_teams') <> 'number'
       or jsonb_typeof(v_r->'days') <> 'number' then
      raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE';
    end if;
    v_rmin := (v_r->>'min_teams')::numeric;
    v_rmax := (v_r->>'max_teams')::numeric;
    v_rdays := (v_r->>'days')::numeric;
    if v_rmin <> trunc(v_rmin) or v_rmax <> trunc(v_rmax) or v_rdays <> trunc(v_rdays)
       or v_rmin < 1 or v_rmax < v_rmin or v_rdays < 0 then
      raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE';
    end if;
  end loop;

  -- ── availability_blocks: array OBLIGATORIO; cada bloque bien formado y proyectado a claves UI-safe.
  --    Malformado (no-objeto, instantes/fechas/horas inválidos, fin≤inicio) → CONFIG_UNAVAILABLE. ──
  if v_set.availability_blocks is null or jsonb_typeof(v_set.availability_blocks) <> 'array' then
    raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE';
  end if;
  for v_b in select value from jsonb_array_elements(v_set.availability_blocks) as t(value) loop
    if jsonb_typeof(v_b) <> 'object' then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;

    if (v_b ? 'starts_at') or (v_b ? 'ends_at') then
      -- v2: ambos instantes presentes, parseables como timestamptz y fin > inicio.
      begin
        v_ts1 := (v_b->>'starts_at')::timestamptz;
        v_ts2 := (v_b->>'ends_at')::timestamptz;
      exception when others then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end;
      if v_ts1 is null or v_ts2 is null or v_ts2 <= v_ts1 then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;
      v_blocks := v_blocks || jsonb_build_object('starts_at', v_b->'starts_at', 'ends_at', v_b->'ends_at');
    else
      -- v1: date válida; all_day=true → día completo; si no, from/to válidos con from<to.
      begin
        v_date := (v_b->>'date')::date;
      exception when others then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end;
      if v_date is null then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;
      if jsonb_typeof(v_b->'all_day') = 'boolean' and (v_b->>'all_day')::boolean = true then
        v_blocks := v_blocks || jsonb_build_object('date', v_b->'date', 'all_day', true);
      else
        begin
          v_tf := (v_b->>'from')::time;
          v_tt := (v_b->>'to')::time;
        exception when others then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end;
        if v_tf is null or v_tt is null or v_tt <= v_tf then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;
        v_blocks := v_blocks || jsonb_build_object('date', v_b->'date', 'from', v_b->'from', 'to', v_b->'to');
      end if;
    end if;
  end loop;

  -- SOLO lo necesario para las restricciones: antelación mínima por rango de equipos + bloqueos operativos.
  return jsonb_build_object(
    'booking_lead_rules',  v_set.booking_lead_rules,
    'availability_blocks', v_blocks
  );
end;
$$;
revoke all on function public.get_championship_availability_restrictions(text) from public;
grant execute on function public.get_championship_availability_restrictions(text) to anon, authenticated;

do $$
begin
  raise notice 'OK: get_championship_availability_restrictions(p_city) — lectura PÚBLICA (anon+authenticated) de booking_lead_rules + availability_blocks (UI-safe). Config ausente/malformada → CHAMPIONSHIP_CONFIG_UNAVAILABLE (nunca []). RLS de championship_settings intacta.';
end $$;
