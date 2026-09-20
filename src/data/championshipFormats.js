// Reglas MOCK de "Organiza tu campeonato" (frontend). NO consulta Supabase/games/rentals.
// Estructuradas para que, más adelante, formato + cantidad de equipos filtren disponibilidad real.

// ── Formatos de juego ────────────────────────────────────────────────────────
// Presentación al usuario en notación vXv; la lógica interna mantiene keys F6/F7/F8/F11.
export const FORMATS = ['6v6', '7v7', '8v8', '11v11'];
export const FORMAT_KEY = { '6v6': 'F6', '7v7': 'F7', '8v8': 'F8', '11v11': 'F11' };
export const PLAYERS_PER_TEAM = { '6v6': 6, '7v7': 7, '8v8': 8, '11v11': 11 };
export const DEFAULT_FORMAT = '7v7';

// ── Grupos de recomendación por cantidad de equipos (definitivos) ────────────
// phases: bloques secuenciales de (canchas × horas). La 2ª fase (cuando existe) es la
// "hora adicional" con menos canchas. courtHours = Σ(canchas×horas) = CAPACIDAD (horas-cancha),
// NUNCA la duración del campeonato. clockHours = horas de reloj recomendadas.
export const RECOMMENDATION_GROUPS = [
  { id: 'g1', min: 4,  max: 4,  phases: [{ courts: 2, hours: 1 }, { courts: 1, hours: 1 }], courtHours: 3,  clockHours: 2 },
  { id: 'g2', min: 5,  max: 6,  phases: [{ courts: 2, hours: 2 }],                          courtHours: 4,  clockHours: 2 },
  { id: 'g3', min: 7,  max: 8,  phases: [{ courts: 3, hours: 2 }],                          courtHours: 6,  clockHours: 2 },
  { id: 'g4', min: 9,  max: 12, phases: [{ courts: 3, hours: 2 }, { courts: 2, hours: 1 }], courtHours: 8,  clockHours: 3 },
  { id: 'g5', min: 13, max: 14, phases: [{ courts: 4, hours: 2 }, { courts: 1, hours: 1 }], courtHours: 9,  clockHours: 3 },
  { id: 'g6', min: 15, max: 16, phases: [{ courts: 4, hours: 2 }, { courts: 2, hours: 1 }], courtHours: 10, clockHours: 3 },
];

export function groupForTeams(n) {
  if (n == null) return null;
  return RECOMMENDATION_GROUPS.find(g => n >= g.min && n <= g.max) || null;
}

// Rango REFERENCIAL de jugadores por holder (SOLO UX; NO es min/max de inscritos, admite suplentes).
//   minPlayers = minTeams × playersPerTeam
//   maxPlayers = maxTeams × playersPerTeam + (playersPerTeam − 1)  (hasta justo antes del siguiente equipo)
// Derivado (no hardcodeado): si cambian holders o playersPerTeam, el rango se recalcula solo.
export function playersRange(minTeams, maxTeams, playersPerTeam) {
  const p = playersPerTeam || 0;
  return { min: minTeams * p, max: maxTeams * p + (p - 1) };
}

export const MIN_TEAMS = 4;
export const MAX_TEAMS = 16;

// ── Catálogo MOCK de canchas ─────────────────────────────────────────────────
export const DISTRICTS = ['San Borja', 'San Isidro', 'Surco', 'Miraflores'];

// formats = compatibilidad de la sede (qué formatos permite). courts = nº de canchas internas.
export const VENUES = [
  { id: 'v1', name: 'Arena Cayma',      district: 'Surco',      address: 'Av. Primavera 120',  formats: ['F6', 'F7', 'F8'],       courts: 4, amenities: ['parking', 'showers'] },
  { id: 'v2', name: 'Complejo Norte',   district: 'San Isidro', address: 'Av. Aramburú 450',   formats: ['F7', 'F8', 'F11'],      courts: 5, amenities: ['parking', 'covered'] },
  { id: 'v3', name: 'La Bombonera 7',   district: 'San Borja',  address: 'Av. San Luis 980',   formats: ['F6', 'F7'],             courts: 3, amenities: ['showers'] },
  { id: 'v4', name: 'Grass Miraflores', district: 'Miraflores', address: 'Malecón de la R. 22',formats: ['F7', 'F8', 'F11'],      courts: 4, amenities: ['parking', 'showers', 'covered'] },
  { id: 'v5', name: 'Estadio Vega',     district: 'Surco',      address: 'Av. Caminos del Inca',formats: ['F6', 'F7', 'F8', 'F11'],courts: 5, amenities: ['parking'] },
  { id: 'v6', name: 'Cancha Borja Sur', district: 'San Borja',  address: 'Av. Del Aire 310',   formats: ['F6', 'F7'],             courts: 3, amenities: ['showers', 'covered'] },
];

export const AMENITIES = [
  { key: 'parking', label: 'Parking' },
  { key: 'showers', label: 'Duchas' },
  { key: 'covered', label: 'Techado' },
];

// Franjas de 1h (filas de la grilla). Estilo grilla como el resto de la app.
export const HOURS = ['3:00 pm', '4:00 pm', '5:00 pm', '6:00 pm', '7:00 pm', '8:00 pm'];

function seeded(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

// Disponibilidad MOCK determinística por dateKey (ymd). matrix[court][hour] = true(libre)/false(ocupado).
// Solo canchas REALES del venue. ~1 de cada 7 (sede, día) sale 100% ocupada. Además ~1 de cada 4 días
// es "apretado" (menos libre) → para esos días es difícil formar un bloque válido → fecha SIN check.
export function venueMatrix(venue, dateKey) {
  const courts = venue?.courts || 0;
  if (!courts) return [];
  if (seeded(`${venue.id}-${dateKey}`) % 7 === 0) return Array.from({ length: courts }, () => HOURS.map(() => false));
  const thr = (seeded(`tight-${dateKey}`) % 4 === 0) ? 3 : 7; // día apretado (~30% libre) vs normal (~70%)
  return Array.from({ length: courts }, (_, c) =>
    HOURS.map((_, h) => (seeded(`${venue.id}-${dateKey}-${c}-${h}`) % 10) < thr));
}

// Filtra sedes por formato compatible + distritos + amenities (todos MOCK).
export function compatibleVenues(format, districtSet, amenitySet) {
  const fk = FORMAT_KEY[format];
  return VENUES.filter(v =>
    v.formats.includes(fk) &&
    (!districtSet || districtSet.size === 0 || districtSet.has(v.district)) &&
    (!amenitySet || amenitySet.size === 0 || [...amenitySet].every(a => v.amenities.includes(a))));
}

// Perfil recomendado (canchas simultáneas por hora), derivado de las fases del grupo. Ej.:
//   g1 → [2,2]   g2 → [3,3]   g3 → [3,3,2]   g4 → [4,4,2]
export function courtsProfile(group) {
  if (!group) return [];
  const prof = [];
  for (const ph of group.phases) for (let h = 0; h < ph.hours; h++) prof.push(ph.courts);
  return prof;
}

// Autoselección: busca en la matriz un BLOQUE CONSECUTIVO que coincida EXACTAMENTE con el perfil,
// con continuidad de canchas: las MISMAS canchas durante las 2 primeras horas y, en la hora
// adicional (g3/g4), 2 de ESAS mismas canchas. Devuelve la 1ª que encuentre o vacío si no hay.
// NO inventa alternativas (no sustituye 2×2h por 4×1h, etc.).
export function autoSelection(matrix, group) {
  const empty = { cells: new Set() };
  if (!group || !matrix.length) return empty;
  const courts = matrix.length;
  const rows = matrix[0]?.length || 0;
  const p1 = group.phases[0];
  const p2 = group.phases[1] || null;
  const total = p1.hours + (p2 ? p2.hours : 0);
  const free = (c, r) => !!matrix[c]?.[r];
  for (let start = 0; start + total <= rows; start++) {
    // Canchas libres en TODAS las horas de la fase 1 (mismas canchas).
    const s1 = [];
    for (let c = 0; c < courts; c++) {
      let all = true;
      for (let h = 0; h < p1.hours && all; h++) if (!free(c, start + h)) all = false;
      if (all) s1.push(c);
    }
    if (s1.length < p1.courts) continue;
    const chosen1 = s1.slice(0, p1.courts);
    let chosen2 = [];
    if (p2) {
      const r2 = start + p1.hours;
      const cand = chosen1.filter(c => free(c, r2)); // 2 de las MISMAS canchas de la fase 1
      if (cand.length < p2.courts) continue;
      chosen2 = cand.slice(0, p2.courts);
    }
    const cells = new Set();
    for (const c of chosen1) for (let h = 0; h < p1.hours; h++) cells.add(`${c}-${start + h}`);
    if (p2) for (const c of chosen2) cells.add(`${c}-${start + p1.hours}`);
    return { cells };
  }
  return empty;
}

// FUENTE ÚNICA DE VERDAD: todos los horarios válidos (COMPLETOS) del venue para esa fecha.
// Un horario válido = un bloque consecutivo que cumple EXACTAMENTE el perfil, con continuidad de
// canchas. Se agrupa por HORA DE INICIO (una opción por hora), tomando la primera combinación de
// canchas válida de forma determinística. Devuelve [] si no hay ninguno.
// Alimenta: ¿cumple el venue?, check de fecha, orden de venues, selector de horarios, bloque de la
// grilla y aviso — todo desde aquí (no se duplica el algoritmo).
export function findValidTournamentSlots(matrix, group) {
  const slots = [];
  if (!group || !matrix.length) return slots;
  const courts = matrix.length;
  const rows = matrix[0]?.length || 0;
  const p1 = group.phases[0];
  const p2 = group.phases[1] || null;
  const total = p1.hours + (p2 ? p2.hours : 0);
  const free = (c, r) => !!matrix[c]?.[r];
  for (let start = 0; start + total <= rows; start++) {
    // Canchas libres en TODAS las horas de la fase 1 (mismas canchas).
    const s1 = [];
    for (let c = 0; c < courts; c++) {
      let ok = true;
      for (let h = 0; h < p1.hours && ok; h++) if (!free(c, start + h)) ok = false;
      if (ok) s1.push(c);
    }
    if (s1.length < p1.courts) continue;
    const chosen1 = s1.slice(0, p1.courts); // 1ª combinación válida (determinística)
    let chosen2 = null;
    if (p2) {
      const r2 = start + p1.hours;
      const cand = chosen1.filter(c => free(c, r2)); // 2 de las MISMAS canchas de la fase 1
      if (cand.length < p2.courts) continue;
      chosen2 = cand.slice(0, p2.courts);
    }
    const cells = new Set();
    const courtsByHour = [];
    for (let h = 0; h < p1.hours; h++) {
      chosen1.forEach(c => cells.add(`${c}-${start + h}`));
      courtsByHour.push([...chosen1]);
    }
    if (p2) {
      chosen2.forEach(c => cells.add(`${c}-${start + p1.hours}`));
      courtsByHour.push([...chosen2]);
    }
    slots.push({ startHour: start, endHour: start + total, cells, courtsByHour });
  }
  return slots;
}

// ¿La selección coincide EXACTAMENTE con la configuración recomendada?
//   · nº de horas usadas = nº de horas del perfil y CONSECUTIVAS;
//   · fase 1: cada hora con EXACTAMENTE las mismas N canchas;
//   · fase adicional (si existe): exactamente M canchas, todas ⊆ las de la fase 1;
//   · sin celdas extra en otras horas/canchas.
// Las horas-cancha por sí solas NO deciden (2×2h ≠ 4×1h; 4×2h ≠ 3×2h).
export function matchesProfile(selected, group) {
  if (!group || !selected || selected.size === 0) return false;
  const byHour = new Map();
  for (const key of selected) {
    const [c, h] = key.split('-').map(Number);
    if (!byHour.has(h)) byHour.set(h, new Set());
    byHour.get(h).add(c);
  }
  const hours = [...byHour.keys()].sort((a, b) => a - b);
  const p1 = group.phases[0];
  const p2 = group.phases[1] || null;
  const total = p1.hours + (p2 ? p2.hours : 0);
  if (hours.length !== total) return false;
  for (let i = 1; i < hours.length; i++) if (hours[i] !== hours[i - 1] + 1) return false;
  const start = hours[0];
  const s1 = byHour.get(start);
  if (s1.size !== p1.courts) return false;
  // Fase 1: mismas canchas exactas en todas sus horas.
  for (let h = 0; h < p1.hours; h++) {
    const set = byHour.get(start + h);
    if (!set || set.size !== p1.courts) return false;
    for (const c of set) if (!s1.has(c)) return false;
  }
  // Fase adicional: M canchas, subconjunto de las de la fase 1.
  if (p2) {
    const set = byHour.get(start + p1.hours);
    if (!set || set.size !== p2.courts) return false;
    for (const c of set) if (!s1.has(c)) return false;
  }
  return true;
}
