-- ============================================================================
-- NUEVO MODELO — counts_reserved_slot default NULL
-- ============================================================================
-- "Jugador normal / sin R1" debe quedar con counts_reserved_slot = NULL. Como
-- createGamePlayer() NO escribe la columna cuando no hay R1 (gameSlotReservationId
-- null), el valor de un INSERT público lo pone el DEFAULT. Se cambia de false → NULL.
--
-- La columna sigue siendo boolean nullable. No migra datos históricos (las filas
-- existentes conservan su valor; solo cambia el default de futuros INSERT).
-- ============================================================================

alter table public.game_players
  alter column counts_reserved_slot set default null;
