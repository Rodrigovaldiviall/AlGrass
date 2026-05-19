import { TODAY_KEY, TOMORROW_KEY } from '../data/games';

const _DOW   = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const _MONTH = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/**
 * "2026-05-19" → "Hoy, mar 19 may 2026" / "Mañana, mié 20 may 2026" / "jue 21 may 2026"
 */
export function formatDateLabel(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const base = `${_DOW[d.getDay()]} ${d.getDate()} ${_MONTH[d.getMonth()]} ${d.getFullYear()}`;
  if (dateKey === TODAY_KEY)    return `Hoy, ${base}`;
  if (dateKey === TOMORROW_KEY) return `Mañana, ${base}`;
  return base;
}

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
