-- ============================================================================
-- Campeonatos · Fase 17 — Congelar el roster del JUGADOR NORMAL desde registration_closed
-- ============================================================================
-- Regla de negocio: una vez CERRADAS las inscripciones el jugador queda comprometido y el roster deja de ser
-- dinámico. El jugador normal solo puede mutar su membership/equipo propio en registration_open (respetando
-- registration_closes_at) o en la excepción YA existente de pending_publish (SOLO el owner). Desde
-- registration_closed en adelante (registration_closed / in_progress / completed) NO puede: unirse a equipo,
-- cambiarse, salir, quedar sin equipo ni crear equipo.
--
-- ALCANCE (mínimo y atómico): SOLO se endurece el GATE DE ESTADO de las mutaciones SELF que hoy admitían
-- registration_closed. Todo lo demás (advisory lock, SET membership única, closes_at, errores, revoke/grant)
-- queda IDÉNTICO. NO se crean RPCs nuevas, NO se da override al owner/pagador, NO se tocan las RPCs de AlGrass
-- (aún no existen para roster ajeno), NI fixture_published_at, NI competición/resultados/goles/fixture.
--
-- Solo DOS funciones cambian:
--   · join_championship_team   — antes permitía registration_open/closed (cualquiera); ahora solo open.
--   · leave_championship       — antes permitía registration_open/closed (cualquiera); ahora solo open.
-- Las otras dos que la fase menciona YA cumplen la regla y NO se reescriben:
--   · join_championship_without_team — ya exigía registration_open o pending-owner (phase12: "En closed no aplica").
--   · save_championship_team (CREATE) — ya exigía registration_open o pending (owner/AlGrass); closed nunca creó.
-- ============================================================================

-- ── join_championship_team — unirse/cambiar a un team EXISTENTE ──────────────────────────────────────
-- CAMBIO: gate de estado. ANTES: status in ('registration_open','registration_closed') o pending-owner.
--         AHORA: status = 'registration_open' o pending-owner. (registration_closed ya no permite mutar.)
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
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  -- registration_open (cualquiera) o pending_publish (SOLO owner). Roster CONGELADO desde registration_closed.
  if not (v_champ.status = 'registration_open'
          or (v_champ.status = 'pending_publish' and v_champ.owner_user_id = v_actor)) then
    raise exception 'NOT_OPEN';
  end if;
  if v_champ.status = 'registration_open'
     and v_champ.registration_closes_at is not null and now() >= v_champ.registration_closes_at then
    raise exception 'REGISTRATION_CLOSED';
  end if;
  if not exists (select 1 from public.championship_teams where id = p_team_id and championship_id = p_championship_id) then
    raise exception 'TEAM_NOT_FOUND';
  end if;

  -- SET membership (una sola fila por UNIQUE): sin fila → INSERT; con fila → UPDATE al nuevo team.
  insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, v_actor, p_team_id)
  on conflict (championship_id, user_id) do update set team_id = excluded.team_id;

  return jsonb_build_object('championship_id', p_championship_id, 'team_id', p_team_id);
end; $$;
revoke all on function public.join_championship_team(uuid, uuid) from public, anon;
grant execute on function public.join_championship_team(uuid, uuid) to authenticated;


-- ── leave_championship — salir/desinscribirse (DELETE de la membership del actor) ────────────────────
-- CAMBIO: gate de estado. ANTES: status in ('registration_open','registration_closed') o pending-owner.
--         AHORA: status = 'registration_open' o pending-owner. (No se puede salir una vez cerradas.)
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
