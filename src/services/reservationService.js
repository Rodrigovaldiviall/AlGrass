import { supabase } from '../lib/supabase';
import { isExpiredPeru, parsePeruDateTime } from '../lib/peruTime';
import { notifyWaitlistUsers } from './waitlistService';

// ── internal helpers ──────────────────────────────────────────────────────────

async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

async function ensureWalletSummary(userId) {
  const { data } = await supabase.from('wallet_summary').select('user_id').eq('user_id', userId).maybeSingle();
  if (!data) {
    await supabase.from('wallet_summary').insert({ user_id: userId, total_amount: 0, reserved_balance: 0, credit_balance: 0 });
  }
}

// Read-modify-write on wallet_summary. Race condition acceptable for this app.
async function applySpend(userId, { totalAmount, subtotalAmount, creditApplied = 0 }) {
  await ensureWalletSummary(userId);
  const { data } = await supabase.from('wallet_summary')
    .select('total_amount, reserved_balance, credit_balance')
    .eq('user_id', userId).single();
  const cur = data ?? { total_amount: 0, reserved_balance: 0, credit_balance: 0 };
  const next = {
    user_id:          userId,
    total_amount:     cur.total_amount     + totalAmount,
    reserved_balance: cur.reserved_balance + subtotalAmount,
    credit_balance:   Math.max(0, cur.credit_balance - creditApplied),
  };
  await supabase.from('wallet_summary').upsert(next, { onConflict: 'user_id' });
}

async function applyRefund(userId, refundAmount) {
  // RPC with SECURITY DEFINER: bypasses RLS for cross-user refunds (e.g. guest cancels, refund goes to payer)
  await supabase.rpc('apply_wallet_refund', { p_user_id: userId, p_amount: refundAmount });
}

const deaccent = s => (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '');

function formatGameTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h)) return timeStr;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m ?? 0).padStart(2, '0')} ${ampm}`;
}

function rankPlayers(players, query) {
  const q = deaccent(query).toLowerCase();
  return players
    .map(p => {
      const name  = deaccent(p.name || '').toLowerCase();
      const code  = deaccent(p.code || '').toLowerCase().replace(/^@/, '');
      const words = name.split(/\s+/);
      const rank  = name.startsWith(q) || code.startsWith(q)  ? 0
                  : words.some(w => w.startsWith(q))           ? 1
                  : 2;
      return { ...p, _rank: rank };
    })
    .sort((a, b) => a._rank - b._rank || a.name.localeCompare(b.name, 'es'))
    .map(({ _rank, ...p }) => p);
}

// ── wallet ────────────────────────────────────────────────────────────────────

export async function getWalletBalance() {
  if (!supabase) return 0;
  const session = await getSession();
  if (!session?.user?.id) return 0;
  await ensureWalletSummary(session.user.id);
  const { data } = await supabase.from('wallet_summary').select('credit_balance').eq('user_id', session.user.id).single();
  return data?.credit_balance ?? 0;
}

// ── promo codes ───────────────────────────────────────────────────────────────

export async function validatePromoCode(code, unitPrice, gameType = null) {
  if (!supabase || !code?.trim()) return { error: 'invalid' };
  const { data, error } = await supabase
    .from('promo_codes')
    .select('discount_percent, expires_at, promo_games_type')
    .eq('code', code.trim().toUpperCase())
    .eq('active', true)
    .maybeSingle();
  if (error || !data) return { error: 'invalid' };
  if (isExpiredPeru(data.expires_at)) return { error: 'invalid' };
  if (data.promo_games_type && data.promo_games_type !== 'all' && data.promo_games_type !== gameType) {
    return { error: 'wrong_type' };
  }
  const discount = Math.min(unitPrice * (data.discount_percent / 100), unitPrice);
  return { discount, value: data.discount_percent, code: code.trim().toUpperCase() };
}

// ── user search ───────────────────────────────────────────────────────────────

export async function searchUsers(query, { limit = 20, excludeIds = [] } = {}) {
  if (!supabase || !query?.trim()) return [];
  const session = await getSession();
  const currentId = session?.user?.id;
  const q      = query.trim();
  const qDb    = deaccent(q).toLowerCase();
  const allExclude = currentId ? [...excludeIds, currentId] : excludeIds;
  let req = supabase
    .from('users')
    .select('id, full_name, user_code, avatar_hue, avatar_path, avatar_updated_at, preferred_position, birth_date')
    .or(`full_name_search.ilike.%${qDb}%,user_code.ilike.%${qDb}%`)
    .limit(limit);
  if (allExclude.length) req = req.not('id', 'in', `(${allExclude.join(',')})`);
  const { data, error } = await req;
  console.debug('[searchUsers] query:', qDb, '| error:', error, '| rows:', data?.length ?? 'null');
  if (error) { console.error('[searchUsers] FULL ERROR:', error); return []; }
  const players = (data || []).map(u => {
    let age = null;
    if (u.birth_date) {
      const bd  = new Date(u.birth_date);
      const now = new Date();
      age = now.getFullYear() - bd.getFullYear();
      if (now.getMonth() < bd.getMonth() || (now.getMonth() === bd.getMonth() && now.getDate() < bd.getDate())) age--;
    }
    return {
      id:            u.id,
      name:          u.full_name || '',
      code:          u.user_code ? `@${u.user_code}` : '',
      hue:           u.avatar_hue ?? ([...(u.full_name || '·')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360),
      avatarPath:    u.avatar_path    ?? null,
      avatarVersion: u.avatar_updated_at ? new Date(u.avatar_updated_at).getTime() : null,
      position:      u.preferred_position || null,
      age,
    };
  });
  return rankPlayers(players, qDb);
}

// ── match status helpers ──────────────────────────────────────────────────────

async function setMatchReserved(gameId) {
  await supabase.from('games')
    .update({ status: 'reserved' })
    .eq('id', gameId)
    .eq('status', 'published');
}

async function setMatchPublishedIfEmpty(gameId) {
  const { count } = await supabase.from('game_players')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', gameId)
    .eq('status', 'confirmed');
  if (count === 0) {
    await supabase.from('games')
      .update({ status: 'published' })
      .eq('id', gameId)
      .eq('status', 'reserved');
  }
}

// ── reserve ───────────────────────────────────────────────────────────────────

// Appends a spend record to reservations (append-only ledger).
export async function createReservation({ gameId, unitPrice, promoCode, promoDiscount, totalAmount, subtotalAmount, playersCount, guestTotal, paymentMethod, creditApplied, source }) {
  if (!supabase) return { skipped: true };
  const session = await getSession();
  if (!session?.user?.id) return { skipped: true };

  await applySpend(session.user.id, { totalAmount, subtotalAmount: subtotalAmount || totalAmount, creditApplied: creditApplied || 0 });

  const { data, error } = await supabase
    .from('reservations')
    .insert({
      game_id:             gameId,
      user_id:             session.user.id,
      status:              'spend',
      unit_price:          unitPrice,
      promo_code:          promoCode || null,
      promo_discount:      promoDiscount || 0,
      credit_applied:      creditApplied || 0,
      total_amount:        totalAmount > 0 ? totalAmount : null,
      subtotal_amount:     subtotalAmount || totalAmount,
      players_count:       playersCount || 1,
      guest_total:         guestTotal || 0,
      payment_method:      totalAmount > 0 ? paymentMethod : null,
      source:              source || 'match',
      reserved_at:         new Date().toISOString(),
      reservation_type:    'normal',
      invited_by_user_id:  null,
    })
    .select('id')
    .single();
  if (error) { console.error('[createReservation]', error); return { data, error }; }

  if (source === 'rental' && gameId) {
    // Claim if published (normal) OR reserved-but-unclaimed (stuck state from pre-migration booking).
    const { error: gameErr } = await supabase
      .from('games')
      .update({ status: 'reserved', booked_by_user_id: session.user.id })
      .eq('id', gameId)
      .or('status.eq.published,and(status.eq.reserved,booked_by_user_id.is.null)');
    if (gameErr) console.error('[createReservation] game status update failed:', gameErr);
  }

  return { data, error };
}

// Activates (or reactivates) a game_players slot via upsert on (game_id, user_id, payer_id).
export async function createGamePlayer({ gameId, userId = null, payerId = null, reservationId = null, amount = 0, reservationType = 'normal', invitedByUserId = null, hostUserId = null }) {
  if (!supabase) return { skipped: true };
  const session = await getSession();
  if (!session?.user?.id) return { skipped: true };
  const resolvedUserId  = userId  || session.user.id;
  const resolvedPayerId = payerId || session.user.id;
  if (hostUserId && resolvedUserId === hostUserId) {
    console.warn('[createGamePlayer] blocked: organizer cannot be added as player');
    return { blocked: true };
  }
  const { data, error } = await supabase
    .from('game_players')
    .upsert({
      game_id:            gameId,
      user_id:            resolvedUserId,
      payer_id:           resolvedPayerId,
      reservation_id:     reservationId,
      amount:             amount,
      status:             'confirmed',
      canceled_at:        null,
      joined_at:          new Date().toISOString(),
      reservation_type:   reservationType,
      invited_by_user_id: invitedByUserId,
    }, { onConflict: 'game_id,user_id,payer_id' })
    .select('id')
    .single();
  if (error) { console.error('[createGamePlayer]', error); return { data, error }; }
  await setMatchReserved(gameId);
  return { data, error };
}

// Organizer invites players for free — no wallet spend, reservation_type = 'invited'.
// user_id = host (same ownership pattern as addGuestsMode reservations).
// Individual invited players are linked via game_players.user_id, not via reservations.user_id.
export async function createInvitedReservation({ gameId, playersCount = 1, unitPrice }) {
  if (!supabase) return { skipped: true };
  const session = await getSession();
  if (!session?.user?.id) return { skipped: true };
  const inviteTotal = unitPrice * playersCount;
  const { data, error } = await supabase
    .from('reservations')
    .insert({
      game_id:            gameId,
      user_id:            session.user.id,  // host — satisfies RLS auth.uid() check
      status:             'spend',
      unit_price:         unitPrice,
      promo_code:         null,
      promo_discount:     inviteTotal,      // full discount → net = 0
      credit_applied:     0,
      total_amount:       0,
      subtotal_amount:    inviteTotal,
      players_count:      playersCount,
      guest_total:        inviteTotal,
      payment_method:     null,
      source:             'organizer_invite',
      reserved_at:        new Date().toISOString(),
      reservation_type:   'invited',
      invited_by_user_id: session.user.id,
    })
    .select('id')
    .single();
  if (error) console.error('[createInvitedReservation]', error);
  return { data, error };
}

// ── cancel ────────────────────────────────────────────────────────────────────

// Cancels current user's confirmed slot, appends a refund reservation, updates wallet.
export async function cancelGamePlayer(gameId, { skipNotification = false } = {}) {
  if (!supabase) return { skipped: true };
  const session = await getSession();
  if (!session?.user?.id) return { skipped: true };

  const { data: rows, error: findErr } = await supabase
    .from('game_players')
    .select('id, reservation_id, amount, payer_id')
    .eq('game_id', gameId)
    .eq('user_id', session.user.id)
    .eq('status', 'confirmed')
    .limit(1);

  if (findErr || !rows?.length) {
    console.warn('[cancelGamePlayer] no confirmed row — skipping');
    return { skipped: true };
  }
  const row = rows[0];
  const refundTo = row.payer_id; // refund always goes to the payer, not the canceler

  const { error: cancelErr } = await supabase
    .from('game_players')
    .update({ status: 'canceled', canceled_at: new Date().toISOString() })
    .eq('id', row.id);
  if (cancelErr) { console.error('[cancelGamePlayer] update failed:', cancelErr); return { error: cancelErr }; }
  await setMatchPublishedIfEmpty(gameId);
  notifyWaitlistUsers(gameId);

  if (row.amount > 0) {
    const { error: ledgerErr } = await supabase.from('reservations').insert({
      game_id:         gameId,
      user_id:         refundTo,
      canceled_by:     session.user.id,
      status:          'refund',
      unit_price:      row.amount,
      subtotal_amount: row.amount,
      players_count:   1,
      guest_total:     0,
      canceled_at:     new Date().toISOString(),
    });
    if (ledgerErr) console.error('[cancelGamePlayer] refund ledger insert failed:', ledgerErr);
    await applyRefund(refundTo, row.amount);

    if (refundTo === session.user.id) {
      // Self-paid slot: credit goes back to the canceler.
      // Caller may pass skipNotification=true when a combined notification will be sent via cancelGuestPlayers.
      if (!skipNotification) {
        supabase.from('notifications').insert({
          recipient_user_id: session.user.id,
          source_type:       'venue',
          delivery_type:     'automatic',
          category:          'refund',
          template_key:      'reservation_cancelled_credit_self',
          game_id:           gameId,
          created_by:        session.user.id,
          sent_at:           new Date().toISOString(),
        }).then(({ error }) => {
          if (error) console.error('[notif] reservation_cancelled_credit_self (game) failed:', error);
          else console.log('[notif] reservation_cancelled_credit_self (game) inserted for', session.user.id);
        });
      }
    } else {
      // Guest slot paid by someone else: fetch both names in one query
      supabase.from('users').select('id, full_name').in('id', [session.user.id, refundTo])
        .then(({ data: users }) => {
          const byId = Object.fromEntries((users ?? []).map(u => [u.id, u.full_name]));
          const cancelerFirst = (byId[session.user.id] ?? '').split(' ')[0] || 'Un jugador';
          const payerFirst    = (byId[refundTo]         ?? '').split(' ')[0] || 'el titular';
          // 1 — notify the guest who canceled
          supabase.from('notifications').insert({
            recipient_user_id: session.user.id,
            source_type:       'venue',
            delivery_type:     'automatic',
            category:          'refund',
            template_key:      'reservation_cancelled_credit_owner',
            custom_text:       `Cancelaste la reserva a la que te invitaron. El crédito fue devuelto a ${payerFirst}.`,
            game_id:           gameId,
            created_by:        session.user.id,
            sent_at:           new Date().toISOString(),
          }).then(({ error }) => {
            if (error) console.error('[notif] reservation_cancelled_credit_owner failed for guest', session.user.id, error);
            else console.log('[notif] reservation_cancelled_credit_owner inserted for guest', session.user.id);
          });
          // 2 — notify the payer
          supabase.from('notifications').insert({
            recipient_user_id: refundTo,
            source_type:       'venue',
            delivery_type:     'automatic',
            category:          'refund',
            template_key:      'guest_invitation_cancelled_credit',
            custom_text:       `${cancelerFirst} canceló su invitación. El crédito fue añadido a tu billetera.`,
            game_id:           gameId,
            created_by:        session.user.id,
            sent_at:           new Date().toISOString(),
          }).then(({ error }) => {
            if (error) console.error('[notif] guest_invitation_cancelled_credit failed for payer', refundTo, error);
            else console.log('[notif] guest_invitation_cancelled_credit inserted for payer', refundTo);
          });
        });
    }
  }

  return { data: row };
}

// Cancels confirmed guest slots owned by current user (payer_id = session.user.id),
// appends one refund reservation per slot, updates wallet with total.
export async function cancelGuestPlayers(gameId, guestUserIds, { selfAlsoCanceled = false } = {}) {
  if (!supabase || !guestUserIds?.length) return { skipped: true };
  const session = await getSession();
  if (!session?.user?.id) return { skipped: true };

  const { data: rows, error: findErr } = await supabase
    .from('game_players')
    .select('id, user_id, reservation_id, amount')
    .eq('game_id', gameId)
    .in('user_id', guestUserIds)
    .eq('payer_id', session.user.id)
    .eq('status', 'confirmed');

  if (findErr || !rows?.length) {
    console.warn('[cancelGuestPlayers] no confirmed guest rows — skipping');
    return { skipped: true };
  }

  const ids = rows.map(r => r.id);
  const { error: cancelErr } = await supabase
    .from('game_players')
    .update({ status: 'canceled', canceled_at: new Date().toISOString() })
    .in('id', ids);
  if (cancelErr) { console.error('[cancelGuestPlayers] update failed:', cancelErr); return { error: cancelErr }; }
  await setMatchPublishedIfEmpty(gameId);
  notifyWaitlistUsers(gameId, rows.length);

  const refundTotal = rows.reduce((s, r) => s + (r.amount || 0), 0);
  if (refundTotal > 0) {
    const { error: ledgerErr } = await supabase.from('reservations').insert({
      game_id:         gameId,
      user_id:         session.user.id,
      canceled_by:     session.user.id,
      status:          'refund',
      unit_price:      rows[0]?.amount ?? 0,
      subtotal_amount: refundTotal,
      players_count:   rows.length,
      guest_total:     refundTotal,
      canceled_at:     new Date().toISOString(),
    });
    if (ledgerErr) console.error('[cancelGuestPlayers] refund ledger insert failed:', ledgerErr);
    await applyRefund(session.user.id, refundTotal);
  }

  // Fetch payer + all guest names in one query for all notification types
  const guestRows = rows.filter(r => r.user_id);
  const allIds = [session.user.id, ...guestRows.map(r => r.user_id)];
  supabase.from('users').select('id, full_name').in('id', allIds)
    .then(({ data: users }) => {
      const byId = Object.fromEntries((users ?? []).map(u => [u.id, u.full_name]));
      const payerFirst = (byId[session.user.id] ?? '').split(' ')[0] || 'El titular';

      if (refundTotal > 0) {
        const titularTemplate = selfAlsoCanceled
          ? 'reservation_cancelled_self_and_guests'
          : 'reservation_cancelled_guests_credit';
        const guestNames = guestRows
          .map(r => (byId[r.user_id] ?? '').split(' ')[0])
          .filter(Boolean);
        const guestNamesStr = guestNames.length === 0 ? 'tus invitados'
          : guestNames.length === 1 ? guestNames[0]
          : `${guestNames.slice(0, -1).join(', ')} y ${guestNames[guestNames.length - 1]}`;
        const titularText = selfAlsoCanceled
          ? `Cancelaste tu reserva y la de ${guestNamesStr}. El crédito fue añadido a tu billetera.`
          : `Cancelaste la reserva de ${guestNamesStr}. El crédito fue añadido a tu billetera.`;
        supabase.from('notifications').insert({
          recipient_user_id: session.user.id,
          source_type:       'venue',
          delivery_type:     'automatic',
          category:          'refund',
          template_key:      titularTemplate,
          custom_text:       titularText,
          game_id:           gameId,
          created_by:        session.user.id,
          sent_at:           new Date().toISOString(),
        }).then(({ error }) => {
          if (error) console.error('[notif]', titularTemplate, 'failed for titular:', session.user.id, error);
          else console.log('[notif]', titularTemplate, 'inserted for titular:', session.user.id);
        });
      }

      // Always notify each canceled guest
      guestRows.forEach(r => {
        supabase.from('notifications').insert({
          recipient_user_id: r.user_id,
          source_type:       'venue',
          delivery_type:     'automatic',
          category:          'invitation',
          template_key:      'guest_invitation_cancelled_by_owner',
          custom_text:       `${payerFirst} canceló tu invitación.`,
          game_id:           gameId,
          created_by:        session.user.id,
          sent_at:           new Date().toISOString(),
        }).then(({ error }) => {
          if (error) console.error('[notif] guest_invitation_cancelled_by_owner failed for', r.user_id, error);
          else console.log('[notif] guest_invitation_cancelled_by_owner inserted for', r.user_id);
        });
      });
    });

  return { data: rows };
}

// Returns the set of game_ids from the given list that the current user has
// actively booked (spend exists, no corresponding refund).
export async function getMyBookedGameIds(gameIds) {
  if (!supabase || !gameIds?.length) return new Set();
  const session = await getSession();
  if (!session?.user?.id) return new Set();
  const userId = session.user.id;

  const { data } = await supabase
    .from('games')
    .select('id')
    .in('id', gameIds)
    .eq('booked_by_user_id', userId);

  return new Set((data || []).map(g => g.id));
}

// Cancels a rental reservation — no game_players involved.
// Refund comes from the original spend reservation's subtotal_amount.
// Idempotent: bails if a refund record already exists for this game+user.
export async function cancelRental(gameId) {
  if (!supabase) return { skipped: true };
  const session = await getSession();
  if (!session?.user?.id) return { skipped: true };
  const userId = session.user.id;

  // Idempotency: block if another user holds the booking.
  // Allow when booked_by_user_id === userId (normal) OR null (stuck state: booked before migration).
  const { data: gameData, error: gameCheckErr } = await supabase
    .from('games').select('booked_by_user_id').eq('id', gameId).single();
  if (gameCheckErr) {
    console.warn('[cancelRental] could not verify booker — skipping');
    return { skipped: true };
  }
  const currentBooker = gameData?.booked_by_user_id;
  if (currentBooker !== null && currentBooker !== userId) {
    console.warn('[cancelRental] another user holds this booking — skipping');
    return { skipped: true };
  }

  const { data: rows, error: findErr } = await supabase
    .from('reservations')
    .select('id, subtotal_amount, total_amount')
    .eq('game_id', gameId)
    .eq('user_id', userId)
    .eq('status', 'spend')
    .order('reserved_at', { ascending: false })
    .limit(1);

  if (findErr || !rows?.length) {
    console.warn('[cancelRental] no spend reservation found');
    return { skipped: true };
  }
  const row = rows[0];
  const refundAmount = row.subtotal_amount ?? row.total_amount ?? 0;

  const { error: ledgerErr } = await supabase.from('reservations').insert({
    game_id:         gameId,
    user_id:         userId,
    canceled_by:     userId,
    status:          'refund',
    subtotal_amount: refundAmount,
    unit_price:      refundAmount,
    players_count:   1,
    guest_total:     0,
    source:          'rental',
    canceled_at:     new Date().toISOString(),
  });
  if (ledgerErr) { console.error('[cancelRental] ledger insert failed:', ledgerErr); return { error: ledgerErr }; }

  if (refundAmount > 0) {
    await applyRefund(userId, refundAmount);

    supabase.from('notifications').insert({
      recipient_user_id: userId,
      source_type:       'venue',
      delivery_type:     'automatic',
      category:          'refund',
      template_key:      'reservation_cancelled_credit_self',
      game_id:           gameId,
      created_by:        userId,
      sent_at:           new Date().toISOString(),
    }).then(({ error }) => {
      if (error) console.error('[notif] reservation_cancelled_credit_self (rental) failed:', error);
      else console.log('[notif] reservation_cancelled_credit_self (rental) inserted for', userId);
    });
  }

  const { error: gameErr } = await supabase.from('games')
    .update({ status: 'published', booked_by_user_id: null })
    .eq('id', gameId);
  if (gameErr) console.error('[cancelRental] game status update failed:', gameErr);

  return { refundAmount };
}

// Cancels invited player slots — no wallet movement (net cost was 0).
// unitPrice is the gross spot price: stored in the refund ledger for financial analytics.
export async function cancelInvitedPlayers(gameId, invitedUserIds, unitPrice = 0) {
  if (!supabase || !invitedUserIds?.length) return { skipped: true };
  const session = await getSession();
  if (!session?.user?.id) return { skipped: true };

  const { data: rows, error: findErr } = await supabase
    .from('game_players')
    .select('id, user_id')
    .eq('game_id', gameId)
    .in('user_id', invitedUserIds)
    .eq('invited_by_user_id', session.user.id)
    .eq('status', 'confirmed');

  if (findErr || !rows?.length) {
    console.warn('[cancelInvitedPlayers] no confirmed invited rows — skipping');
    return { skipped: true };
  }

  const ids = rows.map(r => r.id);
  const { error } = await supabase
    .from('game_players')
    .update({ status: 'canceled', canceled_at: new Date().toISOString() })
    .in('id', ids);

  if (error) { console.error('[cancelInvitedPlayers]', error); return { error }; }
  await setMatchPublishedIfEmpty(gameId);

  const grossTotal = unitPrice * rows.length;
  const { error: ledgerErr } = await supabase.from('reservations').insert({
    game_id:            gameId,
    user_id:            session.user.id,
    canceled_by:        session.user.id,
    status:             'refund',
    unit_price:         unitPrice,
    promo_discount:     grossTotal,
    subtotal_amount:    grossTotal,
    total_amount:       0,
    players_count:      rows.length,
    guest_total:        grossTotal,
    canceled_at:        new Date().toISOString(),
    reservation_type:   'invited',
    invited_by_user_id: session.user.id,
  });
  if (ledgerErr) console.error('[cancelInvitedPlayers] ledger insert failed:', ledgerErr);

  return { data: rows };
}

// Sends venue_changed notifications to all confirmed players of a game.
// customText: optional dynamic body (e.g. 'Tu partido fue movido a la cancha 3.').
// If null, renderNotification falls back to the template's static body.
// The venue name is prepended automatically at render time via the game_id join.
export async function notifyVenueChanged(gameId, { customText = null } = {}) {
  if (!supabase || !gameId) return;
  const { data: players, error } = await supabase
    .from('game_players')
    .select('user_id')
    .eq('game_id', gameId)
    .eq('status', 'confirmed');

  if (error) { console.error('[notifyVenueChanged] fetch players failed:', error); return; }
  if (!players?.length) { console.warn('[notifyVenueChanged] no confirmed players for game', gameId); return; }

  const userIds = [...new Set(players.map(r => r.user_id).filter(Boolean))];
  const now = new Date().toISOString();

  userIds.forEach(userId => {
    supabase.from('notifications').insert({
      recipient_user_id: userId,
      source_type:       'venue',
      delivery_type:     'automatic',
      category:          'operational',
      template_key:      'venue_changed',
      custom_text:       customText ?? null,
      game_id:           gameId,
      sent_at:           now,
    }).then(({ error: e }) => {
      if (e) console.error('[notif] venue_changed failed for', userId, e);
      else console.log('[notif] venue_changed inserted for', userId);
    });
  });
}

// Updates a game's field and notifies all confirmed players.
// Call this from admin/staff UI instead of updating the game directly.
export async function changeGameField(gameId, newFieldId, { customText = null } = {}) {
  if (!supabase || !gameId || !newFieldId) return { skipped: true };
  const { error } = await supabase
    .from('games')
    .update({ field_id: newFieldId })
    .eq('id', gameId);
  if (error) { console.error('[changeGameField] update failed:', error); return { error }; }
  notifyVenueChanged(gameId, { customText });
  return { data: { gameId, newFieldId } };
}

// Sends next_day_reminder notifications to all eligible confirmed players.
// "Eligible" = reserved BEFORE 6PM Lima today (the standard send window).
// Idempotent: skips user+game pairs that already have a next_day_reminder.
// Call manually for testing; wire to a cron job at 18:00 Lima when ready.
export async function sendNextDayReminders() {
  if (!supabase) return { skipped: true };

  // Peru date utilities — Lima is UTC-5, no DST
  const todayKey    = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Lima' });
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const tomorrowKey = new Date(Date.UTC(ty, tm - 1, td + 1)).toISOString().slice(0, 10);
  const cutoffISO   = parsePeruDateTime(todayKey, '18:00').toISOString(); // 6PM Lima today → UTC

  console.log('[reminders] tomorrowKey:', tomorrowKey, '| cutoff:', cutoffISO);

  // 1 — games scheduled tomorrow with their field name and start time
  const { data: games, error: gErr } = await supabase
    .from('games')
    .select('id, time, fields:field_id(name)')
    .eq('date_key', tomorrowKey);

  if (gErr)           { console.error('[reminders] games fetch failed:', gErr); return { error: gErr }; }
  if (!games?.length) { console.log('[reminders] no games tomorrow'); return { sent: 0 }; }

  const gameIds  = games.map(g => g.id);
  const gameById = Object.fromEntries(games.map(g => [g.id, g]));

  // 2 — confirmed players who reserved before the 6PM cutoff
  const { data: players, error: pErr } = await supabase
    .from('game_players')
    .select('user_id, game_id')
    .in('game_id', gameIds)
    .eq('status', 'confirmed')
    .lt('created_at', cutoffISO);

  if (pErr)            { console.error('[reminders] players fetch failed:', pErr); return { error: pErr }; }
  if (!players?.length) { console.log('[reminders] no eligible players'); return { sent: 0 }; }

  // 3 — dedup: skip user+game pairs already notified
  const { data: existing } = await supabase
    .from('notifications')
    .select('recipient_user_id, game_id')
    .eq('template_key', 'next_day_reminder')
    .in('game_id', gameIds);

  const alreadySent = new Set((existing ?? []).map(r => `${r.recipient_user_id}:${r.game_id}`));

  // 4 — insert missing notifications (fire-and-forget)
  const now  = new Date().toISOString();
  let   sent = 0;

  for (const { user_id: userId, game_id: gameId } of players) {
    if (!userId || alreadySent.has(`${userId}:${gameId}`)) continue;

    const game       = gameById[gameId];
    const fieldName  = game?.fields?.name ?? null;
    const timeStr    = formatGameTime(game?.time ?? '');
    const customText = (fieldName && timeStr)
      ? `Tienes un partido mañana en ${fieldName} a las ${timeStr}. Recuerda llegar 15 minutos antes.`
      : null;

    supabase.from('notifications').insert({
      recipient_user_id: userId,
      source_type:       'venue',
      delivery_type:     'automatic',
      category:          'reminder',
      template_key:      'next_day_reminder',
      custom_text:       customText,
      game_id:           gameId,
      sent_at:           now,
    }).then(({ error: e }) => {
      if (e) console.error('[notif] next_day_reminder failed for', userId, gameId, e);
      else   console.log('[notif] next_day_reminder inserted for', userId, gameId);
    });

    sent++;
  }

  console.log(`[reminders] queued ${sent} next_day_reminder notifications`);
  return { sent, tomorrowKey };
}
