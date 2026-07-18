// ============================================================================
// captainSlots — fuente de verdad V6 para el badge de "reserva de cupos".
// ============================================================================
// El badge existe mientras el capitán tenga una R1 PROPIA y ACTIVA (total > 0),
// con independencia de cuántos jugadores estén inscritos (used puede ser 0).
//
// Fuente: filas de game_slot_reservations con reserved_by_user_id = usuario y
// status = 'active' (RLS select-own). NO se deriva de la pertenencia
// (game_players.game_slot_reservation_id), porque una reserva recién creada aún
// no tiene miembros enlazados y el badge debe aparecer igualmente.
//
// No recalcula used/total: se leen tal cual del backend.

// Mapa game_id → { used, total } a partir de las R1 propias/activas del capitán.
export function buildCaptainSlotsMap(r1Rows) {
  const map = new Map();
  (r1Rows ?? []).forEach(r => {
    if ((r.reserved_slots_total ?? 0) > 0) {
      map.set(r.game_id, { used: r.reserved_slots_used ?? 0, total: r.reserved_slots_total ?? 0 });
    }
  });
  return map;
}
