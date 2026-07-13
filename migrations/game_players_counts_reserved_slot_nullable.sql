-- ============================================================================
-- NUEVO MODELO — counts_reserved_slot admite NULL
-- ============================================================================
-- La columna sigue siendo boolean, pero ahora puede valer NULL / FALSE / TRUE:
--   NULL  → no consume cupos reservados (público sin R1, o capitán de su grupo).
--   FALSE → pertenece a un grupo (R1); aún no consume; puede pasar a TRUE.
--   TRUE  → pertenece al grupo; consume; nunca vuelve a FALSE.
--
-- Solo se quita el NOT NULL para poder almacenar NULL (capitán). El tipo (boolean)
-- y el default (false) se conservan. No migra datos históricos.
-- ============================================================================

alter table public.game_players
  alter column counts_reserved_slot drop not null;
