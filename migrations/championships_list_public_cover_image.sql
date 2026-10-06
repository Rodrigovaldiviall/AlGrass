-- Campeonatos — list_public_championships(p_city) expone cover_image_path (portada pública en el listado)
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- El frontend (Championships.jsx) ya renderiza la foto de portada SOLO para públicos con cover_image_path
-- (fallback a color). La RPC del listado por ciudad NO devolvía ese campo, así que la condición nunca se
-- cumplía. Esta migración REEMITE list_public_championships(p_city) IDÉNTICA a la versión vigente
-- (championships_list_reads_admin_parity.sql) y AÑADE únicamente la clave 'cover_image_path'.
--
-- NO toca: privados, Admin, creación/edición, storage/buckets, update_championship_cover, otras RPC, frontend.
-- cover_image_path es solo el PATH en el bucket PÚBLICO championship-covers (nunca URL; la portada es pública).

create or replace function public.list_public_championships(p_city text)
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'cover_theme', c.cover_theme, 'status', c.status,
    'cover_image_path', c.cover_image_path,
    'privacy', c.privacy, 'results_public', c.results_public,
    'event_date', c.event_date, 'start_time', c.start_time, 'end_time', c.end_time,
    'venue_id', c.venue_id, 'format_config', c.format_config,
    'registration_closes_at', c.registration_closes_at, 'published_at', c.published_at,
    'first_date', (select min(g.date_key) from public.championship_reservation_games crg
                     join public.games g on g.id = crg.game_id where crg.championship_id = c.id),
    'last_date',  (select max(g.date_key) from public.championship_reservation_games crg
                     join public.games g on g.id = crg.game_id where crg.championship_id = c.id),
    -- AÑADIDO (lectura autoritativa): capacidad real + sede/ciudad del venue principal.
    'team_capacity', public._championship_team_capacity(c.format_config),
    'venue_name', (select v.name from public.venues v where v.id = c.venue_id),
    'city',       (select v.city from public.venues v where v.id = c.venue_id)
  )
  from public.championships c
  where c.status in ('registration_open', 'registration_closed', 'in_progress', 'completed')
    and nullif(btrim(coalesce(p_city, '')), '') is not null
    and exists (select 1 from public.venues v where v.id = c.venue_id and v.city = p_city)
  order by c.event_date asc;
$$;
revoke all on function public.list_public_championships(text) from public;
grant execute on function public.list_public_championships(text) to anon, authenticated;

-- ── VERIFY: la definición final de list_public_championships(text) contiene cover_image_path ──
do $$
begin
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'list_public_championships'
       and pg_get_function_arguments(p.oid) = 'p_city text'
       and pg_get_functiondef(p.oid) ilike '%cover_image_path%'
  ) then
    raise exception 'VERIFY: list_public_championships(p_city) NO contiene cover_image_path';
  end if;
  raise notice 'OK: list_public_championships(p_city) expone cover_image_path.';
end $$;
