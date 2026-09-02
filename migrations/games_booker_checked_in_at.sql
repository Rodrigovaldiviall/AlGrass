-- ============================================================================
-- games.booker_checked_in_at — asistencia del BOOKER de un Rental
-- ============================================================================
-- Un Rental tiene una ÚNICA asistencia: la del usuario que reservó
-- (games.booked_by_user_id). No usa game_players ni reservations. Es DISTINTA de
-- games.host_checked_in_at (asistencia del HOST). NULL = sin marcar.
--
-- Escritura TEMPORAL desde el frontend (update directo, sin RPC), igual que la
-- asistencia Match actual. La autoridad backend + ventana configurable (Admin
-- Configuración) se harán después conjuntamente para Match + Rental.
-- ============================================================================

alter table public.games
  add column if not exists booker_checked_in_at timestamptz;
