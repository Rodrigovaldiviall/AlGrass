import { supabase } from '../lib/supabase';

export async function fetchMyVenueStaff(userId) {
  // Step 1: fetch venue_staff rows without nested join (avoids inner-join drop when FK isn't resolved)
  const { data: staffRows, error } = await supabase
    .from('venue_staff')
    .select('id, venue_id, status, invited_by, created_at, accepted_at')
    .eq('user_id', userId);

  if (error || !staffRows?.length) return { data: staffRows ?? [], error };

  // Step 2: fetch venue names separately
  const venueIds = [...new Set(staffRows.map(r => r.venue_id).filter(Boolean))];
  const { data: venues } = await supabase
    .from('venues')
    .select('id, name')
    .in('id', venueIds);

  const venueMap = Object.fromEntries((venues ?? []).map(v => [v.id, v]));
  const merged   = staffRows.map(r => ({ ...r, venues: venueMap[r.venue_id] ?? null }));

  return { data: merged, error: null };
}

export async function fetchManagedVenues(userId) {
  const { data, error } = await supabase
    .from('venues')
    .select('id, name')
    .eq('manager_user_id', userId);
  return { data: data ?? [], error };
}

export async function fetchHostedGames(userId) {
  const { data, error } = await supabase
    .from('games')
    .select('id')
    .eq('host_user_id', userId)
    .eq('status', 'active');
  return { data: data ?? [], error };
}

export async function acceptStaffInvite(rowId) {
  return supabase
    .from('venue_staff')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', rowId);
}

export async function rejectStaffInvite(rowId) {
  return supabase
    .from('venue_staff')
    .update({ status: 'rejected' })
    .eq('id', rowId);
}
