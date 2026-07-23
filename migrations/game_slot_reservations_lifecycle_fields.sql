-- ============================================================================
-- V6 · game_slot_reservations — campos de ciclo de vida (ampliación incremental)
-- ============================================================================
-- Añade métricas y el motivo del ciclo de vida de la R1. NO cambia ninguna regla
-- de negocio existente ni el modelo V6: los estados siguen siendo 'inactive'/'active'
-- y toda la lógica de capacidad/consumo/herencia queda intacta.
--
--   released_reason         text  — motivo de la ÚLTIMA liberación (nullable).
--                                   CHECK: automatic | manual_cancel_slots |
--                                          manual_cancel_participation | admin
--                                   Persiste tras reactivar (histórico, no estado).
--   released_at             timestamptz — momento de la ÚLTIMA liberación (nullable).
--   initial_reserved_slots  int   — reserved_slots_total con el que NACIÓ la R1.
--   peak_reserved_slots     int   — mayor reserved_slots_total histórico.
--   last_released_slots     int   — reserved_slots_total justo ANTES de liberar.
--
-- La escritura de estos campos vive en reserve_slots() (ver reserve_slots.sql).
-- No crea triggers, no hace backfill (los valores históricos previos no se pueden
-- reconstruir; las R1 existentes quedan en NULL hasta su próxima escritura).
-- ============================================================================

alter table public.game_slot_reservations
  add column if not exists released_reason        text,
  add column if not exists released_at            timestamptz,
  add column if not exists initial_reserved_slots integer,
  add column if not exists peak_reserved_slots    integer,
  add column if not exists last_released_slots     integer;

alter table public.game_slot_reservations
  drop constraint if exists game_slot_reservations_released_reason_check;

alter table public.game_slot_reservations
  add constraint game_slot_reservations_released_reason_check
  check (
    released_reason is null
    or released_reason in ('automatic', 'manual_cancel_slots', 'manual_cancel_participation', 'admin')
  );
