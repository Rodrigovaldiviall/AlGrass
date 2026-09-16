// Configuración MOCK del checkout de Campeonatos (frontend). Centralizada para que más
// adelante estos valores puedan venir de Admin/Supabase sin tocar el JSX. Nada real aún.

// Precio base MOCK del campeonato (no es la fórmula definitiva de precio).
export const CHAMPIONSHIP_BASE_PRICE = 800; // S/ — MOCK

// Extras MOCK. Estructura estable {id, emoji, label, price} → futura fuente Admin/Supabase.
export const CHAMPIONSHIP_EXTRAS = [
  { id: 'trofeo', emoji: '🏆', label: 'Trofeo', price: 50 },
  { id: 'medallas', emoji: '🥇', label: 'Medallas', price: 80 },
  { id: 'fotografia', emoji: '📷', label: 'Fotografía', price: 90 },
  { id: 'filmacion', emoji: '🎥', label: 'Filmación', price: 120 },
];

// Datos bancarios MOCK para Transferencia. Centralizados (futuro: Admin).
export const CHAMPIONSHIP_BANK = {
  bankName: 'BCP',
  accountHolder: 'AlGrass S.A.C.',
  ruc: '20601234567',
  accountNumber: '191-1234567-0-01',
  cci: '00219100123456700123',
};

// Formato de soles del checkout de campeonato (enteros; claramente mock).
export function soles(n) { return `S/ ${Number(n || 0).toFixed(0)}`; }

// Total = base + extras seleccionados (Set de ids).
export function championshipTotal(base, selectedIds) {
  const extras = CHAMPIONSHIP_EXTRAS.filter(e => selectedIds.has(e.id)).reduce((s, e) => s + e.price, 0);
  return base + extras;
}

// ── Estado del campeonato (mock) — publicación e inscripciones ──────────────────────────────
// Regla AlGrass (futuro Admin): las inscripciones cierran N días antes del inicio. Centralizada.
export const CHAMPIONSHIP_REGISTRATION_CLOSE_DAYS = 5;

// Clave de inscripción demo, consistente por campeonato (hash del nombre → ALG-XXXX).
export function makeRegistrationKey(seedStr) {
  const s = String(seedStr || 'AlGrass');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 'ALG-' + String(1000 + (h % 9000));
}

const _MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// Cierre de inscripciones a partir del inicio (dateKey 'YYYY-MM-DD'). null si no hay fecha definitiva.
export function computeRegistrationClose(dateKey) {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const [y, m, d] = dateKey.split('-').map(Number);
  const close = new Date(y, m - 1, d - CHAMPIONSHIP_REGISTRATION_CLOSE_DAYS);
  return {
    iso: `${close.getFullYear()}-${String(close.getMonth() + 1).padStart(2, '0')}-${String(close.getDate()).padStart(2, '0')}`,
    label: `${close.getDate()} de ${_MONTHS[close.getMonth()]}`,
  };
}
