import { supabase } from '../lib/supabase';

// ── internal helpers ──────────────────────────────────────────────────────────

async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

async function ensureWalletSummary(userId) {
  const { data, error } = await supabase.from('wallet_summary').select('user_id').eq('user_id', userId).maybeSingle();
  console.log('[wallet] ensureWalletSummary select → data:', data, '| error:', error);
  if (!data) {
    const ins = await supabase.from('wallet_summary').insert({ user_id: userId, total_amount: 0, reserved_balance: 0, credit_balance: 0 });
    console.log('[wallet] ensureWalletSummary insert → error:', ins.error, '| status:', ins.status);
  }
}

// Read-modify-write on wallet_summary. Race condition acceptable for this app.
async function applySpend(userId, { totalAmount, subtotalAmount, creditApplied = 0 }) {
  console.log('[wallet] applySpend called — userId:', userId?.slice(-6), '| totalAmount:', totalAmount, '| subtotalAmount:', subtotalAmount, '| creditApplied:', creditApplied);
  await ensureWalletSummary(userId);
  const { data, error: selErr } = await supabase.from('wallet_summary')
    .select('total_amount, reserved_balance, credit_balance')
    .eq('user_id', userId).single();
  console.log('[wallet] applySpend read → data:', data, '| error:', selErr);
  const cur = data ?? { total_amount: 0, reserved_balance: 0, credit_balance: 0 };
  const next = {
    user_id:          userId,
    total_amount:     cur.total_amount     + totalAmount,
    reserved_balance: cur.reserved_balance + subtotalAmount,
    credit_balance:   Math.max(0, cur.credit_balance - creditApplied),
  };
  console.log('[wallet] applySpend upsert payload:', next);
  const { data: upData, error: upErr } = await supabase.from('wallet_summary').upsert(next, { onConflict: 'user_id' }).select();
  console.log('[wallet] applySpend upsert → data:', upData, '| error:', upErr);
}

async function applyRefund(userId, refundAmount) {
  console.log('[wallet] applyRefund called — userId:', userId?.slice(-6), '| refundAmount:', refundAmount);
  // RPC with SECURITY DEFINER: bypasses RLS for cross-user refunds (e.g. guest cancels, refund goes to payer)
  const { error } = await supabase.rpc('apply_wallet_refund', { p_user_id: userId, p_amount: refundAmount });
  console.log('[wallet] applyRefund rpc → error:', error);
}

function rankPlayers(players, query) {
  const q = query.toLowerCase();
  return players
    .map(p => {
      const name  = (p.name || '').toLowerCase();
      const code  = (p.code || '').toLowerCase().replace(/^@/, '');
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

export async function validatePromoCode(code, unitPrice) {
  if (!supabase || !code?.trim()) return { error: 'invalid' };
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('promo_codes')
    .select('discount_percent')
    .eq('code', code.trim().toUpperCase())
    .eq('active', true)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle();
  if (error || !data) return { error: 'invalid' };
  const discount = Math.min(unitPrice * (data.discount_percent / 100), unitPrice);
  return { discount, value: data.discount_percent, code: code.trim().toUpperCase() };
}

// ── user search ───────────────────────────────────────────────────────────────

export async function searchUsers(query, { limit = 20, excludeIds = [] } = {}) {
  if (!supabase || !query?.trim()) return [];
  const session = await getSession();
  const currentId = session?.user?.id;
  const q = query.trim();
  const allExclude = currentId ? [...excludeIds, currentId] : excludeIds;
  let req = supabase
    .from('users')
    .select('id, full_name, user_code, avatar_hue, preferred_position, birth_date')
    .or(`full_name.ilike.%${q}%,user_code.ilike.%${q}%`)
    .limit(limit);
  if (allExclude.length) req = req.not('id', 'in', `(${allExclude.join(',')})`);
  const { data, error } = await req;
  if (error) { console.error('[searchUsers]', error); return []; }
  const players = (data || []).map(u => {
    let age = null;
    if (u.birth_date) {
      const bd  = new Date(u.birth_date);
      const now = new Date();
      age = now.getFullYear() - bd.getFullYear();
      if (now.getMonth() < bd.getMonth() || (now.getMonth() === bd.getMonth() && now.getDate() < bd.getDate())) age--;
    }
    return {
      id:       u.id,
      name:     u.full_name || '',
      code:     u.user_code ? `@${u.user_code}` : '',
      hue:      u.avatar_hue ?? ([...(u.full_name || '·')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360),
      position: u.preferred_position || null,
      age,
    };
  });
  return rankPlayers(players, q);
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
      game_id:         gameId,
      user_id:         session.user.id,
      status:          'spend',
      unit_price:      unitPrice,
      promo_code:      promoCode || null,
      promo_discount:  promoDiscount || 0,
      credit_applied:  creditApplied || 0,
      total_amount:    totalAmount,
      subtotal_amount: subtotalAmount || totalAmount,
      players_count:   playersCount || 1,
      guest_total:     guestTotal || 0,
      payment_method:  paymentMethod,
      source:          source || 'match',
      reserved_at:     new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) console.error('[createReservation]', error);
  return { data, error };
}

// Activates (or reactivates) a game_players slot via upsert on (game_id, user_id, payer_id).
export async function createGamePlayer({ gameId, userId = null, payerId = null, reservationId = null, amount = 0 }) {
  if (!supabase) return { skipped: true };
  const session = await getSession();
  if (!session?.user?.id) return { skipped: true };
  const resolvedUserId  = userId  || session.user.id;
  const resolvedPayerId = payerId || session.user.id;
  const { data, error } = await supabase
    .from('game_players')
    .upsert({
      game_id:        gameId,
      user_id:        resolvedUserId,
      payer_id:       resolvedPayerId,
      reservation_id: reservationId,
      amount:         amount,
      status:         'confirmed',
      canceled_at:    null,
      joined_at:      new Date().toISOString(),
    }, { onConflict: 'game_id,user_id,payer_id' })
    .select('id')
    .single();
  if (error) console.error('[createGamePlayer]', error);
  return { data, error };
}

// ── cancel ────────────────────────────────────────────────────────────────────

// Cancels current user's confirmed slot, appends a refund reservation, updates wallet.
export async function cancelGamePlayer(gameId) {
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

  console.log('[cancelGamePlayer] confirmed row:', rows?.[0], '| findErr:', findErr);
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

  if (row.amount > 0) {
    await supabase.from('reservations').insert({
      game_id:         gameId,
      user_id:         refundTo,
      status:          'refund',
      unit_price:      row.amount,
      subtotal_amount: row.amount,
      players_count:   1,
      guest_total:     0,
      canceled_at:     new Date().toISOString(),
    });
    await applyRefund(refundTo, row.amount);
  }

  console.log('[cancelGamePlayer] done — row.id:', row.id, '| refund:', row.amount);
  return { data: row };
}

// Cancels confirmed guest slots owned by current user (payer_id = session.user.id),
// appends one refund reservation per slot, updates wallet with total.
export async function cancelGuestPlayers(gameId, guestUserIds) {
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

  console.log('[cancelGuestPlayers] confirmed rows:', rows, '| findErr:', findErr);
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

  const refundTotal = rows.reduce((s, r) => s + (r.amount || 0), 0);
  if (refundTotal > 0) {
    await supabase.from('reservations').insert({
      game_id:         gameId,
      user_id:         session.user.id,
      status:          'refund',
      unit_price:      rows[0]?.amount ?? 0,
      subtotal_amount: refundTotal,
      players_count:   rows.length,
      guest_total:     refundTotal,
      canceled_at:     new Date().toISOString(),
    });
    await applyRefund(session.user.id, refundTotal);
    console.log('[cancelGuestPlayers] done — canceled:', ids.length, '| total refund:', refundTotal);
  }

  return { data: rows };
}
