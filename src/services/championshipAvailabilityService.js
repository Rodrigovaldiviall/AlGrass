// ── championshipAvailabilityService — disponibilidad REAL de canchas para Crear campeonato ──────
// Reemplaza la fuente MOCK del grid (championshipFormats.venueMatrix/compatibleVenues) por games
// rentales REALES de Supabase. SOLO lectura (SELECT); NUNCA modifica games. La identidad física de
// cada celda es SIEMPRE games.id (nunca índices/posiciones/nombres). Reutiliza la MISMA tabla `games`
// que la App normal (mismo modelo type='rental'), sin duplicar la lógica de Rental/Match.
//
// Candidatos para Championship (idénticos a lo que revalida create_championship_transfer_hold):
//   type='rental', status='published', booked_by_user_id IS NULL, championship_id IS NULL.

import { supabase } from '../lib/supabase';
import { DATE_WINDOW, ymd } from '../data/games';

// Etiqueta de reloj a partir de una HORA absoluta del día (0–23). Mantiene el estilo del grid ("6:00 pm").
export function hourLabel(h) {
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = ((h % 12) || 12);
  return `${h12}:00 ${ampm}`;
}

// Etiqueta de reloj a partir de MINUTOS del día → soporta :30 ("6:30 pm"). Para los chips de horario.
export function clockFromMin(min) {
  const h = Math.floor(min / 60), m = ((min % 60) + 60) % 60;
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = ((h % 12) || 12);
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// Trae TODO el inventario rental disponible del horizonte (una sola query) y lo aplana a un modelo
// mínimo por game. duration_min real (game → field → 60 fallback). Devuelve { games, error }.
export async function fetchChampionshipInventory() {
  const from = ymd(DATE_WINDOW[0]);
  const to = ymd(DATE_WINDOW[DATE_WINDOW.length - 1]);
  const { data, error } = await supabase
    .from('games')
    .select(`
      id, date_key, time, duration_min, format,
      fields:field_id (
        id, name, format, duration_min,
        venues:venue_id ( id, name, district, address, city, lat, lng, cover_image_path, cover_updated_at, venue_amenities:amenities )
      )
    `)
    .eq('type', 'rental')
    .eq('status', 'published')
    .is('booked_by_user_id', null)
    .is('championship_id', null)
    .gte('date_key', from)
    .lte('date_key', to);
  if (error) return { games: [], error };
  const games = (data || []).map(g => {
    const field = g.fields;
    const venue = field?.venues;
    const [hh, mm] = String(g.time || '0:0').split(':');
    const startMin = parseInt(hh, 10) * 60 + parseInt(mm || '0', 10);
    const durationMin = g.duration_min ?? field?.duration_min ?? 60;   // §6: duración REAL, no siempre 60
    return {
      id: g.id,
      dateKey: g.date_key,
      startMin,
      durationMin,
      format: g.format ?? field?.format ?? null,
      fieldId: field?.id ?? null,
      fieldName: field?.name ?? '',
      venueId: venue?.id ?? null,
      venueName: venue?.name ?? '',
      district: venue?.district ?? '',
      address: venue?.address ?? '',
      city: venue?.city ?? '',
      amenities: venue?.venue_amenities ?? {},
      // Datos de VENUE para el detalle /venue (foto/ubicación del VENUE, no de una cancha concreta).
      venueLat: venue?.lat ?? null,
      venueLng: venue?.lng ?? null,
      venueCoverPath: venue?.cover_image_path ?? null,
      venueCoverVersion: venue?.cover_updated_at ? new Date(venue.cover_updated_at).getTime() : null,
    };
  }).filter(g => g.venueId && g.fieldId && !Number.isNaN(g.startMin));
  // §11: resolución visual = 30 min. Si algún rental empieza en minutos distintos de :00/:30, avisarlo
  // (el grid no lo representa exactamente; no se inventa soporte de 15 min sin necesidad real).
  const offGrid = games.filter(g => (g.startMin % 30) !== 0);
  if (offGrid.length) console.warn('[championship availability] rentals con minutos ≠ :00/:30 (no representados a 30min):', offGrid.map(g => ({ id: g.id, dateKey: g.dateKey, startMin: g.startMin })));
  return { games, error: null };
}

// ── Bloqueos de disponibilidad Championship (por ciudad) — espejo de la regla del backend ──────────
// Un game queda EXCLUIDO del inventario utilizable por Championship si se solapa con ALGÚN availability_block.
// Solapamiento por intervalo semiabierto: start < block_end AND end > block_start (los límites que solo se
// tocan NO solapan). all_day=true → todo el día de esa fecha. DEFENSIVO: un bloqueo con date que coincide
// pero from/to malformados se trata como all_day (sobre-bloquea, nunca sub-bloquea); la autoridad final es
// el hold (_championship_assert_not_blocked). NO muta el game; solo decide si es candidato.
function hhmmToMin(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}
export function gameBlockedByChampionship(game, blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return false;
  const gs = game.startMin, ge = game.startMin + game.durationMin;
  for (const b of blocks) {
    if (!b || typeof b !== 'object' || b.date !== game.dateKey) continue;   // otra fecha / bloque inválido
    if (b.all_day === true) return true;                                    // todo el día
    const fm = hhmmToMin(b.from), tm = hhmmToMin(b.to);
    if (fm == null || tm == null || tm <= fm) return true;                  // horas malformadas → conservador (todo el día)
    if (gs < tm && ge > fm) return true;                                    // solapamiento semiabierto
  }
  return false;
}

// Sedes compatibles reales: venues con ≥1 candidato del formato, filtradas por distrito/amenities.
// `courts` = nº de fields distintos (canchas) con candidatos de ese formato en la sede (todo el horizonte).
export function championshipVenues(games, format, districtSet, amenitySet) {
  if (!format) return [];                          // sin formato seleccionado → sin disponibilidad
  const byVenue = new Map();
  for (const g of games) {
    if (format && g.format !== format) continue;
    if (!byVenue.has(g.venueId)) {
      byVenue.set(g.venueId, {
        id: g.venueId, name: g.venueName, district: g.district, address: g.address,
        city: g.city, amenities: g.amenities || {}, fieldIds: new Set(),
        // Venue-level para /venue: ubicación + foto del VENUE (compartida por todas sus canchas).
        lat: g.venueLat ?? null, lng: g.venueLng ?? null,
        coverPath: g.venueCoverPath ?? null, coverVersion: g.venueCoverVersion ?? null,
      });
    }
    byVenue.get(g.venueId).fieldIds.add(g.fieldId);
  }
  let arr = [...byVenue.values()];
  if (districtSet && districtSet.size) arr = arr.filter(v => districtSet.has(v.district));
  if (amenitySet && amenitySet.size) arr = arr.filter(v => [...amenitySet].every(a => v.amenities?.[a] === true));
  arr.forEach(v => { v.courts = v.fieldIds.size; });
  return arr.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

// Distritos reales presentes en el inventario (para el sheet de filtro).
export function championshipDistricts(games) {
  return [...new Set((games || []).map(g => g.district).filter(Boolean))].sort();
}

// Grid REAL de una sede+fecha para un formato. RESOLUCIÓN INTERNA = 30 min (segmentos), mientras la
// PRESENTACIÓN agrupa 2 segmentos en una fila visual de 1 hora. UNA sola representación temporal para
// disponibilidad, detección de slots y selectedGameIds (sin matrices paralelas).
//   fields    = canchas (columnas), ordenadas por nombre (estable);
//   baseHour  = hora absoluta de la fila 0 (los segmentos arrancan en baseHour:00);
//   hourRows  = nº de filas visuales de 1h (desde el 1er inicio hasta el último fin, alineado a hora);
//   segCount  = hourRows × 2 (segmentos de 30 min);
//   matrix[fi][s]    = boolean libre: un game CUBRE el segmento s=[segStart, segStart+30) de esa cancha
//                      si time ≤ segStart y time+duration ≥ segStart+30 (deriva del intervalo REAL);
//   gamesGrid[fi][s] = el game que cubre ese segmento (o null) — un game de 60min cubre 2 segmentos, uno
//                      de 90 cubre 3, etc., SIEMPRE el MISMO game.id (no se divide el game en backend);
//   hourLabels[r]    = etiqueta de reloj de cada fila (hora completa).
// Un segmento sin game queda null → findValidTournamentSlots NUNCA puentea huecos.
export function championshipVenueGrid(games, venueId, dateKey, format) {
  const empty = { fields: [], baseHour: 0, hourRows: 0, segCount: 0, matrix: [], gamesGrid: [], hourLabels: [], fieldGames: [] };
  if (!venueId || !dateKey || !format) return empty;
  const cand = games.filter(g => g.venueId === venueId && g.dateKey === dateKey && g.format === format);
  if (!cand.length) return empty;

  // Canchas (columnas) — orden estable por nombre.
  const fieldMap = new Map();
  for (const g of cand) if (!fieldMap.has(g.fieldId)) fieldMap.set(g.fieldId, g.fieldName);
  const fields = [...fieldMap.entries()].map(([id, name]) => ({ id, name }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  // Span alineado a hora (filas de 1h); segmentos de 30 min dentro.
  let minStart = Infinity, maxEnd = -Infinity;
  for (const g of cand) { minStart = Math.min(minStart, g.startMin); maxEnd = Math.max(maxEnd, g.startMin + g.durationMin); }
  const baseHour = Math.floor(minStart / 60);
  const endHour = Math.ceil(maxEnd / 60);
  const hourRows = Math.max(0, endHour - baseHour);
  const segCount = hourRows * 2;
  const baseMin = baseHour * 60;

  const matrix = fields.map(() => new Array(segCount).fill(false));
  const gamesGrid = fields.map(() => new Array(segCount).fill(null));
  fields.forEach((f, fi) => {
    for (let s = 0; s < segCount; s++) {
      const segStart = baseMin + s * 30;
      const segEnd = segStart + 30;
      const g = cand.find(x => x.fieldId === f.id && x.startMin <= segStart && (x.startMin + x.durationMin) >= segEnd);
      if (g) { matrix[fi][s] = true; gamesGrid[fi][s] = g; }
    }
  });
  const hourLabels = Array.from({ length: hourRows }, (_, r) => hourLabel(baseHour + r));
  // fieldGames[fi] = games REALES de esa cancha (con time/duration EXACTOS, incluidos :15/:45) ordenados
  // por inicio. Solo para el RENDER de píldoras proporcionales; NO alimenta slots (30 min). Una píldora = un game.
  const fieldGames = fields.map(f => cand.filter(g => g.fieldId === f.id).slice().sort((a, b) => a.startMin - b.startMin));
  return { fields, baseHour, hourRows, segCount, matrix, gamesGrid, hourLabels, fieldGames };
}

// Detección de horarios válidos por CAPACIDAD SIMULTÁNEA (NO por continuidad de las mismas canchas).
// Regla: para cada segmento del candidato, availableCourts(seg) >= requiredCourts(seg). Las canchas
// físicas PUEDEN cambiar entre segmentos. Cada slot lleva SU asignación (cells + gameIds) para que el
// render y el hold usen EXACTAMENTE la misma decisión (no se recalcula después).
//
// requiredCourts por segmento se deriva del perfil del grupo (phases): cada fase aporta courts durante
// (hours×2) segmentos → p.ej. g1 [{2,2}] → [2,2,2,2]; g3 [{3,2},{2,1}] → [3,3,3,3,2,2].
//
// Asignación determinista por segmento: conservar las canchas del segmento anterior que sigan disponibles;
// completar las faltantes por orden de índice de field; tomar SOLO requiredCourts (nunca todas las libres).
// Perfil PURO de canchas requeridas por segmento (30 min) del formato: cada fase aporta `courts`
// durante (hours×2) segmentos. p.ej. g1 [{2,1},{1,1}] → [2,2,1,1]. ÚNICA fuente del perfil; la usa
// championshipSlots (reserva real) y la preview visual (sin decidir reservabilidad). No cambia lógica.
export function championshipReqPerSeg(group) {
  const req = [];
  if (!group || !Array.isArray(group.phases)) return req;
  for (const p of group.phases) for (let h = 0; h < p.hours * 2; h++) req.push(p.courts);
  return req;
}

export function championshipSlots(grid, group) {
  const slots = [];
  if (!group || !grid || !grid.fields.length) return slots;
  const F = grid.fields.length;
  const S = grid.segCount;
  const games = grid.gamesGrid;    // [field][seg] game | null

  // Perfil de canchas requeridas por segmento (30 min).
  const reqPerSeg = championshipReqPerSeg(group);
  const total = reqPerSeg.length;
  if (total === 0 || total > S) return slots;

  const gAt = (f, s) => (s >= 0 && s < S ? games[f][s] : null);
  // Rango de SEGMENTOS del game que cubre (f,s): un game es INDIVISIBLE → ocupa todos sus segmentos.
  const gameRange = (f, s) => {
    const g = gAt(f, s); if (!g) return null;
    let a = s; while (a - 1 >= 0 && gAt(f, a - 1)?.id === g.id) a--;
    let b = s; while (b + 1 < S && gAt(f, b + 1)?.id === g.id) b++;
    return { id: g.id, startSeg: a, endSeg: b + 1 };
  };

  for (let start = 0; start + total <= S; start++) {
    const end = start + total;
    // Simulación por games COMPLETOS: en cada segmento debe haber `req` games seleccionados que lo cubran;
    // un game seleccionado se consume ENTERO (todos sus segmentos) y solo se puede empezar uno nuevo cuando
    // un game empieza EXACTAMENTE en ese segmento (nunca se corta un game en curso). Canchas pueden cambiar
    // solo al terminar un game. Determinista: continuidad de cancha primero, luego índice de field.
    const chosenByField = new Array(F).fill(null);      // game actualmente asignado a cada cancha (o null)
    const cells = new Set();
    const idSet = new Set();
    const usedFields = new Set();                        // canchas ya usadas en ESTE slot (minimizar distintas)
    let prevFields = new Set();
    let feasible = true;
    // Alcance continuo de una cancha desde s0 dentro del slot [start,end] (look-ahead de continuidad).
    const reach = (f, s0) => { let seg = s0, last = s0; while (seg < end) { const r = gameRange(f, seg); if (r && r.startSeg === seg && r.endSeg <= end) { last = r.endSeg; seg = r.endSeg; } else break; } return last - s0; };

    for (let o = 0; o < total && feasible; o++) {
      const s = start + o;
      const req = reqPerSeg[o];
      // Liberar games ya terminados.
      for (let f = 0; f < F; f++) if (chosenByField[f] && chosenByField[f].endSeg <= s) chosenByField[f] = null;
      // Games activos (asignados) que cubren s.
      let active = 0;
      for (let f = 0; f < F; f++) { const cg = chosenByField[f]; if (cg && cg.startSeg <= s && s < cg.endSeg) active++; }
      let need = req - active;
      if (need > 0) {
        // Candidatos: cancha libre con un game que EMPIEZA en s y cae ENTERO dentro del slot.
        const cand = [];
        for (let f = 0; f < F; f++) {
          if (chosenByField[f]) continue;
          const r = gameRange(f, s);
          if (r && r.startSeg === s && r.startSeg >= start && r.endSeg <= end) cand.push({ f, r });
        }
        // Prioridad: (1) reusar una cancha YA usada en este slot (menos canchas distintas); (2) mayor
        // continuidad hacia adelante en la MISMA cancha (look-ahead); (3) continuidad inmediata (prevFields);
        // (4) índice de field (estable). Solo compone los gameIds del slot; NO auto-selecciona nada.
        cand.sort((x, y) =>
          ((usedFields.has(y.f) ? 1 : 0) - (usedFields.has(x.f) ? 1 : 0))
          || (reach(y.f, s) - reach(x.f, s))
          || ((prevFields.has(y.f) ? 1 : 0) - (prevFields.has(x.f) ? 1 : 0))
          || (x.f - y.f));
        for (const { f, r } of cand) {
          if (need <= 0) break;
          chosenByField[f] = r;
          usedFields.add(f);
          for (let ss = r.startSeg; ss < r.endSeg; ss++) cells.add(`${f}-${ss}`);  // game COMPLETO
          idSet.add(r.id);
          need--;
        }
        if (need > 0) { feasible = false; break; }      // no hay games completos suficientes → intervalo inválido
      }
      // Canchas activas en s (para preferir continuidad en el siguiente segmento).
      const cur = new Set();
      for (let f = 0; f < F; f++) { const cg = chosenByField[f]; if (cg && cg.startSeg <= s && s < cg.endSeg) cur.add(f); }
      prevFields = cur;
    }

    if (feasible) slots.push({ startHour: start, endHour: end, cells, gameIds: [...idSet] });
  }
  return slots;
}

// Igual que championshipSlots (MISMAS reglas de validez: reqPerSeg, continuidad de cancha, games
// completos) pero PRIORIZANDO un game ANCLA en la asignación y aceptando SOLO ventanas cuyo slot válido
// INCLUYA ese ancla. Sirve a la selección MANUAL desde la tabla: `championshipSlots` materializa una única
// combinación representativa por horario (p.ej. A+B+C) y deja fuera alternativas igualmente válidas
// (A+B+D). Este helper encuentra la variante válida que usa la cancha pulsada, sin duplicar el criterio de
// validez. Devuelve el slot { startHour, endHour, cells, gameIds } más temprano que incluye el ancla, o null.
export function championshipSlotForAnchor(grid, group, anchorId) {
  if (!group || !grid || !grid.fields.length) return null;
  const F = grid.fields.length;
  const S = grid.segCount;
  const games = grid.gamesGrid;
  const reqPerSeg = championshipReqPerSeg(group);
  const total = reqPerSeg.length;
  if (!total || total > S) return null;

  const gAt = (f, s) => (s >= 0 && s < S ? games[f][s] : null);
  const gameRange = (f, s) => {
    const g = gAt(f, s); if (!g) return null;
    let a = s; while (a - 1 >= 0 && gAt(f, a - 1)?.id === g.id) a--;
    let b = s; while (b + 1 < S && gAt(f, b + 1)?.id === g.id) b++;
    return { id: g.id, startSeg: a, endSeg: b + 1 };
  };

  for (let start = 0; start + total <= S; start++) {
    const end = start + total;
    const chosenByField = new Array(F).fill(null);
    const cells = new Set();
    const idSet = new Set();
    const usedFields = new Set();                        // canchas ya usadas en ESTE slot (minimizar distintas)
    let prevFields = new Set();
    let feasible = true;
    // Alcance continuo de una cancha desde s0 dentro del slot [start,end] (look-ahead de continuidad).
    const reach = (f, s0) => { let seg = s0, last = s0; while (seg < end) { const r = gameRange(f, seg); if (r && r.startSeg === seg && r.endSeg <= end) { last = r.endSeg; seg = r.endSeg; } else break; } return last - s0; };
    for (let o = 0; o < total && feasible; o++) {
      const s = start + o;
      const req = reqPerSeg[o];
      for (let f = 0; f < F; f++) if (chosenByField[f] && chosenByField[f].endSeg <= s) chosenByField[f] = null;
      let active = 0;
      for (let f = 0; f < F; f++) { const cg = chosenByField[f]; if (cg && cg.startSeg <= s && s < cg.endSeg) active++; }
      let need = req - active;
      if (need > 0) {
        const cand = [];
        for (let f = 0; f < F; f++) {
          if (chosenByField[f]) continue;
          const r = gameRange(f, s);
          if (r && r.startSeg === s && r.startSeg >= start && r.endSeg <= end) cand.push({ f, r });
        }
        // Diferencia con championshipSlots: el ancla se elige PRIMERO cuando compite por un hueco. El resto
        // del criterio es IDÉNTICO (misma continuidad de cancha) para que, al expulsar celdas antiguas por el
        // ancla, se preserven grupos consecutivos en la misma cancha y se minimicen las canchas distintas:
        // (1) ancla; (2) reusar cancha ya usada en el slot; (3) mayor continuidad hacia adelante (look-ahead);
        // (4) continuidad inmediata (prevFields); (5) índice de field (estable, desempate final).
        cand.sort((x, y) =>
          ((y.r.id === anchorId ? 1 : 0) - (x.r.id === anchorId ? 1 : 0))
          || ((usedFields.has(y.f) ? 1 : 0) - (usedFields.has(x.f) ? 1 : 0))
          || (reach(y.f, s) - reach(x.f, s))
          || ((prevFields.has(y.f) ? 1 : 0) - (prevFields.has(x.f) ? 1 : 0))
          || (x.f - y.f));
        for (const { f, r } of cand) {
          if (need <= 0) break;
          chosenByField[f] = r;
          usedFields.add(f);
          for (let ss = r.startSeg; ss < r.endSeg; ss++) cells.add(`${f}-${ss}`);
          idSet.add(r.id);
          need--;
        }
        if (need > 0) { feasible = false; break; }
      }
      const cur = new Set();
      for (let f = 0; f < F; f++) { const cg = chosenByField[f]; if (cg && cg.startSeg <= s && s < cg.endSeg) cur.add(f); }
      prevFields = cur;
    }
    if (feasible && idSet.has(anchorId)) return { startHour: start, endHour: end, cells, gameIds: [...idSet] };
  }
  return null;   // ninguna ventana admite una combinación válida que use el ancla
}

// ¿El conjunto EXACTO de gameIds sigue constituyendo una combinación VÁLIDA para el formato en este grid?
// Reutiliza la MISMA autoridad (championshipSlots para la representativa + championshipSlotForAnchor para
// variantes manuales); NO define un criterio nuevo. Sirve para decidir, al cambiar filtros, si la
// selección del usuario sigue siendo válida en el nuevo contexto (mismo venue/fecha), sin depender de
// índices viejos. Devuelve true solo si algún slot válido tiene EXACTAMENTE esos gameIds.
export function championshipCombinationValid(grid, group, gameIds) {
  if (!Array.isArray(gameIds) || !gameIds.length) return false;
  const set = new Set(gameIds);
  const same = (arr) => arr.length === gameIds.length && arr.every(id => set.has(id));
  if (championshipSlots(grid, group).some(s => same(s.gameIds))) return true;   // combinación representativa
  for (const id of gameIds) { const v = championshipSlotForAnchor(grid, group, id); if (v && same(v.gameIds)) return true; }  // variante
  return false;
}

// PREVIEW VISUAL de disponibilidad INSUFICIENTE (NO decide reservabilidad; eso solo lo hace
// championshipSlots). Dado un game ANCLA que NO forma parte de ningún slot completo, representa el INTENTO
// COMPLETO del formato en UNIDADES DE HORA (celdas completas de la tabla), NO en medias celdas de 30 min.
// El perfil se expande a "por cada fase, `courts` bloques durante CADA una de sus `hours`" (p.ej.
// g1 [{2,1},{1,1}] → hora1: 2 bloques, hora2: 1 bloque). Elige la ventana que CONTIENE al ancla y minimiza
// faltantes (empate → inicio más temprano) y devuelve:
//   · existingIds → games reales que ocupan un bloque-hora del intento (se pintarán ROJO, no azul);
//   · missing [{f, seg}] → bloques-hora completos que faltan, en columnas libres ADYACENTES (derecha→izq).
// TODO el intento se pinta rojo en el render (combinación inválida). Siempre incluye al ancla. `seg` es el
// segmento de INICIO de la hora (par) → el bloque abarca la HORA entera. NUNCA inventa gameId.
export function buildInsufficientPreview(grid, group, anchorId, cols) {
  if (!group || !grid || !grid.fields.length) return null;
  const phases = group.phases;
  if (!Array.isArray(phases) || !phases.length) return null;
  const F = grid.fields.length;
  const S = grid.segCount;
  const C = Math.max(cols || F, F);
  const games = grid.gamesGrid;
  const total = phases.reduce((a, p) => a + p.hours * 2, 0);   // segmentos totales de la ventana
  if (!total || total > S) return null;

  const gAt = (f, s) => (s >= 0 && s < S ? games[f][s] : null);
  const gameRange = (f, s) => {
    const g = gAt(f, s); if (!g) return null;
    let a = s; while (a - 1 >= 0 && gAt(f, a - 1)?.id === g.id) a--;
    let b = s; while (b + 1 < S && gAt(f, b + 1)?.id === g.id) b++;
    return { id: g.id, f, startSeg: a, endSeg: b + 1 };
  };
  // Localizar el ancla.
  let anchor = null;
  for (let f = 0; f < F && !anchor; f++) for (let s = 0; s < S; s++) { const g = gAt(f, s); if (g && g.id === anchorId) { anchor = gameRange(f, s); break; } }
  if (!anchor) return null;

  let best = null;
  for (let start = 0; start + total <= S; start++) {
    if (!(start <= anchor.startSeg && anchor.endSeg <= start + total)) continue;  // la ventana debe contener al ancla
    // Perfil por HORA de reloj: [{seg (inicio de hora), req}] expandiendo las fases.
    const hourReq = []; let cur = start;
    for (const p of phases) for (let h = 0; h < p.hours; h++) { hourReq.push({ seg: cur, req: p.courts }); cur += 2; }

    const existingIds = new Set();
    const missing = [];
    let missingCount = 0;
    let usedAnchor = false;
    for (const { seg, req } of hourReq) {
      const usedF = new Set();
      // Games que cubren la HORA completa [seg, seg+2) en su columna (1h o más).
      const cover = [];
      for (let f = 0; f < F; f++) { const r = gameRange(f, seg); if (r && r.startSeg <= seg && r.endSeg >= seg + 2) cover.push(r); }
      cover.sort((x, y) => (x.id === anchorId ? -1 : 0) - (y.id === anchorId ? -1 : 0) || x.f - y.f);   // ancla primero
      let taken = 0;
      for (const r of cover) { if (taken >= req) break; if (usedF.has(r.f)) continue; usedF.add(r.f); existingIds.add(r.id); if (r.id === anchorId) usedAnchor = true; taken++; }
      const need = req - taken;
      if (need > 0) {
        // Colocar faltantes como bloques-hora completos en columnas libres, adyacentes: derecha primero, luego izq.
        const usedArr = [...usedF];
        const maxU = usedArr.length ? Math.max(...usedArr) : -1;
        const minU = usedArr.length ? Math.min(...usedArr) : C;
        const right = [], left = [], rest = [];
        for (let f = 0; f < C; f++) { if (usedF.has(f)) continue; if (f > maxU) right.push(f); else if (f < minU) left.push(f); else rest.push(f); }
        const order = [...right, ...left.reverse(), ...rest];
        let placed = 0;
        for (const f of order) { if (placed >= need) break; missing.push({ f, seg }); usedF.add(f); placed++; }
        missingCount += need;
      }
    }
    if (!usedAnchor) continue;                             // la ventana debe USAR el ancla
    if (!best || missingCount < best.missingCount || (missingCount === best.missingCount && start < best.start)) {
      best = { start, total, existingIds: [...existingIds], missing, missingCount };
    }
  }
  return best;   // null si ninguna ventana compatible contiene/usa el ancla
}

// games.id REALES de un slot (bloque): recorre las celdas 'fi-s' (segmentos) y devuelve los IDs únicos
// que los cubren. Un game que cubre varios segmentos aporta su id UNA sola vez (dedupe). Nunca índices.
// (Se conserva por compatibilidad; con championshipSlots el slot YA trae gameIds preasignados.)
export function slotGameIds(gamesGrid, slot) {
  if (!slot || !gamesGrid?.length) return [];
  const ids = new Set();
  for (const key of slot.cells) {
    const [fi, r] = key.split('-').map(Number);
    const g = gamesGrid[fi]?.[r];
    if (g?.id) ids.add(g.id);
  }
  return [...ids];
}
