import { supabase } from '../lib/supabase';

const TABLE  = 'rating';
const LS_KEY = 'pichanga_ratings';

// ── Local cache helpers ──────────────────────────────────────────────────────
export function getLocalRatings() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
}
export function setLocalRatings(map) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch {}
}

// ── Save rating (localStorage + Supabase) ───────────────────────────────────
export async function saveRating({ userId, gameType, gameId, venueId, fieldId, hostUserId, stars, comment }) {
  // Write local cache immediately for instant UI feedback
  const local = getLocalRatings();
  local[gameId] = { stars, comment: comment || null, ratedAt: new Date().toISOString() };
  setLocalRatings(local);

  // ── Guard checks — log reason if we bail ────────────────────────────────
  if (!supabase) { console.error('[rating] supabase client is null — skipping insert'); return; }
  if (!userId)   { console.error('[rating] userId is null/undefined — skipping insert'); return; }
  if (!gameId)   { console.error('[rating] gameId is null/undefined — skipping insert'); return; }

  // ── Look up field_id / venue_id if not provided ─────────────────────────
  let fId = fieldId ?? null;
  let vId = venueId ?? null;
  if (!fId || !vId) {
    const { data: gData, error: gErr } = await supabase
      .from('games')
      .select('field_id, fields:field_id ( venue_id )')
      .eq('id', gameId)
      .maybeSingle();
    if (gErr) console.warn('[rating] game lookup error:', gErr.message);
    if (gData) {
      fId = fId ?? gData.field_id ?? null;
      vId = vId ?? gData.fields?.venue_id ?? null;
    }
  }

  const payload = {
    user_id:      userId,
    game_type:    gameType ?? 'match',
    game_id:      gameId,
    venue_id:     vId,
    field_id:     fId,
    host_user_id: hostUserId ?? null,
    stars,
    comment:      comment || null,
  };
  console.log('[rating] INSERT payload:', payload);

  // Try INSERT first; if duplicate (23505) do UPDATE instead
  const { data: insertData, error: insertErr } = await supabase
    .from(TABLE)
    .insert(payload)
    .select();

  if (!insertErr) {
    console.log('[rating] INSERT success:', insertData);
    return;
  }

  console.error('[rating] INSERT error:', insertErr.code, insertErr.message, insertErr.details);

  // Duplicate → UPDATE existing row
  if (insertErr.code === '23505') {
    console.log('[rating] duplicate detected — attempting UPDATE');
    const { data: updateData, error: updateErr } = await supabase
      .from(TABLE)
      .update({ stars, comment: comment || null, venue_id: vId, field_id: fId, host_user_id: hostUserId ?? null })
      .eq('user_id', userId)
      .eq('game_id', gameId)
      .select();
    if (updateErr) console.error('[rating] UPDATE error:', updateErr.code, updateErr.message);
    else console.log('[rating] UPDATE success:', updateData);
  }
}

// ── Fetch all ratings for a user from Supabase ──────────────────────────────
export async function fetchMyRatings(userId) {
  if (!supabase || !userId) return {};
  const { data, error } = await supabase
    .from(TABLE)
    .select('game_id, stars, comment')
    .eq('user_id', userId);
  if (error) { console.error('[rating] fetchMyRatings error:', error.message); return {}; }
  console.log('[rating] fetchMyRatings:', data?.length ?? 0, 'ratings loaded');
  return Object.fromEntries((data || []).map(r => [r.game_id, { stars: r.stars, comment: r.comment }]));
}
