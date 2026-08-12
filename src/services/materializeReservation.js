// ── materializeReservation — ÚNICA orquestación del dominio de reserva ─────────
// Extraída de ConfirmReservation.handlePaid (main flow). La invocan TANTO el
// camino interno (checkout) COMO confirm_order (server), difiriendo SOLO en el ctx.
//
// NO contiene UI, navegación ni caches locales (eso vive en el checkout). Las
// REGLAS son idénticas a las de handlePaid: createReservation → game_players
// (con derivación de grupo de capitán) → reserve_slots → notifications, en el
// mismo orden y con los mismos parámetros. Solo se parametriza por
//   ctx = { db, actor, orderId? }.
//
// Devuelve un resultado que el llamador mapea a su UI:
//   { code: 'RENTAL_TAKEN' | 'GAME_FULL' } · { error, skipped } · { ok, reservationId, referralConsumed }

import { createReservation, createGamePlayer } from './reservationService.js';
import { resolveCaptainGroupAssignment } from './captainGroupService.js';

async function loadSlotSnapshot(db, gameId, referral) {
  const { data } = referral != null
    ? await db.rpc('get_slot_reservation_for_user', { p_game_id: gameId, p_user_id: referral })
    : await db.rpc('get_slot_reservation', { p_game_id: gameId });
  return data;
}

const _firstName = (n) => (n || '').split(' ')[0];

export async function materializeReservation(ctx, snapshot) {
  const {
    gameId, gameType, unitPrice, promoCode, promoDiscount, totalAmount, subtotalAmount,
    playersCount, guestTotal, paymentMethod, creditApplied, source,
    guests = [], reservedSlots = 0, referral = null, titularNet,
    hostUserId = null, venueId = null, releaseHours, payerName,
  } = snapshot;
  const db = ctx.db;
  const actor = ctx.actor;

  // 1) Asiento en el ledger (spend). La proveniencia order_id viaja en el ctx.
  const { data: resData, error, skipped, rentalTaken } = await createReservation({
    gameId, unitPrice, promoCode, promoDiscount,
    totalAmount, subtotalAmount, playersCount, guestTotal,
    paymentMethod, creditApplied, source,
  }, ctx);
  if (rentalTaken) return { code: 'RENTAL_TAKEN' };
  if (skipped || error) return { error, skipped };
  const reservationId = resData?.id ?? null;

  let referralConsumed = false;

  // 2) Roster + R1 (solo match). Misma derivación de grupo de capitán.
  if (gameType === 'match' || !gameType) {
    const slotRes = await loadSlotSnapshot(db, gameId, referral);
    const aTit = resolveCaptainGroupAssignment(slotRes, { actorUserId: actor, enrolleeUserId: actor, linkOwnerUserId: referral });
    const { error: gpErr } = await createGamePlayer({ gameId, reservationId, amount: titularNet, hostUserId, gameSlotReservationId: aTit.gameSlotReservationId, countsReservedSlot: aTit.countsReservedSlot, referredByUserId: aTit.referredByUserId }, ctx);
    if (gpErr?.message?.startsWith('GAME_FULL')) return { code: 'GAME_FULL' };
    if (!gpErr) referralConsumed = true;
    if (reservedSlots > 0 && !gpErr) {
      const { error: rsErr } = await db.rpc('reserve_slots', { p_game_id: gameId, p_reserved_slots_total: reservedSlots, p_actor: actor });
      if (rsErr) return rsErr.message?.startsWith('GAME_FULL') ? { code: 'GAME_FULL', referralConsumed } : { error: rsErr, referralConsumed };
    }
    await Promise.all(guests.map(guest => {
      const aG = resolveCaptainGroupAssignment(slotRes, { actorUserId: actor, enrolleeUserId: guest.id, linkOwnerUserId: null });
      return createGamePlayer({ gameId, userId: guest.id, reservationId, amount: unitPrice, hostUserId, gameSlotReservationId: aG.gameSlotReservationId, countsReservedSlot: aG.countsReservedSlot, referredByUserId: aG.referredByUserId }, ctx);
    }));
  }

  // 3) Notificaciones (fire-and-forget; mismas plantillas y textos).
  const tpl = guests.length > 0 ? 'reservation_confirmed_with_guests' : 'reservation_confirmed';
  let tplText;
  if (reservedSlots > 0) {
    const cupos   = `${reservedSlots} ${reservedSlots === 1 ? 'cupo' : 'cupos'}`;
    const incluye = guests.length > 0
      ? `${guests.length} ${guests.length === 1 ? 'invitado' : 'invitados'} y ${cupos}`
      : cupos;
    const plural  = (reservedSlots + guests.length) > 1;
    tplText = `Tu reserva incluye ${incluye}. Compártelo${plural ? 's' : ''} con tus amigos antes de ${releaseHours} h del partido.`;
  } else {
    tplText = guests.length > 0
      ? 'Tu reserva incluye invitados. Recuérdales la hora y lugar.'
      : 'Tu reserva ha sido confirmada. ¡Hasta la cancha!';
  }
  db.from('notifications').insert({
    recipient_user_id: actor,
    source_type: 'venue', delivery_type: 'automatic', category: 'reservation',
    template_key: tpl, custom_text: tplText,
    game_id: gameId, venue_id: venueId ?? null, reservation_id: reservationId,
    sent_at: new Date().toISOString(),
  }).then(({ error }) => { if (error) console.error('[notif]', tpl, 'failed:', error); });
  guests.filter(g => g.id).forEach(guest => {
    db.from('notifications').insert({
      recipient_user_id: guest.id,
      source_type: 'venue', delivery_type: 'automatic', category: 'invitation',
      template_key: 'invited_by_player',
      custom_text: `${_firstName(payerName)} te invitó a jugar. Revisa los detalles.`,
      game_id: gameId, venue_id: venueId ?? null, created_by: actor,
      sent_at: new Date().toISOString(),
    }).then(({ error }) => { if (error) console.error('[notif] invited_by_player (main) failed for', guest.id, error); });
  });

  return { ok: true, reservationId, referralConsumed };
}
