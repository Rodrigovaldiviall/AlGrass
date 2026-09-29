-- ============================================================================
-- Campeonatos · Fase 36 — Campeón OFICIAL manual (championships.champion_team_id) + RPC set_championship_champion
-- ============================================================================
-- DECISIÓN DE PRODUCTO: el campeón YA NO se infiere del ganador de stage='final'. Se selecciona MANUALMENTE por
-- Host/AlGrass y se guarda como dato explícito en championships.champion_team_id (FK a championship_teams,
-- ON DELETE SET NULL). El resultado de la Final sigue siendo deportivo pero NO define el campeón oficial.
--
-- Autoridad REUTILIZADA: _champ_can_manage_results (Fase 24) — coincide EXACTO con la regla de campeón:
--   HOST    → in_progress (PRE-LIVE y LIVE) · NO completed
--   ALGRASS → in_progress + completed (correcciones históricas)
--   OWNER (no host) / PLAYER → nunca.  (Owner+Host manda Host → pasa por host.)
--
-- NO toca championship_matches / resultados / qualified_team_id / fixture / standings / goals / lifecycle.
-- Solo AÑADE una columna, una RPC y un campo de LECTURA (get_championship_public), de forma compatible.
-- ============================================================================

-- ── 1) Columna: campeón oficial (nullable; FK con ON DELETE SET NULL) ─────────────────────────────────
alter table public.championships
  add column if not exists champion_team_id uuid references public.championship_teams(id) on delete set null;

comment on column public.championships.champion_team_id is
  'Campeón OFICIAL, seleccionado MANUALMENTE por Host/AlGrass (set_championship_champion). NULL = sin campeón. NO se infiere del resultado de la final.';


-- ── 2) RPC: set_championship_champion — definir/cambiar/limpiar el campeón ─────────────────────────────
-- p_team_id NULL = limpiar la selección (mismos permisos). p_team_id no nulo = debe pertenecer al campeonato.
-- No depende de que exista final, ni de su resultado, ni de que el equipo la haya jugado.
create or replace function public.set_championship_champion(
  p_championship_id uuid,
  p_team_id         uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Misma lock key del módulo (serializa con roster/resultados/transiciones del mismo campeonato).
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- Permisos: MISMA autoridad que resultados (host in_progress; AlGrass in_progress+completed; owner/player nunca).
  if not public._champ_can_manage_results(p_championship_id, v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  -- El equipo (si se define) DEBE pertenecer a ESTE campeonato. NULL = limpiar.
  if p_team_id is not null
     and not exists (select 1 from public.championship_teams
                      where id = p_team_id and championship_id = p_championship_id) then
    raise exception 'TEAM_NOT_FOUND';
  end if;

  update public.championships set champion_team_id = p_team_id where id = p_championship_id
    returning * into v_champ;

  return jsonb_build_object('id', v_champ.id, 'champion_team_id', v_champ.champion_team_id);
end; $$;
revoke all on function public.set_championship_champion(uuid, uuid) from public, anon;
grant execute on function public.set_championship_champion(uuid, uuid) to authenticated;

comment on function public.set_championship_champion(uuid, uuid) is
  'Define/cambia/limpia (p_team_id null) el campeón OFICIAL (champion_team_id). Autoriza con _champ_can_manage_results: host in_progress; AlGrass in_progress+completed; owner/player nunca. El equipo debe ser del campeonato. Independiente del fixture/final.';


-- ── 3) get_championship_public — expone champion_team_id (compatible; base Fase 28) ───────────────────
create or replace function public.get_championship_public(p_championship_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_champ public.championships%rowtype;
begin
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if not (v_champ.status in ('registration_open','registration_closed','in_progress','completed')
          or v_champ.owner_user_id = auth.uid()
          or (v_champ.host_user_id is not null and v_champ.host_user_id = auth.uid())) then
    raise exception 'CHAMPIONSHIP_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'id', v_champ.id, 'status', v_champ.status, 'name', v_champ.name,
    'cover_theme', v_champ.cover_theme, 'cover_image_path', v_champ.cover_image_path,
    'event_date', v_champ.event_date, 'start_time', v_champ.start_time, 'end_time', v_champ.end_time,
    'venue_id', v_champ.venue_id, 'format_config', v_champ.format_config,
    'registration_closes_at', v_champ.registration_closes_at, 'published_at', v_champ.published_at,
    'fixture_published_at', v_champ.fixture_published_at,
    'live_started_at', v_champ.live_started_at,
    'champion_team_id', v_champ.champion_team_id,   -- Fase 36: campeón OFICIAL manual (null = sin campeón)
    'privacy', v_champ.privacy, 'results_public', v_champ.results_public,
    'owner_user_id', v_champ.owner_user_id,
    'is_host', (auth.uid() is not null and v_champ.host_user_id is not null and v_champ.host_user_id = auth.uid()),
    'has_registration_key', (nullif(btrim(coalesce(v_champ.registration_key, '')), '') is not null),
    'is_member', (auth.uid() is not null and exists (
        select 1 from public.championship_players where championship_id = p_championship_id and user_id = auth.uid()
      ))
  );
end; $$;
revoke all on function public.get_championship_public(uuid) from public;
grant execute on function public.get_championship_public(uuid) to anon, authenticated;


-- ── 4) Verificaciones razonables ──────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='championships' and column_name='champion_team_id') then
    raise exception 'VERIFY: falta championships.champion_team_id';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='set_championship_champion') then
    raise exception 'VERIFY: falta set_championship_champion';
  end if;
  raise notice 'OK Fase 36: champion_team_id + set_championship_champion + get_championship_public expone champion_team_id.';
end $$;
