-- ============================================================================
-- NUEVO MODELO · FASE 1 — Solo esquema de game_slot_reservations
-- ============================================================================
-- Deja la tabla lista para el modelo definitivo (R1 única por capitán/partido,
-- que nace `inactive` con total=0 en la primera inscripción). NO toca RPC,
-- NO toca frontend, NO borra datos, NO migra histórico, NO renombra ni elimina
-- columnas (released_*, expires_at, etc. se conservan aunque queden en desuso).
--
-- Cambios:
--   1) status admite 'inactive' → ciclo de vida inactive/active/canceled.
--   2) default de status = 'inactive'.
--   3) reserved_slots_total admite 0 (CHECK  > 0  →  >= 0).
--   4) una única R1 por (game_id, reserved_by_user_id) en CUALQUIER estado
--      (índice único parcial → incondicional).
--
-- Supuesto: la tabla no tiene filas con status 'released'/'expired' ni
-- duplicados por (game_id, reserved_by_user_id). Es así porque reserve_slots()
-- y consume_reserved_slot() nunca se han invocado (game_slot_reservations vacía).
-- Si hubiera filas legacy, el nuevo CHECK/índice fallaría de forma explícita.
-- ============================================================================

-- 1 + 2) Estado: default 'inactive' y ciclo de vida inactive/active/canceled.
alter table public.game_slot_reservations
  alter column status set default 'inactive';

alter table public.game_slot_reservations
  drop constraint if exists game_slot_reservations_status_check;

alter table public.game_slot_reservations
  add constraint game_slot_reservations_status_check
  check (status in ('inactive', 'active', 'canceled'));

-- 3) reserved_slots_total puede ser 0 (R1 nace con total=0).
alter table public.game_slot_reservations
  drop constraint if exists game_slot_reservations_total_positive;

alter table public.game_slot_reservations
  add constraint game_slot_reservations_total_positive
  check (reserved_slots_total >= 0);

-- 4) Una única R1 por (game_id, reserved_by_user_id), independiente del estado.
--    Reemplaza el índice único parcial (WHERE status in ('active','released'))
--    por uno incondicional.
drop index if exists public.game_slot_reservations_active_uk;

create unique index if not exists game_slot_reservations_captain_uk
  on public.game_slot_reservations using btree (game_id, reserved_by_user_id);
