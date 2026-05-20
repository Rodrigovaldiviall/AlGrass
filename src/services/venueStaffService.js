import { supabase } from '../lib/supabase';

export async function fetchMyVenueStaff(userId) {
  // Step 1: fetch venue_staff rows without nested join (avoids inner-join drop when FK isn't resolved)
  const { data: staffRows, error } = await supabase
    .from('venue_staff')
    .select('id, venue_id, status, invited_by, created_at, accepted_at')
    .eq('user_id', userId);

  if (error || !staffRows?.length) return { data: staffRows ?? [], error };

  // Step 2: fetch venue info separately — includes manager_user_id so callers can
  // derive isVenueManager without a second query (trigger guarantees manager → staff accepted)
  const venueIds = [...new Set(staffRows.map(r => r.venue_id).filter(Boolean))];
  const { data: venues } = await supabase
    .from('venues')
    .select('id, name, manager_user_id')
    .in('id', venueIds);

  const venueMap = Object.fromEntries((venues ?? []).map(v => [v.id, v]));
  const merged   = staffRows.map(r => ({ ...r, venues: venueMap[r.venue_id] ?? null }));

  return { data: merged, error: null };
}

export async function fetchHostedGames(userId) {
  // Query 1: games where user is explicit host
  const [explicitRes, fieldsRes] = await Promise.all([
    supabase.from('games').select('id').eq('host_user_id', userId).eq('type', 'match').eq('status', 'active'),
    supabase.from('fields').select('id').eq('default_host_user_id', userId),
  ]);

  const explicit = explicitRes.data ?? [];

  // Query 2: games on fields where user is default host AND no explicit override
  let defaultHosted = [];
  if (fieldsRes.data?.length) {
    const fieldIds = fieldsRes.data.map(f => f.id);
    const { data } = await supabase
      .from('games')
      .select('id')
      .in('field_id', fieldIds)
      .is('host_user_id', null)
      .eq('type', 'match')
      .eq('status', 'active');
    defaultHosted = data ?? [];
  }

  // Deduplicate by id
  const seen = new Set();
  const all  = [...explicit, ...defaultHosted].filter(g => seen.has(g.id) ? false : seen.add(g.id));
  return { data: all, error: null };
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
