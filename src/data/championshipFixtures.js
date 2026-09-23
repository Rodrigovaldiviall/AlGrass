// FUENTE MAESTRA: Docs/campeonatos-formatos.xlsx (hoja "Fixture"). Traducción EXACTA a config
// centralizada. NO se lee el Excel en runtime. Frontend/mock; futuro: Supabase/Admin.
// Las letras A,B,C… son POSICIONES de sorteo; se resuelven a equipos reales con drawTeams().

export const CHAMPIONSHIP_FIXTURES = {
  4: {
    teams: 4,
    format: "Vs + Final + 3°",
    groups: [4],           // tamaños de grupo (sorteo llena en este orden)
    groupCount: 1,
    courts: 2,
    hasSemifinals: false,
    hasFinal: true,
    hasThirdPlace: true,
    totalMatches: 8,
    totalHours: 4,   // canchas·horas (bloque grupos + bloque finales)
    minGamesPerTeam: 3,   // 45 min por equipo
    maxGamesPerTeam: 4,   // 60 max por equipo
    schedule: [
      { time: "00–15", cells: ["A vs B", "C vs D"] },
      { time: "15–20", cells: ["descanso 5'"] },
      { time: "20–35", cells: ["A vs C", "B vs D"] },
      { time: "35–40", cells: ["descanso 5'"] },
      { time: "40–55", cells: ["A vs D", "B vs C"] },
      { time: "55–60", cells: ["descanso 15'"] },
      { time: "60–70", cells: [] },
      { time: "70–85", cells: ["1° vs 2° FINAL", "3° vs 4°"] },
      { time: "85–120", cells: ["margen 35'"] },
    ],
  },
  5: {
    teams: 5,
    format: "Vs + Final + 3°",
    groups: [5],           // tamaños de grupo (sorteo llena en este orden)
    groupCount: 1,
    courts: 2,
    hasSemifinals: false,
    hasFinal: true,
    hasThirdPlace: true,
    totalMatches: 12,
    totalHours: 4,   // canchas·horas (bloque grupos + bloque finales)
    minGamesPerTeam: 4,   // 60 min por equipo
    maxGamesPerTeam: 5,   // 75 max por equipo
    schedule: [
      { time: "00–15", cells: ["A vs B", "C vs D"] },
      { time: "15–20", cells: ["Descanso 5'", "Descanso 5'"] },
      { time: "20–35", cells: ["A vs E", "B vs C"] },
      { time: "35–40", cells: ["Descanso 5'", "Descanso 5'"] },
      { time: "40–55", cells: ["D vs E", "A vs C"] },
      { time: "55–60", cells: ["Descanso 15'"] },
      { time: "60–75", cells: ["B vs D", "C vs E"] },
      { time: "75–80", cells: ["Descanso 5'"] },
      { time: "80–95", cells: ["A vs D", "B vs E"] },
      { time: "95–105", cells: ["Descanso 10'"] },
      { time: "105–120", cells: ["1° vs 2° FINAL", "3° vs 4°"] },
    ],
  },
  6: {
    // CORRECCIÓN confirmada: 1 SOLO grupo de 6, 3 partidos por equipo (9 partidos de grupo). El texto
    // "2 Grupos 3" del Excel era engañoso; los cruces A–F del Excel forman un único grupo (cada letra 3 veces).
    teams: 6,
    format: "Grupo único de 6 · 3 partidos + Final + 3°",
    groups: [6],           // tamaños de grupo (sorteo llena en este orden)
    groupCount: 1,
    courts: 2,
    hasSemifinals: false,
    hasFinal: true,
    hasThirdPlace: true,
    totalMatches: 11,
    totalHours: 4,   // canchas·horas (bloque grupos + bloque finales)
    minGamesPerTeam: 3,   // 45 min por equipo
    maxGamesPerTeam: 5,   // 75 max por equipo
    schedule: [
      { time: "00–15", cells: ["A vs B", "C vs D"] },
      { time: "15–20", cells: ["Descanso 5'"] },
      { time: "20–35", cells: ["E vs F", "A vs C"] },
      { time: "35–40", cells: ["Descanso 5'"] },
      { time: "40–55", cells: ["B vs E", "D vs F"] },
      { time: "55–60", cells: ["Descanso 5'"] },
      { time: "60–75", cells: ["A vs D", "C vs E"] },
      { time: "75–80", cells: ["Descanso 5'"] },
      { time: "80–95", cells: ["B vs F", "—"] },
      { time: "95–105", cells: ["Descanso 10'"] },
      { time: "105–120", cells: ["1° vs 2° FINAL", "3° vs 4°"] },
    ],
  },
  7: {
    teams: 7,
    format: "4 Vs + Final + 3°",
    groups: [7],           // tamaños de grupo (sorteo llena en este orden)
    groupCount: 1,
    courts: 3,
    hasSemifinals: false,
    hasFinal: true,
    hasThirdPlace: true,
    totalMatches: 16,
    totalHours: 6,   // canchas·horas (bloque grupos + bloque finales)
    minGamesPerTeam: 4,   // 60 min por equipo
    maxGamesPerTeam: 5,   // 75 max por equipo
    schedule: [
      { time: "00–15", cells: ["A vs C", "B vs D", "E vs G"] },
      { time: "15–20", cells: ["Descanso 5'"] },
      { time: "20–35", cells: ["A vs D", "B vs E", "C vs F"] },
      { time: "35–40", cells: ["Descanso 5'"] },
      { time: "40–55", cells: ["A vs E", "B vs F", "D vs G"] },
      { time: "55–60", cells: ["Descanso 5'"] },
      { time: "60–75", cells: ["A vs F", "B vs G", "C vs E"] },
      { time: "75–80", cells: ["Descanso 5'"] },
      { time: "80–95", cells: ["C vs G", "D vs F"] },
      { time: "95–105", cells: ["Descanso 10'"] },
      { time: "105–120", cells: ["1º vs 2º FINAL", "3° vs 4°"] },
    ],
  },
  8: {
    teams: 8,
    format: "2 Grupos 4 Vs + Semi + Final + 3°",
    groups: [4, 4],           // tamaños de grupo (sorteo llena en este orden)
    groupCount: 2,
    courts: 3,
    hasSemifinals: true,
    hasFinal: true,
    hasThirdPlace: true,
    totalMatches: 16,
    totalHours: 6,   // canchas·horas (bloque grupos + bloque finales)
    minGamesPerTeam: 3,   // 45 min por equipo
    maxGamesPerTeam: 5,   // 75 max por equipo
    schedule: [
      { time: "00–15", cells: ["A vs B", "C vs D", "E vs F"] },
      { time: "15–20", cells: ["descanso 5'"] },
      { time: "20–35", cells: ["G vs H", "A vs C", "B vs D"] },
      { time: "35–40", cells: ["descanso 5'"] },
      { time: "40–55", cells: ["E vs G", "F vs H", "A vs D"] },
      { time: "55–60", cells: ["descanso 5'"] },
      { time: "60–75", cells: ["B vs C", "E vs H", "F vs G"] },
      { time: "75–80", cells: ["descanso 5'"] },
      { time: "80–95", cells: ["1.º G1 vs 2.º G2", "1.º G2 vs 2.º G1"] },
      { time: "95–105", cells: ["descanso 10'"] },
      { time: "105–120", cells: ["1º vs 2º FINAL", "3° vs 4°"] },
    ],
  },
  9: {
    teams: 9,
    format: "2 Grupos de 5 y 4 vs + Final + 3°",
    groups: [5, 4],           // tamaños de grupo (sorteo llena en este orden)
    groupCount: 2,
    courts: 3,
    hasSemifinals: false,
    hasFinal: true,
    hasThirdPlace: true,
    totalMatches: 18,
    totalHours: 8,   // canchas·horas (bloque grupos + bloque finales)
    minGamesPerTeam: 3,   // 45 min por equipo
    maxGamesPerTeam: 5,   // 75 max por equipo
    schedule: [
      { time: "00–15", cells: ["B vs E", "C vs D", "F vs I"] },
      { time: "15–20", cells: ["descanso 5'"] },
      { time: "20–35", cells: ["A vs E", "B vs C", "G vs H"] },
      { time: "35–40", cells: ["descanso 5'"] },
      { time: "40–55", cells: ["A vs D", "E vs C", "F vs H"] },
      { time: "55–60", cells: ["descanso 5'"] },
      { time: "60–75", cells: ["A vs C", "D vs B", "I vs G"] },
      { time: "75–80", cells: ["descanso 5'"] },
      { time: "80–95", cells: ["A vs B", "D vs E"] },
      { time: "95–100", cells: ["descanso 5'"] },
      { time: "100–115", cells: ["F vs G", "H vs I"] },
      { time: "115-120", cells: ["descanso 15'"] },
      { time: "120-130", cells: [] },
      { time: "130-145", cells: ["1º vs 2º FINAL", "3° vs 4°"] },
      { time: "145-180", cells: ["margen 35'"] },
    ],
  },
  10: {
    teams: 10,
    format: "2 Grupos de 5 Vs + Final + 3°",
    groups: [5, 5],           // tamaños de grupo (sorteo llena en este orden)
    groupCount: 2,
    courts: 3,
    hasSemifinals: false,
    hasFinal: true,
    hasThirdPlace: true,
    totalMatches: 22,
    totalHours: 8,   // canchas·horas (bloque grupos + bloque finales)
    minGamesPerTeam: 4,   // 60 min por equipo
    maxGamesPerTeam: 5,   // 75 max por equipo
    schedule: [
      { time: "00–15", cells: ["A vs B", "C vs D", "F vs G"] },
      { time: "15–20", cells: ["descanso 5'"] },
      { time: "20–35", cells: ["A vs C", "B vs E", "H vs I"] },
      { time: "35–40", cells: ["descanso 5'"] },
      { time: "40–55", cells: ["D vs E", "F vs H", "G vs J"] },
      { time: "55–60", cells: ["descanso 5'"] },
      { time: "60–75", cells: ["A vs D", "B vs C", "I vs J"] },
      { time: "75–80", cells: ["descanso 5'"] },
      { time: "80–95", cells: ["F vs I", "G vs H", "A vs E"] },
      { time: "95–100", cells: ["descanso 5'"] },
      { time: "100–115", cells: ["B vs D", "F vs J", "G vs I"] },
      { time: "115–120", cells: ["descanso 5'"] },
      { time: "120–135", cells: ["C vs E", "H vs J"] },
      { time: "135–140", cells: ["descanso 15'"] },
      { time: "140–155", cells: ["1º vs 2º FINAL", "3° vs 4°"] },
      { time: "155–180", cells: ["descanso 25'"] },
    ],
  },
  11: {
    teams: 11,
    format: "2 Grupos de 4 Vs y 7 x 4partiods + Final + 3°",
    groups: [4, 7],           // tamaños de grupo (sorteo llena en este orden)
    groupCount: 2,
    courts: 3,
    hasSemifinals: false,
    hasFinal: true,
    hasThirdPlace: true,
    totalMatches: 22,
    totalHours: 8,   // canchas·horas (bloque grupos + bloque finales)
    minGamesPerTeam: 3,   // 45 min por equipo
    maxGamesPerTeam: 5,   // 75 max por equipo
    schedule: [
      { time: "00–15", cells: ["A vs B", "C vs D", "E vs F"] },
      { time: "15–20", cells: ["Descanso 5'"] },
      { time: "20–35", cells: ["A vs C", "B vs D", "E vs G"] },
      { time: "35–40", cells: ["Descanso 5'"] },
      { time: "40–55", cells: ["A vs D", "B vs C", "E vs H"] },
      { time: "55–60", cells: ["Descanso 5'"] },
      { time: "60–75", cells: ["E vs I", "F vs G", "J vs K"] },
      { time: "75–80", cells: ["Descanso 5'"] },
      { time: "80–95", cells: ["F vs J", "G vs K", "H vs I"] },
      { time: "95–100", cells: ["Descanso 5'"] },
      { time: "100–115", cells: ["F vs K", "G vs H", "I vs J"] },
      { time: "115–120", cells: ["Descanso 5'"] },
      { time: "120–135", cells: ["H vs J", "I vs K"] },
      { time: "135–150", cells: ["Descanso 15'"] },
      { time: "150–165", cells: ["1º vs 2º FINAL", "3° vs 4°"] },
      { time: "165–180", cells: ["Margen 15'"] },
    ],
  },
  12: {
    teams: 12,
    format: "3+grupos 4 Vs + Semi + Final + 3°",
    groups: [4, 4, 4],           // tamaños de grupo (sorteo llena en este orden)
    groupCount: 3,
    courts: 3,
    hasSemifinals: true,
    hasFinal: true,
    hasThirdPlace: true,
    totalMatches: 22,
    totalHours: 8,   // canchas·horas (bloque grupos + bloque finales)
    minGamesPerTeam: 3,   // 45 min por equipo
    maxGamesPerTeam: 5,   // 75 max por equipo
    schedule: [
      { time: "00–15", cells: ["A vs B", "E vs F", "I vs J"] },
      { time: "15–20", cells: ["Descanso 5'"] },
      { time: "20–35", cells: ["C vs D", "G vs H", "K vs L"] },
      { time: "35–40", cells: ["Descanso 5'"] },
      { time: "40–55", cells: ["A vs C", "E vs G", "I vs K"] },
      { time: "55–60", cells: ["Descanso 5'"] },
      { time: "60–75", cells: ["B vs D", "F vs H", "J vs L"] },
      { time: "75–80", cells: ["Descanso 5'"] },
      { time: "80–95", cells: ["A vs D", "E vs H", "I vs L"] },
      { time: "95–100", cells: ["Descanso 5'"] },
      { time: "100–115", cells: ["B vs C", "F vs G", "J vs K"] },
      { time: "115–120", cells: ["Descanso 15'"] },
      { time: "120–130", cells: [] },
      { time: "130–145", cells: ["1.º G1 vs 1.º G2", "1.º G3 vs mejor 2.º"] },
      { time: "145–160", cells: ["Descanso 15+"] },
      { time: "160–175", cells: ["1º vs 2º FINAL", "3° vs 4°"] },
      { time: "175–180", cells: ["Margen 5'"] },
    ],
  },
  13: {
    teams: 13,
    format: "3+grupos 5,4,4 Vs + Final + 3°",
    groups: [5, 4, 4],           // tamaños de grupo (sorteo llena en este orden)
    groupCount: 3,
    courts: 4,
    hasSemifinals: false,
    hasFinal: true,
    hasThirdPlace: true,
    totalMatches: 24,
    totalHours: 10,   // canchas·horas (bloque grupos + bloque finales)
    minGamesPerTeam: 3,   // 45 min por equipo
    maxGamesPerTeam: 5,   // 75 max por equipo
    schedule: [
      { time: "00–15", cells: ["B vs E", "C vs D", "F vs G", "H vs I"] },
      { time: "15–20", cells: ["Descanso 5'"] },
      { time: "20–35", cells: ["A vs E", "B vs C", "J vs K", "L vs M"] },
      { time: "35–40", cells: ["Descanso 5'"] },
      { time: "40–55", cells: ["A vs D", "C vs E", "F vs H", "G vs I"] },
      { time: "55–60", cells: ["Descanso 5'"] },
      { time: "60–75", cells: ["A vs C", "B vs D", "J vs L", "K vs M"] },
      { time: "75–80", cells: ["Descanso 5'"] },
      { time: "80–95", cells: ["A vs B", "D vs E", "F vs I", "G vs H"] },
      { time: "95–100", cells: ["Descanso 5'"] },
      { time: "100–115", cells: ["J vs M", "K vs L"] },
      { time: "115–120", cells: ["Descanso 15'"] },
      { time: "120–130", cells: [] },
      { time: "130–145", cells: ["1º vs 2º FINAL", "3° vs 4°"] },
      { time: "145–180", cells: ["Descanso 35'"] },
    ],
  },
  14: {
    teams: 14,
    format: "3+grupos 6x3,4x3,4x3 Vs + Final + 3°",
    groups: [6, 4, 4],           // tamaños de grupo (sorteo llena en este orden)
    groupCount: 3,
    courts: 4,
    hasSemifinals: false,
    hasFinal: true,
    hasThirdPlace: true,
    totalMatches: 23,
    totalHours: 10,   // canchas·horas (bloque grupos + bloque finales)
    minGamesPerTeam: 3,   // 45 min por equipo
    maxGamesPerTeam: 5,   // 75 max por equipo
    schedule: [
      { time: "00–15", cells: ["A vs B", "C vs D", "E vs F", "G vs H"] },
      { time: "15–20", cells: ["Descanso 5'"] },
      { time: "20–35", cells: ["I vs J", "K vs L", "M vs N", "—"] },
      { time: "35–40", cells: ["Descanso 5'"] },
      { time: "40–55", cells: ["A vs C", "B vs D", "E vs G", "F vs H"] },
      { time: "55–60", cells: ["Descanso 5'"] },
      { time: "60–75", cells: ["I vs K", "J vs M", "L vs N", "—"] },
      { time: "75–80", cells: ["Descanso 5'"] },
      { time: "80–95", cells: ["A vs D", "B vs C", "E vs H", "F vs G"] },
      { time: "95–100", cells: ["Descanso 5'"] },
      { time: "100–115", cells: ["I vs L", "J vs N", "K vs M", "—"] },
      { time: "115–120", cells: ["Descanso 15'"] },
      { time: "120–130", cells: [] },
      { time: "130–145", cells: ["1º vs 2º FINAL", "3° vs 4°"] },
      { time: "145–180", cells: ["Descanso 35'"] },
    ],
  },
  15: {
    teams: 15,
    format: "3+grupos de 4x3, 5x4 y 6x3 + Final + 3°",
    groups: [4, 5, 6],           // tamaños de grupo (sorteo llena en este orden)
    groupCount: 3,
    courts: 4,
    hasSemifinals: false,
    hasFinal: true,
    hasThirdPlace: true,
    totalMatches: 27,
    totalHours: 10,   // canchas·horas (bloque grupos + bloque finales)
    minGamesPerTeam: 3,   // 45 min por equipo
    maxGamesPerTeam: 5,   // 75 max por equipo
    schedule: [
      { time: "00–15", cells: ["A vs B", "C vs D", "E vs F", "G vs H"] },
      { time: "15–20", cells: ["descanso"] },
      { time: "20–35", cells: ["J vs K", "L vs M", "N vs O", "E vs I"] },
      { time: "35–40", cells: ["descanso"] },
      { time: "40–55", cells: ["A vs C", "B vs D", "F vs H", "G vs I"] },
      { time: "55–60", cells: ["descanso"] },
      { time: "60–75", cells: ["J vs L", "K vs N", "M vs O", "E vs H"] },
      { time: "75–80", cells: ["descanso"] },
      { time: "80–95", cells: ["A vs D", "B vs C", "F vs I", "G vs E"] },
      { time: "95–100", cells: ["descanso"] },
      { time: "100–115", cells: ["J vs M", "K vs O", "L vs N", "F vs G"] },
      { time: "115–120", cells: ["descanso"] },
      { time: "120–135", cells: ["H vs I"] },
      { time: "135–150", cells: ["descanso 5'"] },
      { time: "150–165", cells: ["1º vs 2º FINAL", "3° vs 4°"] },
      { time: "165–180", cells: ["descanso 5'"] },
    ],
  },
  16: {
    teams: 16,
    format: "4 grupos de 4x3 + Semi + Final + 3°",
    groups: [4, 4, 4, 4],           // tamaños de grupo (sorteo llena en este orden)
    groupCount: 4,
    courts: 4,
    hasSemifinals: true,
    hasFinal: true,
    hasThirdPlace: true,
    totalMatches: 28,
    totalHours: 10,   // canchas·horas (bloque grupos + bloque finales)
    minGamesPerTeam: 3,   // 45 min por equipo
    maxGamesPerTeam: 5,   // 75 max por equipo
    schedule: [
      { time: "00–15", cells: ["A vs B", "C vs D", "E vs F", "G vs H"] },
      { time: "15–20", cells: ["descanso 5'"] },
      { time: "20–35", cells: ["I vs J", "K vs L", "M vs N", "O vs P"] },
      { time: "35–40", cells: ["descanso 5'"] },
      { time: "40–55", cells: ["A vs C", "B vs D", "E vs G", "F vs H"] },
      { time: "55–60", cells: ["descanso 5'"] },
      { time: "60–75", cells: ["I vs K", "J vs L", "M vs O", "N vs P"] },
      { time: "75–80", cells: ["descanso 5'"] },
      { time: "80–95", cells: ["A vs D", "B vs C", "E vs H", "F vs G"] },
      { time: "95–100", cells: ["descanso 5'"] },
      { time: "100–115", cells: ["I vs L", "J vs K", "M vs P", "N vs O"] },
      { time: "115–120", cells: ["descanso 15'"] },
      { time: "120–130", cells: [] },
      { time: "130–145", cells: ["1.º G1 vs 1.º G2", "1.º G3 vs 1.º G4"] },
      { time: "145–160", cells: ["descanso 15'"] },
      { time: "160–175", cells: ["1º vs 2º FINAL", "3° vs 4°"] },
      { time: "175–180", cells: ["Margen 5'"] },
    ],
  },
};

export const TEAM_LETTERS = 'ABCDEFGHIJKLMNOP';

// Capacidad VISUAL de slots en Inscripciones según el RANGO contratado (Torneo). Es solo presentación
// de cupos; NO es el nº real de equipos inscritos (que sigue siendo teams.length para el fixture).
// 4–6 → 6 · 7–8 → 8 · 9–12 → 12 · 13–16 → 16. Futuro: vendrá del campeonato real (Supabase).
export function visualCapacity(maxTeams) {
  const n = Number(maxTeams) || 0;
  if (n <= 6) return 6;
  if (n <= 8) return 8;
  if (n <= 12) return 12;
  return 16;
}

// Capacidad VISUAL de slots para campeonato REAL (Inscripciones). Deriva del tope contratado
// (summary.group.max, que vive en championships.format_config). Tramos de PRODUCTO:
//   <=4 → 4 · 5–6 → 6 · 7–8 → 8 · 9–12 → 12 · 13–14 → 14 · 15–16 → 16.
// Fallback seguro: sin config/0 → 4 (mínimo); fuera de rango (>16) → 16 (tope). NO son equipos reales,
// solo cupos vacíos para comunicar el máximo de equipos.
export function realTeamCapacity(maxTeams) {
  const n = Number(maxTeams) || 0;
  if (n <= 4) return 4;
  if (n <= 6) return 6;
  if (n <= 8) return 8;
  if (n <= 12) return 12;
  if (n <= 14) return 14;
  return 16;
}

// ¿La celda es un enfrentamiento por letras ('A vs B')? → { a, b } (mayúsculas). Si no (descanso,
// FINAL, 3°/4°, semis '1.º G1 vs 2.º G2', '—', 'margen…') → null (se resuelve en fase posterior).
const _VS = /^([A-P])\s*vs\s*([A-P])$/i;
export function parseGroupMatch(cell) {
  const m = _VS.exec(String(cell || '').trim());
  return m ? { a: m[1].toUpperCase(), b: m[2].toUpperCase() } : null;
}

// Sorteo (default): baraja los equipos reales y los asigna a las letras A,B,C… en orden.
// Devuelve { A: teamId, B: teamId, … }. rng inyectable para hacerlo determinista/persistible.
export function drawTeams(teamIds, rng = Math.random) {
  const arr = [...teamIds];
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  const map = {};
  arr.forEach((id, i) => { if (i < TEAM_LETTERS.length) map[TEAM_LETTERS[i]] = id; });
  return map;
}

// Reparte las letras en grupos según fixture.groups → [['A','B','C','D'], ['E','F',…], …].
export function groupLetters(count) {
  const fx = CHAMPIONSHIP_FIXTURES[count]; if (!fx) return [];
  const out = []; let k = 0;
  for (const size of fx.groups) { out.push(TEAM_LETTERS.slice(k, k + size).split('')); k += size; }
  return out;
}

// Resuelve el schedule sustituyendo letras por teamId (via el map del sorteo). Las celdas que no
// son enfrentamiento por letras (descansos/finales/semis) se conservan como texto (label).
export function resolveSchedule(count, letterToTeamId) {
  const fx = CHAMPIONSHIP_FIXTURES[count]; if (!fx) return [];
  return fx.schedule.map(row => ({
    time: row.time,
    cells: row.cells.map(cell => {
      const vs = parseGroupMatch(cell);
      if (!vs) return { type: 'label', text: cell };
      return { type: 'match', a: letterToTeamId[vs.a] ?? null, b: letterToTeamId[vs.b] ?? null, aLetter: vs.a, bLetter: vs.b };
    }),
  }));
}

// ¿Una celda-label es un PARTIDO dependiente de resultados (participantes "por definir")?
// FINAL / 3.º-4.º / semis ("1.º G1 vs 2.º G2") contienen "vs"; descansos/margen/"—" no.
const _LABEL_VS = /\bvs\b/i;

// ── Genera el fixture completo (REGLA COMPETITIVA + PLANIFICACIÓN default) para `count` equipos ──
// Desacoplado de React → reutilizable para un futuro "Volver a sortear" desde Admin.
//   teamIds: ids ESTABLES de los equipos inscritos. rng: inyectable (default Math.random).
// Devuelve null si no hay configuración para esa cantidad (el caller decide el estado controlado).
// Estructura persistible: { count, teamDraw, groups, matches[] } — NO incluye resultados.
export function buildFixture(count, teamIds, rng = Math.random) {
  const fx = CHAMPIONSHIP_FIXTURES[count];
  if (!fx) return null;
  const teamDraw = drawTeams(teamIds, rng);            // A/B/C… → teamId (aleatorio, una sola vez)
  const schedule = resolveSchedule(count, teamDraw);
  const groups = groupLetters(count).map(letters => letters.map(L => teamDraw[L] ?? null));
  const matches = [];
  schedule.forEach(row => row.cells.forEach((cell, i) => {
    const court = i + 1;                               // planificación: celda i → Cancha i+1
    if (cell.type === 'match') {
      matches.push({ phase: 'group', court, time: row.time, aId: cell.a, bId: cell.b });
    } else if (cell.type === 'label' && _LABEL_VS.test(cell.text)) {
      // Partido dependiente de resultados: existe con fase/cancha/horario, participantes "Por definir".
      matches.push({ phase: 'knockout', court, time: row.time, label: cell.text, aId: null, bId: null });
    }
    // descansos / margen / "—" → no son partidos: se omiten
  }));
  return { count, teamDraw, groups, matches };
}
