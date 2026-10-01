// Constantes/helpers compartidos de datos de perfil, extraídos de Profile.jsx SIN cambiar
// su lógica. Viven aquí (no en Profile) para poder importarse desde otras pantallas sin
// activar react-refresh/only-export-components (Profile así solo exporta componentes).
import { supabase } from '../lib/supabase';

export const POSITIONS = ['DEL', 'MED', 'DEF', 'ARQ'];

// Ciudad ACTIVA del usuario = fuente ÚNICA persistente (localStorage 'pichanga_profile'.city), la MISMA que usan
// Partidos/Rentals. Se actualiza al cambiar de ciudad (junto con public.users.city). null si aún no hay ciudad.
// NO usar user.city de AuthContext para scope de ciudad: ese objeto no se re-hidrata al cambiar de ciudad en sesión.
export function getActiveCity() {
  try { return JSON.parse(localStorage.getItem('pichanga_profile'))?.city || null; } catch { return null; }
}

// Cambia la ciudad ACTIVA con el MISMO mecanismo que el selector de Partidos (PickupGames.handleCityChange):
// persiste en localStorage 'pichanga_profile' + actualiza public.users.city (supabase-js es lazy → .then()
// obligatorio para que la query se envíe). No crea otro estado/contexto. Devuelve nada; el caller refresca su UI.
export function setActiveCity(city, userId) {
  if (!city) return;
  try { const p = JSON.parse(localStorage.getItem('pichanga_profile')) || {}; localStorage.setItem('pichanga_profile', JSON.stringify({ ...p, city })); } catch {}
  if (userId) supabase.from('users').update({ city }).eq('id', userId).then(({ error }) => { if (error) console.warn('[city] users.update failed:', error); });
}

// Lista de ciudades soportadas = MISMA fuente que Partidos/Settings (distintas venues.city, ordenadas es).
export async function fetchCities() {
  const { data } = await supabase.from('venues').select('city').not('city', 'is', null);
  return [...new Set((data ?? []).map(r => r.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
}

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
