-- ============================================================================
-- FASE 3 — game_players.game_slot_reservation_id
-- ============================================================================
-- Pertenencia PERMANENTE de un jugador al grupo originado por una reserva de
-- capitán, para ese partido. La asigna y propaga EXPLÍCITAMENTE la lógica de las
-- RPC (sin trigger). Nunca se elimina por cancelación, reingreso, released ni
-- expired: representa la pertenencia histórica al grupo.
--
-- ON DELETE SET NULL: si algún día se borrara la reserva, el jugador conserva su
-- fila (solo pierde el vínculo). Las reservas normalmente no se borran, se liberan.
-- ============================================================================

alter table public.game_players
  add column if not exists game_slot_reservation_id uuid
    references public.game_slot_reservations(id) on delete set null;

create index if not exists game_players_slot_reservation_idx
  on public.game_players using btree (game_slot_reservation_id);
