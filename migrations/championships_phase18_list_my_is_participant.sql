-- ============================================================================
-- Campeonatos · Fase 18 — list_my_championships: exponer is_participant
-- ============================================================================
-- Profile ya deriva el badge con champBadge(status, isParticipant), pero list_my_championships no exponía si
-- el usuario actual está INSCRITO como jugador (championship_players), así que "Inscrito" nunca aparecía.
--
-- ÚNICO cambio: añadir el campo booleano `is_participant` al JSON de cada fila. Se CONSERVA EXACTAMENTE la
-- lógica DESPLEGADA actual (OWNER + MEMBER) y su order by; NO se crea RPC nueva, NO se vuelve a la versión
-- owner-only del repo, NO se cambian statuses ni el resto de columnas.
--
-- Lógica de visibilidad conservada (idéntica a la desplegada):
--   OWNER  → owner_user_id = auth.uid(), en: payment_validation, pending_publish, registration_open,
--            registration_closed, in_progress, completed, canceled.
--   MEMBER → exists(championship_players para auth.uid()), en: registration_open, registration_closed,
--            in_progress, completed, canceled.
-- (owner y member sin duplicar: un mismo campeonato aparece una sola vez porque la fila es única en c.)
-- ============================================================================

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
    -- NUEVO: ¿el usuario actual está inscrito como jugador en ESTE campeonato? (para el badge "Inscrito").
    'is_participant', exists (
      select 1 from public.championship_players cp
       where cp.championship_id = c.id and cp.user_id = auth.uid()
    )
  )
  from public.championships c
  where (
      -- OWNER: ciclo completo del pagador (incluye no publicados propios + histórico terminado/cancelado).
      (c.owner_user_id = auth.uid()
       and c.status in ('payment_validation', 'pending_publish', 'registration_open',
                        'registration_closed', 'in_progress', 'completed', 'canceled'))
      or
      -- MEMBER: inscrito como jugador; visible desde que hay inscripciones en adelante.
      (exists (select 1 from public.championship_players cp
                where cp.championship_id = c.id and cp.user_id = auth.uid())
       and c.status in ('registration_open', 'registration_closed',
                        'in_progress', 'completed', 'canceled'))
    )
  order by c.event_date asc;
$$;
revoke all on function public.list_my_championships() from public, anon;
grant execute on function public.list_my_championships() to authenticated;
