import { supabase } from '../lib/supabase';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// ── Validate — returns array of blocker keys (empty = OK to delete) ──────────
export async function validateDeleteAccount(userId) {
  if (!supabase || !userId) return ['unknown'];
  const issues = [];
  const today = todayKey();

  // Collect future game IDs (date_key >= today, any status)
  const { data: futureGames } = await supabase
    .from('games')
    .select('id')
    .gte('date_key', today);
  const futureIds = (futureGames || []).map(g => g.id);

  // 1. Inscrito en partidos futuros como jugador
  if (futureIds.length) {
    const { data: playerRows } = await supabase
      .from('game_players')
      .select('game_id')
      .eq('user_id', userId)
      .eq('status', 'confirmed')
      .in('game_id', futureIds);
    if (playerRows?.length) issues.push('future_player');
  }

  // 2. Invitados activos pagados por el usuario en partidos futuros
  if (futureIds.length) {
    const { data: guestRows } = await supabase
      .from('game_players')
      .select('game_id')
      .eq('payer_id', userId)
      .neq('user_id', userId)
      .eq('status', 'confirmed')
      .in('game_id', futureIds);
    if (guestRows?.length) issues.push('active_guests');
  }

  // 3. Canchas futuras reservadas
  const { data: futureRentals } = await supabase
    .from('games')
    .select('id')
    .eq('booked_by_user_id', userId)
    .in('status', ['published', 'reserved'])
    .gte('date_key', today);
  if (futureRentals?.length) issues.push('future_rental');

  // 4. Saldo positivo en billetera
  const { data: wallet } = await supabase
    .from('wallet_summary')
    .select('credit_balance')
    .eq('user_id', userId)
    .maybeSingle();
  if ((wallet?.credit_balance ?? 0) > 0) issues.push('credit_balance');

  // 5. Owner o manager de venue
  const { data: staffRows } = await supabase
    .from('venue_staff')
    .select('role, venues:venue_id(manager_user_id)')
    .eq('user_id', userId)
    .eq('status', 'accepted');
  const isOwnerOrManager = (staffRows || []).some(
    r => r.role === 'owner' || r.venues?.manager_user_id === userId
  );
  if (isOwnerOrManager) issues.push('venue_owner');

  return issues;
}

// ── Execute — runs full deletion pipeline ───────────────────────────────────
export async function executeDeleteAccount(userId) {
  if (!supabase || !userId) throw new Error('no_client');
  const today = todayKey();

  // 1. Reasignar host de partidos futuros
  const { data: futureHosted } = await supabase
    .from('games')
    .select('id, fields:field_id(default_host_user_id)')
    .eq('host_user_id', userId)
    .gte('date_key', today);

  for (const game of (futureHosted || [])) {
    const newHost = game.fields?.default_host_user_id ?? null;
    await supabase.from('games').update({ host_user_id: newHost }).eq('id', game.id);
  }

  // 2. Eliminar filas de venue_staff
  await supabase.from('venue_staff').delete().eq('user_id', userId);

  // 3. Anonimizar perfil en public.users
  const { error: anonErr } = await supabase.from('users').update({
    full_name:          'Usuario eliminado',
    email:              null,
    phone:              null,
    birth_date:         null,
    city:               null,
    sex:                null,
    preferred_position: null,
    nationality:        null,
    occupation:         null,
    avatar_path:        null,
    avatar_updated_at:  null,
    user_code:          null,
    deleted_at:         new Date().toISOString(),
  }).eq('id', userId);
  if (anonErr) throw anonErr;

  // 4. Eliminar entrada en auth.users via función SECURITY DEFINER
  await supabase.rpc('delete_auth_user');
}
