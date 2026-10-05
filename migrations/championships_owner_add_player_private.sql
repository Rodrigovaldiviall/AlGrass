-- ============================================================================
-- Campeonatos · El OWNER puede agregar jugadores en campeonatos PRIVADOS
-- ============================================================================
-- Hoy "add_player" (agregar un tercero nuevo al roster) lo permite SOLO host o
-- AlGrass; el owner nunca. Este cambio extiende ESA ÚNICA condición para que, en
-- campeonatos PRIVADOS, también pueda el OWNER/ORGANIZADOR (championship.owner_user_id,
-- quien contrató/pagó), con la MISMA ventana de fases que el host (RO/RC/PRE/LIVE).
--
-- NO crea rol nuevo, NO crea flujo nuevo, NO cambia ninguna otra acción del roster
-- (create/edit/delete/move/self siguen EXACTAMENTE igual), NO toca equipos,
-- inscripciones ni pagos, y NO afecta a campeonatos públicos (ahí el owner NO entra).
--
-- COPIA FIEL de la versión vigente (championships_phase35_self_roster_matrix.sql):
-- lo único que cambia es la rama `add_player`, que pasa de
--   (v_host or v_algrass)
-- a
--   (v_host or v_algrass or (v_owner and c.privacy = 'private'))
-- El resto del cuerpo es idéntico. Es el espejo backend del gate de frontend
-- (rosterWindows.canAdminAddNew). Idempotente (create or replace).
-- ============================================================================

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

  -- add_player (tercero nuevo): host o AlGrass; y ADEMÁS el owner en campeonatos PRIVADOS (mismo rango que
  -- el host: RO/RC/PRE/LIVE). En públicos el owner NO entra. (Fase 29 + owner-privado.)
  if p_action = 'add_player' then
    return (v_host or v_algrass or (v_owner and c.privacy = 'private'))
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

do $verify$
declare v_def text;
begin
  select pg_get_functiondef(to_regprocedure('public._champ_can_manage_roster(uuid, uuid, text)')) into v_def;
  if v_def is null then raise exception 'VERIFY: no existe _champ_can_manage_roster.'; end if;
  if v_def !~ 'v_host or v_algrass or \(v_owner and c\.privacy = ''private''\)' then
    raise exception 'VERIFY: add_player no admite al owner en privados.';
  end if;
  raise notice 'OK: add_player ahora permite host/AlGrass y, en privados, el owner (misma ventana RO/RC/PRE/LIVE). Resto de acciones intacto.';
end $verify$;
