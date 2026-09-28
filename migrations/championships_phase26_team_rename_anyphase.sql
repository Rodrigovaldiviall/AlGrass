-- ============================================================================
-- Campeonatos · Fase 26 — Renombrar EQUIPO (solo nombre) por Owner/Host/AlGrass en CUALQUIER fase
-- ============================================================================
-- Amplía save_championship_team (Fase 20) con una rama RENAME (solo `name`) para owner/host/AlGrass válida en
-- CUALQUIER fase operativa (incluye in_progress y completed), salvo canceled. La edición COMPLETA (color/diseño)
-- y las vías del jugador normal/capitán quedan EXACTAMENTE igual que en Fase 20. No cambia firma, permisos de
-- color/diseño, delete ni ninguna otra RPC. host_user_id sigue siendo la única fuente del Host.
-- ============================================================================

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
  v_can_full   boolean;   -- vía jugador normal / capitán (Phase 11)
  v_can_create boolean;   -- vía administrativa (owner/host/AlGrass)
  v_can_edit   boolean;   -- edición COMPLETA administrativa (owner/host/AlGrass en ventana edit_team)
  v_can_rename boolean;   -- rename SOLO nombre (owner/host/AlGrass) en cualquier fase (salvo canceled)  ← Fase 26
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

  v_can_full := (v_count = 0 and (not v_creator_priv or v_is_owner or v_is_algrass))
                or (v_count >= 1 and v_is_captain);
  v_can_edit := public._champ_can_manage_roster(p_championship_id, v_actor, 'edit_team');
  -- RENAME (solo nombre): owner/host/AlGrass en cualquier fase operativa (incluye in_progress y completed).
  -- No aplica en canceled. color/diseño NO se tocan por esta vía.
  v_can_rename := (v_is_owner or v_is_host or v_is_algrass) and v_champ.status <> 'canceled';

  if not (v_can_edit or v_can_full or v_can_rename) then raise exception 'NOT_AUTHORIZED'; end if;
  if v_can_edit or (v_can_full and v_champ.status = 'registration_open') then
    -- Edición COMPLETA (nombre+color+diseño). closes_at cierra la vía NO administrativa (jugador/capitán) en open.
    if not v_can_edit
       and v_champ.status = 'registration_open'
       and v_champ.registration_closes_at is not null and now() >= v_champ.registration_closes_at then
      raise exception 'REGISTRATION_CLOSED';
    end if;
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
