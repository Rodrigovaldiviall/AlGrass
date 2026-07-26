// ============================================================================
// captainGroupService — Modelo V6 (Reserva de Cupos)
// ============================================================================
// ÚNICO lugar donde vive la inteligencia de game_slot_reservation_id,
// counts_reserved_slot y referred_by_user_id.
//
// Función PURA: no importa servicios, no llama a Supabase, no lee auth. Recibe
// hechos ya resueltos por el caller y devuelve la asignación. No conoce flujos.
//
// Se resuelven DOS conceptos INDEPENDIENTES entre sí:
//
//   A) game_slot_reservation_id + counts_reserved_slot  (a partir del snapshot de
//      get_slot_reservation() del ACTOR):
//        1) reserva PROPIA del actor ACTIVE → hereda esa (counts=true).
//        2) si no, pertenencia del actor ACTIVE → hereda esa (counts=true).
//        3) si no → null / null.
//
//   B) referred_by_user_id  (a partir de un contexto de referido, TOTALMENTE
//      independiente de la Reserva de Cupos):
//        1) Checkout público (el actor se inscribe a sí mismo, sin link) → null.
//        2) Invitación (el actor inscribe a otro)                         → actorUserId.
//        3) Link (entra por un link)                                      → linkOwnerUserId.
//      Precedencia: link > invitación > público.
// ============================================================================

/**
 * @typedef {Object} SlotReservationSnapshot  Fila devuelta por get_slot_reservation().
 * @property {boolean}     has_reservation
 * @property {string|null} reservation_id
 * @property {string|null} status
 * @property {string|null} member_reservation_id
 * @property {string|null} member_reservation_status
 */

/**
 * @typedef {Object} ReferralContext  Contexto del referido (independiente de R1).
 * @property {string|null} actorUserId      - quién origina la inscripción.
 * @property {string|null} enrolleeUserId   - a quién se inscribe (self ⇒ checkout público).
 * @property {string|null} linkOwnerUserId  - dueño del link, si la entrada es por link.
 */

/**
 * @typedef {Object} CaptainGroupAssignment
 * @property {string|null}  gameSlotReservationId
 * @property {boolean|null} countsReservedSlot
 * @property {string|null}  referredByUserId
 */

/**
 * Resuelve grupo/consumo (V6) y referido para un ACTOR. Función PURA.
 *
 * @param {SlotReservationSnapshot|SlotReservationSnapshot[]|null} slotReservation
 *   Respuesta de get_slot_reservation() (o el array; se usa el primer elemento).
 * @param {ReferralContext} [referral]
 *   Contexto del referido. Si se omite, referredByUserId = null.
 * @returns {CaptainGroupAssignment}
 */
export function resolveCaptainGroupAssignment(slotReservation, referral = {}) {
  const row = Array.isArray(slotReservation) ? slotReservation[0] : slotReservation;
  const { actorUserId = null, enrolleeUserId = null, linkOwnerUserId = null } = referral;

  // ── B) referred_by_user_id (independiente de Reserva de Cupos) ──────────────
  let referredByUserId;
  if (linkOwnerUserId != null) {
    referredByUserId = linkOwnerUserId;                                    // 3) link
  } else if (actorUserId != null && enrolleeUserId != null && enrolleeUserId !== actorUserId) {
    referredByUserId = actorUserId;                                        // 2) invitación
  } else {
    referredByUserId = null;                                               // 1) checkout público
  }

  // ── A) game_slot_reservation_id + counts_reserved_slot (modelo V6) ──────────
  let gameSlotReservationId = null;
  let countsReservedSlot = null;
  if (row?.has_reservation && row?.status === 'active') {
    gameSlotReservationId = row.reservation_id;
    countsReservedSlot = true;
  } else if (row?.member_reservation_id != null && row?.member_reservation_status === 'active') {
    gameSlotReservationId = row.member_reservation_id;
    countsReservedSlot = true;
  }

  // TEMP DEBUG (referral) — eliminar tras diagnosticar Caso A vs B.
  console.log('[REFDBG resolve]', { actorUserId, enrolleeUserId, linkOwnerUserId, out_referredBy: referredByUserId });
  return { gameSlotReservationId, countsReservedSlot, referredByUserId };
}
