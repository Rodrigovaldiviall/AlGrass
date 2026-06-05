import { supabase } from '../lib/supabase';

export async function joinWaitlist(userId, gameId) {
  if (!supabase || !userId || !gameId) return;
  const { data: existing } = await supabase
    .from('game_waitlist')
    .select('game_id')
    .eq('user_id', userId)
    .eq('game_id', gameId)
    .eq('status', 'waiting')
    .maybeSingle();
  if (existing) return;
  const { error } = await supabase
    .from('game_waitlist')
    .insert({ user_id: userId, game_id: gameId, status: 'waiting', joined_at: new Date().toISOString() });
  if (error) console.warn('[waitlist] join error:', error);
}

export async function leaveWaitlist(userId, gameId) {
  if (!supabase || !userId || !gameId) return;
  const { error } = await supabase
    .from('game_waitlist')
    .update({ status: 'canceled', left_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('game_id', gameId);
  if (error) console.warn('[waitlist] leave error:', error);
}

export async function getMyWaitlistGameIds(userId) {
  if (!supabase || !userId) return [];
  const { data, error } = await supabase
    .from('game_waitlist')
    .select('game_id')
    .eq('user_id', userId)
    .eq('status', 'waiting');
  if (error) { console.warn('[waitlist] fetch ids error:', error); return []; }
  return (data ?? []).map(r => r.game_id);
}

export async function notifyWaitlistUsers(gameId, slotsFreed = 1) {
  if (!supabase || !gameId) return;

  const { data: game } = await supabase
    .from('games')
    .select('total_spots')
    .eq('id', gameId)
    .maybeSingle();
  if (!game) return;

  const { count: confirmed } = await supabase
    .from('game_players')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', gameId)
    .eq('status', 'confirmed');

  const openSpotsAfter  = (game.total_spots ?? 0) - (confirmed ?? 0);
  const openSpotsBefore = openSpotsAfter - slotsFreed;

  // Only notify on the 0 → 1+ transition
  if (openSpotsAfter <= 0 || openSpotsBefore > 0) return;

  // SECURITY DEFINER RPC — bypasses waitlist_select_own RLS policy
  const { data: waiters } = await supabase
    .rpc('get_waitlist_user_ids', { p_game_id: gameId });
  if (!waiters?.length) return;

  const waiterIds = waiters.map(w => w.user_id);

  const { data: existing } = await supabase
    .from('notifications')
    .select('recipient_user_id')
    .eq('game_id', gameId)
    .eq('template_key', 'waitlist_spot_available')
    .in('recipient_user_id', waiterIds);

  const alreadyNotified = new Set((existing ?? []).map(r => r.recipient_user_id));
  const toNotify = waiterIds.filter(id => !alreadyNotified.has(id));
  if (!toNotify.length) return;

  // SECURITY DEFINER RPC — bypasses recipient_user_id != auth.uid() RLS restriction
  await Promise.all(
    toNotify.map(userId =>
      supabase.rpc('notify_waitlist_spot_available', {
        p_recipient_user_id: userId,
        p_game_id:           gameId,
      })
    )
  );
}

export async function markWaitlistReserved(userId, gameId) {
  if (!supabase || !userId || !gameId) return;
  const { error } = await supabase
    .from('game_waitlist')
    .update({ status: 'reserved' })
    .eq('user_id', userId)
    .eq('game_id', gameId)
    .eq('status', 'waiting');
  if (error) console.warn('[waitlist] mark reserved error:', error);
}

export async function getMyWaitlistGamesFull(userId) {
  if (!supabase || !userId) return [];
  const { data, error } = await supabase
    .from('game_waitlist')
    .select(`
      game_id, joined_at,
      games:game_id ( id, date_key, time, format, total_spots, current_players, duration_min, type,
        game_amenities:amenities,
        fields:field_id ( name, format, total_spots, duration_min, field_amenities:amenities, venues:venue_id ( name, address, cover_image_path, cover_updated_at, venue_amenities:amenities ) ) )
    `)
    .eq('user_id', userId)
    .eq('status', 'waiting');
  if (error) { console.warn('[waitlist] fetch full error:', error); return []; }
  return data ?? [];
}
