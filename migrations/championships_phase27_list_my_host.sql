-- ============================================================================
-- Campeonatos · Fase 27 — list_my_championships: incluir al HOST asignado (host_user_id) en "Mis campeonatos"
-- ============================================================================
-- Base: Fase 22. Dos cambios MÍNIMOS, sin N+1 (una sola consulta, sin subconsulta por fila nueva):
--   (1) El payload ahora expone `host_user_id` → Perfil detecta "soy el Host" (host_user_id === auth.uid()).
--   (2) El WHERE añade la rama host: un campeonato donde el usuario es host_user_id aparece en su lista aunque
--       no sea owner ni jugador. Mismos estados que la rama owner (el host es organizador operativo).
-- NO cambia permisos de acción, lifecycle, is_participant ni el orden. host_user_id sigue siendo la ÚNICA
-- fuente del Host. Sigue SECURITY DEFINER acotado por auth.uid().
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
    'live_started_at', c.live_started_at,   -- Fase 21: antena "En vivo" en la card de Perfil
    'host_user_id', c.host_user_id,          -- Fase 27: Perfil marca "Organiza" si host_user_id = auth.uid()
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
      -- Fase 27: host asignado (organizador operativo) — mismos estados que owner.
      (c.host_user_id is not null and c.host_user_id = auth.uid()
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
