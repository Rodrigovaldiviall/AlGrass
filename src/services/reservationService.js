import { supabase } from '../lib/supabase.js';
import { isExpiredPeru, hasStartedPeru, parsePeruDateTime } from '../lib/peruTime.js';
import { notifyWaitlistUsers } from './waitlistService.js';

// ── internal helpers ──────────────────────────────────────────────────────────

async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

async function ensureWalletSummary(userId, ctx) {
  const db = ctx?.db ?? supabase;
  const { data } = await db.from('wallet_summary').select('user_id').eq('user_id', userId).maybeSingle();
  if (!data) {
    await db.from('wallet_summary').insert({ user_id: userId, total_amount: 0, reserved_balance: 0, credit_balance: 0 });
  }
}

// Read-modify-write on wallet_summary. Race condition acceptable for this app.
async function applySpend(userId, { totalAmount, subtotalAmount, creditApplied = 0 }, ctx) {
  const db = ctx?.db ?? supabase;
  await ensureWalletSummary(userId, ctx);
  const { data } = await db.from('wallet_summary')
    .select('total_amount, reserved_balance, credit_balance')
    .eq('user_id', userId).single();
  const cur = data ?? { total_amount: 0, reserved_balance: 0, credit_balance: 0 };
  const next = {
    user_id:          userId,
    total_amount:     cur.total_amount     + totalAmount,
    reserved_balance: cur.reserved_balance + subtotalAmount,
    credit_balance:   Math.max(0, cur.credit_balance - creditApplied),
  };
  await db.from('wallet_summary').upsert(next, { onConflict: 'user_id' });
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

export async function validatePromoCode(code, unitPrice, gameType = null, userId = null, gameCity = null) {
  if (!supabase || !code?.trim()) return { error: 'invalid' };
  const { data, error } = await supabase
    .from('promo_codes')
    .select('id, discount_type, discount_percent, discount_amount, starts_at, expires_at, promo_games_type, max_uses_total, max_uses_per_user, city')
    .eq('code', code.trim().toUpperCase())
    .eq('active', true)
    .maybeSingle();
  if (error || !data) return { error: 'invalid' };
  if (isExpiredPeru(data.expires_at)) return { error: 'invalid' };
  if (!hasStartedPeru(data.starts_at)) return { error: 'not_started' };
  if (data.promo_games_type && data.promo_games_type !== 'all' && data.promo_games_type !== gameType) {
    return { error: 'wrong_type' };
  }

  // Segmentación por ciudad (contra la ciudad DEL EVENTO/VENUE, no del usuario).
  //   city NULL/'' → válida para todas. Si tiene ciudad, debe coincidir con gameCity.
  // Normalización robusta (case/acentos/espacios) reutilizando deaccent del módulo.
  if (data.city && deaccent(data.city).trim().toLowerCase() !== deaccent(gameCity || '').trim().toLowerCase()) {
    return { error: 'city_not_allowed' };
  }

  // Límites de uso. Fuente de verdad = reservations (status='spend', promo_code_id).
  // Los refunds NO restan usos (solo se cuentan 'spend'). Sin contadores sincronizados.
  if (data.max_uses_total != null) {
    // COUNT global vía RPC SECURITY DEFINER: el count directo desde el cliente subcuenta
    // por RLS (solo ve filas propias). La RPC devuelve el escalar entero directo en `data`.
    const { data: totalUses } = await supabase.rpc('count_promo_uses', { p_promo_id: data.id });
    if ((totalUses ?? 0) >= data.max_uses_total) return { error: 'limit_reached' };
  }
  if (data.max_uses_per_user != null) {
    const uid = userId ?? (await getSession())?.user?.id ?? null;
    if (uid) {
      const { count } = await supabase
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'spend')
        .eq('promo_code_id', data.id)
        .eq('user_id', uid);
      if ((count ?? 0) >= data.max_uses_per_user) return { error: 'limit_reached_user' };
    }
  }

  // Descuento sobre el subtotal elegible (= unitPrice del titular, igual que hoy).
  //   percent → % del subtotal (tope: el propio subtotal).
  //   fixed   → min(monto nominal, subtotal). Nunca deja total negativo.
  const discount = data.discount_type === 'fixed'
    ? Math.min(Number(data.discount_amount) || 0, unitPrice)
    : Math.min(unitPrice * (data.discount_percent / 100), unitPrice);
  return {
    discount,
    value: data.discount_type === 'fixed' ? data.discount_amount : data.discount_percent,
    code: code.trim().toUpperCase(),
    promoCodeId: data.id,
    discount_type: data.discount_type,
  };
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
    .from('users_public')
    .select('id, full_name, user_code, avatar_hue, avatar_path, avatar_updated_at, preferred_position, age')
    .or(`full_name.ilike.%${qDb}%,user_code.ilike.%${qDb}%`)
    .limit(limit);
  if (allExclude.length) req = req.not('id', 'in', `(${allExclude.join(',')})`);
  const { data, error } = await req;
  console.debug('[searchUsers] query:', qDb, '| error:', error, '| rows:', data?.length ?? 'null');
  if (error) { console.error('[searchUsers] FULL ERROR:', error); return []; }
  const players = (data || []).map(u => {
    return {
      id:            u.id,
      name:          u.full_name || '',
      code:          u.user_code ? `@${u.user_code}` : '',
      hue:           u.avatar_hue ?? ([...(u.full_name || '·')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360),
      avatarPath:    u.avatar_path    ?? null,
      avatarVersion: u.avatar_updated_at ? new Date(u.avatar_updated_at).getTime() : null,
      position:      u.preferred_position || null,
      age:           u.age ?? null,
    };
  });
  return rankPlayers(players, qDb);
}

// ── match status helpers ──────────────────────────────────────────────────────

async function setMatchReserved(gameId, ctx) {
  const db = ctx?.db ?? supabase;
  await db.from('games')
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
export async function createReservation({ gameId, unitPrice, promoCode, promoCodeId, promoDiscount, totalAmount, subtotalAmount, playersCount, guestTotal, paymentMethod, creditApplied, source, invited = false }, ctx) {
  const db = ctx?.db ?? supabase;
  if (!db) return { skipped: true };
  const actor = ctx?.actor ?? (await getSession())?.user?.id;
  if (!actor) return { skipped: true };

  // invited (invitación gratis del host): registro operativo SIN movimiento económico.
  // NO se ejecuta applySpend (no toca credit_balance ni reserved_balance).
  if (!invited) {
    await applySpend(actor, { totalAmount, subtotalAmount: subtotalAmount || totalAmount, creditApplied: creditApplied || 0 }, ctx);
  }

  const { data, error } = await db
    .from('reservations')
    .insert({
      game_id:             gameId,
      user_id:             actor,
      status:              'spend',
      unit_price:          unitPrice,
      promo_code:          promoCode || null,
      promo_code_id:       promoCodeId || null,
      promo_discount:      promoDiscount || 0,
      credit_applied:      creditApplied || 0,
      total_amount:        totalAmount > 0 ? totalAmount : null,
      subtotal_amount:     subtotalAmount || totalAmount,
      players_count:       playersCount || 1,
      guest_total:         guestTotal || 0,
      payment_method:      totalAmount > 0 ? paymentMethod : null,
      source:              source || 'match',
      reserved_at:         new Date().toISOString(),
      // invited (invitación gratis del host): el ledger se identifica como 'invited'
      // desde el origen, con economía 0 (importes ya vienen en 0 en el snapshot).
      reservation_type:    invited ? 'invited' : 'normal',
      invited_by_user_id:  invited ? actor : null,
      // Proveniencia (Etapa 4): solo cuando se materializa desde una Order (camino externo).
      // El camino interno NO pasa ctx.orderId → la columna ni se referencia (queda NULL por
      // default), así que esta línea no depende de reservations.order_id hasta usarse en externo.
      ...(ctx?.orderId != null ? { order_id: ctx.orderId } : {}),
    })
    .select('id')
    .single();
  if (error) { console.error('[createReservation]', error); return { data, error }; }

  if (source === 'rental' && gameId) {
    // Claim if published (normal) OR reserved-but-unclaimed (stuck state from pre-migration booking).
    const { data: claimed, error: gameErr } = await db
      .from('games')
      .update({ status: 'reserved', booked_by_user_id: actor })
      .eq('id', gameId)
      .or('status.eq.published,and(status.eq.reserved,booked_by_user_id.is.null)')
      .select('id');
    if (gameErr) console.error('[createReservation] game status update failed:', gameErr);
    if (!gameErr && (!claimed || claimed.length === 0)) return { data, error, rentalTaken: true };
  }

  return { data, error };
}

// Activates (or reactivates) a game_players slot via upsert on (game_id, user_id, payer_id).
export async function createGamePlayer({ gameId, userId = null, payerId = null, reservationId = null, amount = 0, reservationType = 'normal', invitedByUserId = null, hostUserId = null, gameSlotReservationId = null, countsReservedSlot = undefined, referredByUserId = null }, ctx) {
  const db = ctx?.db ?? supabase;
  if (!db) return { skipped: true };
  const actor = ctx?.actor ?? (await getSession())?.user?.id;
  if (!actor) return { skipped: true };
  const resolvedUserId  = userId  || actor;
  const resolvedPayerId = payerId || actor;
  if (hostUserId && resolvedUserId === hostUserId) {
    console.warn('[createGamePlayer] blocked: organizer cannot be added as player');
    return { blocked: true };
  }
  const { data, error } = await db
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
      // V6 · info de Reserva de Cupos. Escritura CONDICIONAL: la función es un
      // persistidor ciego (la decisión vive en captainGroupService). counts usa
      // centinela undefined (null es un valor con significado); gsr/referred se
      // omiten si son null para no pisar y no fallar si la columna aún no existe.
      ...(gameSlotReservationId != null ? { game_slot_reservation_id: gameSlotReservationId } : {}),
      ...(countsReservedSlot !== undefined ? { counts_reserved_slot: countsReservedSlot } : {}),
      ...(referredByUserId != null ? { referred_by_user_id: referredByUserId } : {}),
    }, { onConflict: 'game_id,user_id,payer_id' })
    .select('id')
    .single();
  if (error) { console.error('[createGamePlayer]', error); return { data, error }; }
  await setMatchReserved(gameId, ctx);
  return { data, error };
}

// Organizer invites players for free — no wallet spend, reservation_type = 'invited'.
// user_id = host (same ownership pattern as addGuestsMode reservations).
// Individual invited players are linked via game_players.user_id, not via reservations.user_id.
export async function createInvitedReservation({ gameId, playersCount = 1, unitPrice }, ctx) {
  const db = ctx?.db ?? supabase;
  if (!db) return { skipped: true };
  const actor = ctx?.actor ?? (await getSession())?.user?.id;
  if (!actor) return { skipped: true };
  const inviteTotal = unitPrice * playersCount;
  const { data, error } = await db
    .from('reservations')
    .insert({
      game_id:            gameId,
      user_id:            actor,  // host — satisfies RLS auth.uid() check
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
      invited_by_user_id: actor,
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

  // Autoridad ECONÓMICA (regla 24h) desde el servidor, ANTES del claim: si no podemos
  // determinar la política de devolución, abortamos SIN cancelar (no dejamos al jugador
  // en un estado parcialmente procesado). Nunca se decide con Date.now() ni con un boolean
  // enviado por la UI.
  const { data: windowData, error: windowErr } = await supabase
    .rpc('match_cancellation_window', { p_game_id: gameId });
  if (windowErr) {
    console.error('[cancelGamePlayer] match_cancellation_window failed:', windowErr);
    return { error: windowErr };
  }
  const win = Array.isArray(windowData) ? windowData[0] : windowData;
  if (!win || typeof win.refundable !== 'boolean') {
    console.error('[cancelGamePlayer] match_cancellation_window returned no verdict');
    return { error: new Error('CANCELLATION_WINDOW_UNAVAILABLE') };
  }
  const refundable = win.refundable;

  // Atomic claim: only the call that flips confirmed→canceled proceeds to refund.
  const { data: claimed, error: cancelErr } = await supabase
    .from('game_players')
    .update({ status: 'canceled', canceled_at: new Date().toISOString(), counts_reserved_slot: false })
    .eq('id', row.id)
    .eq('status', 'confirmed')
    .select('id, amount, payer_id');
  if (cancelErr) { console.error('[cancelGamePlayer] update failed:', cancelErr); return { error: cancelErr }; }
  if (!claimed?.length) {
    console.warn('[cancelGamePlayer] slot not confirmed at update — skipping refund');
    return { skipped: true };
  }
  const claimedRow = claimed[0];
  // historicalAmount = snapshot histórico de la plaza (NUNCA se modifica; game_players.amount
  // se conserva). refundAmount = dinero realmente devuelto = 0 si la regla 24h no reembolsa.
  const historicalAmount = Number(claimedRow.amount) || 0;
  const refundAmount     = refundable ? historicalAmount : 0;
  const refundTo   = claimedRow.payer_id; // refund always goes to the payer, not the canceler
  await setMatchPublishedIfEmpty(gameId);
  notifyWaitlistUsers(gameId);

  // Movimiento ECONÓMICO (ledger + wallet) SOLO cuando hay crédito. Sin cambios.
  if (refundAmount > 0) {
    const { error: ledgerErr } = await supabase.from('reservations').insert({
      game_id:         gameId,
      user_id:         refundTo,
      canceled_by:     session.user.id,
      status:          'refund',
      unit_price:      refundAmount,
      subtotal_amount: refundAmount,
      players_count:   1,
      guest_total:     0,
      canceled_at:     new Date().toISOString(),
    });
    if (ledgerErr) console.error('[cancelGamePlayer] refund ledger insert failed:', ledgerErr);
    await applyRefund(refundTo, refundAmount);
  }

  // Notificación de cancelación SIEMPRE (también sin crédito, tramo <24h). El texto se
  // ramifica por `hadCredit`; el caso CON crédito queda idéntico. Economía intacta arriba.
  const hadCredit = refundAmount > 0;
  // ¿El usuario que cancela conserva invitados PROPIOS activos? (game_players confirmados
  // que él paga, distintos de su propia plaza). Solo ajusta el COPY.
  const { count: ownGuestCount } = await supabase
    .from('game_players')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', gameId)
    .eq('payer_id', session.user.id)
    .eq('status', 'confirmed')
    .neq('user_id', session.user.id);
  const hasActiveOwnGuests = (ownGuestCount ?? 0) > 0;

  if (refundTo === session.user.id) {
    // Self-paid slot. skipNotification=true cuando el resumen lo enviará cancelGuestPlayers.
    if (!skipNotification) {
      const selfCustom = hadCredit
        ? (hasActiveOwnGuests ? 'Cancelaste tu reserva y aún tienes invitados activos. El crédito fue añadido a tu billetera.' : null)
        : (hasActiveOwnGuests ? 'Cancelaste tu reserva y aún tienes invitados activos. Por la anticipación (menos de 24 h), no se generó crédito en tu billetera.' : null);
      supabase.from('notifications').insert({
        recipient_user_id: session.user.id,
        source_type:       'venue',
        delivery_type:     'automatic',
        category:          hadCredit ? 'refund' : 'reservation',
        template_key:      hadCredit ? 'reservation_cancelled_credit_self' : 'reservation_cancelled_no_refund',
        ...(selfCustom ? { custom_text: selfCustom } : {}),
        game_id:           gameId,
        reservation_id:    row.reservation_id,
        created_by:        session.user.id,
        sent_at:           new Date().toISOString(),
      }).then(({ error }) => {
        if (error) console.error('[notif] cancel self (game) failed:', error);
      });
    }
  } else {
    // Guest slot paid by someone else: fetch both names in one query
    supabase.from('users_public').select('id, full_name').in('id', [session.user.id, refundTo])
      .then(({ data: users }) => {
        const byId = Object.fromEntries((users ?? []).map(u => [u.id, u.full_name]));
        const cancelerFirst = (byId[session.user.id] ?? '').split(' ')[0] || 'Un jugador';
        const payerFirst    = (byId[refundTo]         ?? '').split(' ')[0] || 'el titular';
        // 1 — notify the guest who canceled
        supabase.from('notifications').insert({
          recipient_user_id: session.user.id,
          source_type:       'venue',
          delivery_type:     'automatic',
          category:          hadCredit ? 'refund' : 'reservation',
          template_key:      'reservation_cancelled_credit_owner',
          custom_text:       hadCredit
            ? (hasActiveOwnGuests
                ? `Cancelaste la reserva y aún tienes invitados activos. El crédito fue devuelto a ${payerFirst}.`
                : `Cancelaste la reserva. El crédito fue devuelto a ${payerFirst}.`)
            : `Cancelaste la reserva. Por la anticipación (menos de 24 h), no se generó crédito a ${payerFirst}.`,
          game_id:           gameId,
          reservation_id:    row.reservation_id,
          created_by:        session.user.id,
          sent_at:           new Date().toISOString(),
        }).then(({ error }) => {
          if (error) console.error('[notif] reservation_cancelled_credit_owner failed for guest', session.user.id, error);
        });
        // 2 — notify the payer
        supabase.from('notifications').insert({
          recipient_user_id: refundTo,
          source_type:       'venue',
          delivery_type:     'automatic',
          category:          hadCredit ? 'refund' : 'reservation',
          template_key:      'guest_invitation_cancelled_credit',
          custom_text:       hadCredit
            ? `${cancelerFirst} canceló su invitación. El crédito fue añadido a tu billetera.`
            : `${cancelerFirst} canceló su invitación. Por la anticipación (menos de 24 h), no se generó crédito en tu billetera.`,
          game_id:           gameId,
          reservation_id:    row.reservation_id,
          created_by:        session.user.id,
          sent_at:           new Date().toISOString(),
        }).then(({ error }) => {
          if (error) console.error('[notif] guest_invitation_cancelled_credit failed for payer', refundTo, error);
        });
      });
  }

  // refundable = veredicto temporal (regla 24h); refundAmount = dinero realmente devuelto.
  return { data: row, refundable, refundAmount };
}

// Cancels confirmed guest slots owned by current user (payer_id = session.user.id),
// appends one refund reservation per slot, updates wallet with total.
export async function cancelGuestPlayers(gameId, guestUserIds, { selfAlsoCanceled = false } = {}) {
  if (!supabase || !guestUserIds?.length) return { skipped: true };
  const session = await getSession();
  if (!session?.user?.id) return { skipped: true };

  // Autoridad ECONÓMICA (regla 24h) desde el servidor, ANTES del claim: si no podemos
  // determinar la política de devolución, abortamos SIN cancelar ningún invitado. Misma
  // fuente temporal única que cancelGamePlayer; nunca Date.now() ni un boolean de la UI.
  const { data: windowData, error: windowErr } = await supabase
    .rpc('match_cancellation_window', { p_game_id: gameId });
  if (windowErr) {
    console.error('[cancelGuestPlayers] match_cancellation_window failed:', windowErr);
    return { error: windowErr };
  }
  const win = Array.isArray(windowData) ? windowData[0] : windowData;
  if (!win || typeof win.refundable !== 'boolean') {
    console.error('[cancelGuestPlayers] match_cancellation_window returned no verdict');
    return { error: new Error('CANCELLATION_WINDOW_UNAVAILABLE') };
  }
  const refundable = win.refundable;

  // Cancelación + liberación de R1 propia ATÓMICAS en el backend: en UNA transacción
  // cancela SOLO los guests que ESTE payer paga (payer_id = auth.uid()) y están
  // 'confirmed', y por cada uno realmente cancelado libera su R1 PROPIA
  // (reserved_by_user_id = su user_id) vía release_slot_reservation. Devuelve las
  // filas realmente canceladas (id, user_id, amount, reservation_id) para que el
  // refund/wallet/notificaciones sigan EXACTAMENTE igual, aquí en JS.
  const { data: claimed, error: cancelErr } = await supabase.rpc('cancel_guest_players', {
    p_game_id:  gameId,
    p_user_ids: guestUserIds,
  });
  if (cancelErr) { console.error('[cancelGuestPlayers] rpc failed:', cancelErr); return { error: cancelErr }; }
  if (!claimed?.length) {
    console.warn('[cancelGuestPlayers] no slots transitioned — skipping');
    return { skipped: true };
  }
  await setMatchPublishedIfEmpty(gameId);
  notifyWaitlistUsers(gameId, claimed.length);

  // historicalRefundTotal = suma histórica de game_players.amount (snapshots; NUNCA se
  // modifican). refundAmount = dinero realmente devuelto = 0 si la regla 24h no reembolsa.
  const historicalRefundTotal = claimed.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const refundAmount = refundable ? historicalRefundTotal : 0;
  if (refundAmount > 0) {
    const { error: ledgerErr } = await supabase.from('reservations').insert({
      game_id:         gameId,
      user_id:         session.user.id,
      canceled_by:     session.user.id,
      status:          'refund',
      unit_price:      claimed[0]?.amount ?? 0,
      subtotal_amount: refundAmount,
      players_count:   claimed.length,
      guest_total:     refundAmount,
      canceled_at:     new Date().toISOString(),
    });
    if (ledgerErr) console.error('[cancelGuestPlayers] refund ledger insert failed:', ledgerErr);
    await applyRefund(session.user.id, refundAmount);
  }

  // Fetch payer + all guest names in one query for all notification types
  const guestRows = claimed.filter(r => r.user_id);
  // Un batch puede abarcar varias reservas → mapa game_player.id → reservation_id
  // (reservation_id llega en `claimed` desde el RPC).
  const resByGpId = Object.fromEntries(claimed.map(r => [r.id, r.reservation_id]));
  const allIds = [session.user.id, ...guestRows.map(r => r.user_id)];
  supabase.from('users_public').select('id, full_name').in('id', allIds)
    .then(({ data: users }) => {
      const byId = Object.fromEntries((users ?? []).map(u => [u.id, u.full_name]));
      const payerFirst = (byId[session.user.id] ?? '').split(' ')[0] || 'El titular';

      // Resumen al titular SIEMPRE (también sin crédito, tramo <24h). Solo cambia el TEXTO
      // por `hadCredit`; el caso CON crédito queda idéntico. La economía ya se movió arriba.
      const hadCredit = refundAmount > 0;
      const titularTemplate = selfAlsoCanceled
        ? 'reservation_cancelled_self_and_guests'
        : 'reservation_cancelled_guests_credit';
      // Agrupar por reservation_id: una notificación-resumen por reserva distinta
      // (mismo template y texto; solo cambia el subconjunto de invitados).
      const groups = {};
      guestRows.forEach(r => { const rid = resByGpId[r.id]; (groups[rid] ??= []).push(r); });
      Object.entries(groups).forEach(([rid, groupRows]) => {
        const guestNames = groupRows
          .map(r => (byId[r.user_id] ?? '').split(' ')[0])
          .filter(Boolean);
        const guestNamesStr = guestNames.length === 0 ? 'tus invitados'
          : guestNames.length === 1 ? guestNames[0]
          : `${guestNames.slice(0, -1).join(', ')} y ${guestNames[guestNames.length - 1]}`;
        const titularText = hadCredit
          ? (selfAlsoCanceled
              ? `Cancelaste tu reserva y la de ${guestNamesStr}. El crédito fue añadido a tu billetera.`
              : `Cancelaste la reserva de ${guestNamesStr}. El crédito fue añadido a tu billetera.`)
          : (selfAlsoCanceled
              ? `Cancelaste tu reserva y la de ${guestNamesStr}. Por la anticipación (menos de 24 h), no se generó crédito en tu billetera.`
              : `Cancelaste la reserva de ${guestNamesStr}. Por la anticipación (menos de 24 h), no se generó crédito en tu billetera.`);
        supabase.from('notifications').insert({
          recipient_user_id: session.user.id,
          source_type:       'venue',
          delivery_type:     'automatic',
          category:          hadCredit ? 'refund' : 'reservation',
          template_key:      titularTemplate,
          custom_text:       titularText,
          game_id:           gameId,
          reservation_id:    rid,
          created_by:        session.user.id,
          sent_at:           new Date().toISOString(),
        }).then(({ error }) => {
          if (error) console.error('[notif]', titularTemplate, 'failed for titular:', session.user.id, error);
        });
      });

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
          reservation_id:    resByGpId[r.id],
          created_by:        session.user.id,
          sent_at:           new Date().toISOString(),
        }).then(({ error }) => {
          if (error) console.error('[notif] guest_invitation_cancelled_by_owner failed for', r.user_id, error);
        });
      });
    });

  // refundable = veredicto temporal (regla 24h); refundAmount = dinero realmente devuelto.
  return { data: claimed, refundable, refundAmount };
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

// Cancela un rental — TRANSPORTE FINO sobre la RPC server-authoritative cancel_rental_self.
// La RPC es la ÚNICA autoridad: recalcula el tramo 72h/24h con now() del servidor, lee el
// spend histórico, aplica el refund escalonado + wallet atómicamente, libera el horario y
// notifica (incluido refund 0). El cliente YA NO lee el spend, ni calcula el refund, ni
// inserta ledger, ni aplica wallet, ni actualiza public.games (endurecimiento de seguridad).
export async function cancelRental(gameId) {
  if (!supabase) return { skipped: true };
  const { data, error } = await supabase.rpc('cancel_rental_self', { p_game_id: gameId });
  if (error) return { error };
  return {
    refundAmount: Number(data?.refund_amount) || 0,
    refundPct:    Number(data?.refund_pct) || 0,
  };
}

// Preview SOLO para UI: veredicto del servidor del tramo actual (100/50/0) + cortes.
// NO es la autoridad del dinero; el importe definitivo lo devuelve cancel_rental_self al
// confirmar (el usuario puede cruzar el límite de 72h/24h con el sheet abierto).
export async function getRentalCancellationWindow(gameId) {
  if (!supabase) return { error: new Error('NO_SUPABASE') };
  const { data, error } = await supabase.rpc('rental_cancellation_window', { p_game_id: gameId });
  if (error) return { error };
  const win = Array.isArray(data) ? data[0] : data;
  return { data: win || null };
}

// Cancels invited player slots — no wallet movement (net cost was 0).
// unitPrice is the gross spot price: stored in the refund ledger for financial analytics.
export async function cancelInvitedPlayers(gameId, invitedUserIds, unitPrice = 0) {
  if (!supabase || !invitedUserIds?.length) return { skipped: true };
  const session = await getSession();
  if (!session?.user?.id) return { skipped: true };

  const { data: rows, error: findErr } = await supabase
    .from('game_players')
    .select('id, user_id, reservation_id')
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
    .update({ status: 'canceled', canceled_at: new Date().toISOString(), counts_reserved_slot: false })
    .in('id', ids);

  if (error) { console.error('[cancelInvitedPlayers]', error); return { error }; }
  await setMatchPublishedIfEmpty(gameId);

  // Invitación gratis: economía 0 en el refund (sin descuento ficticio). No toca wallet.
  const { error: ledgerErr } = await supabase.from('reservations').insert({
    game_id:            gameId,
    user_id:            session.user.id,
    canceled_by:        session.user.id,
    status:             'refund',
    unit_price:         0,
    promo_discount:     0,
    subtotal_amount:    0,
    total_amount:       0,
    players_count:      rows.length,
    guest_total:        0,
    canceled_at:        new Date().toISOString(),
    reservation_type:   'invited',
    invited_by_user_id: session.user.id,
  });
  if (ledgerErr) console.error('[cancelInvitedPlayers] ledger insert failed:', ledgerErr);

  // Notificar a cada invitado REALMENTE cancelado (una por jugador, no al host).
  // Mismo patrón/plantilla que cancelGuestPlayers: 'guest_invitation_cancelled_by_owner'.
  // `rows` = filas confirmadas invitadas por este host al momento del select; en una
  // re-cancelación quedan 0 (ya no están 'confirmed') → return skip previo, sin notificar.
  // De cara al jugador la invitación gratuita se presenta como de "AlGrass" (no el host).
  rows.forEach(r => {
    if (!r.user_id) return;
    supabase.from('notifications').insert({
      recipient_user_id: r.user_id,
      source_type:       'venue',
      delivery_type:     'automatic',
      category:          'invitation',
      template_key:      'guest_invitation_cancelled_by_owner',
      custom_text:       'AlGrass canceló tu invitación.',
      game_id:           gameId,
      reservation_id:    r.reservation_id ?? null,
      created_by:        session.user.id,
      sent_at:           new Date().toISOString(),
    }).then(({ error }) => {
      if (error) console.error('[notif] guest_invitation_cancelled_by_owner failed for', r.user_id, error);
    });
  });

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
    });

    sent++;
  }

  console.log(`[reminders] queued ${sent} next_day_reminder notifications`);
  return { sent, tomorrowKey };
}

// ── V6 · Expiración automática de Reserva de Cupos (popup una sola vez) ──────────
// Mismo patrón que Rating (backend = fuente de verdad, sin localStorage): la RPC
// get_pending_slot_expiry() ya devuelve, en SQL, la R1 pendiente (released_reason
// 'automatic', expiry_notified_at IS NULL, partido aún no iniciado), una a la vez.
export async function fetchPendingSlotExpiry(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase.rpc('get_pending_slot_expiry');
  if (error) { console.warn('[slotExpiry] fetch:', error.message); return null; }
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { id: row.reservation_id, gameId: row.game_id } : null;
}

// Marca el popup como mostrado (guard atómico is null en la RPC). Idempotente.
export async function markSlotReservationNotified(reservationId) {
  if (!supabase || !reservationId) return;
  const { error } = await supabase.rpc('mark_slot_reservation_notified', { p_reservation_id: reservationId });
  if (error) console.warn('[slotExpiry] mark:', error.message);
}
