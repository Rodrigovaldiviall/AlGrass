// ── Foto de PORTADA (opcional) de un campeonato real → bucket PÚBLICO championship-covers ──
// Guarda SOLO el path en championships.cover_image_path (vía RPC). La URL pública se deriva en runtime
// con getPublicUrl (nunca se almacena en DB). cover_theme sigue siendo la identidad/fallback.
import { uuidv4 } from '../lib/uuid';
import { compressChampionshipCover } from './compress';

export const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp']; // NO PDF
export const COVER_MAX_BYTES = 8 * 1024 * 1024; // 8 MB (barrera máxima, igual que el bucket)

// Validación frontend de tipo + tamaño (ANTES de optimizar). Devuelve mensaje de error o null.
export function validateCoverImage(file) {
  if (!file) return 'Selecciona una imagen.';
  if (!COVER_TYPES.includes(file.type)) return 'Formato no permitido. Usa JPG, PNG o WEBP.';
  if (file.size > COVER_MAX_BYTES) return 'La imagen supera los 8 MB.';
  return null;
}

// Optimiza (1600px/WebP/~0.82) y sube. La salida SIEMPRE es WebP → path/MIME = webp (coincide con el
// archivo final real). Si la optimización falla NO se sube el original pesado: se devuelve error claro.
// Path: {ownerUserId}/{championshipId}/{uuid}.webp. Devuelve { path } o { error }.
export async function uploadChampionshipCover(supabase, { userId, championshipId, file }) {
  const invalid = validateCoverImage(file);          // 8 MB + tipo, antes del procesamiento
  if (invalid) return { error: invalid };
  if (!userId || !championshipId) return { error: 'MISSING_IDS' };
  let optimized;
  try { optimized = await compressChampionshipCover(file); }
  catch { return { error: 'No pudimos optimizar la imagen. Intenta con otra.' }; }
  const path = `${userId}/${championshipId}/${uuidv4()}.webp`;
  const { error } = await supabase.storage
    .from('championship-covers')
    .upload(path, optimized, { contentType: 'image/webp', upsert: false });
  if (error) return { error: 'No se pudo subir la foto.' };
  return { path };
}

// URL pública derivada del path (bucket público). No se persiste en DB.
// Opcional `{ width, quality }` → variante TRANSFORMADA de lectura (Supabase Image Transformations): se pide
// una imagen más pequeña que el master 1600px (que NO cambia). Sin opciones → URL original (compat hacia atrás).
// Si la transformación no produjera URL → fallback a la original (el banner nunca se rompe).
export function getChampionshipCoverUrl(supabase, path, opts = null) {
  if (!path) return null;
  const bucket = supabase.storage.from('championship-covers');
  if (opts && opts.width) {
    const { data } = bucket.getPublicUrl(path, { transform: { width: opts.width, quality: opts.quality ?? 80 } });
    if (data?.publicUrl) return data.publicUrl;
  }
  const { data } = bucket.getPublicUrl(path);
  return data?.publicUrl || null;
}

// Borra un objeto anterior (limpieza tras cambiar/eliminar foto). Silencioso: un fallo deja un orphan
// pero NO rompe la UX (la DB ya apunta al valor correcto).
export async function deleteChampionshipCover(supabase, path) {
  if (!path) return;
  try { await supabase.storage.from('championship-covers').remove([path]); } catch {}
}
