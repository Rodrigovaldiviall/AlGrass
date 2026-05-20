import { compressAvatarImage } from './compress';

export async function uploadAvatar(supabase, userId, file) {
  const compressed = await compressAvatarImage(file);
  const path = `${userId}/avatar.webp`;
  const { error } = await supabase.storage.from('avatars').upload(path, compressed, { upsert: true, contentType: 'image/webp' });
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
