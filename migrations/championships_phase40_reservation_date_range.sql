-- ============================================================================
-- Campeonatos · Fase 40 — Rango de fecha/hora del RESUMEN desde la RESERVA FÍSICA (no championship_matches)
-- ============================================================================
-- CORRECCIÓN: el rango general (Fecha/Horario del detalle y first_date/last_date de la card) debe salir de las
-- RESERVAS FÍSICAS del campeonato (championship_reservation_games → games), NO de championship_matches. Los
-- matches pueden tener horarios internos distintos; la autoridad del resumen es la cancha reservada.
--
-- get_championship_public NO exponía game_id/date_key/time/duration por reserva (Fase 38 solo agrupa venues+fields),
-- así que el detalle caía al fallback de event_date y perdía la fecha final. Se AÑADE un array DERIVADO
-- reservation_games[] con lo necesario para que ChampionshipView calcule primera/última reserva y el horario.
--
-- Solo lectura/derivación en RPCs SECURITY DEFINER (leen reservation_games saltando su RLS de owner). NO crea
-- tablas/columnas, NO nueva fuente de verdad, NO toca fixture/matches/reservas/lifecycle. Reemplaza el origen de
-- first_date/last_date en list_public_championships (antes Fase 39: championship_matches) por la reserva física, y
-- extiende get_championship_public (base Fase 38: conserva venues[] y todos los campos previos) con reservation_games[].
-- ============================================================================

-- ── 1) list_public_championships — first_date/last_date DESDE la reserva física (games.date_key) ───────
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
    -- Fase 40: rango REAL desde championship_reservation_games → games.date_key (NO championship_matches).
    'first_date', (select min(g.date_key) from public.championship_reservation_games crg
                     join public.games g on g.id = crg.game_id where crg.championship_id = c.id),
    'last_date',  (select max(g.date_key) from public.championship_reservation_games crg
                     join public.games g on g.id = crg.game_id where crg.championship_id = c.id)
  )
  from public.championships c
  where c.status in ('registration_open', 'registration_closed', 'in_progress', 'completed')
  order by c.event_date asc;
$$;
revoke all on function public.list_public_championships() from public;
grant execute on function public.list_public_championships() to anon, authenticated;


-- ── 2) get_championship_public — AÑADE reservation_games[] (reserva física). BASE: Fase 38 (venues[]). ──
create or replace function public.get_championship_public(p_championship_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_champ public.championships%rowtype;
begin
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if not (v_champ.status in ('registration_open','registration_closed','in_progress','completed')
          or v_champ.owner_user_id = auth.uid()
          or (v_champ.host_user_id is not null and v_champ.host_user_id = auth.uid())) then
    raise exception 'CHAMPIONSHIP_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'id', v_champ.id, 'status', v_champ.status, 'name', v_champ.name,
    'cover_theme', v_champ.cover_theme, 'cover_image_path', v_champ.cover_image_path,
    'event_date', v_champ.event_date, 'start_time', v_champ.start_time, 'end_time', v_champ.end_time,
    'venue_id', v_champ.venue_id, 'format_config', v_champ.format_config,
    'registration_closes_at', v_champ.registration_closes_at, 'published_at', v_champ.published_at,
    'fixture_published_at', v_champ.fixture_published_at,
    'live_started_at', v_champ.live_started_at,
    'champion_team_id', v_champ.champion_team_id,   -- Fase 36
    'privacy', v_champ.privacy, 'results_public', v_champ.results_public,
    'owner_user_id', v_champ.owner_user_id,
    'is_host', (auth.uid() is not null and v_champ.host_user_id is not null and v_champ.host_user_id = auth.uid()),
    'has_registration_key', (nullif(btrim(coalesce(v_champ.registration_key, '')), '') is not null),
    'is_member', (auth.uid() is not null and exists (
        select 1 from public.championship_players where championship_id = p_championship_id and user_id = auth.uid()
      )),
    -- Fase 40: RESERVAS FÍSICAS (fuente del rango de fecha/hora del resumen). DERIVADO de
    -- championship_reservation_games → games → fields. El cliente ordena por date_key+time y toma primera/última.
    'reservation_games', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'game_id', g.id, 'date_key', g.date_key,
               'time', to_char(g.time, 'HH24:MI'), 'duration_min', g.duration_min,
               'field_id', g.field_id, 'venue_id', f.venue_id
             ) order by g.date_key asc, g.time asc), '[]'::jsonb)
      from public.championship_reservation_games crg
      join public.games  g on g.id = crg.game_id
      left join public.fields f on f.id = g.field_id
      where crg.championship_id = p_championship_id
    ),
    -- Fase 38: venues OPERATIVOS reales (multi-venue) DERIVADOS de la reserva física. Solo lectura, no persistido.
    'venues', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'venue_id', v.id, 'venue_name', v.name, 'venue_address', v.address,
          'district', v.district, 'city', v.city, 'lat', v.lat, 'lng', v.lng,
          'cover_image_path', v.cover_image_path, 'cover_updated_at', v.cover_updated_at,
          'amenities', v.amenities,
          'fields', (
            select coalesce(jsonb_agg(distinct jsonb_build_object('field_id', f2.id, 'field_name', f2.name)), '[]'::jsonb)
            from public.championship_reservation_games crg2
            join public.games   g2 on g2.id = crg2.game_id
            join public.fields  f2 on f2.id = g2.field_id
            where crg2.championship_id = p_championship_id and f2.venue_id = v.id
          )
        )
        order by (v.id = v_champ.venue_id) desc, dv.first_reserved asc, lower(v.name) asc
      ), '[]'::jsonb)
      from (
        select f.venue_id, min(crg.created_at) as first_reserved
        from public.championship_reservation_games crg
        join public.games  g on g.id = crg.game_id
        join public.fields f on f.id = g.field_id
        where crg.championship_id = p_championship_id and f.venue_id is not null
        group by f.venue_id
      ) dv
      join public.venues v on v.id = dv.venue_id
    )
  );
end; $$;
revoke all on function public.get_championship_public(uuid) from public;
grant execute on function public.get_championship_public(uuid) to anon, authenticated;

do $$
begin
  raise notice 'OK Fase 40: reservation_games[] + first_date/last_date desde championship_reservation_games → games (no matches).';
end $$;
