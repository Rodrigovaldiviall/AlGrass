import { supabase } from '../lib/supabase';

// Estados "abiertos": mientras la solicitud está en curso no se permite crear otra.
export const OPEN_STATUSES = ['pending_email_confirmation', 'pending_review'];
// Código Postgres de violación de UNIQUE (índice parcial de solicitud abierta).
export const UNIQUE_VIOLATION = '23505';

// Crea la solicitud del usuario autenticado. Inserta SOLO user_id + group_size + status.
// requested_at lo genera la BD (DEFAULT now()); reviewed_*/assigned_role/review_note quedan
// en su default (null). La RLS + los CHECK imponen user_id=auth.uid() y el estado válido.
// Devuelve { error } (error.code === UNIQUE_VIOLATION si ya hay una solicitud abierta).
export async function createCaptainRequest(userId, groupSize) {
  if (!supabase || !userId) return { error: { message: 'invalid' } };
  const { error } = await supabase.from('captain_requests').insert({
    user_id: userId,
    group_size: groupSize,
    status: 'pending_review',
  });
  return { error: error ?? null };
}

// ¿El usuario tiene una solicitud ABIERTA? El índice parcial garantiza como máximo una.
// Devuelve { open, error }; ante ausencia de fila, open=false sin error.
export async function fetchMyOpenCaptainRequest(userId) {
  if (!supabase || !userId) return { open: false, error: null };
  const { data, error } = await supabase
    .from('captain_requests')
    .select('id, status')
    .eq('user_id', userId)
    .in('status', OPEN_STATUSES)
    .maybeSingle();
  if (error) return { open: false, error };
  return { open: !!data, error: null };
}
