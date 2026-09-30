-- ============================================================================
-- Campeonatos · Listado público ACOTADO por CIUDAD (discovery por users.city)
-- ============================================================================
-- El menú Campeonatos mostraba campeonatos de cualquier ciudad. Discovery debe limitarse a la ciudad del usuario
-- (users.city). La ciudad del campeonato se DERIVA de su venue principal/inicial (championships.venue_id → venues.city)
-- — la referencia comercial de creación — SIN crear columna city en championships (aunque sea multi-venue operativo,
-- el listado usa el venue inicial).
--
-- Se AÑADE una sobrecarga list_public_championships(p_city text): idéntica a la versión sin argumento (Fase 40,
-- conserva first_date/last_date y demás campos) pero filtrando por la ciudad del venue principal. Si p_city es
-- null/'' → NO devuelve nada (sin ciudad no hay discovery; no se inventa una ciudad por defecto). No cambia
-- permisos, privacidad, results_public ni el acceso directo/deep-link (eso sigue con sus reglas actuales).
-- La versión sin argumento se deja intacta (no se rompe nada); el frontend pasa a usar la de ciudad.
-- ============================================================================

create or replace function public.list_public_championships(p_city text)
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
    'first_date', (select min(g.date_key) from public.championship_reservation_games crg
                     join public.games g on g.id = crg.game_id where crg.championship_id = c.id),
    'last_date',  (select max(g.date_key) from public.championship_reservation_games crg
                     join public.games g on g.id = crg.game_id where crg.championship_id = c.id)
  )
  from public.championships c
  where c.status in ('registration_open', 'registration_closed', 'in_progress', 'completed')
    -- Discovery por CIUDAD del venue PRINCIPAL (championships.venue_id → venues.city). p_city null/'' → sin resultados.
    and nullif(btrim(coalesce(p_city, '')), '') is not null
    and exists (select 1 from public.venues v where v.id = c.venue_id and v.city = p_city)
  order by c.event_date asc;
$$;
revoke all on function public.list_public_championships(text) from public;
grant execute on function public.list_public_championships(text) to anon, authenticated;

do $$
begin
  raise notice 'OK: list_public_championships(p_city) — discovery acotado a la ciudad del venue principal.';
end $$;
