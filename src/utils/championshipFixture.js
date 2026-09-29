// Conflictos de horario para asignar un equipo a un slot de la Llave. MISMO criterio que el backend
// (set_championship_match_team, Fase 31): dos partidos del MISMO día (date_key) se solapan si sus intervalos
// [start_time, start_time + duration_min) se cruzan → s1 < s2+d2 AND s2 < s1+d1. Devuelve un mapa
// { teamId: "HH:MM–HH:MM" } con los equipos que YA juegan un partido solapado con el partido objetivo (para
// mostrarlos deshabilitados en el selector). Es solo una AYUDA de UX; la autoridad real es el backend.

function toMin(t) {
  if (!t) return null;
  const p = String(t).split(':');
  const h = Number(p[0]), m = Number(p[1]);
  return (Number.isFinite(h) && Number.isFinite(m)) ? h * 60 + m : null;
}
function fmt(mins) {
  const h = Math.floor(mins / 60) % 24, m = ((mins % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function slotTeamConflicts(matches, targetMatchId) {
  const list = matches || [];
  const target = list.find(m => m.id === targetMatchId);
  if (!target) return {};
  const ts = toMin(target.start_time), td = target.duration_min, tdate = target.date_key;
  if (ts == null || td == null || !tdate) return {};   // objetivo sin fecha/hora → no se puede evaluar solape
  const out = {};
  list.forEach(m => {
    if (m.id === targetMatchId || m.date_key !== tdate) return;
    const ms = toMin(m.start_time), md = m.duration_min;
    if (ms == null || md == null) return;
    if (!(ts < ms + md && ms < ts + td)) return;        // sin solape
    const range = `${fmt(ms)}–${fmt(ms + md)}`;
    [m.home_team_id, m.away_team_id].forEach(tid => { if (tid && !out[tid]) out[tid] = range; });
  });
  return out;
}
