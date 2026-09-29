-- ============================================================================
-- Campeonatos · Fase 38 — get_championship_public expone venues[] OPERATIVOS (multi-venue), DERIVADOS
-- ============================================================================
-- CONTEXTO: la reserva física del campeonato es championship_reservation_games → games → fields → venues.
-- Desde Admin se pueden AÑADIR canchas/rentals adicionales (incluso de OTRO venue) a un campeonato existente,
-- por lo que un campeonato puede tener VARIOS venues operativos SIN modificar format_config.summary (que solo
-- guarda el venue inicial de la compra original, por compatibilidad).
--
-- PROBLEMA: championship_reservation_games tiene RLS que solo permite SELECT al owner/staff (Fase 1), así que
-- host/jugadores/anon NO pueden derivar los venues desde el cliente. get_championship_competition expone por
-- match field_id/field_name/venue_name pero NO venue_id/address/mapa y solo cubre games con fixture.
--
-- FIX MÍNIMO (sin nueva fuente de verdad): get_championship_public (SECURITY DEFINER, ya llega a todos los
-- viewers) AÑADE un campo DERIVADO 'venues' construido en tiempo de lectura desde championship_reservation_games
-- → games → fields → venues. NO crea tablas (championship_venues), NI columnas (venue_id_2/3), NI JSON persistido.
-- Todo lo demás de get_championship_public queda IDÉNTICO a Fase 36 (mismos campos, gate y grants).
--
-- Cada venue: { venue_id, venue_name, venue_address, district, city, lat, lng, cover_image_path,
--               cover_updated_at, amenities, fields:[{ field_id, field_name }] }.
-- Orden: primero el venue principal (championships.venue_id), luego por reserva más antigua, luego por nombre.
-- ============================================================================

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
    'champion_team_id', v_champ.champion_team_id,   -- Fase 36: campeón OFICIAL manual (null = sin campeón)
    'privacy', v_champ.privacy, 'results_public', v_champ.results_public,
    'owner_user_id', v_champ.owner_user_id,
    'is_host', (auth.uid() is not null and v_champ.host_user_id is not null and v_champ.host_user_id = auth.uid()),
    'has_registration_key', (nullif(btrim(coalesce(v_champ.registration_key, '')), '') is not null),
    'is_member', (auth.uid() is not null and exists (
        select 1 from public.championship_players where championship_id = p_championship_id and user_id = auth.uid()
      )),
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

-- ── Verificación razonable ────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='get_championship_public') then
    raise exception 'VERIFY: falta get_championship_public';
  end if;
  raise notice 'OK Fase 38: get_championship_public expone venues[] derivado (multi-venue) sin nueva fuente de verdad.';
end $$;
