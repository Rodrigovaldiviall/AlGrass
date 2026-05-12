import { supabase } from '../lib/supabase';

const RESERVATIONS_KEY = 'pichanga_reservations';
const CREDIT_KEY       = 'pichanga_credit';
const PAID_KEY         = 'pichanga_paid_players';

export async function getReservations() {
  try { const v = JSON.parse(localStorage.getItem(RESERVATIONS_KEY)); return Array.isArray(v) ? v : []; } catch { return []; }
}

export async function setReservations(reservations) {
  try { localStorage.setItem(RESERVATIONS_KEY, JSON.stringify(reservations)); } catch {}
}

export async function getCredit() {
  try { return JSON.parse(localStorage.getItem(CREDIT_KEY)) || { balance: 0, transactions: [] }; } catch { return { balance: 0, transactions: [] }; }
}

export async function setCredit(credit) {
  try { localStorage.setItem(CREDIT_KEY, JSON.stringify(credit)); } catch {}
}

export async function getPaidStatus() {
  try { const v = JSON.parse(localStorage.getItem(PAID_KEY)); return Array.isArray(v) ? v : []; } catch { return []; }
}

export async function setPaidStatus(data) {
  try { localStorage.setItem(PAID_KEY, JSON.stringify(data)); } catch {}
}

export async function createReservation({ gameId, unitPrice, playersCount = 1, promoCode, promoDiscount, totalAmount, subtotalAmount, paymentMethod, creditApplied }) {
  if (!supabase) return { skipped: true };
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) return { skipped: true };
  const { data, error } = await supabase
    .from('reservations')
    .insert({
      game_id:         gameId,
      user_id:         session.user.id,
      status:          'confirmed',
      unit_price:      unitPrice,
      players_count:   playersCount,
      subtotal_amount: subtotalAmount ?? unitPrice * playersCount,
      promo_code:      promoCode  || null,
      promo_discount:  promoDiscount || 0,
      credit_applied:  creditApplied || 0,
      total_amount:    totalAmount,
      payment_method:  paymentMethod || null,
      reserved_at:     new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) console.error('[createReservation]', error);
  return { data, error };
}

// upsert: handles rejoin (status=canceled → confirmed, nueva reservation_id)
export async function createGamePlayer({ gameId, userId = null, reservationId, invitedBy = null }) {
  if (!supabase) return { skipped: true };
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) return { skipped: true };
  const resolvedUserId = userId || session.user.id;
  // Auto-set invitedBy to current user when inserting a guest row
  const resolvedInvitedBy = invitedBy ?? (resolvedUserId !== session.user.id ? session.user.id : null);
  const { data, error } = await supabase
    .from('game_players')
    .upsert(
      {
        game_id:        gameId,
        user_id:        resolvedUserId,
        reservation_id: reservationId,
        invited_by:     resolvedInvitedBy,
        status:         'confirmed',
        joined_at:      new Date().toISOString(),
        canceled_at:    null,
      },
      { onConflict: 'game_id,user_id' }
    )
    .select('id')
    .single();
  if (error) console.error('[createGamePlayer]', error);
  return { data, error };
}

export async function createWalletTransaction({ type, amount, gameId = null, reservationId = null, description = null }) {
  if (!supabase) return { skipped: true };
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) return { skipped: true };
  const { error } = await supabase
    .from('wallet_transactions')
    .insert({
      user_id:        session.user.id,
      type,
      amount,
      game_id:        gameId,
      reservation_id: reservationId,
      description,
    });
  if (error) console.error('[createWalletTransaction]', error);
  return { error };
}

export async function syncCreditBalance(newBalance) {
  if (!supabase) return { skipped: true };
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) return { skipped: true };
  const { error } = await supabase
    .from('users')
    .update({ credit_balance: newBalance })
    .eq('id', session.user.id);
  if (error) console.error('[syncCreditBalance]', error);
  return { error };
}

// Increments users.credit_balance by delta instead of overwriting, safe against
// concurrent trigger updates (e.g. handle_guest_cancellation already updated the balance).
export async function incrementCreditBalance(delta) {
  if (!supabase || !delta) return { skipped: true };
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) return { skipped: true };
  const userId = session.user.id;
  const { data: cur } = await supabase
    .from('users')
    .select('credit_balance')
    .eq('id', userId)
    .single();
  const base = cur?.credit_balance ?? 0;
  const { error } = await supabase
    .from('users')
    .update({ credit_balance: base + delta })
    .eq('id', userId);
  if (error) console.error('[incrementCreditBalance]', error);
  return { error };
}

export async function generateAndSaveUserCode(fullName) {
  if (!supabase || !fullName?.trim()) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) return null;
  const { data: existing } = await supabase
    .from('users').select('user_code').eq('id', session.user.id).single();
  if (existing?.user_code) return existing.user_code;
  const { data: generated, error } = await supabase.rpc('generate_user_code', { p_full_name: fullName });
  if (error || !generated) { console.error('[generateAndSaveUserCode]', error); return null; }
  const { error: upErr } = await supabase.from('users').update({ user_code: generated }).eq('id', session.user.id);
  if (upErr) console.error('[generateAndSaveUserCode] update:', upErr);
  return generated;
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

export async function searchUsers(query, { limit = 20, city = null, excludeIds = [] } = {}) {
  if (!supabase || !query?.trim()) return [];
  const { data: { session } } = await supabase.auth.getSession();
  const currentId = session?.user?.id;
  const q = query.trim();
  const allExclude = currentId ? [...excludeIds, currentId] : excludeIds;
  let req = supabase
    .from('users')
    .select('id, full_name, user_code, avatar_hue, preferred_position, birth_date')
    .or(`full_name.ilike.%${q}%,user_code.ilike.%${q}%`)
    .limit(limit);
  if (city) req = req.eq('city', city);
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
      id:        u.id,
      name:      u.full_name || '',
      code:      u.user_code ? `@${u.user_code}` : '',
      hue:       u.avatar_hue ?? ([...(u.full_name || '·')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360),
      avatarUrl: null,
      position:  u.preferred_position || null,
      age,
    };
  });
  return rankPlayers(players, q);
}

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

export async function cancelGamePlayer(gameId) {
  if (!supabase) return { skipped: true };
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) return { skipped: true };
  const userId = session.user.id;
  const { data, error } = await supabase
    .from('game_players')
    .update({ status: 'canceled', canceled_at: new Date().toISOString() })
    .eq('game_id', gameId)
    .eq('user_id', userId)
    .select('game_id, user_id, status');
  if (error) console.error('[cancelGamePlayer] error detail →', error);
  return { data, error };
}

export async function cancelReservation(gameId) {
  if (!supabase) return { skipped: true };
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) return { skipped: true };
  const { data, error } = await supabase
    .from('reservations')
    .update({ status: 'canceled', canceled_at: new Date().toISOString() })
    .eq('game_id', gameId)
    .eq('user_id', session.user.id)
    .eq('status', 'confirmed')
    .select('id, status');
  if (error) console.error('[cancelReservation]', error);
  return { data, error };
}
