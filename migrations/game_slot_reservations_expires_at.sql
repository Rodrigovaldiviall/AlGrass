-- ============================================================================
-- V6 · game_slot_reservations.expires_at — deadline de liberación automática
-- ============================================================================
-- Marca temporal fija en la que la R1 debe liberarse automáticamente, según
-- reserved_by_role:
--   captain_gold → game_start − 24h
--   captain      → game_start − 48h
--   venue_owner / algrass_admin / algrass_staff → game_start (sin adelanto)
--
-- Se escribe UNA sola vez, al NACER la R1 (dentro de reserve_slots, rama INSERT),
-- y permanece INALTERABLE durante toda la vida de la reserva (no se recalcula al
-- redimensionar cupos ni al reactivar). Las R1 preexistentes quedan en NULL y por
-- diseño nunca expiran automáticamente (no tienen deadline conocido).
--
-- Índice PARCIAL sobre status='active' para que el barrido del cron sea O(pocas
-- filas): solo indexa las R1 candidatas a expirar.
-- ============================================================================

alter table public.game_slot_reservations
  add column if not exists expires_at timestamptz;

create index if not exists game_slot_reservations_active_expiry_idx
  on public.game_slot_reservations (expires_at)
  where status = 'active';
