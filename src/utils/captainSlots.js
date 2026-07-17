// ============================================================================
// captainSlots — fuente de verdad V6 para el badge de "reserva de cupos".
// ============================================================================
// Datos derivados EXCLUSIVAMENTE del embed PostgREST
// game_players → game_slot_reservations (mismo round-trip que la lista ya hace).
// No recalcula used/total ni reutiliza lógica de V5: los valores salen tal cual
// del backend. El modelo V6 garantiza como máximo una R1 por
// (game_id, reserved_by_user_id); la RLS select-own ya restringe el embed a la
// reserva PROPIA, pero igual se valida reserved_by_user_id de forma explícita.

// Normaliza el embed a un ÚNICO objeto y lo acepta solo si es la R1 PROPIA.
// PostgREST puede entregar objeto (to-one) o array; si es array se exige length===1
// (no se toma la posición 0 por casualidad).
export function pickOwnR1(embedded, userId) {
  const r1 = Array.isArray(embedded)
    ? (embedded.length === 1 ? embedded[0] : null)
    : (embedded ?? null);
  if (!r1 || r1.reserved_by_user_id !== userId) return null;
  return r1;
}

// Mapa game_id → { used, total } de la reserva de cupos ACTIVA (total>0) del capitán.
export function buildCaptainSlotsMap(rows, userId) {
  const map = new Map();
  if (!userId) return map;
  (rows ?? []).forEach(r => {
    const r1 = pickOwnR1(r.game_slot_reservations, userId);
    if (r1 && (r1.reserved_slots_total ?? 0) > 0) {
      map.set(r.game_id, { used: r1.reserved_slots_used ?? 0, total: r1.reserved_slots_total ?? 0 });
    }
  });
  return map;
}
