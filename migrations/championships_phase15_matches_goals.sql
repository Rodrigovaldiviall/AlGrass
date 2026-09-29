-- ============================================================================
-- Campeonatos · Fase 15 — Fixture: championship_matches + championship_goals
-- ============================================================================
-- FUENTE DE VERDAD del calendario/resultados. Solo DOS tablas nuevas; standings y goleadores se DERIVAN
-- (no se guardan). Sin winner_team_id (el ganador por marcador se deriva de home_score/away_score) y sin
-- duplicar venue_id/field_id/date_key (salen de game_id → games).
--
-- Modelo de scheduling (ya acordado): games = bloque físico reservado (cancha/venue/fecha). Un mismo game
-- puede alojar VARIOS matches; por eso cada match guarda su propio start_time + duration_min. game_id/
-- start_time/duration_min pueden ser NULL mientras el partido no esté programado.
--
-- Esta migración SOLO crea las tablas (columnas, constraints, índices, RLS, revoke). NO trae RPCs, triggers,
-- ni lógica de batch/conflictos/sustitución/save result/save goals/standings: todo eso viene en fases
-- posteriores por RPCs SECURITY DEFINER que validan host (championships.host_user_id) / AlGrass y el estado
-- final del fixture. Cliente sin acceso directo (revoke): lectura/escritura irán por esas RPCs.
-- ============================================================================

-- ── 1) championship_matches ──────────────────────────────────────────────────
create table if not exists public.championship_matches (
  id                uuid primary key default gen_random_uuid(),
  championship_id   uuid not null references public.championships(id) on delete cascade,
  stage             text not null check (stage in ('group','semifinal','final','third_place')),
  group_code        text,                                                    -- solo relevante en stage='group'
  home_team_id      uuid references public.championship_teams(id) on delete restrict,   -- null hasta el sorteo; editable en llaves
  away_team_id      uuid references public.championship_teams(id) on delete restrict,
  home_score        int check (home_score >= 0),                             -- null = sin resultado cargado; 0 es válido
  away_score        int check (away_score >= 0),
  qualified_team_id uuid references public.championship_teams(id) on delete restrict,   -- quién avanza DESDE este match (independiente del marcador)
  game_id           uuid references public.games(id) on delete set null,     -- bloque físico (cancha/venue/fecha). SET NULL → queda "sin programar"
  start_time        time,                                                    -- inicio propio del partido (hora local, como games.time)
  duration_min      int check (duration_min is null or duration_min > 0),    -- duración propia
  match_order       int,                                                     -- orden/desempate al listar el bloque
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Prohíbe A vs A, pero permite la pareja aún no sorteada (algún lado null).
  constraint championship_matches_distinct_teams
    check (home_team_id is null or away_team_id is null or home_team_id <> away_team_id),
  -- Un partido sin resultado tiene AMBOS scores null; con resultado, AMBOS presentes (0-0 válido).
  constraint championship_matches_score_pair
    check ((home_score is null) = (away_score is null)),
  -- El clasificado, si se define, debe ser uno de los dos equipos de ESTE match.
  constraint championship_matches_qualified_in_pair
    check (qualified_team_id is null or qualified_team_id = home_team_id or qualified_team_id = away_team_id)
);
create index if not exists championship_matches_champ_idx on public.championship_matches (championship_id);
create index if not exists championship_matches_game_idx  on public.championship_matches (game_id);


-- ── 2) championship_goals ────────────────────────────────────────────────────
-- Goleadores individuales. La suma NO tiene que coincidir con el marcador (puede faltar algún goleador).
-- player_user_id: referencia LÓGICA al usuario (mismo patrón que championship_players.user_id / owner_user_id;
-- sin FK a users) → el gol persiste aunque el jugador salga del campeonato. La pertenencia (jugador del team,
-- team en el match) se valida en el RPC de escritura, no por FK.
create table if not exists public.championship_goals (
  id             uuid primary key default gen_random_uuid(),
  match_id       uuid not null references public.championship_matches(id) on delete cascade,
  player_user_id uuid not null,
  team_id        uuid not null references public.championship_teams(id) on delete restrict,
  goals          int not null default 1 check (goals > 0),
  created_at     timestamptz not null default now(),
  unique (match_id, player_user_id)                                          -- 1 fila por goleador/partido (índice cubre "goles por match")
);


-- ── 3) Seguridad: cerrar al cliente; todo por RPC SECURITY DEFINER (patrón del módulo) ──
alter table public.championship_matches enable row level security;
alter table public.championship_goals   enable row level security;
revoke all on public.championship_matches from anon, authenticated;
revoke all on public.championship_goals   from anon, authenticated;
-- Sin policies de cliente: lectura (calendario/standings/goleadores) y escritura (resultado/goleadores/
-- clasificado/programación en lote) irán por RPCs SECURITY DEFINER en fases posteriores.
