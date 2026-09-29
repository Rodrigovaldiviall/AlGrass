-- ============================================================================
-- Campeonatos · Fase 16 — LECTURA de competición (calendario/resultados/standings/goleadores)
-- ============================================================================
-- UNA sola RPC de lectura: get_championship_competition(champ) → { matches, standings, scorers } en un solo
-- round-trip. Separada de get_championship_registration_state (superficie de Inscripciones, que se llama en
-- cada montaje): la competición solo interesa en la etapa de Calendario/Resultados y no debe sobrecargar
-- aquella llamada.
--
-- SOLO LECTURA. No escribe nada. standings/goleadores se DERIVAN (no se guardan). Mismo gate de lectura que
-- registration_state (estados públicos, o owner, o AlGrass). SECURITY DEFINER → lee las tablas de fixture
-- (RLS cerrada al cliente en Fase 15) y resuelve display por join a championship_teams / games→fields→venues
-- / users_public, SIN duplicar venue_id/field_id/date_key. NO trae edición/generación/save (fases futuras).
-- ============================================================================

create or replace function public.get_championship_competition(p_championship_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_champ      public.championships%rowtype;
  v_is_algrass boolean := public._is_algrass_staff(v_actor);
  v_matches    jsonb;
  v_standings  jsonb;
  v_scorers    jsonb;
begin
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  -- Mismo gate de lectura que get_championship_registration_state.
  if not (v_champ.status in ('registration_open','registration_closed','in_progress','completed')
          or v_champ.owner_user_id = v_actor or v_is_algrass) then
    raise exception 'CHAMPIONSHIP_NOT_FOUND';
  end if;

  -- ── MATCHES: campos crudos + display resuelto (equipos, cancha/venue/fecha vía game_id) + goleadores del match.
  select coalesce(jsonb_agg(s.j order by s.dk nulls last, s.st nulls last, s.mo nulls last, s.created_at), '[]'::jsonb)
    into v_matches
    from (
      select
        jsonb_build_object(
          'id', m.id, 'championship_id', m.championship_id,
          'stage', m.stage, 'group_code', m.group_code,
          'home_team_id', m.home_team_id, 'away_team_id', m.away_team_id,
          'home_score', m.home_score, 'away_score', m.away_score,
          'qualified_team_id', m.qualified_team_id,
          'game_id', m.game_id, 'start_time', m.start_time, 'duration_min', m.duration_min, 'match_order', m.match_order,
          -- Display de equipos (null si aún no sorteado).
          'home_team', case when ht.id is null then null
                            else jsonb_build_object('id', ht.id, 'name', ht.name, 'color', ht.color, 'design', ht.design) end,
          'away_team', case when at.id is null then null
                            else jsonb_build_object('id', at.id, 'name', at.name, 'color', at.color, 'design', at.design) end,
          -- Cancha/venue/fecha DERIVADOS de game_id → games → fields → venues (no duplicados en la tabla).
          'field_id', g.field_id, 'field_name', f.name, 'venue_name', v.name, 'date_key', g.date_key,
          -- Goleadores registrados en ESTE match (la suma NO tiene que igualar el marcador).
          'goals', (
            select coalesce(jsonb_agg(jsonb_build_object(
                     'player_user_id', gl.player_user_id, 'team_id', gl.team_id, 'goals', gl.goals,
                     'full_name', u.full_name, 'avatar_path', u.avatar_path, 'avatar_hue', u.avatar_hue
                   ) order by gl.goals desc), '[]'::jsonb)
            from public.championship_goals gl
            left join public.users_public u on u.id = gl.player_user_id
            where gl.match_id = m.id
          )
        ) as j,
        g.date_key as dk, m.start_time as st, m.match_order as mo, m.created_at
      from public.championship_matches m
      left join public.championship_teams ht on ht.id = m.home_team_id
      left join public.championship_teams at on at.id = m.away_team_id
      left join public.games   g on g.id = m.game_id
      left join public.fields  f on f.id = g.field_id
      left join public.venues  v on v.id = f.venue_id
      where m.championship_id = p_championship_id
    ) s;

  -- ── STANDINGS: la TABLA incluye TODOS los equipos del grupo (aunque no hayan jugado); las estadísticas
  -- solo se calculan de partidos jugados (ambos scores no null) y se COALESCE a 0 para los demás.
  -- 1) teams_in_group = universo de (group_code, team) desde TODOS los stage='group' (home+away, con/sin score).
  -- 2) played/agg = estadísticas solo de partidos con resultado. 3) LEFT JOIN universo ← agg → 0 por defecto.
  with teams_in_group as (
    select group_code, home_team_id as team_id
      from public.championship_matches
     where championship_id = p_championship_id and stage = 'group' and home_team_id is not null
    union
    select group_code, away_team_id as team_id
      from public.championship_matches
     where championship_id = p_championship_id and stage = 'group' and away_team_id is not null
  ),
  played as (
    select group_code, home_team_id as team_id, home_score as gf, away_score as gc
      from public.championship_matches
     where championship_id = p_championship_id and stage = 'group'
       and home_team_id is not null and away_team_id is not null
       and home_score is not null and away_score is not null
    union all
    select group_code, away_team_id as team_id, away_score as gf, home_score as gc
      from public.championship_matches
     where championship_id = p_championship_id and stage = 'group'
       and home_team_id is not null and away_team_id is not null
       and home_score is not null and away_score is not null
  ),
  agg as (
    select group_code, team_id,
           count(*)                                              as pj,
           count(*) filter (where gf > gc)                       as pg,
           count(*) filter (where gf = gc)                       as pe,
           count(*) filter (where gf < gc)                       as pp,
           sum(gf)                                               as gf,
           sum(gc)                                               as gc,
           sum(gf) - sum(gc)                                     as dg,
           sum(case when gf > gc then 3 when gf = gc then 1 else 0 end) as pts
      from played
     group by group_code, team_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'group_code', ug.group_code, 'team_id', ug.team_id,
           'team', case when t.id is null then null
                        else jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color, 'design', t.design) end,
           'pj', coalesce(a.pj, 0), 'pg', coalesce(a.pg, 0), 'pe', coalesce(a.pe, 0), 'pp', coalesce(a.pp, 0),
           'gf', coalesce(a.gf, 0), 'gc', coalesce(a.gc, 0), 'dg', coalesce(a.dg, 0), 'pts', coalesce(a.pts, 0)
         ) order by ug.group_code nulls last,
                    coalesce(a.pts, 0) desc, coalesce(a.dg, 0) desc, coalesce(a.gf, 0) desc), '[]'::jsonb)
    into v_standings
    from teams_in_group ug
    left join agg a on a.group_code is not distinct from ug.group_code and a.team_id = ug.team_id
    left join public.championship_teams t on t.id = ug.team_id;

  -- ── GOLEADORES del campeonato: SOLO goles del equipo ACTUAL del jugador. Se cruza championship_goals con
  -- championship_players (mismo championship + mismo user) y se cuentan únicamente las filas donde el team del
  -- gol == el team actual del jugador. Así, si Juan marcó con A y luego pasa a B, esos goles con A siguen
  -- guardados (histórico intacto) pero NO aparecen en la tabla visible; solo cuentan los de su equipo actual.
  -- Si championship_players.team_id es null (sin equipo), el igual falla → no aparece en el ranking. goals DESC.
  select coalesce(jsonb_agg(jsonb_build_object(
           'player_user_id', s.player_user_id, 'goals', s.goals, 'team_id', s.team_id,
           'full_name', u.full_name, 'avatar_path', u.avatar_path, 'avatar_hue', u.avatar_hue
         ) order by s.goals desc, lower(u.full_name)), '[]'::jsonb)
    into v_scorers
    from (
      select gl.player_user_id,
             cp.team_id                                               as team_id,   -- equipo ACTUAL del jugador
             sum(gl.goals)                                            as goals
        from public.championship_goals gl
        join public.championship_matches m on m.id = gl.match_id
        join public.championship_players cp on cp.championship_id = p_championship_id
                                           and cp.user_id  = gl.player_user_id
                                           and cp.team_id  = gl.team_id             -- solo goles de su equipo actual (null → excluido)
       where m.championship_id = p_championship_id
       group by gl.player_user_id, cp.team_id
    ) s
    left join public.users_public u on u.id = s.player_user_id;

  return jsonb_build_object(
    'matches',   v_matches,
    'standings', v_standings,
    'scorers',   v_scorers
  );
end;
$$;

revoke all on function public.get_championship_competition(uuid) from public, anon;
grant execute on function public.get_championship_competition(uuid) to authenticated;
