import { compressAvatarImage } from './compress';

export async function uploadAvatar(supabase, userId, file) {
  const compressed = await compressAvatarImage(file);
  const path = `${userId}/avatar.webp`;
  const { error } = await supabase.storage.from('avatars').upload(path, compressed, { upsert: true, contentType: 'image/webp' });
  if (error) throw error;
  return path;
}

// Importa el avatar de un proveedor OAuth (Google/Facebook) al bucket `avatars`.
// NO pasa la imagen por canvas (evita tainted-canvas/CORS): descarga el binario tal
// cual con un GET simple y lo sube manteniendo la convención ${userId}/avatar.webp.
// Devuelve el path subido. Lanza si el fetch/subida falla (el caller lo trata como
// "continuar sin avatar", nunca bloquea el login).
export async function importOAuthAvatar(supabase, userId, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`avatar fetch ${res.status}`);
  const blob = await res.blob();
  if (!blob.size) throw new Error('avatar vacío');
  const path = `${userId}/avatar.webp`;
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, blob, { upsert: true, contentType: blob.type || 'image/jpeg' });
  if (error) throw error;
  return path;
}

export function getAvatarUrl(supabase, path, version = null) {
  if (!path) return null;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  const url = data?.publicUrl;
  if (!url) return null;
  return version ? `${url}?v=${version}` : url;
}
