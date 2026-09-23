// ── Foto de PORTADA (opcional) de un campeonato real → bucket PÚBLICO championship-covers ──
// Guarda SOLO el path en championships.cover_image_path (vía RPC). La URL pública se deriva en runtime
// con getPublicUrl (nunca se almacena en DB). cover_theme sigue siendo la identidad/fallback.
import { uuidv4 } from '../lib/uuid';

export const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp']; // NO PDF
export const COVER_MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Validación frontend de tipo + tamaño. Devuelve mensaje de error o null.
export function validateCoverImage(file) {
  if (!file) return 'Selecciona una imagen.';
  if (!COVER_TYPES.includes(file.type)) return 'Formato no permitido. Usa JPG, PNG o WEBP.';
  if (file.size > COVER_MAX_BYTES) return 'La imagen supera los 8 MB.';
  return null;
}

// Sube la portada. Path: {ownerUserId}/{championshipId}/{uuid}.{ext}. Devuelve { path } o { error }.
export async function uploadChampionshipCover(supabase, { userId, championshipId, file }) {
  const invalid = validateCoverImage(file);
  if (invalid) return { error: invalid };
  if (!userId || !championshipId) return { error: 'MISSING_IDS' };
  const ext = EXT[file.type] || 'jpg';
  const path = `${userId}/${championshipId}/${uuidv4()}.${ext}`;
  const { error } = await supabase.storage
    .from('championship-covers')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { error: error.message || 'UPLOAD_FAILED' };
  return { path };
}

// URL pública derivada del path (bucket público). No se persiste en DB.
export function getChampionshipCoverUrl(supabase, path) {
  if (!path) return null;
  const { data } = supabase.storage.from('championship-covers').getPublicUrl(path);
  return data?.publicUrl || null;
}

// Borra un objeto anterior (limpieza tras cambiar/eliminar foto). Silencioso: un fallo deja un orphan
// pero NO rompe la UX (la DB ya apunta al valor correcto).
export async function deleteChampionshipCover(supabase, path) {
  if (!path) return;
  try { await supabase.storage.from('championship-covers').remove([path]); } catch {}
}
