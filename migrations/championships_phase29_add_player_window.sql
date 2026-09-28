-- ============================================================================
-- Campeonatos · Fase 29 — Ventana definitiva de "agregar jugador NUEVO" (add_player)
-- ============================================================================
-- BASE: Fase 21 (versión VIGENTE de _champ_can_manage_roster). NO se usa la base de Fase 20 (obsoleta: usaba el
-- pseudo-estado 'CAL'/fixture_published_at como gate, ya eliminado). Aquí fixture_published_at NO gobierna
-- permisos: in_progress se desdobla por live_started_at (in_progress_prelive / in_progress_live).
--
-- ÚNICO cambio respecto de Fase 21: la rama 'add_player'. La operación de escritura sigue siendo
-- manage_championship_player (Fase 20) — NO se crea RPC nueva. add_player = actor Host/AlGrass agrega un
-- usuario existente NO inscrito, con membership DIRECTA a team_id (no un tercero cualquiera).
--
-- Regla acordada para add_player (más estricta que Fase 21):
--   HOST    → registration_open, registration_closed, in_progress_prelive (PRE-LIVE), in_progress_live (LIVE)
--   ALGRASS → misma ventana que host para add_player
--   → EXCLUYE pending_publish y completed para AMBOS (antes: host incluía PP; AlGrass heredaba PP+completed).
--   OWNER → nunca · jugador normal → nunca.
-- El RESTO de acciones (create/edit/delete/move/self) y la matriz AlGrass general quedan EXACTAMENTE como Fase 21.
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
  -- PRE-LIVE, LIVE. Excluye pending_publish y completed para AMBOS roles. Se evalúa ANTES de la rama genérica
  -- de AlGrass para no heredar su ventana más amplia (PP/completed).
  if p_action = 'add_player' then
    return (v_host or v_algrass)
       and ph in ('registration_open','registration_closed','in_progress_prelive','in_progress_live');
  end if;

  -- AlGrass: TODAS las fases operativas + completed, INCLUYENDO pending_publish (jamás payment_validation ni
  -- canceled). Aplica al RESTO de acciones (create/edit/delete/move/self). Las reglas propias de cada RPC
  -- siguen vigentes (p.ej. delete_team exige roster=0). [IDÉNTICO a Fase 21.]
  if v_algrass then
    return ph in ('pending_publish','registration_open','registration_closed','in_progress_prelive','in_progress_live','completed');
  end if;

  -- Owner/Host (v_owner or v_host = true). add_player ya se resolvió arriba (owner nunca; host solo la ventana
  -- estricta). [Resto IDÉNTICO a Fase 21.]
  if p_action = 'create_team' or p_action = 'delete_team' then
    return ph in ('pending_publish','registration_open','registration_closed');
  elsif p_action = 'edit_team' then
    return ph in ('pending_publish','registration_open','registration_closed','in_progress_prelive');
  elsif p_action = 'move_player' or p_action = 'self' then
    return ph in ('pending_publish','registration_open','registration_closed','in_progress_prelive','in_progress_live');
  else
    return false;
  end if;
end; $$;
revoke all on function public._champ_can_manage_roster(uuid, uuid, text) from public, anon;
grant execute on function public._champ_can_manage_roster(uuid, uuid, text) to authenticated;
