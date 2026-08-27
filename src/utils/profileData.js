// Constantes/helpers compartidos de datos de perfil, extraídos de Profile.jsx SIN cambiar
// su lógica. Viven aquí (no en Profile) para poder importarse desde otras pantallas sin
// activar react-refresh/only-export-components (Profile así solo exporta componentes).

export const POSITIONS = ['DEL', 'MED', 'DEF', 'ARQ'];

const PREFIX_DATA = [
  { code: '+51',  digits: '51',  label: 'Perú',          exact: 9 },
  { code: '+54',  digits: '54',  label: 'Argentina' },
  { code: '+591', digits: '591', label: 'Bolivia' },
  { code: '+55',  digits: '55',  label: 'Brasil' },
  { code: '+56',  digits: '56',  label: 'Chile' },
  { code: '+86',  digits: '86',  label: 'China' },
  { code: '+57',  digits: '57',  label: 'Colombia' },
  { code: '+593', digits: '593', label: 'Ecuador' },
  { code: '+34',  digits: '34',  label: 'España' },
  { code: '+1',   digits: '1',   label: 'Estados Unidos' },
  { code: '+595', digits: '595', label: 'Paraguay' },
  { code: '+598', digits: '598', label: 'Uruguay' },
  { code: '+58',  digits: '58',  label: 'Venezuela' },
];

export function detectPrefix(input) {
  const d = input.replace(/[^\d]/g, '');
  for (const len of [3, 2, 1]) {
    const found = PREFIX_DATA.find(p => p.digits === d.slice(0, len));
    if (found) return found;
  }
  return null;
}

export const MONTH_LABELS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function calcAge(day, month, year) {
  if (!day || !month || !year) return null;
  const today = new Date();
  const born  = new Date(year, month - 1, day);
  let age = today.getFullYear() - born.getFullYear();
  const m = today.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < born.getDate())) age--;
  return age >= 0 ? age : null;
}
