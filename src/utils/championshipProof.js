// ── Comprobante de transferencia bancaria de Campeonatos → bucket PRIVADO ──
// Sube el archivo a `championship-payment-proofs` y devuelve SOLO el storage path (nunca URL pública:
// el bucket es privado; las signed URLs se generan luego desde AlGrass-Admin). El path se guarda en
// championships.payment_voucher_ref vía confirm_championship_transfer.
import { uuidv4 } from '../lib/uuid';

// Tipos permitidos (imagen o PDF). Sin límite en el proyecto → elijo 10 MB conservador.
export const PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const PROOF_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

// Valida tipo + tamaño en frontend (rechazo antes de subir). Devuelve mensaje de error o null.
export function validateProofFile(file) {
  if (!file) return 'Adjunta un comprobante.';
  if (!PROOF_TYPES.includes(file.type)) return 'Formato no permitido. Usa JPG, PNG, WEBP o PDF.';
  if (file.size > PROOF_MAX_BYTES) return 'El archivo supera los 10 MB.';
  return null;
}

// Sube el comprobante. Path: {userId}/{championshipId}/{uuid}.{ext} (identidad NO depende del filename
// original). Sin getPublicUrl. Devuelve { path } o { error }.
export async function uploadChampionshipProof(supabase, { userId, championshipId, file }) {
  const invalid = validateProofFile(file);
  if (invalid) return { error: invalid };
  if (!userId || !championshipId) return { error: 'MISSING_IDS' };
  const ext = EXT[file.type] || 'bin';
  const path = `${userId}/${championshipId}/${uuidv4()}.${ext}`;
  const { error } = await supabase.storage
    .from('championship-payment-proofs')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { error: error.message || 'UPLOAD_FAILED' };
  return { path };
}
