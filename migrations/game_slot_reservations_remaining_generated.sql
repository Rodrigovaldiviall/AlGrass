-- ============================================================================
-- Drift fix — reserved_slots_remaining debe ser GENERATED STORED
-- ============================================================================
-- En Supabase la columna quedó como columna PLANA (is_generated = NEVER). Debe ser:
--   generated always as (greatest(reserved_slots_total - reserved_slots_used, 0)) stored
--
-- Postgres NO permite convertir una columna existente en generada in-place, así que
-- se elimina y se vuelve a crear con el MISMO nombre. NO hay pérdida de datos: el
-- valor es DERIVADO de reserved_slots_total/reserved_slots_used y se recomputa
-- idéntico al recrear la columna generada. No toca ninguna otra columna ni RPC.
--
-- Atómico (begin/commit): si algo falla, no queda estado a medias.
-- ============================================================================

begin;

-- 1) Quitar (si existen) los CHECK que referencian reserved_slots_remaining, para que
--    el DROP COLUMN no requiera CASCADE ni quede bloqueado por dependencias.
--    Ya son obsoletos en el modelo (used puede superar total; el balance no aplica).
alter table public.game_slot_reservations
  drop constraint if exists game_slot_reservations_counts_balance;
alter table public.game_slot_reservations
  drop constraint if exists game_slot_reservations_used_within_total;

-- 2) Recrear la columna como GENERATED STORED, conservando el nombre.
alter table public.game_slot_reservations
  drop column reserved_slots_remaining;

alter table public.game_slot_reservations
  add column reserved_slots_remaining integer
  generated always as (greatest(reserved_slots_total - reserved_slots_used, 0)) stored;

commit;
