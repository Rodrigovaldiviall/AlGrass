import { supabase } from '../lib/supabase';

const RATINGS_KEY = 'pichanga_ratings';

export async function getRatings() {
  try { return JSON.parse(localStorage.getItem(RATINGS_KEY)) || {}; } catch { return {}; }
}

export async function setRatings(ratings) {
  try { localStorage.setItem(RATINGS_KEY, JSON.stringify(ratings)); } catch {}
}

/**
 * Save a game rating for the current user.
 * Writes to Supabase `game_ratings` if available; always mirrors to localStorage.
 *
 * Required DB table (create once):
 *   CREATE TABLE game_ratings (
 *     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     game_id     uuid NOT NULL REFERENCES games(id),
 *     rater_id    uuid NOT NULL REFERENCES auth.users(id),
 *     stars       smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
 *     comment     text,
 *     created_at  timestamptz NOT NULL DEFAULT now(),
 *     UNIQUE (game_id, rater_id)
 *   );
 *   -- RLS: rater can insert own row; anyone can read.
 *
 * Only confirmed game_players can rate (enforced in frontend via isGamePast + confirmed status).
 */
export async function saveRating({ gameId, raterId, stars, comment }) {
  if (supabase && gameId && raterId) {
    const { error } = await supabase
      .from('game_ratings')
      .upsert({ game_id: gameId, rater_id: raterId, stars, comment: comment || null },
               { onConflict: 'game_id,rater_id' });
    if (error) console.warn('[ratingService] saveRating:', error.message);
  }
}

/**
 * Fetch all ratings submitted by a user (for showing "already rated" state).
 * Returns a map: { [gameId]: { stars, comment } }
 */
export async function fetchMyRatings(raterId) {
  if (!supabase || !raterId) return {};
  const { data, error } = await supabase
    .from('game_ratings')
    .select('game_id, stars, comment')
    .eq('rater_id', raterId);
  if (error) { console.warn('[ratingService] fetchMyRatings:', error.message); return {}; }
  return Object.fromEntries((data || []).map(r => [r.game_id, { stars: r.stars, comment: r.comment }]));
}
