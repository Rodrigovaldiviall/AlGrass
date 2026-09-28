-- ============================================================================
-- Campeonatos · Fase 24 — Escritura de RESULTADO de un partido (marcador + goleadores) por Host/AlGrass
-- ============================================================================
-- No existía backend de escritura de resultados (championship_matches/goals están cerradas al cliente). Se añade:
--   (1) _champ_can_manage_results — helper SEPARADO del de roster (owner NUNCA edita resultados).
--   (2) save_championship_match_result — guarda marcador + goleadores en UNA transacción.
--
-- Matriz de permisos (resultados):
--   HOST    → in_progress (PRE-LIVE y LIVE)  · NO completed
--   ALGRASS → in_progress + completed (correcciones históricas)
--   OWNER / PLAYER → nunca.  RC / antes de calendario → nunca (no es in_progress).
--
-- El marcador es la fuente del resultado; los goleadores son información ADICIONAL: su suma NO tiene que
-- igualar el marcador (goles de autor no identificado quedan sin atribuir). NO crea end_time, ni tablas, ni
-- "jugador desconocido". NO toca fixture (equipos/cancha/hora/duración/stage/group/order): eso es Admin.
-- ============================================================================

-- ── 1) _champ_can_manage_results — autoridad de edición de resultados (distinta de roster) ───────────
create or replace function public._champ_can_manage_results(p_championship_id uuid, p_actor uuid)
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
         (public._is_algrass_staff(p_actor) and c.status in ('in_progress', 'completed'))
         or (c.host_user_id is not null and c.host_user_id = p_actor and c.status = 'in_progress')
       )
  ) end;
$$;
-- Helper INTERNO: no ejecutable directamente por authenticated. Solo lo invocan las RPCs SECURITY DEFINER que
-- lo usan (p. ej. save_championship_match_result), que corren con el privilegio del owner de la función.
revoke all on function public._champ_can_manage_results(uuid, uuid) from public, anon, authenticated;


-- ── 2) save_championship_match_result — marcador + goleadores (transacción; reemplazo total de goles) ─
-- p_goals: jsonb array de { user_id, team_id, goals } (goals int > 0). El marcador y los goles se guardan
-- juntos; si algo falla, la transacción revierte (no queda marcador sin goles ni al revés).
--
-- ÚNICA RPC de escritura de resultados del producto: la llaman App y Admin. El Back Office NO tiene una
-- propia; su migración solo añade la LECTURA del detalle (get_admin_championship_match).
--
-- p_updated_at es el testigo de concurrencia: si viene informado y ya no coincide con el de la fila, otra
-- persona guardó en medio y se corta con CONCURRENT_UPDATE. Si viene null se permite, por compatibilidad
-- con quien todavía no lo manda.
--
-- Se DROPEA antes la firma de 4 argumentos: con las dos vivas, una llamada por nombre sin p_updated_at
-- sería ambigua y PostgREST no sabría cuál elegir. Una sola firma, y punto.
drop function if exists public.save_championship_match_result(uuid, int, int, jsonb);

create or replace function public.save_championship_match_result(
  p_match_id   uuid,
  p_home_score int,
  p_away_score int,
  p_goals      jsonb default '[]'::jsonb,
  p_updated_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_m     public.championship_matches%rowtype;
  v_g     jsonb;
  v_uid   uuid;
  v_tid   uuid;
  v_goals int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  -- p_goals SIEMPRE forma de array JSON: null u otro tipo (objeto, número…) → INVALID_INPUT, antes de cualquier
  -- jsonb_array_elements(). No cambia el contrato [{ user_id, team_id, goals }]; el array vacío sigue válido.
  if p_goals is null or jsonb_typeof(p_goals) <> 'array' then raise exception 'INVALID_INPUT'; end if;
  -- FOR UPDATE: dos personas guardando el mismo partido se serializan aquí, y la
  -- segunda ve el updated_at ya cambiado en vez de pisar lo de la primera.
  select * into v_m from public.championship_matches where id = p_match_id for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;

  if p_updated_at is not null and v_m.updated_at is distinct from p_updated_at then
    raise exception 'CONCURRENT_UPDATE';
  end if;
  -- Serializa con las mutaciones de roster del mismo campeonato (misma lock key).
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || v_m.championship_id::text)::bigint);

  if not public._champ_can_manage_results(v_m.championship_id, v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  -- Marcador: AMBOS null (sin resultado) o AMBOS enteros >= 0 (0 válido). Espejo del CHECK score_pair (Fase 15).
  if (p_home_score is null) <> (p_away_score is null) then raise exception 'INVALID_INPUT'; end if;
  if (p_home_score is not null and p_home_score < 0) or (p_away_score is not null and p_away_score < 0) then raise exception 'INVALID_INPUT'; end if;
  -- Para cargar marcador deben existir ambos equipos (partido operativo).
  if p_home_score is not null and (v_m.home_team_id is null or v_m.away_team_id is null) then raise exception 'NOT_OPEN'; end if;
  -- Sin marcador (NULL/NULL) NO puede haber goleadores atribuidos. (No cambia la regla de que la suma de goles
  -- es independiente del marcador cuando este existe; solo impide goles con el partido sin resultado.)
  if p_home_score is null and exists (
       select 1 from jsonb_array_elements(coalesce(p_goals, '[]'::jsonb)) e
        where coalesce(nullif(e->>'goals', '')::int, 0) > 0
     ) then
    raise exception 'INVALID_INPUT';
  end if;

  update public.championship_matches
     set home_score = p_home_score, away_score = p_away_score, updated_at = now()
   where id = p_match_id;

  -- Goleadores: REEMPLAZO total para este match. Cada gol valida team ∈ {home,away} y jugador miembro de ESE
  -- team. La suma NO tiene que igualar el marcador (info adicional; autores no identificados quedan fuera).
  delete from public.championship_goals where match_id = p_match_id;
  for v_g in select value from jsonb_array_elements(coalesce(p_goals, '[]'::jsonb)) loop
    v_uid   := nullif(v_g->>'user_id', '')::uuid;
    v_tid   := nullif(v_g->>'team_id', '')::uuid;
    v_goals := coalesce((v_g->>'goals')::int, 0);
    if v_uid is null or v_tid is null or v_goals <= 0 then continue; end if;   -- entradas vacías/0 → se ignoran
    if v_tid is distinct from v_m.home_team_id and v_tid is distinct from v_m.away_team_id then
      raise exception 'TEAM_NOT_IN_MATCH';
    end if;
    if not exists (select 1 from public.championship_players cp
                    where cp.championship_id = v_m.championship_id and cp.user_id = v_uid and cp.team_id = v_tid) then
      raise exception 'PLAYER_NOT_IN_TEAM';
    end if;
    insert into public.championship_goals (match_id, player_user_id, team_id, goals)
      values (p_match_id, v_uid, v_tid, v_goals);
  end loop;

  return jsonb_build_object(
    'match_id', p_match_id, 'home_score', p_home_score, 'away_score', p_away_score,
    'goals_count', (select count(*) from public.championship_goals where match_id = p_match_id)
  );
end; $$;
revoke all on function public.save_championship_match_result(uuid, int, int, jsonb, timestamptz)
  from public, anon;
grant execute on function public.save_championship_match_result(uuid, int, int, jsonb, timestamptz)
  to authenticated;

comment on function public.save_championship_match_result(uuid, int, int, jsonb, timestamptz) is
  'UNICA RPC de escritura de resultados (marcador + goleadores) en una transaccion. La usan App y Admin. Autoriza con _champ_can_manage_results: host en in_progress, AlGrass en in_progress y completed; owner y player nunca. La suma de goles NO tiene que igualar el marcador. No toca fixture ni qualified_team_id.';
