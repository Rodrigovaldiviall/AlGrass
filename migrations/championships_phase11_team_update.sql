-- ============================================================================
-- Campeonatos · Fase 11 — Persistencia del equipo + permisos owner/AlGrass
-- ============================================================================
-- (1) Consolida create+update en UNA sola RPC save_championship_team (p_team_id nullable).
-- (2) Modelo de permisos por CAPITÁN dinámico + protección de estructuras del organizador, sin RPCs nuevas:
--     CREATE  → open: cualquier autenticado; pending_publish: SOLO owner/AlGrass. Capacidad global; sin
--               límite por creador; crear ≠ inscribirse (no toca championship_players).
--     UPDATE  → equipo VACÍO: FULL edit (nombre+color+diseño) por cualquiera si lo creó un jugador normal,
--               o SOLO owner/AlGrass si es estructura privilegiada (creator_is_privileged). Con jugadores:
--               FULL edit SOLO el capitán (miembro con joined_at más antiguo) en registration_open; owner/
--               AlGrass conservan RENAME (solo nombre) como override de moderación en pending/open/closed.
--               created_by NO otorga capitán ni edición normal; solo marca estructuras privilegiadas.
--     DELETE  → roster ACTUAL = 0 SIEMPRE. Autorización por ESTADO: pending_publish y registration_closed
--               solo owner/AlGrass; registration_open cualquiera para team de jugador normal y solo owner/
--               AlGrass para team privilegiado; in_progress/completed nadie.
--     STATE   → expone owner_user_id, is_algrass (viewer), is_captain y creator_is_privileged por equipo.
--
-- Membership (join/leave/sin-equipo) NO se toca.
--
-- COMPATIBILIDAD DE DEPLOY: create_championship_team NO se dropea aquí (evita ventana de rotura entre
-- migración y despliegue del frontend). Tras validar que producción usa save_championship_team:
--     DROP FUNCTION public.create_championship_team(uuid, text, text, text);
-- ============================================================================

-- Helper de rol back-office (mismo patrón que cancel_match/cancel_rental).
create or replace function public._is_algrass_staff(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
     where user_id = p_user and role in ('algrass_admin', 'algrass_staff')
  );
$$;
revoke all on function public._is_algrass_staff(uuid) from public, anon;
grant execute on function public._is_algrass_staff(uuid) to authenticated;


-- ── 1) save_championship_team — CREATE (p_team_id null) / UPDATE (p_team_id uuid) ────────────────────
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
  v_can_full   boolean;
  v_can_rename boolean;
  v_cap int; v_count int; v_team_id uuid;
begin
  -- ── BLOQUE COMÚN ──
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_name is null then raise exception 'INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  v_is_owner   := (v_champ.owner_user_id = v_actor);
  v_is_algrass := public._is_algrass_staff(v_actor);

  if p_team_id is null then
    -- ── CREATE ── registration_open (cualquiera autenticado con acceso) o pending_publish (owner/AlGrass).
    if not (v_champ.status = 'registration_open'
            or (v_champ.status = 'pending_publish' and (v_is_owner or v_is_algrass))) then
      raise exception 'NOT_OPEN';
    end if;
    if v_champ.status = 'registration_open'
       and v_champ.registration_closes_at is not null and now() >= v_champ.registration_closes_at then
      raise exception 'REGISTRATION_CLOSED';
    end if;
    -- Crear equipo ≠ inscribirse: NO se toca championship_players. Sin límite por creador; sí capacidad global.
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
  -- ¿El team es una estructura preparada por el organizador/AlGrass? (protege edición y delete estando vacío).
  v_creator_priv := (v_team.created_by_user_id = v_champ.owner_user_id)
                    or public._is_algrass_staff(v_team.created_by_user_id);

  -- Roster ACTUAL + CAPITÁN dinámico = miembro con joined_at más antiguo (NO created_by; NO se persiste).
  select count(*) into v_count from public.championship_players where team_id = p_team_id;
  select user_id into v_captain from public.championship_players
   where team_id = p_team_id order by joined_at asc, user_id asc limit 1;
  v_is_captain := (v_captain is not null and v_captain = v_actor);

  -- Capacidades del actor:
  --   FULL (nombre+color+diseño): equipo VACÍO → cualquier usuario SI el creador era jugador normal; si el
  --                               creador era owner/AlGrass, SOLO owner/AlGrass. Con jugadores → SOLO el capitán.
  --   RENAME (solo nombre): owner/AlGrass como override administrativo de moderación (aun con jugadores).
  v_can_full   := (v_count = 0 and (not v_creator_priv or v_is_owner or v_is_algrass))
                  or (v_count >= 1 and v_is_captain);
  v_can_rename := (v_is_owner or v_is_algrass);
  if not (v_can_full or v_can_rename) then raise exception 'NOT_AUTHORIZED'; end if;

  if v_can_full
     and (v_champ.status = 'registration_open'
          or (v_champ.status = 'pending_publish' and (v_is_owner or v_is_algrass))) then
    -- Edición COMPLETA. FULL solo en open (o pending si owner/AlGrass). closes_at cierra open.
    if v_champ.status = 'registration_open'
       and v_champ.registration_closes_at is not null and now() >= v_champ.registration_closes_at then
      raise exception 'REGISTRATION_CLOSED';
    end if;
    update public.championship_teams
       set name = v_name, color = v_color, design = v_design, updated_at = now()
     where id = p_team_id;
  elsif v_can_rename
     and v_champ.status in ('pending_publish', 'registration_open', 'registration_closed') then
    -- RENAME administrativo (owner/AlGrass): SOLO nombre; color/design intactos. pending/open/closed.
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


-- ── 2) delete_championship_team — roster ACTUAL = 0; autorización por ESTADO + creador privilegiado ──
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
  v_creator_priv boolean;   -- el team fue creado por el owner/pagador o por AlGrass (estructura protegida)
  v_count int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.status not in ('pending_publish', 'registration_open', 'registration_closed') then
    raise exception 'NOT_OPEN';
  end if;

  select * into v_team from public.championship_teams
   where id = p_team_id and championship_id = p_championship_id for update;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;

  -- Borrable SOLO con roster ACTUAL = 0, recontado BAJO LOCK (la UI nunca es fuente de verdad). Con 1+
  -- jugadores: rechazar SIEMPRE (ni el capitán; debe salir primero y, si queda vacío, ya puede borrarse).
  select count(*) into v_count from public.championship_players where team_id = p_team_id;
  if v_count > 0 then raise exception 'TEAM_HAS_PLAYERS'; end if;

  v_is_owner   := (v_champ.owner_user_id = v_actor);
  v_is_algrass := public._is_algrass_staff(v_actor);
  -- ¿El CREADOR original era privilegiado? owner = comparar con owner_user_id (estable); AlGrass = rol actual
  -- del creador (no hay snapshot de creación; los roles de back-office son estables). created_by SOLO se usa aquí.
  v_creator_priv := (v_team.created_by_user_id = v_champ.owner_user_id)
                    or public._is_algrass_staff(v_team.created_by_user_id);

  -- Autorización POR ESTADO (el estado manda; luego la protección del creador privilegiado):
  --   pending_publish   → SOLO owner/AlGrass (jugador normal nunca).
  --   registration_open → team de jugador normal: cualquier autenticado; team privilegiado: solo owner/AlGrass.
  --   registration_closed → SOLO owner/AlGrass (ni siquiera el creador jugador normal).
  --   (in_progress/completed ya cortan arriba con NOT_OPEN.)
  if v_champ.status in ('pending_publish', 'registration_closed') then
    if not (v_is_owner or v_is_algrass) then raise exception 'NOT_AUTHORIZED'; end if;
  elsif v_champ.status = 'registration_open' then
    if v_creator_priv and not (v_is_owner or v_is_algrass) then raise exception 'NOT_AUTHORIZED'; end if;
  end if;

  delete from public.championship_teams where id = p_team_id;
  return jsonb_build_object('deleted', true);
end; $$;
revoke all on function public.delete_championship_team(uuid, uuid) from public, anon;
grant execute on function public.delete_championship_team(uuid, uuid) to authenticated;


-- ── 3) get_championship_registration_state — añade owner_user_id + is_algrass (flags de permisos UI) ──
create or replace function public.get_championship_registration_state(p_championship_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_teams jsonb; v_players jsonb; v_me jsonb; v_pcount int;
  v_is_algrass boolean := public._is_algrass_staff(v_actor);
begin
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  -- Legible en estados públicos, o si el actor es el owner, o AlGrass (para gestión pre-publicación).
  if not (v_champ.status in ('registration_open','registration_closed','in_progress','completed')
          or v_champ.owner_user_id = v_actor or v_is_algrass) then
    raise exception 'CHAMPIONSHIP_NOT_FOUND';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'name', t.name, 'color', t.color, 'design', t.design,
           'created_by_user_id', t.created_by_user_id,
           -- creator_is_privileged: el team lo creó el owner o un AlGrass → DELETE protegido (solo owner/AlGrass).
           'creator_is_privileged', (t.created_by_user_id = v_champ.owner_user_id
                                      or public._is_algrass_staff(t.created_by_user_id)),
           'player_count', (select count(*) from public.championship_players p where p.team_id = t.id)
         ) order by t.created_at), '[]'::jsonb)
    into v_teams
    from public.championship_teams t where t.championship_id = p_championship_id;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by (x.user_id = v_actor) desc, lower(x.full_name)), '[]'::jsonb)
    into v_players
    from (
      -- is_captain: por equipo, el miembro con joined_at más antiguo (capitán DINÁMICO, sin columna nueva).
      select p.user_id, u.full_name, u.avatar_path, u.avatar_hue, p.team_id, t.name as team_name,
             (p.team_id is not null and p.user_id = (
                select cp.user_id from public.championship_players cp
                 where cp.team_id = p.team_id order by cp.joined_at asc, cp.user_id asc limit 1
             )) as is_captain
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
    'owner_user_id', v_champ.owner_user_id,
    'is_algrass', v_is_algrass,
    'team_count', (select count(*) from public.championship_teams where championship_id = p_championship_id),
    'player_count', v_pcount
  );
end; $$;
revoke all on function public.get_championship_registration_state(uuid) from public, anon;
grant execute on function public.get_championship_registration_state(uuid) to authenticated;
