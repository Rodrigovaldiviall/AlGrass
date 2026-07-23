-- ============================================================================
-- notifications.reservation_id — identifica la reserva que originó la notificación
-- ============================================================================
-- La navegación de notificaciones de reserva debe identificar la reserva por
-- reservation_id (no por game_id), para desambiguar cuando un usuario tiene varias
-- reservas en el mismo partido (reserva propia + invitación, add-players, etc.).
--
-- Columna nullable a propósito: las notificaciones antiguas quedan en NULL y el
-- frontend aplica el fallback por game_id (sin romper el historial).
--
-- NO ejecutar automáticamente. Correr manualmente en Supabase.
-- ============================================================================

alter table public.notifications
  add column if not exists reservation_id uuid references public.reservations(id);
