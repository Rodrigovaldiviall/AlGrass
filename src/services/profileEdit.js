import { supabase } from '../lib/supabase';

// Persistencia de "Editar perfil" en public.users (compartida por Perfil y Configuración).
// Devuelve el patch aplicado, o null si no hay sesión / falló (mismo comportamiento que antes).
export async function saveProfileEdit(updated) {
  if (!supabase) return null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return null;
    const patch = {
      full_name:          updated.fullName          || null,
      sex:                updated.gender            || null,
      preferred_position: updated.positions?.length ? updated.positions : null,
      phone:              updated.phone             || null,
      nationality:        updated.nationality       || null,
      occupation:         updated.occupation        || null,
      ...(updated.avatarPath    != null ? { avatar_path: updated.avatarPath } : {}),
      ...(updated.avatarVersion != null ? { avatar_updated_at: new Date(updated.avatarVersion).toISOString() } : {}),
    };
    if (updated.birthYear && updated.birthMonth && updated.birthDay) {
      patch.birth_date = `${updated.birthYear}-${String(updated.birthMonth).padStart(2, '0')}-${String(updated.birthDay).padStart(2, '0')}`;
    }
    const { error } = await supabase.from('users').update(patch).eq('id', session.user.id);
    if (error) { console.warn('[Profile] update users:', error.message); return null; }
    return patch;
  } catch (e) { console.warn('[Profile] handleSave:', e); return null; }
}
