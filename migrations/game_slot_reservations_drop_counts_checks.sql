-- ============================================================================
-- NUEVO MODELO · MICROFASE — Eliminar CHECK que contradicen el modelo de grupos
-- ============================================================================
-- En el nuevo modelo `reserved_slots_used` PUEDE superar `reserved_slots_total`
-- (p. ej. total=5, used=7 → remaining=0). La columna generada
--   reserved_slots_remaining = greatest(reserved_slots_total - reserved_slots_used, 0)
-- ya garantiza que remaining nunca sea negativo, así que estos CHECK sobran y
-- bloquean el modelo.
--
-- Solo elimina dos CHECK. NO los reemplaza. NO toca RPC, frontend, índices,
-- otros constraints ni columnas.
--
-- (Estos constraints existen en la base viva pero no en el repo — drift.)
-- ============================================================================

alter table public.game_slot_reservations
  drop constraint if exists game_slot_reservations_counts_balance;

alter table public.game_slot_reservations
  drop constraint if exists game_slot_reservations_used_within_total;
