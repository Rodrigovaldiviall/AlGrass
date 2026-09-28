-- ============================================================================
-- Campeonatos · Fase 31 — Asignar/cambiar el EQUIPO de un lado del partido (llave) [PROPUESTA — NO EJECUTAR AÚN]
-- ============================================================================
-- No existía escritura de participantes del fixture: save_championship_match_result (Fase 24) solo escribe
-- marcador + goleadores; home_team_id/away_team_id no tenían RPC. Se añade la MÍNIMA RPC compartida (App/Admin)
-- para asignar o cambiar el equipo de UN lado (home|away) de un partido de la llave.
--
-- Autoridad REUTILIZADA: _champ_can_manage_results (Fase 24) para el ROL (host/AlGrass; owner/player nunca),
-- MÁS un guard de fase estricto status='in_progress' para que la VENTANA sea exactamente PRE-LIVE + LIVE:
--   HOST    → in_progress (PRE-LIVE y LIVE)
--   ALGRASS → in_progress (PRE-LIVE y LIVE)  ← NO completed para ESTA acción (el guard lo excluye).
--   OWNER / PLAYER → nunca.  RO/RC/pending_publish/completed/canceled → INVALID_PHASE.
-- (No se crea helper nuevo ni se asume permiso de owner.)
--
-- Solapamiento (mismo equipo en 2 partidos a la misma hora): NO existe validación en el backend actual
-- (los CHECK de championship_matches son por-partido: distinct_teams/score_pair/qualified_in_pair). Esta RPC
-- NO la introduce (fuera de alcance): rellena el slot del match indicado, nada más.
--
-- Protección: NO se cambia un equipo si el partido ya está "concluido" — tiene marcador, goleadores o
-- qualified_team_id. Así no se huérfanan resultados/goles y NO se toca qualified_team_id (solo se bloquea si
-- está puesto). Espejo del CHECK de la tabla: nunca el mismo equipo en ambos lados; el equipo debe pertenecer al
-- campeonato. TEAM_TIME_OVERLAP: el equipo no puede quedar en dos partidos que se solapan en horario el mismo
-- día (criterio de intervalos [start, start+dur); fecha vía games.date_key) — misma regla en App y Admin.
-- p_updated_at = testigo de concurrencia (CONCURRENT_UPDATE), igual que save_championship_match_result.
-- NO toca marcador, goles, roster, standings, lifecycle ni crea/renombra/elimina equipos.
-- ============================================================================

create or replace function public.set_championship_match_team(
  p_match_id   uuid,
  p_side       text,          -- 'home' | 'away'
  p_team_id    uuid,          -- equipo a asignar (debe pertenecer al campeonato)
  p_updated_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_m     public.championship_matches%rowtype;
  v_other uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_side not in ('home','away') then raise exception 'INVALID_INPUT'; end if;
  if p_team_id is null then raise exception 'INVALID_INPUT'; end if;

  -- FOR UPDATE: dos ediciones del mismo partido se serializan; la 2.ª ve updated_at cambiado (no pisa).
  select * into v_m from public.championship_matches where id = p_match_id for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;

  if p_updated_at is not null and v_m.updated_at is distinct from p_updated_at then
    raise exception 'CONCURRENT_UPDATE';
  end if;
  -- Misma lock key que roster/resultados del mismo campeonato → serializa todas las mutaciones que compiten.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || v_m.championship_id::text)::bigint);

  if not public._champ_can_manage_results(v_m.championship_id, v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  -- Ventana ESTRICTA: solo con el campeonato in_progress (PRE-LIVE o LIVE). Excluye completed incluso para
  -- AlGrass (para ESTA acción), y RO/RC/pending_publish/canceled. La superficie de llave editable es in_progress.
  if not exists (select 1 from public.championships
                  where id = v_m.championship_id and status = 'in_progress') then
    raise exception 'INVALID_PHASE';
  end if;

  -- Partido "concluido" (marcador, goleadores o clasificado) → protegido, no se cambia el equipo.
  if v_m.home_score is not null or v_m.away_score is not null
     or v_m.qualified_team_id is not null
     or exists (select 1 from public.championship_goals where match_id = p_match_id) then
    raise exception 'MATCH_HAS_RESULT';
  end if;

  -- El equipo debe pertenecer a ESTE campeonato.
  if not exists (select 1 from public.championship_teams
                  where id = p_team_id and championship_id = v_m.championship_id) then
    raise exception 'TEAM_NOT_FOUND';
  end if;

  -- Nunca el mismo equipo en ambos lados (espejo del CHECK de la tabla).
  v_other := case when p_side = 'home' then v_m.away_team_id else v_m.home_team_id end;
  if v_other is not null and v_other = p_team_id then raise exception 'SAME_TEAM'; end if;

  -- SOLAPAMIENTO DE HORARIO: el equipo NO puede jugar dos partidos que se solapan en el tiempo el MISMO día.
  -- Criterio estándar de intervalos [start_time, start_time + duration_min): dos partidos se solapan si
  --   s1 < s2 + d2  AND  s2 < s1 + d1.  La fecha viene del game vinculado (games.date_key). Se comparan SOLO
  -- partidos programados (game_id con date_key, start_time y duration_min presentes) del MISMO campeonato,
  -- distintos del que se edita, donde el equipo ya esté en home o away. App y Admin deben coincidir en estos
  -- mismos casos. Si el partido editado no está programado (sin game/fecha/hora), no hay solape que evaluar.
  if exists (
    select 1
      from public.championship_matches m2
      join public.games g2 on g2.id = m2.game_id
      join public.games g1 on g1.id = v_m.game_id
     where m2.championship_id = v_m.championship_id
       and m2.id <> v_m.id
       and (m2.home_team_id = p_team_id or m2.away_team_id = p_team_id)
       and g1.date_key = g2.date_key
       and v_m.start_time is not null and v_m.duration_min is not null
       and m2.start_time is not null and m2.duration_min is not null
       and v_m.start_time < (m2.start_time + make_interval(mins => m2.duration_min))
       and m2.start_time < (v_m.start_time + make_interval(mins => v_m.duration_min))
  ) then
    raise exception 'TEAM_TIME_OVERLAP';
  end if;

  if p_side = 'home' then
    update public.championship_matches set home_team_id = p_team_id, updated_at = now() where id = p_match_id;
  else
    update public.championship_matches set away_team_id = p_team_id, updated_at = now() where id = p_match_id;
  end if;

  select * into v_m from public.championship_matches where id = p_match_id;
  return jsonb_build_object(
    'match_id', p_match_id, 'home_team_id', v_m.home_team_id, 'away_team_id', v_m.away_team_id,
    'updated_at', v_m.updated_at
  );
end; $$;
revoke all on function public.set_championship_match_team(uuid, text, uuid, timestamptz) from public, anon;
grant execute on function public.set_championship_match_team(uuid, text, uuid, timestamptz) to authenticated;

comment on function public.set_championship_match_team(uuid, text, uuid, timestamptz) is
  'Asigna/cambia el equipo de un lado (home|away) de un partido de la llave. Autoriza con _champ_can_manage_results (host in_progress; AlGrass in_progress+completed; owner/player nunca). Bloquea si el partido ya tiene marcador, goles o qualified_team_id. No mismo equipo en ambos lados; el equipo debe ser del campeonato. No toca marcador/goles/roster/standings/lifecycle.';
