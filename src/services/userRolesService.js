import { supabase } from '../lib/supabase';

// Roles GLOBALES de la plataforma. Fuente única: tabla user_roles.
// NO incluye permisos contextuales (venue_staff, manager_user_id, host).
export const GLOBAL_ROLES = ['captain', 'captain_gold', 'algrass_staff', 'algrass_admin'];

// Lee SOLO los roles globales del usuario autenticado.
// RLS garantiza que únicamente devuelve filas con user_id = auth.uid().
export async function fetchMyGlobalRoles(userId) {
  if (!supabase || !userId) return [];
  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId);
  if (error) { console.warn('[userRoles] fetch error:', error); return []; }
  return (data ?? []).map(r => r.role).filter(r => GLOBAL_ROLES.includes(r));
}

// Deriva los flags acumulables a partir del array de roles.
export function deriveRoleFlags(roles = []) {
  const set = new Set(roles);
  return {
    // captain y captain_gold tienen permisos idénticos → ambos cuentan como capitán.
    isCaptain:      set.has('captain') || set.has('captain_gold'),
    isCaptainGold:  set.has('captain_gold'),
    isAlGrassStaff: set.has('algrass_staff'),
    isAlGrassAdmin: set.has('algrass_admin'),
  };
}

// Administración (RPC SECURITY DEFINER — la autorización se valida en la BD).
export async function grantCaptain(targetUserId) {
  if (!supabase || !targetUserId) return { error: 'invalid' };
  return supabase.rpc('grant_captain', { p_user_id: targetUserId });
}

export async function revokeCaptain(targetUserId) {
  if (!supabase || !targetUserId) return { error: 'invalid' };
  return supabase.rpc('revoke_captain', { p_user_id: targetUserId });
}
