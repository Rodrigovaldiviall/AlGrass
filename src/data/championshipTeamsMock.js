// Mocks de equipos/roster/resultados para "Ver mi campeonato" (frontend). Sin Supabase.
// Fiel a la idea del .md §11/§12/§13: poco ruido visual (1 jugador por equipo), colores de paleta.

export const PALETTE = ['#3F5FE0', '#E24A4A', '#2E9E5B', '#F5A524', '#8E44AD', '#16A0A0', '#D6336C', '#5B6470', '#B8860B', '#1F6B36'];

// Diseño del escudo (mock, simple y extensible): 5 sólidos + 5 patrones. type + colors[].
// Se renderiza igual en el selector (swatch) y en el Shield (grande y pequeños).
export const TEAM_DESIGNS = [
  { id: 'solid-blue', type: 'solid', colors: ['#3F5FE0'] },
  { id: 'solid-red', type: 'solid', colors: ['#E24A4A'] },
  { id: 'solid-green', type: 'solid', colors: ['#2E9E5B'] },
  { id: 'solid-orange', type: 'solid', colors: ['#F5A524'] },
  { id: 'solid-purple', type: 'solid', colors: ['#8E44AD'] },
  { id: 'stripes-blue', type: 'stripes', colors: ['#3F5FE0', '#FFFFFF'] },   // franjas verticales azul/blanco
  { id: 'diagonal-blue', type: 'diagonal', colors: ['#3F5FE0', '#FFFFFF'] }, // franjas diagonales azul/blanco
  { id: 'stripes-red', type: 'stripes', colors: ['#E24A4A', '#FFFFFF'] },    // franjas verticales rojo/blanco
  { id: 'checker-red', type: 'checker', colors: ['#E24A4A', '#FFFFFF'] },    // damero rojo/blanco
  { id: 'split-bw', type: 'split', colors: ['#1B1B1F', '#FFFFFF'] },         // mitad y mitad negro/blanco
];
export const DEFAULT_DESIGN = TEAM_DESIGNS[0];

// Compat: un equipo antiguo con solo `color` → diseño sólido equivalente.
export function designFromColor(color) {
  return TEAM_DESIGNS.find(d => d.type === 'solid' && d.colors[0] === color) || { id: 'solid', type: 'solid', colors: [color || '#5B6470'] };
}
// Diseño efectivo de un equipo: design > color > default.
export function teamDesign(team) {
  if (team && team.design) return team.design;
  if (team && team.color) return designFromColor(team.color);
  return DEFAULT_DESIGN;
}
export function sameDesign(a, b) {
  if (!a || !b) return false;
  return a.type === b.type && (a.colors || []).join(',').toLowerCase() === (b.colors || []).join(',').toLowerCase();
}

const FIRST = ['Carlos', 'Diego', 'Luis', 'Jorge', 'Miguel', 'Andrés', 'Marco', 'Iván', 'Pablo', 'Renzo', 'Bruno', 'Gabriel', 'Álvaro', 'Nicolás', 'Sebastián', 'Rodrigo'];
const LAST = ['Rojas', 'Quispe', 'Torres', 'Vega', 'Ramos', 'Flores', 'Castro', 'Núñez', 'Salas', 'Mendoza', 'Ríos', 'Chávez', 'Paredes', 'Cárdenas', 'Loayza', 'Ponce'];
const TEAM_NAMES = ['Los Tigres', 'Real Cayma', 'Atlético Sur', 'Depor Norte', 'FC Amigos', 'Los Cracks', 'Racing Borja', 'Unión Surco', 'Sporting Vega', 'Titanes', 'Halcones', 'Leones', 'Pumas', 'Dragones', 'Cóndores', 'Búhos'];

function seeded(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

// Regla de nombre de equipo: máximo 4 PALABRAS (no 4 caracteres). Reutilizable en la validación.
export const MAX_TEAM_WORDS = 4;
export function withinTeamNameWordLimit(name) {
  return (name || '').trim().split(/\s+/).filter(Boolean).length <= MAX_TEAM_WORDS;
}

export function initials(name) {
  const p = (name || '').trim().split(/\s+/);
  return (((p[0] || '')[0] || '') + ((p[1] || '')[0] || '')).toUpperCase() || '?';
}

// Color determinístico por nombre (avatar).
export function hashColor(name) { return `hsl(${seeded(name || '') % 360} 45% 45%)`; }

// Oscurece un hex (#rrggbb) para la franja/ribbon del escudo.
export function darken(hex, amt = 0.28) {
  const n = parseInt((hex || '#888888').slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amt));
  const g = Math.round(((n >> 8) & 255) * (1 - amt));
  const b = Math.round((n & 255) * (1 - amt));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// Nombre del usuario actual (mock). El jugador id 'you' lo usa; en listas se muestra con "(tú)".
export const CURRENT_USER_NAME = 'Rodrigo Valdivia Llosa';

// Formato de nombre en listas: 2 palabras completas + inicial de la 3ª ("Rodrigo Valdivia L.").
export function displayPlayerName(name) {
  const w = (name || '').trim().split(/\s+/).filter(Boolean);
  if (w.length <= 2) return w.join(' ');
  return `${w[0]} ${w[1]} ${w[2][0].toUpperCase()}.`;
}
// Etiqueta de fila de jugador: formatea el nombre y marca al usuario actual con "(tú)".
export function playerLabel(p) {
  const base = displayPlayerName(p?.name);
  return p?.id === 'you' ? `${base} (tú)` : base;
}

// Equipos mock: `count` equipos, 1 jugador cada uno (bajo ruido, como el .md). Nombre de 3 palabras
// (nombre + 2 apellidos) para mostrar el formato "Nombre Apellido I.".
export function buildTeams(count) {
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    const design = TEAM_DESIGNS[i % TEAM_DESIGNS.length];
    return {
      id: 't' + i,
      name: TEAM_NAMES[i % TEAM_NAMES.length],
      color: design.colors[0], // compat con consumidores que aún leen color
      design,
      players: [{ id: `p${i}`, name: `${FIRST[seeded('f' + i) % FIRST.length]} ${LAST[seeded('l' + i) % LAST.length]} ${LAST[seeded('m' + i) % LAST.length]}` }],
    };
  });
}

// Jugadores sin equipo (lista general).
export const NO_TEAM_PLAYERS = [
  { id: 'n1', name: 'Andrés Salas Rojas' },
  { id: 'n2', name: 'Renzo Paredes Vega' },
];

// Roster combinado: jugadores de todos los equipos + sin equipo. `you` (opcional) va primero.
// includeNoTeamPool: pool mock "sin equipo" SOLO en la demo previa. Campeonato REAL creado → false
// (jugadores derivan únicamente de equipos reales + quien se une; sin fallback a mocks).
export function combinedRoster(teams, you, includeNoTeamPool = true) {
  const rows = [];
  teams.forEach(t => (t.players || []).forEach(p => rows.push({ ...p, team: t })));
  if (includeNoTeamPool) NO_TEAM_PLAYERS.forEach(p => rows.push({ ...p, team: null }));
  rows.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return you ? [you, ...rows] : rows;
}

// ── Formato por cantidad de equipos (fuente ÚNICA; docs). Solo describe la ESTRUCTURA para
//    la demo visual (grupos de la Tabla, semifinales de la Llave, partidos por equipo).
//    NO genera fixture/cruces/clasificación. Semifinales SOLO en 8, 12 y 16. ────────────────
export const CHAMPIONSHIP_FORMATS_BY_TEAM_COUNT = {
  4:  { groupSizes: [4],          gamesPerTeam: [3],          hasSemifinals: false, hasFinal: true, hasThirdPlace: true },
  5:  { groupSizes: [5],          gamesPerTeam: [4],          hasSemifinals: false, hasFinal: true, hasThirdPlace: true },
  6:  { groupSizes: [6],          gamesPerTeam: [3],          hasSemifinals: false, hasFinal: true, hasThirdPlace: true },
  7:  { groupSizes: [7],          gamesPerTeam: [4],          hasSemifinals: false, hasFinal: true, hasThirdPlace: true },
  8:  { groupSizes: [4, 4],       gamesPerTeam: [3, 3],       hasSemifinals: true,  hasFinal: true, hasThirdPlace: true },
  9:  { groupSizes: [4, 5],       gamesPerTeam: [3, 4],       hasSemifinals: false, hasFinal: true, hasThirdPlace: true },
  10: { groupSizes: [5, 5],       gamesPerTeam: [4, 4],       hasSemifinals: false, hasFinal: true, hasThirdPlace: true },
  11: { groupSizes: [4, 7],       gamesPerTeam: [3, 4],       hasSemifinals: false, hasFinal: true, hasThirdPlace: true },
  12: { groupSizes: [4, 4, 4],    gamesPerTeam: [3, 3, 3],    hasSemifinals: true,  hasFinal: true, hasThirdPlace: true },
  13: { groupSizes: [4, 4, 5],    gamesPerTeam: [3, 3, 4],    hasSemifinals: false, hasFinal: true, hasThirdPlace: true },
  14: { groupSizes: [4, 4, 6],    gamesPerTeam: [3, 3, 3],    hasSemifinals: false, hasFinal: true, hasThirdPlace: true },
  15: { groupSizes: [4, 5, 6],    gamesPerTeam: [3, 4, 3],    hasSemifinals: false, hasFinal: true, hasThirdPlace: true },
  16: { groupSizes: [4, 4, 4, 4], gamesPerTeam: [3, 3, 3, 3], hasSemifinals: true,  hasFinal: true, hasThirdPlace: true },
};

export function formatForTeamCount(n) {
  return CHAMPIONSHIP_FORMATS_BY_TEAM_COUNT[n]
    || CHAMPIONSHIP_FORMATS_BY_TEAM_COUNT[Math.min(16, Math.max(4, n || 4))];
}

// Copy compacto del formato para la zona de Resultados.
export function formatSummaryLabel(n, cfg) {
  const G = cfg.groupSizes.length;
  if (G === 1) return `${n} equipos · ${cfg.gamesPerTeam[0]} partidos por equipo`;
  const sameSize = cfg.groupSizes.every(s => s === cfg.groupSizes[0]);
  const sameGames = cfg.gamesPerTeam.every(g => g === cfg.gamesPerTeam[0]);
  if (sameSize && sameGames) return `${n} equipos · ${G} grupos de ${cfg.groupSizes[0]} · ${cfg.gamesPerTeam[0]} partidos por equipo`;
  return `${n} equipos · ${G} grupos (${cfg.groupSizes.join(' + ')})`;
}

// Reparte un array secuencialmente según tamaños de grupo.
export function chunkByCounts(arr, counts) {
  const out = []; let i = 0;
  counts.forEach(c => { out.push(arr.slice(i, i + c)); i += c; });
  return out;
}

// ── Resultados (MOCK visual, NO es el fixture definitivo) ────────────────────
export function mockStandings(teams) {
  return teams.map((t, i) => {
    const g = 2 - (i % 3 === 0 ? 1 : 0), e = i % 2, p = 3 - g - e;
    return { team: t, pj: 3, g, e, p, pts: g * 3 + e, gf: 5 + (seeded(t.name) % 5), gc: 2 + (seeded(t.id) % 4), dg: (5 + seeded(t.name) % 5) - (2 + seeded(t.id) % 4), results: [g > 0 ? 'w' : 'l', e ? 'd' : (g > 1 ? 'w' : 'l'), p > 0 ? 'l' : 'w'] };
  }).sort((a, b) => b.pts - a.pts || b.dg - a.dg);
}

export function mockScorers(teams) {
  const list = [];
  teams.forEach(t => t.players.forEach(p => list.push({ ...p, team: t, goals: seeded(p.name) % 5 })));
  return list.sort((a, b) => b.goals - a.goals);
}

// Partidos MOCK explícitos (NO fixture). `played` distingue pasado (con marcador) de próximo.
// dateLabel ya viene formateado "Dom 19 de mayo"; time en línea aparte.
export function mockMatches(teams) {
  if (teams.length < 2) return [];
  const T = (i) => teams[i];
  const base = [
    { ai: 0, bi: 1, played: true,  sa: 3, sb: 1, court: 'C2', dateLabel: 'Sáb 18 de mayo', time: '4:00 pm' },
    { ai: 2, bi: 3, played: true,  sa: 2, sb: 2, court: 'C1', dateLabel: 'Sáb 18 de mayo', time: '5:00 pm' },
    { ai: 4, bi: 5, played: true,  sa: 0, sb: 2, court: 'C3', dateLabel: 'Sáb 18 de mayo', time: '6:00 pm' },
    { ai: 0, bi: 2, played: false, sa: null, sb: null, court: 'C2', dateLabel: 'Dom 19 de mayo', time: '4:00 pm' },
    { ai: 1, bi: 3, played: false, sa: null, sb: null, court: 'C1', dateLabel: 'Dom 19 de mayo', time: '5:00 pm' },
    { ai: 4, bi: 6, played: false, sa: null, sb: null, court: 'C3', dateLabel: 'Dom 19 de mayo', time: '6:00 pm' },
    { ai: 5, bi: 0, played: false, sa: null, sb: null, court: 'C2', dateLabel: 'Lun 20 de mayo', time: '7:00 pm' },
  ];
  return base
    .filter(m => m.ai < teams.length && m.bi < teams.length)
    .map((m, i) => ({ id: 'm' + i, a: T(m.ai), b: T(m.bi), played: m.played, sa: m.sa, sb: m.sb, court: m.court, dateLabel: m.dateLabel, time: m.time }));
}
