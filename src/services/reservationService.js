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

export async function createReservation({ gameId, unitPrice, promoCode, promoDiscount, totalAmount, paymentMethod, creditApplied, source }) {
  if (!supabase) return { skipped: true };
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) return { skipped: true }; // mock/localStorage user, no Supabase session
  const { data, error } = await supabase
    .from('reservations')
    .insert({
      game_id:        gameId,
      user_id:        session.user.id,
      status:         'confirmed',
      unit_price:     unitPrice,
      promo_code:     promoCode || null,
      promo_discount: promoDiscount || 0,
      credit_applied: creditApplied || 0,
      total_amount:   totalAmount,
      payment_method: paymentMethod,
      source:         source || 'match',
      reserved_at:    new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) console.error('[createReservation]', error);
  return { data, error };
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

export async function cancelReservation(gameId) {
  if (!supabase) return { skipped: true };
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    console.warn('[cancelReservation] no Supabase session — localStorage only');
    return { skipped: true };
  }
  console.log('[cancelReservation] updating game_id:', gameId, 'user_id:', session.user.id);
  const { data, error } = await supabase
    .from('reservations')
    .update({ status: 'canceled', canceled_at: new Date().toISOString() })
    .eq('game_id', gameId)
    .eq('user_id', session.user.id)
    .eq('status', 'confirmed')
    .select('id, status');
  if (error) console.error('[cancelReservation] error:', error);
  else       console.log('[cancelReservation] updated rows:', data);
  return { data, error };
}
