/**
 * Parse a game's start time from canonical DB fields.
 * @param {string} dateKey  "YYYY-MM-DD"
 * @param {string} time24   "HH:MM" or "HH:MM:SS" (Postgres time, 24h)
 */
export function gameStartDate(dateKey, time24) {
  if (!dateKey || !time24) return null;
  const [y, mo, d] = dateKey.split('-').map(Number);
  const [h, m] = time24.split(':').map(Number);
  if ([y, mo, d, h, m].some(isNaN)) return null;
  return new Date(y, mo - 1, d, h, m);
}

export function gameEndDate(dateKey, time24, durationMin) {
  const start = gameStartDate(dateKey, time24);
  return start ? new Date(start.getTime() + (durationMin ?? 90) * 60_000) : null;
}

/** now >= game_end */
export function isGamePast(dateKey, time24, durationMin) {
  const end = gameEndDate(dateKey, time24, durationMin);
  return end ? end <= new Date() : false;
}

/** now >= game_start */
export function isGameStarted(dateKey, time24) {
  const start = gameStartDate(dateKey, time24);
  return start ? start <= new Date() : false;
}

/**
 * Derives the attendance display state from checked_in_at.
 * @param {string|null} checkedInAt  ISO timestamp from game_players.checked_in_at
 * @param {Date|null}   gameStart    Date object from gameStartDate()
 * @param {boolean}     isPast       Whether the game has ended (now >= game_end)
 * @returns {{ status: 'a_tiempo'|'tarde'|'ausente', minsLate: number|null } | null}
 */
export function deriveAttendance(checkedInAt, gameStart, isPast) {
  if (checkedInAt && gameStart) {
    const t = new Date(checkedInAt);
    const minsLate = Math.max(0, Math.round((t.getTime() - gameStart.getTime()) / 60_000));
    return { status: minsLate === 0 ? 'a_tiempo' : 'tarde', minsLate };
  }
  if (isPast) return { status: 'ausente', minsLate: null };
  return null;
}

/**
 * Minimum required players for a format string ("7v7" → 14).
 * Used to derive "Con suplentes" state: total_spots > requiredPlayers(format).
 */
export function requiredPlayers(format) {
  const m = /^(\d+)v\1$/.exec(format || '');
  return m ? Number(m[1]) * 2 : 0;
}

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
