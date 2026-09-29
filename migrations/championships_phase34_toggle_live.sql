-- ============================================================================
-- Campeonatos · Fase 34 — toggle_championship_live: Host activa/desactiva EN VIVO (PRE-LIVE ↔ LIVE)
-- ============================================================================
-- set_championship_status (Fase 21) es AlGrass-only y maneja TODO el grafo de lifecycle. Extenderlo para el Host
-- abriría demasiado (podría tocar completar/reabrir/inscripciones). En su lugar, RPC MÍNIMA y específica que SOLO
-- alterna el sub-estado en vivo dentro de in_progress:
--   p_live = true  → status='in_progress', live_started_at = now()   (PRE-LIVE → LIVE)
--   p_live = false → status='in_progress', live_started_at = null    (LIVE → PRE-LIVE)
--
-- Autorización: HOST (championships.host_user_id) o AlGrass staff. Owner puro y jugador → NO. El campeonato DEBE
-- estar en in_progress (si está en otro estado → INVALID_PHASE); así el Host NUNCA abre/cierra inscripciones,
-- completa, cancela ni vuelve a pending_publish. NO toca status base (queda 'in_progress'), ni roster, fixture,
-- resultados, goals, matches. AlGrass conserva además set_championship_status intacto (no se reduce nada).
-- ============================================================================

create or replace function public.toggle_championship_live(
  p_championship_id uuid,
  p_live            boolean
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_live is null then raise exception 'INVALID_INPUT'; end if;
  -- Misma lock key que roster/resultados/transiciones → no compite con otras mutaciones del campeonato.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- Solo HOST asignado o AlGrass. Owner puro / jugador → NO.
  if not ((v_champ.host_user_id is not null and v_champ.host_user_id = v_actor)
          or public._is_algrass_staff(v_actor)) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- Solo dentro de in_progress: el toggle NO cambia el estado base ni cruza a otras fases.
  if v_champ.status <> 'in_progress' then raise exception 'INVALID_PHASE'; end if;

  update public.championships
     set live_started_at = case when p_live then now() else null end
   where id = p_championship_id
  returning * into v_champ;

  return jsonb_build_object(
    'id', v_champ.id,
    'status', v_champ.status,
    'live_started_at', v_champ.live_started_at,
    'phase', case when v_champ.live_started_at is not null then 'in_progress_live' else 'in_progress_prelive' end
  );
end; $$;
revoke all on function public.toggle_championship_live(uuid, boolean) from public, anon;
grant execute on function public.toggle_championship_live(uuid, boolean) to authenticated;

comment on function public.toggle_championship_live(uuid, boolean) is
  'Host/AlGrass alterna EN VIVO (live_started_at) dentro de in_progress: p_live true → now(), false → null. Owner puro/jugador NO. Fuera de in_progress → INVALID_PHASE. No cambia status base ni toca roster/fixture/resultados/lifecycle general.';
