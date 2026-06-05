import { supabase } from '../lib/supabase';
import { gameEndDate } from '../utils/deriveGameState';

const TABLE  = 'rating';
const LS_KEY = 'pichanga_ratings';

// ── Local cache helpers ──────────────────────────────────────────────────────
export function getLocalRatings() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
}
export function setLocalRatings(map) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch {}
}

function computeEventEndedAt(g) {
  if (!g.dateKey || !g.time24) return null;
  try {
    const end = gameEndDate(g.dateKey, g.time24, g.durationMin);
    return end ? end.toISOString() : null;
  } catch { return null; }
}

// ── Save rating (upsert: creates row if missing, updates stars/comment/rated_at) ─
// popupShownAt: pass when rating comes from the popup modal so popup_shown_at is also recorded.
export async function saveRating({ userId, gameType, gameId, venueId, fieldId, hostUserId, stars, comment, popupShownAt }) {
  const ratedAt = new Date().toISOString();

  // Optimistic local cache
  const local = getLocalRatings();
  local[gameId] = { ...(local[gameId] ?? {}), stars, comment: comment || null, rated_at: ratedAt,
    ...(popupShownAt != null ? { popup_shown_at: popupShownAt } : {}),
  };
  setLocalRatings(local);

  if (!supabase || !userId || !gameId) return;

  let fId = fieldId ?? null;
  let vId = venueId ?? null;
  if (!fId || !vId) {
    const { data: gData } = await supabase
      .from('games')
      .select('field_id, fields:field_id ( venue_id )')
      .eq('id', gameId)
      .maybeSingle();
    if (gData) {
      fId = fId ?? gData.field_id ?? null;
      vId = vId ?? gData.fields?.venue_id ?? null;
    }
  }

  // upsert: INSERT if no row, UPDATE stars/comment/rated_at on conflict.
  // Does NOT touch event_ended_at — preserves the value set by upsertRatingRows.
  const { error } = await supabase
    .from(TABLE)
    .upsert({
      user_id:      userId,
      game_type:    gameType ?? 'match',
      game_id:      gameId,
      venue_id:     vId,
      field_id:     fId,
      host_user_id: hostUserId ?? null,
      stars,
      comment:      comment || null,
      rated_at:     ratedAt,
      ...(popupShownAt != null ? { popup_shown_at: popupShownAt } : {}),
    }, { onConflict: 'user_id,game_id' });

  if (error) console.error('[rating] saveRating error:', error.code, error.message);
}

// ── Fetch all ratings for a user from Supabase ──────────────────────────────
export async function fetchMyRatings(userId) {
  if (!supabase || !userId) return {};
  const { data, error } = await supabase
    .from(TABLE)
    .select('game_id, stars, comment, popup_shown_at, rated_at, event_ended_at')
    .eq('user_id', userId);
  if (error) { console.error('[rating] fetchMyRatings error:', error.message); return {}; }
  return Object.fromEntries((data || []).map(r => [r.game_id, {
    stars:          r.stars,
    comment:        r.comment,
    popup_shown_at: r.popup_shown_at,
    rated_at:       r.rated_at,
    event_ended_at: r.event_ended_at,
  }]));
}

// ── Create initial rating rows for past games (idempotent, ON CONFLICT DO NOTHING) ─
// Rentals: only the current user (they are the booker).
// Matches: all confirmed game_players of those games (enables cross-user analytics).
export async function upsertRatingRows(userId, games) {
  if (!supabase || !userId || !games.length) return;

  const matchGames  = games.filter(g => g.type !== 'rental');
  const rentalGames = games.filter(g => g.type === 'rental');
  const rows = [];

  // Rentals — only the current user
  for (const g of rentalGames) {
    rows.push({
      user_id:        userId,
      game_id:        g.gameId ?? g.id,
      game_type:      'rental',
      host_user_id:   g.hostUserId ?? null,
      event_ended_at: computeEventEndedAt(g),
      stars: null, comment: null, popup_shown_at: null, rated_at: null,
    });
  }

  // Matches — query all confirmed participants and create a row per player
  if (matchGames.length) {
    const gameIds = matchGames.map(g => g.gameId ?? g.id);
    const metaMap = Object.fromEntries(matchGames.map(g => [g.gameId ?? g.id, g]));
    const { data: players, error: gpErr } = await supabase
      .from('game_players')
      .select('game_id, user_id')
      .in('game_id', gameIds)
      .eq('status', 'confirmed');
    if (gpErr) console.error('[rating] game_players query error:', gpErr.message);
    for (const p of (players || [])) {
      const meta = metaMap[p.game_id];
      if (!meta) continue;
      rows.push({
        user_id:        p.user_id,
        game_id:        p.game_id,
        game_type:      'match',
        host_user_id:   meta.hostUserId ?? null,
        event_ended_at: computeEventEndedAt(meta),
        stars: null, comment: null, popup_shown_at: null, rated_at: null,
      });
    }
    // Host — ignoreDuplicates handles the case where host is also a confirmed player
    for (const g of matchGames) {
      const hostId = g.hostUserId ?? null;
      if (!hostId) continue;
      rows.push({
        user_id:        hostId,
        game_id:        g.gameId ?? g.id,
        game_type:      'match',
        host_user_id:   hostId,
        event_ended_at: computeEventEndedAt(g),
        stars: null, comment: null, popup_shown_at: null, rated_at: null,
      });
    }
  }

  if (!rows.length) return;
  const { error } = await supabase
    .from(TABLE)
    .upsert(rows, { onConflict: 'user_id,game_id', ignoreDuplicates: true });
  if (error) console.error('[rating] upsertRatingRows error:', error.message);
}

// ── Mark popup as shown — prevents re-showing on any device ─────────────────
export async function markPopupShown(userId, gameId) {
  if (!supabase || !userId || !gameId) return;
  const { error } = await supabase
    .from(TABLE)
    .update({ popup_shown_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('game_id', gameId)
    .is('popup_shown_at', null);
  if (error) console.error('[rating] markPopupShown error:', error.message);
}
