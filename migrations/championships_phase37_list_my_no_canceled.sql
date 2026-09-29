-- ============================================================================
-- Campeonatos · Fase 37 — list_my_championships NO incluye campeonatos 'canceled' (Perfil)
-- ============================================================================
-- BUG: un campeonato creado con transferencia cuyo pago se abandona/expira pasa a status='canceled'
-- (championships_phase2_transfer_hold: el hold vencido/abortado marca el campeonato como 'canceled'). Pero
-- list_my_championships (Fase 27) incluía 'canceled' en las 3 ramas (owner/host/participante) → seguía
-- apareciendo en "Mis campeonatos" en Perfil.
--
-- FIX en la FUENTE (no filtro visual): se elimina 'canceled' de las 3 ramas. Todo lo demás IDÉNTICO a Fase 27
-- (payload, host_user_id, is_participant, orden, revoke/grant). Se conservan los estados VÁLIDOS:
--   owner/host → payment_validation, pending_publish, registration_open, registration_closed, in_progress, completed.
--   participante → registration_open, registration_closed, in_progress, completed.
-- NO toca lifecycle, cancelación admin, pagos, fixture, teams ni ninguna otra RPC. Solo el listado de Perfil.
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
    'live_started_at', c.live_started_at,
    'host_user_id', c.host_user_id,
    'is_participant', exists (
      select 1 from public.championship_players cp
       where cp.championship_id = c.id and cp.user_id = auth.uid()
    )
  )
  from public.championships c
  where (
      (c.owner_user_id = auth.uid()
       and c.status in ('payment_validation', 'pending_publish', 'registration_open',
                        'registration_closed', 'in_progress', 'completed'))              -- sin 'canceled' (Fase 37)
      or
      (c.host_user_id is not null and c.host_user_id = auth.uid()
       and c.status in ('payment_validation', 'pending_publish', 'registration_open',
                        'registration_closed', 'in_progress', 'completed'))              -- sin 'canceled' (Fase 37)
      or
      (exists (select 1 from public.championship_players cp
                where cp.championship_id = c.id and cp.user_id = auth.uid())
       and c.status in ('registration_open', 'registration_closed',
                        'in_progress', 'completed'))                                     -- sin 'canceled' (Fase 37)
    )
  order by c.event_date asc;
$$;
revoke all on function public.list_my_championships() from public, anon;
grant execute on function public.list_my_championships() to authenticated;
