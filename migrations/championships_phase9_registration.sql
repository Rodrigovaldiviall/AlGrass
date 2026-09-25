-- ============================================================================
-- Campeonatos · Fase 9 — Inscripciones reales (equipos + jugadores) MÍNIMAS
-- ============================================================================
-- Conecta Crear equipo / Unirme sin equipo / roster real / bypass de clave por membership.
-- NO toca fixture/resultados/goles/standings/pagos/checkout/cover/Admin.
--
-- Modelo: un usuario se inscribe UNA sola vez por campeonato (UNIQUE), con team_id o sin él.
-- Toda mutación por RPC SECURITY DEFINER con checks explícitos + advisory lock por campeonato
-- (evita superar capacidad en carrera). Tablas con RLS habilitada y SIN acceso directo (solo RPCs).
-- ============================================================================

-- ── Tablas ───────────────────────────────────────────────────────────────────
create table if not exists public.championship_teams (
  id                 uuid primary key default gen_random_uuid(),
  championship_id    uuid not null references public.championships(id) on delete cascade,
  name               text not null,
  color              text,           -- design.colors[0] (ya en la UX del escudo)
  design             text,           -- clave de TEAM_DESIGNS (patrón del escudo)
  created_by_user_id uuid not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists championship_teams_champ_idx on public.championship_teams (championship_id);

create table if not exists public.championship_players (
  id              uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships(id) on delete cascade,
  user_id         uuid not null,
  team_id         uuid references public.championship_teams(id) on delete set null,
  joined_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (championship_id, user_id)              -- impide doble inscripción (también concurrente)
);
create index if not exists championship_players_champ_idx on public.championship_players (championship_id);
create index if not exists championship_players_team_idx  on public.championship_players (team_id) where team_id is not null;

-- RLS: habilitada y SIN policies → acceso directo denegado. Todo pasa por las RPC SECURITY DEFINER.
alter table public.championship_teams   enable row level security;
alter table public.championship_players enable row level security;
revoke all on public.championship_teams   from anon, authenticated;
revoke all on public.championship_players from anon, authenticated;


-- ── Helper interno: capacidad de equipos desde format_config (mismos tramos que realTeamCapacity) ────
create or replace function public._championship_team_capacity(p_config jsonb)
returns int language sql immutable set search_path = public as $$
  select case
    -- Liga = capacidad 1, EXACTAMENTE como el frontend (realSlotCount = isLiga ? 1 : ...). Sin
    -- leagueEstimate.quantity ni default silencioso 64.
    when (p_config->'summary'->>'mode') = 'liga' then 1
    else case
      when coalesce((p_config->'summary'->'group'->>'max')::int, 0) <= 4  then 4
      when coalesce((p_config->'summary'->'group'->>'max')::int, 0) <= 6  then 6
      when coalesce((p_config->'summary'->'group'->>'max')::int, 0) <= 8  then 8
      when coalesce((p_config->'summary'->'group'->>'max')::int, 0) <= 12 then 12
      when coalesce((p_config->'summary'->'group'->>'max')::int, 0) <= 14 then 14
      else 16 end
  end;
$$;


-- ── RPC 1 — create_championship_team ─────────────────────────────────────────
-- Crea equipo + inscribe al CREADOR (team_id) atómicamente. Advisory lock por campeonato → capacidad
-- segura ante concurrencia. Errores: AUTH_REQUIRED, CHAMPIONSHIP_NOT_FOUND, NOT_OPEN, REGISTRATION_CLOSED,
-- ALREADY_ENROLLED, CAPACITY_FULL, INVALID_INPUT.
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
  if v_champ.registration_closes_at is not null and now() >= v_champ.registration_closes_at then
    raise exception 'REGISTRATION_CLOSED';
  end if;
  if exists (select 1 from public.championship_players where championship_id = p_championship_id and user_id = v_actor) then
    raise exception 'ALREADY_ENROLLED';
  end if;

  v_cap := public._championship_team_capacity(v_champ.format_config);
  select count(*) into v_count from public.championship_teams where championship_id = p_championship_id;
  if v_count >= v_cap then raise exception 'CAPACITY_FULL'; end if;

  insert into public.championship_teams (championship_id, name, color, design, created_by_user_id)
    values (p_championship_id, v_name, nullif(btrim(coalesce(p_color, '')), ''), nullif(btrim(coalesce(p_design, '')), ''), v_actor)
    returning id into v_team_id;
  insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, v_actor, v_team_id);

  return jsonb_build_object('team_id', v_team_id, 'name', v_name);
end; $$;
revoke all on function public.create_championship_team(uuid, text, text, text) from public, anon;
grant execute on function public.create_championship_team(uuid, text, text, text) to authenticated;


-- ── RPC 2 — join_championship_without_team ───────────────────────────────────
-- Inscribe al usuario SIN equipo (team_id null). UNIQUE protege doble inscripción concurrente.
-- Errores: AUTH_REQUIRED, CHAMPIONSHIP_NOT_FOUND, NOT_OPEN, REGISTRATION_CLOSED, ALREADY_ENROLLED.
create or replace function public.join_championship_without_team(p_championship_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.status <> 'registration_open' then raise exception 'NOT_OPEN'; end if;
  if v_champ.registration_closes_at is not null and now() >= v_champ.registration_closes_at then
    raise exception 'REGISTRATION_CLOSED';
  end if;

  begin
    insert into public.championship_players (championship_id, user_id, team_id)
      values (p_championship_id, v_actor, null);
  exception when unique_violation then
    raise exception 'ALREADY_ENROLLED';
  end;

  return jsonb_build_object('championship_id', p_championship_id, 'team_id', null);
end; $$;
revoke all on function public.join_championship_without_team(uuid) from public, anon;
grant execute on function public.join_championship_without_team(uuid) to authenticated;


-- ── RPC 3 — get_championship_registration_state ──────────────────────────────
-- Estado de inscripciones (teams + players + membership propia + contadores). Solo campeonatos publicados
-- (o del owner). Datos PÚBLICOS de usuario (full_name/avatar), como el roster de Match → grant a authenticated.
-- Orden de players: usuario actual primero, luego alfabético. NUNCA email/teléfono/pagos/registration_key.
create or replace function public.get_championship_registration_state(p_championship_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_teams jsonb; v_players jsonb; v_me jsonb; v_pcount int;
begin
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if not (v_champ.status in ('registration_open','registration_closed','in_progress','completed')
          or v_champ.owner_user_id = v_actor) then
    raise exception 'CHAMPIONSHIP_NOT_FOUND';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'name', t.name, 'color', t.color, 'design', t.design,
           'player_count', (select count(*) from public.championship_players p where p.team_id = t.id)
         ) order by t.created_at), '[]'::jsonb)
    into v_teams
    from public.championship_teams t where t.championship_id = p_championship_id;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by (x.user_id = v_actor) desc, lower(x.full_name)), '[]'::jsonb)
    into v_players
    from (
      -- users_public = ÚNICA superficie pública oficial (misma que el roster/perfil de Match). NO se lee
      -- public.users directo. Solo campos públicos seguros: full_name, avatar_path, avatar_hue.
      select p.user_id, u.full_name, u.avatar_path, u.avatar_hue, p.team_id, t.name as team_name
        from public.championship_players p
        left join public.users_public u on u.id = p.user_id
        left join public.championship_teams t on t.id = p.team_id
       where p.championship_id = p_championship_id
    ) x;

  select count(*) into v_pcount from public.championship_players where championship_id = p_championship_id;

  select case when p.user_id is null then null
              else jsonb_build_object('user_id', p.user_id, 'team_id', p.team_id) end
    into v_me
    from (select * from public.championship_players where championship_id = p_championship_id and user_id = v_actor) p;

  return jsonb_build_object(
    'teams', v_teams,
    'players', v_players,
    'current_user_membership', v_me,
    'team_count', (select count(*) from public.championship_teams where championship_id = p_championship_id),
    'player_count', v_pcount
  );
end; $$;
revoke all on function public.get_championship_registration_state(uuid) from public, anon;
grant execute on function public.get_championship_registration_state(uuid) to authenticated;


-- ── Extensión de acceso: member bypass ───────────────────────────────────────
-- verify_championship_access: owner → true; MIEMBRO inscrito → true; visitante → clave (regla Fase 7).
create or replace function public.verify_championship_access(
  p_championship_id  uuid,
  p_registration_key text
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_champ public.championships%rowtype;
  v_typed text := btrim(coalesce(p_registration_key, ''));
begin
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then return false; end if;
  if v_champ.status not in ('registration_open','registration_closed','in_progress','completed') then return false; end if;
  if v_champ.owner_user_id = auth.uid() then return true; end if;                              -- owner
  if auth.uid() is not null and exists (
       select 1 from public.championship_players where championship_id = p_championship_id and user_id = auth.uid()
     ) then return true; end if;                                                              -- miembro inscrito
  if nullif(btrim(coalesce(v_champ.registration_key, '')), '') is null then return false; end if;
  return v_typed = btrim(v_champ.registration_key);                                           -- visitante: clave
end; $$;
revoke all on function public.verify_championship_access(uuid, text) from public, anon;
grant execute on function public.verify_championship_access(uuid, text) to anon, authenticated;


-- ── Extensión de get_championship_public: is_member (para bypass de clave en frontend) ───────────────
-- Igual que Fase 8 + is_member (booleano: el solicitante autenticado ya está inscrito). NO expone roster.
create or replace function public.get_championship_public(p_championship_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_champ public.championships%rowtype;
begin
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if not (v_champ.status in ('registration_open','registration_closed','in_progress','completed')
          or v_champ.owner_user_id = auth.uid()) then
    raise exception 'CHAMPIONSHIP_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'id', v_champ.id, 'status', v_champ.status, 'name', v_champ.name,
    'cover_theme', v_champ.cover_theme, 'cover_image_path', v_champ.cover_image_path,
    'event_date', v_champ.event_date, 'start_time', v_champ.start_time, 'end_time', v_champ.end_time,
    'venue_id', v_champ.venue_id, 'format_config', v_champ.format_config,
    'registration_closes_at', v_champ.registration_closes_at, 'published_at', v_champ.published_at,
    'privacy', v_champ.privacy, 'results_public', v_champ.results_public,
    'owner_user_id', v_champ.owner_user_id,
    'has_registration_key', (nullif(btrim(coalesce(v_champ.registration_key, '')), '') is not null),
    'is_member', (auth.uid() is not null and exists (
        select 1 from public.championship_players where championship_id = p_championship_id and user_id = auth.uid()
      ))
  );
end; $$;
revoke all on function public.get_championship_public(uuid) from public;
grant execute on function public.get_championship_public(uuid) to anon, authenticated;
