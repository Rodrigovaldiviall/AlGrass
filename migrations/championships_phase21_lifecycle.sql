-- ============================================================================
-- Campeonatos · Fase 21 — Lifecycle funcional (in_progress PRE-LIVE / LIVE) + transiciones AlGrass
-- ============================================================================
-- Cambia el modelo: la superficie se decide por STATUS (registration_closed→Inscripciones;
-- in_progress/completed→Calendario y resultados). Dentro de in_progress, live_started_at distingue:
--   live_started_at IS NULL     → in_progress_prelive (Calendario, SIN antena "En vivo")
--   live_started_at IS NOT NULL → in_progress_live    (Calendario, CON antena "En vivo")
-- Se ELIMINA el pseudo-estado "CAL" (registration_closed + fixture_published_at) como gate; fixture_published_at
-- se conserva SOLO como histórico ("cuándo se publicó el calendario por primera vez").
--
-- Contenido (mínimo, reutiliza Phase 20):
--   (1) 1 columna nueva: championships.live_started_at.
--   (2) _champ_can_manage_roster reinterpretado (misma firma 3-args): fases IP_PRELIVE/IP_LIVE, sin CAL.
--   (3) set_championship_status: ÚNICA RPC de transición de fase, SOLO AlGrass, con grafo validado. No borra
--       datos (matches/goals/teams/players/reservation_games/games/scores/qualified_team_id intactos).
-- 0 tablas nuevas. save_championship_team / delete_championship_team / manage_championship_player NO cambian de
-- cuerpo (heredan las ventanas nuevas vía el helper). Ninguna limpieza automática de roster/fixture/resultados.
-- ============================================================================

-- ── 1) Columna nueva: marca de "en vivo" ─────────────────────────────────────
-- live_started_at: cuándo el campeonato entró EN VIVO. NULL = pre-live. Solo se setea/limpia por transición.
-- fixture_published_at (Phase 20) se mantiene como histórico; ya NO decide superficie ni permisos.
alter table public.championships add column if not exists live_started_at timestamptz;


-- ── 2) _champ_can_manage_roster — reinterpretado (IP_PRELIVE / IP_LIVE; sin CAL) ─────────────────────
-- Ventanas por acción (fases efectivas: PP=pending_publish, RO=registration_open, RC=registration_closed,
-- PRE=in_progress_prelive, LIVE=in_progress_live, CO=completed):
--   create_team : owner/host → PP,RO,RC             · AlGrass → RO,RC,PRE,LIVE,CO
--   delete_team : owner/host → PP,RO,RC             · AlGrass → RO,RC,PRE,LIVE,CO
--   edit_team   : owner/host → PP,RO,RC,PRE          · AlGrass → RO,RC,PRE,LIVE,CO
--   move_player : owner/host → PP,RO,RC,PRE,LIVE      · AlGrass → RO,RC,PRE,LIVE,CO
--   add_player  : host       → PP,RO,RC,PRE,LIVE      · AlGrass → RO,RC,PRE,LIVE,CO   (owner NUNCA)
--   self        : owner/host → PP,RO,RC,PRE,LIVE      · AlGrass → RO,RC,PRE,LIVE,CO
-- Player normal no pasa por aquí (read-only desde RC). Nunca payment_validation ni canceled.
-- (pending_publish para owner/AlGrass en create/edit/delete se conserva vía las excepciones inline de Phase 20.)
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
  ph := case
          when c.status = 'in_progress' and c.live_started_at is not null then 'in_progress_live'
          when c.status = 'in_progress'                                    then 'in_progress_prelive'
          else c.status
        end;

  -- AlGrass: TODAS las fases operativas + completed, INCLUYENDO pending_publish (jamás payment_validation ni
  -- canceled). Aplica a las 6 acciones (create/edit/delete/move/add/self). Las reglas propias de cada RPC
  -- siguen vigentes (p.ej. delete_team exige roster=0).
  if v_algrass then
    return ph in ('pending_publish','registration_open','registration_closed','in_progress_prelive','in_progress_live','completed');
  end if;

  -- Owner/Host (v_owner or v_host = true). "add_player" (agregar tercero nuevo) SOLO host.
  if p_action = 'add_player' then
    return v_host and ph in ('pending_publish','registration_open','registration_closed','in_progress_prelive','in_progress_live');
  elsif p_action = 'create_team' or p_action = 'delete_team' then
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


-- ── 3) set_championship_status — transición de fase (SOLO AlGrass), grafo validado, sin borrar datos ──
-- Targets explícitos: pending_publish, registration_open, registration_closed, in_progress_prelive,
-- in_progress_live, completed. in_progress_prelive/live mapean a status='in_progress' con/sin live_started_at.
-- NO toca championship_matches/goals/teams/players/reservation_games/games. Errores: AUTH_REQUIRED,
-- CHAMPIONSHIP_NOT_FOUND, NOT_AUTHORIZED, INVALID_INPUT, INVALID_TRANSITION.
create or replace function public.set_championship_status(
  p_championship_id uuid,
  p_target          text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_cur   text;   -- fase funcional actual
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  -- MISMA lock key que las mutaciones de roster → una transición no compite con create/move/etc. en curso.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- SOLO AlGrass staff/admin cambia fases (ni owner, ni host, ni player).
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  if p_target not in ('pending_publish','registration_open','registration_closed',
                      'in_progress_prelive','in_progress_live','completed') then
    raise exception 'INVALID_INPUT';
  end if;

  -- Fase funcional actual (in_progress desdoblado por live_started_at).
  v_cur := case
             when v_champ.status = 'in_progress' and v_champ.live_started_at is not null then 'in_progress_live'
             when v_champ.status = 'in_progress'                                          then 'in_progress_prelive'
             else v_champ.status
           end;

  -- ── Grafo de transiciones permitidas (cada rama aplica SOLO las marcas necesarias; nada más se toca) ──
  if    v_cur = 'pending_publish'     and p_target = 'registration_open' then
    update public.championships set status = 'registration_open',
           published_at = coalesce(published_at, now()) where id = p_championship_id;

  elsif v_cur = 'registration_open'   and p_target = 'pending_publish' then
    update public.championships set status = 'pending_publish' where id = p_championship_id;

  elsif v_cur = 'registration_open'   and p_target = 'registration_closed' then
    update public.championships set status = 'registration_closed' where id = p_championship_id;

  elsif v_cur = 'registration_closed' and p_target = 'registration_open' then
    update public.championships set status = 'registration_open' where id = p_championship_id;

  elsif v_cur = 'registration_closed' and p_target = 'in_progress_prelive' then
    -- Publicar calendario: entra en in_progress PRE-LIVE. fixture_published_at solo se fija la 1ª vez.
    update public.championships set status = 'in_progress',
           fixture_published_at = coalesce(fixture_published_at, now()),
           live_started_at = null where id = p_championship_id;

  elsif v_cur = 'in_progress_prelive' and p_target = 'registration_closed' then
    -- Volver a inscripciones cerradas. Conserva fixture_published_at (histórico). No borra nada.
    update public.championships set status = 'registration_closed',
           live_started_at = null where id = p_championship_id;

  elsif v_cur = 'in_progress_prelive' and p_target = 'in_progress_live' then
    update public.championships set status = 'in_progress',
           live_started_at = now() where id = p_championship_id;

  elsif v_cur = 'in_progress_live'    and p_target = 'in_progress_prelive' then
    update public.championships set status = 'in_progress',
           live_started_at = null where id = p_championship_id;

  elsif v_cur = 'in_progress_live'    and p_target = 'completed' then
    -- Finalizar. Conserva fixture_published_at y live_started_at (histórico intacto).
    update public.championships set status = 'completed' where id = p_championship_id;

  elsif v_cur = 'completed' and p_target = 'in_progress_live'    and v_champ.live_started_at is not null then
    -- Reabrir: el subestado viene del live_started_at CONSERVADO (no se inventa fecha nueva).
    update public.championships set status = 'in_progress' where id = p_championship_id;

  elsif v_cur = 'completed' and p_target = 'in_progress_prelive' and v_champ.live_started_at is null then
    update public.championships set status = 'in_progress' where id = p_championship_id;

  else
    raise exception 'INVALID_TRANSITION';
  end if;

  select * into v_champ from public.championships where id = p_championship_id;
  return jsonb_build_object(
    'id', v_champ.id,
    'status', v_champ.status,
    'live_started_at', v_champ.live_started_at,
    'fixture_published_at', v_champ.fixture_published_at,
    'phase', case
               when v_champ.status = 'in_progress' and v_champ.live_started_at is not null then 'in_progress_live'
               when v_champ.status = 'in_progress'                                          then 'in_progress_prelive'
               else v_champ.status
             end
  );
end; $$;
revoke all on function public.set_championship_status(uuid, text) from public, anon;
grant execute on function public.set_championship_status(uuid, text) to authenticated;


-- ── 4) Cerrar publish_championship al cliente: SOLO AlGrass cambia el lifecycle ──────────────────────
-- Regla definitiva: ninguna transición de fase la hace owner/host/player. publish_championship (Fase 5) hacía
-- pending_publish → registration_open desde el owner; esa vía queda superada por set_championship_status
-- (AlGrass-only). Se REVOCA su ejecución para authenticated. NO se dropea ni se cambia su cuerpo (queda
-- disponible para uso interno/administrativo futuro si se re-otorga explícitamente). set_championship_status
-- ya cubre pending_publish → registration_open gateado por _is_algrass_staff.
-- IMPLICANCIA (App): el botón "Publicar" del owner en ChampionshipView (publishChampionshipRpc) recibirá
-- permiso denegado; publicar pasa a ser acción de AlGrass. Ajustar esa UX en la fase de App correspondiente.
revoke execute on function public.publish_championship(uuid) from authenticated;
