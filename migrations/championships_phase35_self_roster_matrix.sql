-- ============================================================================
-- Campeonatos · Fase 35 — Reconciliación de la matriz SELF de roster (Host nunca SELF; ampliar join team)
-- ============================================================================
-- Cambios MÍNIMOS sobre las vías SELF, sin tocar gestión de terceros (add_player/move/remove), equipos
-- (create/edit/delete), resultados, fixture, goals ni lifecycle. Reglas FINALES:
--   · HOST (host_user_id = actor) → NUNCA se inscribe como jugador (join team / join sin equipo / cambiar /
--     salir), AUNQUE además sea owner (el rol Host tiene prioridad para SELF). Conserva TODO lo operativo
--     (crear/editar/borrar equipos, add_player/move de terceros).
--   · OWNER → join a un EQUIPO en RO/RC/PRE-LIVE/LIVE. join SIN equipo solo RO. leave solo RO.
--   · PLAYER normal → join/cambiar EQUIPO en RO/RC/PRE-LIVE (NO LIVE). join SIN equipo solo RO. leave solo RO.
--
-- 4 funciones tocadas:
--   1) _champ_can_manage_roster: la acción 'self' se separa de 'move_player' y EXCLUYE al host puro (owner sí).
--   2) join_championship_team: bloquea host puro; ventana RO/RC/PRE (todos) + LIVE (solo owner) + pending-owner.
--   3) join_championship_without_team: bloquea host puro (resto igual: RO / pending-owner).
--   4) leave_championship: bloquea host puro (resto igual: RO / pending-owner).
-- No se reescribe manage_championship_player: el bloqueo de su SELF de host lo aplica el helper (acción 'self').
-- ============================================================================

-- ── 1) _champ_can_manage_roster — 'self' separado de 'move_player'; host puro NO hace self (BASE: Fase 33) ──
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
          when c.status = 'in_progress' and c.live_started_at is not null then 'in_progress_live'
          when c.status = 'in_progress'                                    then 'in_progress_prelive'
          else c.status
        end;

  -- add_player (tercero nuevo): host o AlGrass; owner NUNCA. RO/RC/PRE/LIVE. (Fase 29)
  if p_action = 'add_player' then
    return (v_host or v_algrass)
       and ph in ('registration_open','registration_closed','in_progress_prelive','in_progress_live');
  end if;

  -- SELF administrativo: SOLO owner que NO sea Host. El Host NUNCA se auto-inscribe, aunque además sea owner
  -- y/o AlGrass (el rol Host tiene prioridad). Se evalúa ANTES de la rama genérica de AlGrass para que un
  -- actor Host+AlGrass no obtenga self=true por esa vía. Owner-no-Host: RO/RC/PRE/LIVE (+PP).
  if p_action = 'self' then
    return v_owner and not v_host
       and ph in ('pending_publish','registration_open','registration_closed','in_progress_prelive','in_progress_live');
  end if;

  -- AlGrass: todas las operativas + completed (resto de acciones: create/edit/delete/move). [IDÉNTICO a fases previas.]
  if v_algrass then
    return ph in ('pending_publish','registration_open','registration_closed','in_progress_prelive','in_progress_live','completed');
  end if;

  -- Owner/Host.
  if p_action = 'create_team' or p_action = 'delete_team' then
    return ph in ('pending_publish','registration_open','registration_closed');
  elsif p_action = 'edit_team' then
    return ph in ('pending_publish','registration_open','registration_closed','in_progress_prelive','in_progress_live');   -- Fase 33
  elsif p_action = 'move_player' then
    -- Gestión de TERCEROS inscritos: owner/host. (Sin cambios.)
    return ph in ('pending_publish','registration_open','registration_closed','in_progress_prelive','in_progress_live');
  else
    return false;
  end if;
end; $$;
revoke all on function public._champ_can_manage_roster(uuid, uuid, text) from public, anon;
grant execute on function public._champ_can_manage_roster(uuid, uuid, text) to authenticated;


-- ── 2) join_championship_team — SELF a un EQUIPO: host puro NUNCA; ventana ampliada ──────────────────
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
  -- closes_at solo cierra la ventana de registration_open (RC/PRE ya no dependen de closes_at).
  if v_champ.status = 'registration_open'
     and v_champ.registration_closes_at is not null and now() >= v_champ.registration_closes_at then
    raise exception 'REGISTRATION_CLOSED';
  end if;
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


-- ── 3) join_championship_without_team — SIN equipo: host puro NUNCA (resto igual: RO / pending-owner) ──
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
  if v_champ.status = 'registration_open'
     and v_champ.registration_closes_at is not null and now() >= v_champ.registration_closes_at then
    raise exception 'REGISTRATION_CLOSED';
  end if;

  insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, v_actor, null)
  on conflict (championship_id, user_id) do update set team_id = null;

  return jsonb_build_object('championship_id', p_championship_id, 'team_id', null);
end; $$;
revoke all on function public.join_championship_without_team(uuid) from public, anon;
grant execute on function public.join_championship_without_team(uuid) to authenticated;


-- ── 4) leave_championship — salir: host puro NUNCA (resto igual: RO / pending-owner) ─────────────────
create or replace function public.leave_championship(p_championship_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_is_owner boolean;
  v_is_host  boolean;
  v_deleted int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  v_is_owner := (v_champ.owner_user_id = v_actor);
  v_is_host  := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  if v_is_host then raise exception 'NOT_AUTHORIZED'; end if;   -- Host NUNCA (aunque sea owner)

  -- registration_open (cualquiera) o pending_publish (SOLO owner). Congelado desde registration_closed.
  if not (v_champ.status = 'registration_open'
          or (v_champ.status = 'pending_publish' and v_is_owner)) then
    raise exception 'NOT_OPEN';
  end if;

  delete from public.championship_players
   where championship_id = p_championship_id and user_id = v_actor;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('left', v_deleted > 0);
end; $$;
revoke all on function public.leave_championship(uuid) from public, anon;
grant execute on function public.leave_championship(uuid) to authenticated;
