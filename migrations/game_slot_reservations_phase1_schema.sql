-- ============================================================================
-- V6 · game_slot_reservations — MIGRACIÓN INCREMENTAL (ALTER) al modelo V6
-- ============================================================================
-- Transforma la tabla EXISTENTE (no la crea). Modelo V6:
--   · Estados exclusivos: 'inactive' | 'active'  (fuera 'canceled'/'released'/'expired').
--   · reserved_slots_total ≥ 0 (puede ser 0).
--   · reserved_slots_used  ≥ 0.
--   · reserved_slots_remaining continúa siendo GENERADA = max(total - used, 0)  → NO se toca.
--   · Índice único: (game_id, reserved_by_user_id).
--
-- No crea la tabla. No añade ni elimina columnas (released_*, expires_at,
-- reserved_by_role, etc. se conservan). Sin RPC, triggers ni funciones.
--
-- Requisito: no deben existir filas con status distinto de 'inactive'/'active'
-- (el nuevo CHECK las rechazaría). En el flujo actual reserve_slots solo produjo
-- 'inactive'/'active', así que es seguro.
-- ============================================================================

-- 1) status: default 'inactive' y CHECK exclusivo ('inactive','active').
alter table public.game_slot_reservations
  alter column status set default 'inactive';

alter table public.game_slot_reservations
  drop constraint if exists game_slot_reservations_status_check;

-- Normaliza cualquier fila legacy (canceled/released/expired) antes del nuevo CHECK.
update public.game_slot_reservations
set status = 'inactive'
where status not in ('inactive', 'active');

alter table public.game_slot_reservations
  add constraint game_slot_reservations_status_check
  check (status in ('inactive', 'active'));

-- 2) reserved_slots_total ≥ 0 (admite 0). Se normaliza el CHECK con nombre estable.
alter table public.game_slot_reservations
  drop constraint if exists game_slot_reservations_total_positive;
alter table public.game_slot_reservations
  drop constraint if exists game_slot_reservations_total_nonneg;
alter table public.game_slot_reservations
  add constraint game_slot_reservations_total_nonneg
  check (reserved_slots_total >= 0);

-- 3) reserved_slots_used ≥ 0.
alter table public.game_slot_reservations
  drop constraint if exists game_slot_reservations_used_nonneg;
alter table public.game_slot_reservations
  add constraint game_slot_reservations_used_nonneg
  check (reserved_slots_used >= 0);

-- 4) Índice único incondicional (game_id, reserved_by_user_id).
--    Se retiran posibles índices únicos previos (parcial u otra versión) y se deja uno canónico.
drop index if exists public.game_slot_reservations_active_uk;
drop index if exists public.game_slot_reservations_captain_uk;

create unique index if not exists game_slot_reservations_game_user_uk
  on public.game_slot_reservations using btree (game_id, reserved_by_user_id);
