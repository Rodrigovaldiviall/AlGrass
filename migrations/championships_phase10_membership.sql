-- ============================================================================
-- Campeonatos · Fase 10 — Membership separada de creación + join a equipo + salir + borrar equipo
-- ============================================================================
-- CAMBIO DE MODELO vs Fase 9: CREAR EQUIPO ≠ INSCRIBIRSE.
--   · create_championship_team YA NO inscribe al creador (solo crea el team).
--   · join_championship_team(champ, team)  → inscribe con team_id (registration_open/closed).
--   · leave_championship(champ)            → DELETE de la membership del actor (registration_open/closed).
--   · delete_championship_team(champ,team) → borra team propio (solo registration_open; reglas de vacíos).
--   · get_championship_registration_state  → ahora expone team.created_by_user_id (para el delete en UI).
--
-- Membership = presencia de fila en championship_players (UNIQUE champ+user, SIN status).
-- Reglas de estado:
--   registration_open   → crear / unirse sin equipo / unirse a equipo / salir / borrar equipo propio.
--   registration_closed → SOLO unirse a equipo existente + salir (sin crear/sin-equipo/borrar).
--   in_progress/completed → todo CONGELADO (ni join/leave/create/delete).
-- registration_closes_at bloquea las acciones de registration_open; en registration_closed NO se aplica
--   (esa fase existe para terminar de acomodar jugadores en equipos existentes).
--
-- ADITIVA (CREATE OR REPLACE + funciones nuevas). NO toca fixture/resultados/pagos/Admin/RLS de users.
-- Requiere Fase 9 aplicada. Ejecutar DESPUÉS de reset de datos de prueba (creados con el modelo viejo).
-- ============================================================================

-- ── 1) create_championship_team — SOLO crea el team (ya NO inscribe al creador) ──────────────────────
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
  -- Crear equipo ≠ inscribirse: NO se comprueba membership ni se crea championship_player. Un usuario
  -- (inscrito o no) puede crear equipos; decide después unirse (o no) con join_championship_team.

  v_cap := public._championship_team_capacity(v_champ.format_config);
  select count(*) into v_count from public.championship_teams where championship_id = p_championship_id;
  if v_count >= v_cap then raise exception 'CAPACITY_FULL'; end if;

  insert into public.championship_teams (championship_id, name, color, design, created_by_user_id)
    values (p_championship_id, v_name, nullif(btrim(coalesce(p_color, '')), ''), nullif(btrim(coalesce(p_design, '')), ''), v_actor)
    returning id into v_team_id;
  -- NOTA: NO se inserta championship_players. Crear equipo ≠ inscribirse (Fase 10).

  return jsonb_build_object('team_id', v_team_id, 'name', v_name);
end; $$;
revoke all on function public.create_championship_team(uuid, text, text, text) from public, anon;
grant execute on function public.create_championship_team(uuid, text, text, text) to authenticated;


-- ── 2) join_championship_team — inscribirse en un equipo EXISTENTE ────────────────────────────────────
-- registration_open (respeta closes_at) o registration_closed (ignora closes_at). NUNCA in_progress/completed.
-- Errores: AUTH_REQUIRED, CHAMPIONSHIP_NOT_FOUND, NOT_OPEN, REGISTRATION_CLOSED, TEAM_NOT_FOUND, ALREADY_ENROLLED.
create or replace function public.join_championship_team(
  p_championship_id uuid,
  p_team_id         uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  -- MISMO advisory lock que create/delete team → serializa join-vs-delete del mismo equipo (evita que un
  -- delete de team vacío convierta a este usuario en "sin equipo" por el ON DELETE SET NULL).
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.status not in ('registration_open', 'registration_closed') then raise exception 'NOT_OPEN'; end if;
  if v_champ.status = 'registration_open'
     and v_champ.registration_closes_at is not null and now() >= v_champ.registration_closes_at then
    raise exception 'REGISTRATION_CLOSED';
  end if;
  -- El equipo debe existir y pertenecer a ESTE campeonato (bajo el lock → coherente con delete concurrente).
  if not exists (select 1 from public.championship_teams where id = p_team_id and championship_id = p_championship_id) then
    raise exception 'TEAM_NOT_FOUND';
  end if;

  -- SET membership (una sola fila por UNIQUE): sin fila → INSERT; con fila (otro team o NULL) → UPDATE al
  -- nuevo team; mismo team → no-op. Cambiar de equipo es directo (no exige salir primero). Atómico + lock.
  insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, v_actor, p_team_id)
  on conflict (championship_id, user_id) do update set team_id = excluded.team_id;

  return jsonb_build_object('championship_id', p_championship_id, 'team_id', p_team_id);
end; $$;
revoke all on function public.join_championship_team(uuid, uuid) from public, anon;
grant execute on function public.join_championship_team(uuid, uuid) to authenticated;


-- ── 2b) join_championship_without_team (Fase 9 → SET membership a NULL) ───────────────────────────────
-- SOLO registration_open (+ closes_at no vencido): sin fila → INSERT team_id NULL; con fila (en un team)
-- → UPDATE team_id = NULL; ya sin equipo → no-op. Nunca crea segunda fila. En registration_closed NO se
-- puede pasar a "sin equipo" (esta RPC exige registration_open). Mismo advisory lock champ_reg.
create or replace function public.join_championship_without_team(p_championship_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.status <> 'registration_open' then raise exception 'NOT_OPEN'; end if;
  if v_champ.registration_closes_at is not null and now() >= v_champ.registration_closes_at then
    raise exception 'REGISTRATION_CLOSED';
  end if;

  insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, v_actor, null)
  on conflict (championship_id, user_id) do update set team_id = null;

  return jsonb_build_object('championship_id', p_championship_id, 'team_id', null);
end; $$;
revoke all on function public.join_championship_without_team(uuid) from public, anon;
grant execute on function public.join_championship_without_team(uuid) to authenticated;


-- ── 3) leave_championship — salir/desinscribirse (DELETE de la membership del actor) ─────────────────
-- Permitido en registration_open y registration_closed (incluso con closes_at vencido). Bloqueado
-- in_progress/completed. NO borra el team. Idempotente (si no estaba inscrito, no-op → left=false).
create or replace function public.leave_championship(p_championship_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_deleted int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.status not in ('registration_open', 'registration_closed') then raise exception 'NOT_OPEN'; end if;

  delete from public.championship_players
   where championship_id = p_championship_id and user_id = v_actor;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('left', v_deleted > 0);
end; $$;
revoke all on function public.leave_championship(uuid) from public, anon;
grant execute on function public.leave_championship(uuid) to authenticated;


-- ── 4) delete_championship_team — borrar equipo propio (solo registration_open) ──────────────────────
-- Solo el creador. Reglas de jugadores: 0 jugadores → borra; 1 jugador que ES el creador → borra su
-- membership + el team (queda NO inscrito, no "sin equipo"); cualquier otro caso → TEAM_HAS_PLAYERS.
-- Atómico. Advisory lock por campeonato (coherente con create). Errores: AUTH_REQUIRED, CHAMPIONSHIP_NOT_FOUND,
-- NOT_OPEN, TEAM_NOT_FOUND, NOT_AUTHORIZED, TEAM_HAS_PLAYERS.
create or replace function public.delete_championship_team(
  p_championship_id uuid,
  p_team_id         uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_team  public.championship_teams%rowtype;
  v_count int;
  v_only_is_creator boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.status <> 'registration_open' then raise exception 'NOT_OPEN'; end if;
  if v_champ.registration_closes_at is not null and now() >= v_champ.registration_closes_at then
    raise exception 'REGISTRATION_CLOSED';
  end if;

  select * into v_team from public.championship_teams
   where id = p_team_id and championship_id = p_championship_id for update;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  if v_team.created_by_user_id is distinct from v_actor then raise exception 'NOT_AUTHORIZED'; end if;

  select count(*) into v_count from public.championship_players where team_id = p_team_id;

  if v_count = 0 then
    delete from public.championship_teams where id = p_team_id;
  elsif v_count = 1 then
    -- El único jugador debe ser el creador; si no, no se puede borrar.
    select exists (
      select 1 from public.championship_players
       where team_id = p_team_id and user_id = v_team.created_by_user_id
    ) into v_only_is_creator;
    if not v_only_is_creator then raise exception 'TEAM_HAS_PLAYERS'; end if;
    -- Borrar PRIMERO la membership del creador (evita quedar "sin equipo" por el SET NULL), luego el team.
    delete from public.championship_players where championship_id = p_championship_id and team_id = p_team_id;
    delete from public.championship_teams where id = p_team_id;
  else
    raise exception 'TEAM_HAS_PLAYERS';
  end if;

  return jsonb_build_object('deleted', true);
end; $$;
revoke all on function public.delete_championship_team(uuid, uuid) from public, anon;
grant execute on function public.delete_championship_team(uuid, uuid) to authenticated;


-- ── 5) get_championship_registration_state — añade team.created_by_user_id (para delete en UI) ───────
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
           'created_by_user_id', t.created_by_user_id,
           'player_count', (select count(*) from public.championship_players p where p.team_id = t.id)
         ) order by t.created_at), '[]'::jsonb)
    into v_teams
    from public.championship_teams t where t.championship_id = p_championship_id;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by (x.user_id = v_actor) desc, lower(x.full_name)), '[]'::jsonb)
    into v_players
    from (
      -- users_public = ÚNICA superficie pública oficial. Solo campos públicos seguros.
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
