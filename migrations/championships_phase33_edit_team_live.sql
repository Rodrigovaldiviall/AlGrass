-- ============================================================================
-- Campeonatos · Fase 33 — edit_team permitido también en in_progress LIVE (owner/host)
-- ============================================================================
-- BASE: Fase 29 (versión vigente de _champ_can_manage_roster). ÚNICO cambio: la rama owner/host de 'edit_team'
-- ahora incluye in_progress_live además de in_progress_prelive. Así renombrar/editar equipo (save_championship_team,
-- vía v_can_edit) queda permitido durante TODO in_progress (PRE-LIVE y LIVE):
--   OWNER/HOST edit_team → pending_publish, registration_open, registration_closed, in_progress_prelive,
--                          in_progress_live.  completed / canceled / payment_validation → NO.
-- El resto de acciones (add_player, create_team, delete_team, move_player, self) y la rama genérica de AlGrass
-- quedan EXACTAMENTE como Fase 29. No toca roster/resultados/fixture/lifecycle ni Phase 31/32.
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

  -- Fase efectiva: in_progress se separa por live_started_at. Sin 'CAL' (registration_closed = RC a secas).
  -- fixture_published_at es histórico y NO decide permisos.
  ph := case
          when c.status = 'in_progress' and c.live_started_at is not null then 'in_progress_live'
          when c.status = 'in_progress'                                    then 'in_progress_prelive'
          else c.status
        end;

  -- add_player (agregar tercero NUEVO): host o AlGrass; owner NUNCA. Ventana ESTRICTA (Fase 29): RO, RC,
  -- PRE-LIVE, LIVE. Excluye pending_publish y completed para AMBOS roles. Se evalúa ANTES de la rama genérica.
  if p_action = 'add_player' then
    return (v_host or v_algrass)
       and ph in ('registration_open','registration_closed','in_progress_prelive','in_progress_live');
  end if;

  -- AlGrass: TODAS las fases operativas + completed, INCLUYENDO pending_publish (jamás payment_validation ni
  -- canceled). Aplica al RESTO de acciones (create/edit/delete/move/self). [IDÉNTICO a Fase 29.]
  if v_algrass then
    return ph in ('pending_publish','registration_open','registration_closed','in_progress_prelive','in_progress_live','completed');
  end if;

  -- Owner/Host. add_player ya se resolvió arriba (owner nunca).
  if p_action = 'create_team' or p_action = 'delete_team' then
    return ph in ('pending_publish','registration_open','registration_closed');
  elsif p_action = 'edit_team' then
    -- Fase 33: edit_team permitido durante TODO in_progress (PRE-LIVE y LIVE). completed/canceled/PV → NO.
    return ph in ('pending_publish','registration_open','registration_closed','in_progress_prelive','in_progress_live');
  elsif p_action = 'move_player' or p_action = 'self' then
    return ph in ('pending_publish','registration_open','registration_closed','in_progress_prelive','in_progress_live');
  else
    return false;
  end if;
end; $$;
revoke all on function public._champ_can_manage_roster(uuid, uuid, text) from public, anon;
grant execute on function public._champ_can_manage_roster(uuid, uuid, text) to authenticated;
