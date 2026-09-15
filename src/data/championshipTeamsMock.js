// Mocks de equipos/roster/resultados para "Ver mi campeonato" (frontend). Sin Supabase.
// Fiel a la idea del .md §11/§12/§13: poco ruido visual (1 jugador por equipo), colores de paleta.

export const PALETTE = ['#3F5FE0', '#E24A4A', '#2E9E5B', '#F5A524', '#8E44AD', '#16A0A0', '#D6336C', '#5B6470', '#B8860B', '#1F6B36'];

const FIRST = ['Carlos', 'Diego', 'Luis', 'Jorge', 'Miguel', 'Andrés', 'Marco', 'Iván', 'Pablo', 'Renzo', 'Bruno', 'Gabriel', 'Álvaro', 'Nicolás', 'Sebastián', 'Rodrigo'];
const LAST = ['Rojas', 'Quispe', 'Torres', 'Vega', 'Ramos', 'Flores', 'Castro', 'Núñez', 'Salas', 'Mendoza', 'Ríos', 'Chávez', 'Paredes', 'Cárdenas', 'Loayza', 'Ponce'];
const TEAM_NAMES = ['Los Tigres', 'Real Cayma', 'Atlético Sur', 'Depor Norte', 'FC Amigos', 'Los Cracks', 'Racing Borja', 'Unión Surco', 'Sporting Vega', 'Titanes', 'Halcones', 'Leones', 'Pumas', 'Dragones', 'Cóndores', 'Búhos'];

function seeded(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

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

// Equipos mock: `count` equipos, 1 jugador cada uno (bajo ruido, como el .md).
export function buildTeams(count) {
  return Array.from({ length: Math.max(0, count) }, (_, i) => ({
    id: 't' + i,
    name: TEAM_NAMES[i % TEAM_NAMES.length],
    color: PALETTE[i % PALETTE.length],
    players: [{ id: `p${i}`, name: `${FIRST[seeded('f' + i) % FIRST.length]} ${LAST[seeded('l' + i) % LAST.length]}` }],
  }));
}

// Jugadores sin equipo (lista general).
export const NO_TEAM_PLAYERS = [
  { id: 'n1', name: 'Andrés Salas' },
  { id: 'n2', name: 'Renzo Paredes' },
];

// Roster combinado: jugadores de todos los equipos + sin equipo. `you` (opcional) va primero.
export function combinedRoster(teams, you) {
  const rows = [];
  teams.forEach(t => t.players.forEach(p => rows.push({ ...p, team: t })));
  NO_TEAM_PLAYERS.forEach(p => rows.push({ ...p, team: null }));
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

export function mockMatches(teams) {
  const times = ['4:00 pm', '5:00 pm', '6:00 pm', '7:00 pm'];
  const days = ['Sáb 18', 'Dom 19'];
  const m = [];
  for (let i = 0; i + 1 < teams.length; i += 2) {
    const k = i / 2;
    const done = i === 0;
    m.push({
      a: teams[i], b: teams[i + 1], done,
      sa: done ? 2 : null, sb: done ? 1 : null,
      court: 'C' + ((k % 4) + 1),
      day: days[k % days.length],
      time: times[k % times.length],
    });
  }
  return m;
}
