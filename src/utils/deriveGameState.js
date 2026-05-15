/**
 * Derives the current user's relationship and capabilities for a single game.
 *
 * @param {Array}  rows   - game_players rows for this game.
 *                          Must contain rows where user_id === userId (own slots)
 *                          OR payer_id === userId (own guests). Other rows are ignored.
 * @param {string} userId - current user's ID
 * @returns {{
 *   relationship:        'titular'|'guest'|'canceled-with-guests'|'none',
 *   isVisible:           boolean,
 *   isBooked:            boolean,  // any confirmed slot (titular or guest)
 *   isTitularConfirmed:  boolean,
 *   isGuestConfirmed:    boolean,
 *   mySlotCanceled:      boolean,  // had a slot (now canceled), no confirmed slot
 *   activeGuestCount:    number,
 *   activeGuests:        Array,    // confirmed rows where payer_id === userId
 *   canManage:           boolean,  // has active guests to manage/cancel
 *   canRejoin:           boolean,  // slot canceled → can rejoin
 *   payerId:             string|null,
 *   titularRow:          object|null,
 *   guestRow:            object|null,
 *   canceledRow:         object|null,
 * }}
 */
export function deriveGameState(rows, userId) {
  const EMPTY = {
    relationship: 'none', isVisible: false,
    isBooked: false, isTitularConfirmed: false, isGuestConfirmed: false,
    mySlotCanceled: false, activeGuestCount: 0, activeGuests: [],
    canManage: false, canRejoin: false,
    payerId: null, titularRow: null, guestRow: null, canceledRow: null,
  };
  if (!userId || !rows?.length) return EMPTY;

  const titularRow  = rows.find(r => r.user_id === userId && r.payer_id === userId && r.status === 'confirmed') ?? null;
  const guestRow    = rows.find(r => r.user_id === userId && r.payer_id !== userId && r.status === 'confirmed') ?? null;
  const canceledRow = rows.find(r => r.user_id === userId && r.status === 'canceled') ?? null;

  const isTitularConfirmed = !!titularRow;
  const isGuestConfirmed   = !!guestRow;
  const isBooked           = isTitularConfirmed || isGuestConfirmed;
  const mySlotCanceled     = !isBooked && !!canceledRow;

  const activeGuests     = rows.filter(r => r.payer_id === userId && r.user_id !== userId && r.status === 'confirmed');
  const activeGuestCount = activeGuests.length;

  const relationship =
    isTitularConfirmed                     ? 'titular'              :
    isGuestConfirmed                       ? 'guest'                :
    mySlotCanceled && activeGuestCount > 0 ? 'canceled-with-guests' :
                                             'none';

  return {
    relationship,
    isVisible:          relationship !== 'none',
    isBooked,
    isTitularConfirmed,
    isGuestConfirmed,
    mySlotCanceled,
    activeGuestCount,
    activeGuests,
    canManage:   activeGuestCount > 0,
    canRejoin:   mySlotCanceled,
    payerId:     guestRow?.payer_id ?? canceledRow?.payer_id ?? null,
    titularRow,
    guestRow,
    canceledRow,
  };
}
