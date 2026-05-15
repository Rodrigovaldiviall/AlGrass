/**
 * "Rodrigo Valdivia Llerena" → "Rodrigo V."
 * Solo para displays compactos/listados. El nombre completo debe mostrarse en contextos de detalle.
 */
export function abbreviateName(name) {
  if (!name) return name;
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0]} ${parts[1][0]}.`;
}

function _normalizeWord(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z]/g, '').toLowerCase();
}

/**
 * Genera un candidato: rodrigoval482, pedrosil731, pedro582
 * NO incluye el @. Llamar varias veces para distintos candidatos (el random cambia).
 */
export function buildUserCodeCandidate(fullName) {
  const parts  = (fullName || '').trim().split(/\s+/).filter(Boolean);
  const first  = _normalizeWord(parts[0] || '');
  const second = _normalizeWord(parts[1] || '').slice(0, 3);
  const digits = String(Math.floor(Math.random() * 900) + 100);
  return first + second + digits;
}

/**
 * Genera y persiste users.user_code si todavía es null.
 * Reintenta hasta 10 veces ante colisión UNIQUE (código 23505).
 * Retorna el código guardado, o null si falla tras los intentos.
 */
export async function ensureUserCode(supabase, userId, fullName) {
  for (let i = 0; i < 10; i++) {
    const code = buildUserCodeCandidate(fullName);
    const { error } = await supabase
      .from('users')
      .update({ user_code: code })
      .eq('id', userId)
      .is('user_code', null);
    if (!error) return code;
    const isUnique = error.code === '23505' || (error.message || '').includes('unique');
    if (!isUnique) return null;
  }
  return null;
}
