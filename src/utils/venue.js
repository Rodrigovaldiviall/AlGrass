import { compressVenueImage } from './compress';

export async function uploadVenueCover(supabase, venueId, file) {
  const compressed = await compressVenueImage(file);
  const path = `${venueId}/cover.webp`;
  const { error } = await supabase.storage.from('venues').upload(path, compressed, { upsert: true, contentType: 'image/webp' });
  if (error) throw error;
  const version = Date.now();
  await supabase.from('venues').update({ cover_image_path: path, cover_updated_at: new Date(version).toISOString() }).eq('id', venueId);
  return { path, version };
}

export function getVenueCoverUrl(supabase, path, version = null) {
  if (!path) return null;
  const { data } = supabase.storage.from('venues').getPublicUrl(path);
  const url = data?.publicUrl;
  if (!url) return null;
  return version ? `${url}?v=${version}` : url;
}
