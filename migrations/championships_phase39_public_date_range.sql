-- ============================================================================
-- Campeonatos · Fase 39 — list_public_championships expone first_date/last_date del FIXTURE (rango multi-día)
-- ============================================================================
-- CONTEXTO: un campeonato puede tener actividad en VARIOS días (fixture multi-día: championship_matches → games
-- con distintos game.date_key), pero championships.event_date solo guarda el día inicial de la compra original.
-- La card del menú "Campeonatos" (list_public_championships) solo tenía event_date → no podía mostrar el rango.
--
-- FIX MÍNIMO (sin nueva fuente de verdad): se AÑADEN dos campos DERIVADOS en tiempo de lectura:
--   · first_date = MIN(games.date_key) de los championship_matches del campeonato.
--   · last_date  = MAX(games.date_key) de los championship_matches del campeonato.
-- (date_key es 'YYYY-MM-DD' → min/max lexicográfico = cronológico.) Si no hay fixture aún, ambos = null y el
-- cliente cae al fallback actual (event_date, un solo día). NO crea tablas/columnas, NO toca fixture/lifecycle.
-- Todo lo demás de list_public_championships queda IDÉNTICO a Fase 7 (mismos campos, filtro y orden).
-- ============================================================================

create or replace function public.list_public_championships()
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'cover_theme', c.cover_theme, 'status', c.status,
    'privacy', c.privacy, 'results_public', c.results_public,
    'event_date', c.event_date, 'start_time', c.start_time, 'end_time', c.end_time,
    'venue_id', c.venue_id, 'format_config', c.format_config,
    'registration_closes_at', c.registration_closes_at, 'published_at', c.published_at,
    -- Fase 39: rango REAL del fixture (multi-día) DERIVADO de championship_matches → games.date_key. null si no hay fixture.
    'first_date', (select min(g.date_key) from public.championship_matches m
                     join public.games g on g.id = m.game_id where m.championship_id = c.id),
    'last_date',  (select max(g.date_key) from public.championship_matches m
                     join public.games g on g.id = m.game_id where m.championship_id = c.id)
  )
  from public.championships c
  where c.status in ('registration_open', 'registration_closed', 'in_progress', 'completed')
  order by c.event_date asc;
$$;
revoke all on function public.list_public_championships() from public;
grant execute on function public.list_public_championships() to anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='list_public_championships') then
    raise exception 'VERIFY: falta list_public_championships';
  end if;
  raise notice 'OK Fase 39: list_public_championships expone first_date/last_date derivados (rango multi-día).';
end $$;
