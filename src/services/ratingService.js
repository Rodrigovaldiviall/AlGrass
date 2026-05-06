const RATINGS_KEY = 'pichanga_ratings';

export async function getRatings() {
  try { return JSON.parse(localStorage.getItem(RATINGS_KEY)) || {}; } catch { return {}; }
}

export async function setRatings(ratings) {
  try { localStorage.setItem(RATINGS_KEY, JSON.stringify(ratings)); } catch {}
}
