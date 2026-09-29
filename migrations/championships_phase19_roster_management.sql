-- ============================================================================
-- Campeonatos · Fase 19 — Gestión ADMINISTRATIVA de roster (owner / host / AlGrass)
-- ============================================================================
-- Separa dos capacidades: ROSTER/EQUIPOS (esta fase) vs RESULTADOS (fase futura, helper aparte). Añade:
--   (1) _champ_can_manage_roster(champ, actor) → única autoridad server-side de roster.
--   (2) manage_championship_player(...) → única primitiva para mutar membership de TERCEROS (agregar/mover/
--       asignar/sacar/eliminar), autorizada por (1). NO toca las RPCs SELF (join/leave/sin-equipo).
--   (3) Ampliación de save_championship_team y delete_championship_team para admitir la vía administrativa,
--       conservando intactos los caminos del jugador normal y las excepciones de pending_publish.
--
-- Ventana operativa de roster:
--   owner/host → registration_open, registration_closed, in_progress.
--   AlGrass    → + completed.
--   Nadie      → payment_validation, pending_publish, canceled  (pending_publish conserva sus excepciones
--                inline actuales en save/delete: owner/AlGrass; el host NO gana permisos ahí).
--
-- Autorización 100% server-side: auth.uid() + owner_user_id + host_user_id + _is_algrass_staff + status.
-- NO crea tablas. NO cambia la SEMÁNTICA de join_championship_team / join_championship_without_team.
-- NO toca resultados/championship_matches/championship_goals/fixture.
--
-- (5) Endurecimiento de CONCURRENCIA: leave_championship es la ÚNICA mutación SELF de championship_players que
--     no tomaba la advisory lock 'champ_reg:<id>' (join_team y join_without_team ya la tomaban). Se re-emite
--     leave_championship AÑADIENDO SOLO esa lock —misma key que join/save/delete/manage_championship_player—
--     para serializar todas las mutaciones de roster que compiten entre sí. NO cambia gate/status/firma/semántica.
-- ============================================================================

-- ── 1) _champ_can_manage_roster — autoridad ÚNICA de gestión de roster ───────────────────────────────
-- true si el actor puede gestionar roster/equipos en el estado ACTUAL del campeonato. Asume que el campeonato
-- existe (el caller valida y lanza CHAMPIONSHIP_NOT_FOUND). Precedencia AND>OR resuelta con paréntesis.
create or replace function public._champ_can_manage_roster(p_championship_id uuid, p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when p_actor is null then false else exists (
    select 1 from public.championships c
     where c.id = p_championship_id
       and (
         -- AlGrass staff/admin: ventana operativa + completed (corrección histórica). Nunca canceled/pending.
         (public._is_algrass_staff(p_actor)
            and c.status in ('registration_open', 'registration_closed', 'in_progress', 'completed'))
         or
         -- Owner o host del campeonato: ventana operativa (sin completed, sin pending_publish, sin canceled).
         ((c.owner_user_id = p_actor or c.host_user_id = p_actor)
            and c.status in ('registration_open', 'registration_closed', 'in_progress'))
       )
  ) end;
$$;
revoke all on function public._champ_can_manage_roster(uuid, uuid) from public, anon;
grant execute on function public._champ_can_manage_roster(uuid, uuid) to authenticated;


-- ── 2) manage_championship_player — mutación ADMINISTRATIVA de membership de terceros ────────────────
-- Cubre agregar / agregar-sin-equipo / asignar / mover / sacar-a-sin-equipo / eliminar, en UNA sola RPC.
--   p_remove = true                 → elimina la membership (idempotente: si no existía, removed=false).
--   p_remove = false, p_team_id NULL→ upsert membership con team_id NULL (sin equipo).
--   p_remove = false, p_team_id X   → upsert membership asignada al team X.
-- El objetivo es p_user_id (NO el actor). El actor (auth.uid()) es quien se autoriza. NO altera las RPCs SELF.
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
  v_deleted    int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  -- MISMA lock key que las operaciones SELF (join/leave) → serializa jugador↔admin y admin↔admin.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- Autorización server-side con política de dos códigos: NOT_AUTHORIZED si el actor no es owner/host/AlGrass;
  -- NOT_OPEN si es privilegiado pero el status está fuera de su ventana (owner/host: open/closed/in_progress;
  -- AlGrass: + completed). Nadie en payment_validation/pending_publish/canceled.
  v_is_algrass := public._is_algrass_staff(v_actor);
  v_is_owner   := (v_champ.owner_user_id = v_actor);
  v_is_host    := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  if not (v_is_algrass or v_is_owner or v_is_host) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if not public._champ_can_manage_roster(p_championship_id, v_actor) then
    raise exception 'NOT_OPEN';
  end if;

  -- Objetivo: usuario REAL de la app. championship_players.user_id no tiene FK (ref. lógica) → validación
  -- explícita en users_public (mismo mirror usado para display). Sin invitaciones externas.
  if p_user_id is null
     or not exists (select 1 from public.users_public where id = p_user_id) then
    raise exception 'INVALID_INPUT';
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

  -- UPSERT sobre UNIQUE(championship_id, user_id): sin fila → INSERT; con fila → mueve/deja sin equipo.
  insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, p_user_id, p_team_id)
  on conflict (championship_id, user_id) do update set team_id = excluded.team_id;

  return jsonb_build_object('championship_id', p_championship_id, 'user_id', p_user_id,
                            'team_id', p_team_id, 'removed', false);
end; $$;
revoke all on function public.manage_championship_player(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.manage_championship_player(uuid, uuid, uuid, boolean) to authenticated;


-- ── 3) save_championship_team — se AMPLÍA con la vía administrativa (owner/host/AlGrass) ─────────────
-- Conserva: CREATE self-service en open (cualquiera autenticado) + excepción owner/AlGrass en pending_publish;
-- UPDATE full por capitán/equipo-vacío en open; RENAME admin (owner/AlGrass) en pending/open/closed.
-- Añade: owner/host/AlGrass hacen create/edit COMPLETO en su ventana (open/closed/in_progress; AlGrass +completed).
-- registration_closes_at cierra SOLO la vía NO administrativa (self-service/capitán), nunca la administrativa.
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
  v_can_manage boolean;   -- owner/host/AlGrass en ventana operativa (Fase 19)
  v_is_creator boolean;
  v_creator_priv boolean;
  v_captain    uuid;
  v_is_captain boolean;
  v_can_full   boolean;
  v_can_rename boolean;
  v_cap int; v_count int; v_team_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_name is null then raise exception 'INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  v_is_owner   := (v_champ.owner_user_id = v_actor);
  v_is_algrass := public._is_algrass_staff(v_actor);
  v_can_manage := public._champ_can_manage_roster(p_championship_id, v_actor);

  if p_team_id is null then
    -- ── CREATE ── administrativa (owner/host/AlGrass) o self-service en open o excepción owner/AlGrass pending.
    if not (v_can_manage
            or v_champ.status = 'registration_open'
            or (v_champ.status = 'pending_publish' and (v_is_owner or v_is_algrass))) then
      raise exception 'NOT_OPEN';
    end if;
    -- closes_at cierra SOLO la vía self-service en open (la administrativa no se ve afectada).
    if not v_can_manage
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

  -- Equipo VACÍO: FULL edit por SU creador (si es jugador normal) o owner/AlGrass; nunca un tercero cualquiera
  -- (endurecido vs Phase 11, que permitía "cualquiera"). Con jugadores → SOLO el capitán. owner/host/AlGrass
  -- en ventana pasan aparte por v_can_manage.
  v_can_full   := (v_count = 0 and ((v_is_creator and not v_creator_priv) or v_is_owner or v_is_algrass))
                  or (v_count >= 1 and v_is_captain);
  v_can_rename := (v_is_owner or v_is_algrass);
  -- Gestor administrativo (owner/host/AlGrass en ventana) → edición COMPLETA; se conservan capitán y rename.
  if not (v_can_manage or v_can_full or v_can_rename) then raise exception 'NOT_AUTHORIZED'; end if;

  if v_can_manage
     or (v_can_full and (v_champ.status = 'registration_open'
                         or (v_champ.status = 'pending_publish' and (v_is_owner or v_is_algrass)))) then
    -- Edición COMPLETA. closes_at cierra la vía NO administrativa en open.
    if not v_can_manage
       and v_champ.status = 'registration_open'
       and v_champ.registration_closes_at is not null and now() >= v_champ.registration_closes_at then
      raise exception 'REGISTRATION_CLOSED';
    end if;
    update public.championship_teams
       set name = v_name, color = v_color, design = v_design, updated_at = now()
     where id = p_team_id;
  elsif v_can_rename
     and v_champ.status in ('pending_publish', 'registration_open', 'registration_closed') then
    -- RENAME administrativo (owner/AlGrass): SOLO nombre. (Mayormente subsumido por v_can_manage en su ventana.)
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


-- ── 4) delete_championship_team — se AMPLÍA con la vía administrativa ────────────────────────────────
-- Conserva: roster ACTUAL = 0 (TEAM_HAS_PLAYERS); pending/closed → owner/AlGrass; open → creador normal salvo
-- estructura privilegiada. Añade: owner/host/AlGrass borran en su ventana (incl. in_progress; AlGrass +completed).
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
  v_can_manage boolean;   -- owner/host/AlGrass en ventana operativa (Fase 19)
  v_creator_priv boolean;
  v_count int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  v_can_manage := public._champ_can_manage_roster(p_championship_id, v_actor);
  -- Estado permitido: caminos pre-publicación/self (pending/open/closed) o vía administrativa (helper).
  if not (v_champ.status in ('pending_publish', 'registration_open', 'registration_closed')
          or v_can_manage) then
    raise exception 'NOT_OPEN';
  end if;

  select * into v_team from public.championship_teams
   where id = p_team_id and championship_id = p_championship_id for update;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;

  -- Borrable SOLO con roster ACTUAL = 0, recontado BAJO LOCK.
  select count(*) into v_count from public.championship_players where team_id = p_team_id;
  if v_count > 0 then raise exception 'TEAM_HAS_PLAYERS'; end if;

  v_is_owner   := (v_champ.owner_user_id = v_actor);
  v_is_algrass := public._is_algrass_staff(v_actor);
  v_creator_priv := (v_team.created_by_user_id = v_champ.owner_user_id)
                    or public._is_algrass_staff(v_team.created_by_user_id);

  -- Autorización: gestor administrativo (owner/host/AlGrass en ventana) pasa directo; si no, reglas actuales
  -- por estado (pending/closed → owner/AlGrass; open → creador normal salvo estructura privilegiada).
  if v_can_manage then
    null;
  elsif v_champ.status in ('pending_publish', 'registration_closed') then
    if not (v_is_owner or v_is_algrass) then raise exception 'NOT_AUTHORIZED'; end if;
  elsif v_champ.status = 'registration_open' then
    -- Equipo de jugador normal: SOLO su creador legítimo (endurecido vs Phase 11, que permitía "cualquiera");
    -- team privilegiado o de otro creador: solo owner/AlGrass. (owner/host/AlGrass en ventana ya pasaron por
    -- v_can_manage y no llegan aquí.)
    if not ((v_team.created_by_user_id = v_actor and not v_creator_priv) or v_is_owner or v_is_algrass) then
      raise exception 'NOT_AUTHORIZED';
    end if;
  end if;

  delete from public.championship_teams where id = p_team_id;
  return jsonb_build_object('deleted', true);
end; $$;
revoke all on function public.delete_championship_team(uuid, uuid) from public, anon;
grant execute on function public.delete_championship_team(uuid, uuid) to authenticated;


-- ── 5) leave_championship — SOLO añade la advisory lock (endurecimiento de concurrencia) ────────────
-- Cuerpo IDÉNTICO al vigente (Fase 17) salvo la línea `pg_advisory_xact_lock` tras AUTH_REQUIRED. Misma key
-- que join/save/delete/manage_championship_player → serializa el leave SELF frente a movimientos administrativos
-- del mismo jugador. NO cambia gate/status/firma/semántica/permisos (sigue SELF sobre auth.uid()).
create or replace function public.leave_championship(p_championship_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_deleted int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  -- registration_open (cualquiera) o pending_publish (SOLO owner). Roster CONGELADO desde registration_closed.
  if not (v_champ.status = 'registration_open'
          or (v_champ.status = 'pending_publish' and v_champ.owner_user_id = v_actor)) then
    raise exception 'NOT_OPEN';
  end if;

  delete from public.championship_players
   where championship_id = p_championship_id and user_id = v_actor;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('left', v_deleted > 0);
end; $$;
revoke all on function public.leave_championship(uuid) from public, anon;
grant execute on function public.leave_championship(uuid) to authenticated;
