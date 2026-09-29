-- ============================================================================
-- Campeonatos · Fase 20 — Matriz definitiva de roster + "Calendario publicado" (sin nuevo status)
-- ============================================================================
-- Cierra la matriz de roster/equipos por actor×fase y habilita la fase funcional "Calendario publicado"
-- mediante championships.fixture_published_at (NO se crea status nuevo). Reutiliza TODO lo de Phase 19:
--   · 1 columna nueva: championships.fixture_published_at.
--   · refactor del helper _champ_can_manage_roster → parametrizado por ACCIÓN (create_team/edit_team/
--     delete_team/move_player/add_player/self); lee status + fixture_published_at + roles. Sustituye la
--     versión 2-args de Phase 19 (se DROPEA al final).
--   · save_championship_team / delete_championship_team / manage_championship_player: gates afinados por
--     acción; se REVIERTE a Phase 11 la edición/borrado de equipo VACÍO no privilegiado del jugador normal
--     (cualquiera, sin exigir ser el creador); manage distingue self / inscrito / nuevo (owner NO agrega nuevos).
--   · get_championship_public expone fixture_published_at (para la superficie Inscripciones vs Calendario).
-- 0 tablas nuevas. 0 RPCs nuevas de roster. NO resultados, NO transiciones de estado, NO UX (fases futuras).
--
-- Fase efectiva: 'CAL' (Calendario publicado) = status='registration_closed' AND fixture_published_at IS NOT NULL.
--   registration_closed + fixture_published_at IS NULL     → Inscripciones cerradas.
--   registration_closed + fixture_published_at IS NOT NULL → Calendario publicado (CAL).
-- ============================================================================

-- ── 1) Columna nueva ─────────────────────────────────────────────────────────
-- Marca temporal de publicación del calendario/fixture. NULL = aún no publicado. Un timestamptz (patrón de
-- published_at/registration_closes_at) da además "cuándo". El setter (RPC de transición AlGrass) es fase futura.
alter table public.championships add column if not exists fixture_published_at timestamptz;


-- ── 2) Helper de autorización de roster (parametrizado por acción) ───────────────────────────────────
-- Única autoridad server-side. Ventanas por acción (fases: PP=pending_publish, RO=registration_open,
-- RC=registration_closed sin fixture, CAL=registration_closed con fixture, IP=in_progress, CO=completed):
--   create_team : owner/host → PP,RO,RC        · AlGrass → PP,RO,RC,CAL,IP,CO
--   delete_team : owner/host → PP,RO,RC        · AlGrass → PP,RO,RC,CAL,IP,CO
--   edit_team   : owner/host → PP,RO,RC,CAL     · AlGrass → PP,RO,RC,CAL,IP,CO
--   move_player : owner/host → PP,RO,RC,CAL,IP  · AlGrass → PP,RO,RC,CAL,IP,CO
--   add_player  : host       → PP,RO,RC,CAL,IP  · AlGrass → PP,RO,RC,CAL,IP,CO   (owner NUNCA)
--   self        : owner/host → PP,RO,RC,CAL,IP  · AlGrass → PP,RO,RC,CAL,IP,CO
-- El jugador NORMAL no pasa por aquí (sus caminos self-service viven en save/delete y en las RPC SELF).
-- Nunca payment_validation ni canceled.
create or replace function public._champ_can_manage_roster(p_championship_id uuid, p_actor uuid, p_action text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c        public.championships%rowtype;
  v_algrass boolean;
  v_owner   boolean;
  v_host    boolean;
  ph        text;   -- fase efectiva
begin
  if p_actor is null then return false; end if;
  select * into c from public.championships where id = p_championship_id;
  if not found then return false; end if;

  v_algrass := public._is_algrass_staff(p_actor);
  v_owner   := (c.owner_user_id = p_actor);
  v_host    := (c.host_user_id is not null and c.host_user_id = p_actor);
  if not (v_algrass or v_owner or v_host) then return false; end if;

  ph := case
          when c.status = 'registration_closed' and c.fixture_published_at is not null then 'CAL'
          else c.status
        end;

  -- AlGrass: TODO en fases operativas + completed (jamás payment_validation ni canceled).
  if v_algrass then
    return ph in ('pending_publish','registration_open','registration_closed','CAL','in_progress','completed');
  end if;

  -- Owner/Host (v_owner or v_host = true). "add_player" (agregar tercero nuevo) SOLO host.
  if p_action = 'add_player' then
    return v_host and ph in ('pending_publish','registration_open','registration_closed','CAL','in_progress');
  elsif p_action = 'create_team' or p_action = 'delete_team' then
    return ph in ('pending_publish','registration_open','registration_closed');
  elsif p_action = 'edit_team' then
    return ph in ('pending_publish','registration_open','registration_closed','CAL');
  elsif p_action = 'move_player' or p_action = 'self' then
    return ph in ('pending_publish','registration_open','registration_closed','CAL','in_progress');
  else
    return false;
  end if;
end; $$;
revoke all on function public._champ_can_manage_roster(uuid, uuid, text) from public, anon;
grant execute on function public._champ_can_manage_roster(uuid, uuid, text) to authenticated;


-- ── 3) save_championship_team — CREATE/EDIT con gates por acción; jugador normal REVERTIDO a Phase 11 ──
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
  v_is_algrass boolean;
  v_is_creator boolean;
  v_creator_priv boolean;
  v_captain    uuid;
  v_is_captain boolean;
  v_can_full   boolean;   -- vía jugador normal / capitán (Phase 11)
  v_can_create boolean;   -- vía administrativa (owner/host/AlGrass)
  v_can_edit   boolean;   -- vía administrativa (owner/host/AlGrass)
  v_cap int; v_count int; v_team_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_name is null then raise exception 'INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  v_is_owner   := (v_champ.owner_user_id = v_actor);
  v_is_algrass := public._is_algrass_staff(v_actor);

  if p_team_id is null then
    -- ── CREATE ── administrativa (owner/host/AlGrass en ventana create_team) o self-service normal en open.
    v_can_create := public._champ_can_manage_roster(p_championship_id, v_actor, 'create_team');
    if not (v_can_create or v_champ.status = 'registration_open') then
      raise exception 'NOT_OPEN';
    end if;
    -- closes_at cierra SOLO la vía self-service en open (la administrativa no se ve afectada).
    if not v_can_create
       and v_champ.status = 'registration_open'
       and v_champ.registration_closes_at is not null and now() >= v_champ.registration_closes_at then
      raise exception 'REGISTRATION_CLOSED';
    end if;
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

  -- Jugador normal (Phase 11, REVERTIDO): equipo VACÍO NO privilegiado → editable por CUALQUIER autenticado
  -- (no requiere ser el creador); si el creador es owner/AlGrass, solo owner/AlGrass. Con jugadores → SOLO capitán.
  v_can_full := (v_count = 0 and (not v_creator_priv or v_is_owner or v_is_algrass))
                or (v_count >= 1 and v_is_captain);
  -- Vía administrativa: owner/host/AlGrass edición COMPLETA en su ventana (edit_team incluye CAL, no IP).
  v_can_edit := public._champ_can_manage_roster(p_championship_id, v_actor, 'edit_team');

  if not (v_can_edit or v_can_full) then raise exception 'NOT_AUTHORIZED'; end if;
  if v_can_edit or (v_can_full and v_champ.status = 'registration_open') then
    -- closes_at cierra la vía NO administrativa (jugador normal/capitán) en open.
    if not v_can_edit
       and v_champ.status = 'registration_open'
       and v_champ.registration_closes_at is not null and now() >= v_champ.registration_closes_at then
      raise exception 'REGISTRATION_CLOSED';
    end if;
    update public.championship_teams
       set name = v_name, color = v_color, design = v_design, updated_at = now()
     where id = p_team_id;
  else
    raise exception 'NOT_OPEN';
  end if;

  return jsonb_build_object('team_id', p_team_id, 'name', v_name);
end; $$;
revoke all on function public.save_championship_team(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.save_championship_team(uuid, uuid, text, text, text) to authenticated;


-- ── 4) delete_championship_team — roster=0; admin por acción; jugador normal REVERTIDO a Phase 11 ─────
create or replace function public.delete_championship_team(
  p_championship_id uuid,
  p_team_id         uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor   uuid := auth.uid();
  v_champ   public.championships%rowtype;
  v_team    public.championship_teams%rowtype;
  v_is_owner   boolean;
  v_is_algrass boolean;
  v_can_delete boolean;
  v_creator_priv boolean;
  v_count int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  select * into v_team from public.championship_teams
   where id = p_team_id and championship_id = p_championship_id for update;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;

  -- Regla universal: solo borrable con roster ACTUAL = 0 (recontado BAJO LOCK).
  select count(*) into v_count from public.championship_players where team_id = p_team_id;
  if v_count > 0 then raise exception 'TEAM_HAS_PLAYERS'; end if;

  v_is_owner   := (v_champ.owner_user_id = v_actor);
  v_is_algrass := public._is_algrass_staff(v_actor);
  v_creator_priv := (v_team.created_by_user_id = v_champ.owner_user_id)
                    or public._is_algrass_staff(v_team.created_by_user_id);
  v_can_delete := public._champ_can_manage_roster(p_championship_id, v_actor, 'delete_team');

  if v_can_delete then
    null;  -- owner/host/AlGrass en ventana delete_team (PP/RO/RC; AlGrass +CAL/IP/CO)
  elsif v_champ.status = 'registration_open' then
    -- Jugador normal (Phase 11, REVERTIDO): cualquier equipo VACÍO NO privilegiado; NO requiere ser el creador.
    -- Equipo del owner/AlGrass (privilegiado) → solo owner/AlGrass (aquí v_can_delete ya lo cubrió).
    if v_creator_priv then raise exception 'NOT_AUTHORIZED'; end if;
  else
    raise exception 'NOT_OPEN';
  end if;

  delete from public.championship_teams where id = p_team_id;
  return jsonb_build_object('deleted', true);
end; $$;
revoke all on function public.delete_championship_team(uuid, uuid) from public, anon;
grant execute on function public.delete_championship_team(uuid, uuid) to authenticated;


-- ── 5) manage_championship_player — distingue self / inscrito / nuevo; owner NO agrega terceros nuevos ─
create or replace function public.manage_championship_player(
  p_championship_id uuid,
  p_user_id         uuid,
  p_team_id         uuid    default null,
  p_remove          boolean default false
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor      uuid := auth.uid();
  v_champ      public.championships%rowtype;
  v_is_owner   boolean;
  v_is_host    boolean;
  v_is_algrass boolean;
  v_exists     boolean;
  v_self       boolean;
  v_action     text;
  v_deleted    int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  -- MISMA lock key que join/leave/save/delete → serializa todas las mutaciones de roster que compiten.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  v_is_algrass := public._is_algrass_staff(v_actor);
  v_is_owner   := (v_champ.owner_user_id = v_actor);
  v_is_host    := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  if not (v_is_owner or v_is_host or v_is_algrass) then raise exception 'NOT_AUTHORIZED'; end if;

  -- Objetivo: usuario REAL de la app (championship_players.user_id sin FK). Sin invitaciones externas.
  if p_user_id is null
     or not exists (select 1 from public.users_public where id = p_user_id) then
    raise exception 'INVALID_INPUT';
  end if;

  v_self   := (p_user_id = v_actor);
  v_exists := exists (select 1 from public.championship_players
                       where championship_id = p_championship_id and user_id = p_user_id);
  -- Categoría de operación:
  --   self       → target = actor (auto-inscribirse/mover/quedar-sin-equipo/desuscribirse owner/host).
  --   move_player→ target YA inscrito (o remove): mover/asignar/quitar membership existente.
  --   add_player → target NUEVO no inscrito: agregar tercero (SOLO host/AlGrass; owner nunca).
  if v_self then
    v_action := 'self';
  elsif p_remove or v_exists then
    v_action := 'move_player';
  else
    v_action := 'add_player';
  end if;

  -- Regla de ROL: agregar un tercero nuevo es exclusivo de host/AlGrass. Owner queda excluido aunque gestione
  -- el resto del roster (mover/quitar inscritos, self). Falla de rol → NOT_AUTHORIZED.
  if v_action = 'add_player' and not (v_is_host or v_is_algrass) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  -- Ventana por acción/estado. Privilegiado pero fuera de ventana → NOT_OPEN.
  if not public._champ_can_manage_roster(p_championship_id, v_actor, v_action) then
    raise exception 'NOT_OPEN';
  end if;

  if p_remove then
    delete from public.championship_players
     where championship_id = p_championship_id and user_id = p_user_id;
    get diagnostics v_deleted = row_count;
    return jsonb_build_object('championship_id', p_championship_id, 'user_id', p_user_id,
                              'team_id', null, 'removed', v_deleted > 0);
  end if;

  -- Asignación a team: debe existir Y pertenecer a ESTE campeonato (jamás team de otro campeonato).
  if p_team_id is not null
     and not exists (select 1 from public.championship_teams
                      where id = p_team_id and championship_id = p_championship_id) then
    raise exception 'TEAM_NOT_FOUND';
  end if;

  insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, p_user_id, p_team_id)
  on conflict (championship_id, user_id) do update set team_id = excluded.team_id;

  return jsonb_build_object('championship_id', p_championship_id, 'user_id', p_user_id,
                            'team_id', p_team_id, 'removed', false);
end; $$;
revoke all on function public.manage_championship_player(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.manage_championship_player(uuid, uuid, uuid, boolean) to authenticated;


-- ── 6) get_championship_public — expone fixture_published_at (superficie Inscripciones vs Calendario) ─
-- Cuerpo idéntico al vigente (Fase 9) + el campo fixture_published_at. Mismo gate de lectura, revoke/grant.
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
    'fixture_published_at', v_champ.fixture_published_at,
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


-- ── 7) Limpieza: se elimina la versión 2-args del helper (superada por la parametrizada por acción) ───
-- Ninguna función referencia ya la firma 2-args (save/delete/manage usan la de 3-args). Se dropea para no
-- dejar un overload obsoleto. (Si algún objeto la referenciara, este drop fallaría y avisaría.)
drop function if exists public._champ_can_manage_roster(uuid, uuid);
