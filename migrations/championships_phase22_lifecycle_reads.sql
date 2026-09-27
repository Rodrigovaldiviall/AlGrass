-- ============================================================================
-- Campeonatos · Fase 22 — Exponer live_started_at en las LECTURAS que distinguen PRE-LIVE vs LIVE
-- ============================================================================
-- Phase 21 añadió championships.live_started_at (NULL=pre-live, NOT NULL=en vivo). Esta fase SOLO amplía las
-- 3 lecturas que alimentan superficies de App que deben distinguir "En vivo": get_championship_public
-- (ChampionshipView), list_my_championships (Profile) y list_public_championships (menú Campeonatos).
--
-- NO se amplían get_championship_registration_state (Inscripciones no necesita live) ni get_championship_competition
-- (la antena se decide con el status+live_started_at del detalle/listado, no de la competición). 0 RPCs nuevas.
-- Cuerpos idénticos a la versión vigente + el campo live_started_at. fixture_published_at NO decide UX (histórico).
-- Requiere aplicar Phase 21 antes (columna live_started_at). No cambia gates ni lógica de negocio.
-- ============================================================================

-- ── 1) get_championship_public — detalle (ChampionshipView). Base: Fase 20 (+ fixture_published_at). ──
create or replace function public.get_championship_public(p_championship_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_champ public.championships%rowtype;
begin
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if not (v_champ.status in ('registration_open','registration_closed','in_progress','completed')
          or v_champ.owner_user_id = auth.uid()) then
    raise exception 'CHAMPIONSHIP_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'id', v_champ.id, 'status', v_champ.status, 'name', v_champ.name,
    'cover_theme', v_champ.cover_theme, 'cover_image_path', v_champ.cover_image_path,
    'event_date', v_champ.event_date, 'start_time', v_champ.start_time, 'end_time', v_champ.end_time,
    'venue_id', v_champ.venue_id, 'format_config', v_champ.format_config,
    'registration_closes_at', v_champ.registration_closes_at, 'published_at', v_champ.published_at,
    'fixture_published_at', v_champ.fixture_published_at,
    'live_started_at', v_champ.live_started_at,   -- Fase 21: NULL=pre-live · NOT NULL=en vivo
    'privacy', v_champ.privacy, 'results_public', v_champ.results_public,
    'owner_user_id', v_champ.owner_user_id,
    'has_registration_key', (nullif(btrim(coalesce(v_champ.registration_key, '')), '') is not null),
    'is_member', (auth.uid() is not null and exists (
        select 1 from public.championship_players where championship_id = p_championship_id and user_id = auth.uid()
      ))
  );
end; $$;
revoke all on function public.get_championship_public(uuid) from public;
grant execute on function public.get_championship_public(uuid) to anon, authenticated;


-- ── 2) list_my_championships — "Mis campeonatos" (Profile). Base: Fase 18 (owner + member + is_participant). ──
create or replace function public.list_my_championships()
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id, 'status', c.status, 'name', c.name, 'cover_theme', c.cover_theme,
    'event_date', c.event_date, 'start_time', c.start_time, 'format_config', c.format_config,
    'registration_closes_at', c.registration_closes_at, 'created_at', c.created_at,
    'live_started_at', c.live_started_at,   -- Fase 21: antena "En vivo" en la card de Perfil
    'is_participant', exists (
      select 1 from public.championship_players cp
       where cp.championship_id = c.id and cp.user_id = auth.uid()
    )
  )
  from public.championships c
  where (
      (c.owner_user_id = auth.uid()
       and c.status in ('payment_validation', 'pending_publish', 'registration_open',
                        'registration_closed', 'in_progress', 'completed', 'canceled'))
      or
      (exists (select 1 from public.championship_players cp
                where cp.championship_id = c.id and cp.user_id = auth.uid())
       and c.status in ('registration_open', 'registration_closed',
                        'in_progress', 'completed', 'canceled'))
    )
  order by c.event_date asc;
$$;
revoke all on function public.list_my_championships() from public, anon;
grant execute on function public.list_my_championships() to authenticated;


-- ── 3) list_public_championships — listado del menú Campeonatos. Base: Fase 7. ──
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
    'live_started_at', c.live_started_at   -- Fase 21: pill "En vivo" en la card del listado
  )
  from public.championships c
  where c.status in ('registration_open', 'registration_closed', 'in_progress', 'completed')
  order by c.event_date asc;
$$;
revoke all on function public.list_public_championships() from public;
grant execute on function public.list_public_championships() to anon, authenticated;
