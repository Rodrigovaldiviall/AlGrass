import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BLUE, TEXT, SUB, HAIR, ORANGE, SOFT, GREEN } from '../constants';
import TabBar from '../components/TabBar';
import { useSheetPull } from '../hooks/useSheetPull';
import { DATE_WINDOW, TODAY, TODAY_KEY, ymd } from '../data/games';
import { getChampionshipConfig } from '../services/championshipService';
import {
  FORMATS, DEFAULT_FORMAT, PLAYERS_PER_TEAM, RECOMMENDATION_GROUPS, AMENITIES, playersRange,
} from '../data/championshipFormats';
import {
  fetchChampionshipInventory, championshipVenues, championshipDistricts,
  championshipVenueGrid, championshipSlots, hourLabel, clockFromMin, gameBlockedByChampionship,
} from '../services/championshipAvailabilityService';

// Mismo patrón de fechas que Partidos (DateCell): día abreviado + número, 30 días de horizonte.
const DOW_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
function dateChip(d) {
  const k = ymd(d);
  if (k === TODAY_KEY) return { top: 'Hoy', bottom: d.getDate() };
  return { top: DOW_ES[d.getDay()], bottom: d.getDate() };
}
function DateCell({ top, bottom, active, isToday, onClick, check, disabled, refEl }) {
  const topColor = active ? '#fff' : (isToday ? BLUE : SUB);
  const bottomColor = active ? '#fff' : TEXT;
  return (
    <button ref={refEl} onClick={disabled ? undefined : onClick} disabled={disabled} style={{
      position: 'relative',
      flex: '0 0 auto', width: 50, height: 52, borderRadius: 11,
      background: active ? BLUE : '#fff', border: `1px solid ${active ? BLUE : HAIR}`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: 0,
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.38 : 1,
      outline: 'none', WebkitTapHighlightColor: 'transparent', fontFamily: 'inherit',
      transition: 'background .15s, border-color .15s',
    }}>
      {/* check discreto: la fecha tiene al menos un venue con la disponibilidad recomendada */}
      {check && (
        <span style={{ position: 'absolute', bottom: 3, right: 3, width: 11, height: 11, borderRadius: '50%', background: active ? '#fff' : GREEN, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="7" height="7" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5l2.5 2.5 4.5-5" stroke={active ? GREEN : '#fff'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      )}
      <div style={{ fontSize: 10.5, fontWeight: 600, color: topColor, lineHeight: 1, textTransform: 'uppercase', letterSpacing: 0.3 }}>{top}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: bottomColor, lineHeight: 1.1, marginTop: 3 }}>{bottom}</div>
    </button>
  );
}

const CARD = { background: '#fff', border: `1px solid ${HAIR}`, borderRadius: 16, padding: 16, marginBottom: 14 };
// Etiquetas de amenities (para el resumen de "Ver mi campeonato").
const AMENITY_LABEL = { parking: 'Estacionamiento', showers: 'Duchas', covered: 'Techado' };
const SECTION_TITLE = { fontSize: 15, fontWeight: 800, color: TEXT, letterSpacing: -0.2, marginBottom: 10 };

// ── Chip toggle (blanco/borde inactivo, azul claro/texto azul activo) ─────────
function Chip({ active, onClick, children, style }) {
  return (
    <button onClick={onClick} className="pressable" style={{
      flexShrink: 0, height: 34, padding: '0 14px', borderRadius: 999,
      border: active ? '1px solid transparent' : `1px solid ${HAIR}`,
      background: active ? '#E8F1FF' : '#fff', color: active ? BLUE : TEXT,
      fontSize: 13.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
      WebkitTapHighlightColor: 'transparent', outline: 'none', ...style,
    }}>{children}</button>
  );
}

// ── Bottom sheet multi-select genérico (distrito / cancha) ────────────────────
function PickSheet({ title, items, selected, onToggle, onClose }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { const r = requestAnimationFrame(() => setVisible(true)); return () => cancelAnimationFrame(r); }, []);
  const startExit = () => setVisible(false);
  const { rootRef, scrollRef, dragY, dragging } = useSheetPull({ onClose: startExit });
  return (
    <>
      <div onClick={startExit} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200 }} />
      <div ref={rootRef}
        onTransitionEnd={(e) => { if (e.propertyName === 'transform' && !visible) onClose(); }}
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 201,
          background: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
          transform: visible ? `translateY(${dragY}px)` : 'translateY(100%)',
          transition: dragging ? 'none' : 'transform .28s cubic-bezier(0.32,0.72,0,1)',
          maxHeight: '70%', display: 'flex', flexDirection: 'column',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.12)',
        }}>
        <div style={{ padding: '10px 16px 0', flexShrink: 0 }}>
          <div style={{ width: 42, height: 4, borderRadius: 2, background: '#D1D1D6', margin: '0 auto 12px' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottom: `1px solid ${HAIR}` }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: TEXT, letterSpacing: -0.2 }}>{title}</span>
            <button onClick={startExit} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 600, color: BLUE, padding: '4px 0', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Listo</button>
          </div>
        </div>
        <div ref={scrollRef} className="no-sb" style={{ overflowY: 'auto', flex: 1, padding: '4px 16px calc(16px + env(safe-area-inset-bottom))' }}>
          {items.map(it => {
            const on = selected.has(it.value);
            return (
              <button key={it.value} onClick={() => onToggle(it.value)} style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '11px 0',
                background: 'transparent', border: 'none', borderBottom: `1px solid ${HAIR}`,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', WebkitTapHighlightColor: 'transparent', outline: 'none',
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                  border: on ? 'none' : `1.6px solid ${HAIR}`, background: on ? BLUE : '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {on && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, color: TEXT, fontWeight: 500 }}>{it.label}</div>
                  {it.sub && <div style={{ fontSize: 12, color: SUB, marginTop: 1 }}>{it.sub}</div>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ── Checkbox-card expandible ("no encuentro disponibilidad" / "que me contacten") ──
function CheckboxCard({ checked, onToggle, label, expanded, locked = false }) {
  return (
    <div style={{ border: `1px solid ${checked ? BLUE : HAIR}`, borderRadius: 12, padding: '12px 14px', background: checked ? '#F5F8FF' : '#fff' }}>
      <button onClick={locked ? undefined : onToggle} disabled={locked} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'transparent', border: 'none', cursor: locked ? 'default' : 'pointer', fontFamily: 'inherit', textAlign: 'left', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
        <div style={{ width: 20, height: 20, borderRadius: 5, flexShrink: 0, border: checked ? 'none' : `1.6px solid ${HAIR}`, background: checked ? BLUE : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {checked && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </div>
        <span style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{label}</span>
      </button>
      {checked && expanded && <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5, marginTop: 10, paddingLeft: 30 }}>{expanded}</div>}
    </div>
  );
}

export default function ChampionshipOrganize() {
  const navigate = useNavigate();
  const location = useLocation();
  // Estado restaurado al volver desde "Ver mi campeonato" (frontend, sin persistencia).
  const restore = location.state?.organizeState || null;

  // Paso del flujo de creación: 'intro' (pantalla informativa) → 'form' (configuración actual).
  // Al VOLVER a editar (restore presente) se entra directo al formulario (la intro solo aparece al
  // crear desde cero). Es un step interno: NO añade ruta ni cambia el back de la edición.
  const [step, setStep] = useState(restore ? 'form' : 'intro');

  const [mode, setMode] = useState(restore?.mode ?? 'oneday');            // 'oneday' | 'liga'
  const [format, setFormat] = useState(restore?.format ?? DEFAULT_FORMAT);  // 7v7 por defecto
  const [groupId, setGroupId] = useState(restore?.groupId ?? null);         // rango de tamaño (uno de los 4 grupos)
  const [contactMe, setContactMe] = useState(restore?.contactMe ?? false);
  // Liga: cantidad única + unidad (equipos|personas), SIN cálculo automático entre ambos.
  const [leagueQty, setLeagueQty] = useState(restore?.leagueQty ?? '');
  const [leagueUnit, setLeagueUnit] = useState(restore?.leagueUnit ?? 'teams');

  const [districts, setDistricts] = useState(() => new Set(restore?.districts ?? []));
  const [venueFilter, setVenueFilter] = useState(() => new Set(restore?.venueFilter ?? []));
  const [amenities, setAmenities] = useState(() => new Set(restore?.amenities ?? []));
  const [dateKey, setDateKey] = useState(restore?.dateKey ?? TODAY_KEY);
  const [venueIdx, setVenueIdx] = useState(restore?.venueIdx ?? 0);
  const [slotIdx, setSlotIdx] = useState(restore?.slotIdx ?? null); // horario NO preseleccionado (null = ninguno)
  const [courtCustom, setCourtCustom] = useState(restore?.courtCustom ?? false); // "que me contacten" en Cancha
  const [courtForced, setCourtForced] = useState(false); // CASO A: personalización OBLIGATORIA por cero disponibilidad GLOBAL
  const [districtSheet, setDistrictSheet] = useState(false);
  const [venueSheet, setVenueSheet] = useState(false);
  const didMount = useRef(false); // evita que los resets de venue/slot pisen el estado restaurado

  // Inventario rental REAL de Supabase (SELECT). null = cargando. Sustituye la fuente mock del grid.
  const [inv, setInv] = useState(null);
  const invLoading = inv == null;
  useEffect(() => {
    let alive = true;
    fetchChampionshipInventory().then(({ games: gs, error }) => {
      if (!alive) return;
      if (error) { console.warn('[ChampionshipOrganize] inventory:', error.message); setInv([]); return; }
      setInv(gs || []);
    });
    return () => { alive = false; };
  }, []);
  const gamesAll = inv || [];

  // Config de Championship por CIUDAD del inventario (asunción operativa: un inventario ≈ una ciudad).
  // Fuente única para: (a) availability_blocks → filtrar canchas ANTES del grid; (b) booking_lead_rules.
  // Se llave por la ciudad del inventario (NO por resolvedVenue) para evitar dependencia circular con el grid.
  const invCity = useMemo(() => {
    const cs = [...new Set(gamesAll.map(g => g.city).filter(Boolean))];
    return cs.length ? cs[0] : null;
  }, [gamesAll]);
  const [champCfg, setChampCfg] = useState(null);
  useEffect(() => {
    if (!invCity) { setChampCfg(null); return; }
    let alive = true;
    getChampionshipConfig({ city: invCity }).then(({ data, error }) => { if (alive) setChampCfg(error ? null : data); });
    return () => { alive = false; };
  }, [invCity]);
  const availabilityBlocks = Array.isArray(champCfg?.availability_blocks) ? champCfg.availability_blocks : [];

  // Inventario UTILIZABLE por Championship = inventario real − rentals que se solapan con un availability_block
  // de SU ciudad. NO se muta el rental (sigue disponible en Rental/Match); solo se excluye como candidato.
  const games = useMemo(() => {
    if (!availabilityBlocks.length) return gamesAll;
    return gamesAll.filter(g => (g.city !== invCity) || !gameBlockedByChampionship(g, availabilityBlocks));
  }, [gamesAll, availabilityBlocks, invCity]);

  const group = RECOMMENDATION_GROUPS.find(g => g.id === groupId) || null;

  // Sedes base REALES: formato compatible + distritos + amenities + filtro de cancha (respeta TODOS los filtros).
  const baseVenues = useMemo(() => {
    const base = championshipVenues(games, format, districts, amenities);
    return venueFilter.size === 0 ? base : base.filter(v => venueFilter.has(v.id));
  }, [games, format, districts, amenities, venueFilter]);

  // ÚNICA fuente de verdad: ¿este venue tiene AL MENOS un horario válido esa fecha? (capacidad simultánea)
  const venueComplies = (v, k) => group != null && championshipSlots(championshipVenueGrid(games, v.id, k, format), group).length > 0;

  // Check de fechas: una fecha tiene check si AL MENOS un venue base tiene ≥1 horario válido ese día.
  const dateChecks = useMemo(() => {
    const s = new Set();
    if (!group) return s;
    for (const d of DATE_WINDOW) { const k = ymd(d); if (baseVenues.some(v => venueComplies(v, k))) s.add(k); }
    return s;
  }, [group, baseVenues, games, format]); // eslint-disable-line

  // Orden de venues para la fecha activa: primero los que cumplen, luego el resto (mismo orden base).
  const candidates = useMemo(() => {
    if (!group) return baseVenues;
    const yes = [], no = [];
    for (const v of baseVenues) (venueComplies(v, dateKey) ? yes : no).push(v);
    return [...yes, ...no];
  }, [baseVenues, group, dateKey, games, format]); // eslint-disable-line

  // Disponibilidad GLOBAL REAL: ¿existe ALGÚN día (IGNORANDO distrito/sede/amenities) con una combinación
  // válida para el formato? true = hay opciones en alguna parte; false = NO existe NINGUNA (empty global). §5.
  const globalVenues = useMemo(() => championshipVenues(games, format, new Set(), new Set()), [games, format]);
  const globalHasAnyAvailability = useMemo(() => {
    if (!group) return false;
    for (const d of DATE_WINDOW) { const k = ymd(d); if (globalVenues.some(v => venueComplies(v, k))) return true; }
    return false;
  }, [globalVenues, group, games, format]); // eslint-disable-line

  const resolvedVenue = candidates[Math.min(venueIdx, Math.max(0, candidates.length - 1))] || null;

  // ── Booking lead (UX): usa champCfg (ciudad del inventario) → días de anticipación por rango del grupo. ──
  // Bloquea fechas < HOY_LIMA + lead. Autoridad final = backend (quote/hold re-validan BOOKING_LEAD_NOT_MET).
  // Misma regla conceptual del backend: EXACTAMENTE una booking_lead_rule que contenga [group.min, group.max].
  const bookingLeadDays = useMemo(() => {
    if (!group || !champCfg || !Array.isArray(champCfg.booking_lead_rules)) return 0;
    const ms = champCfg.booking_lead_rules.filter(r =>
      Number.isFinite(+r?.min_teams) && Number.isFinite(+r?.max_teams) && Number.isFinite(+r?.days) &&
      +r.min_teams <= group.min && group.max <= +r.max_teams && +r.days >= 0);
    return ms.length === 1 ? +ms[0].days : 0;   // 0/ambiguo → sin bloqueo local (backend valida)
  }, [group, champCfg]);
  const minAllowedKey = useMemo(() => {
    if (!bookingLeadDays) return null;
    return ymd(new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + bookingLeadDays)); // America/Lima
  }, [bookingLeadDays]);

  // Grid REAL de la sede+fecha (fields = columnas; retícula horaria por time+duration). Fuente única de
  // matrix/segmentos (disponibilidad + slots), fields (columnas) y fieldGames (píldoras por game real).
  const grid = useMemo(
    () => (resolvedVenue ? championshipVenueGrid(games, resolvedVenue.id, dateKey, format)
                         : { fields: [], baseHour: 0, hourRows: 0, segCount: 0, matrix: [], gamesGrid: [], hourLabels: [], fieldGames: [] }),
    [resolvedVenue, dateKey, games, format]
  );
  // Dimensión VISUAL mínima del grid (regla SOLO visual, NO disponibilidad): mínimo 4 FILAS DE HORA.
  const gridBaseHour = grid.hourRows > 0 ? grid.baseHour : 15;      // 3pm neutro si la fecha no tiene games reales
  const visualRows = Math.max(4, grid.hourRows);                    // mínimo 4 horas visibles
  const visualHours = Array.from({ length: visualRows }, (_, r) => hourLabel(gridBaseHour + r));
  // Segmento (30 min) → etiqueta de reloj (soporta :30). Los slots vienen en índices de SEGMENTO.
  const segLabel = (seg) => clockFromMin(grid.baseHour * 60 + seg * 30);

  // Horarios válidos por CAPACIDAD SIMULTÁNEA con games COMPLETOS. Cada slot trae gameIds (dedupe REAL).
  const slots = useMemo(() => (group ? championshipSlots(grid, group) : []), [grid, group]);
  const complies = slots.length > 0;
  const activeSlot = (complies && slotIdx != null) ? slots[Math.min(slotIdx, slots.length - 1)] : null;
  // games.id REALES del horario seleccionado (para el hold) = los preasignados por championshipSlots.
  const selectedGameIds = activeSlot ? activeSlot.gameIds : [];
  // Render de píldoras: geometría por game REAL (time+duration); selección por game.id.
  const selSet = new Set(selectedGameIds);
  const GROW = 28, GVINSET = 2, GRAD = 7, GLABELW = 54; // alto/hora, inset vertical (gap entre píldoras), radio, ancho eje
  const gBaseMin = gridBaseHour * 60;

  const showCanchaCard = mode === 'oneday' && !contactMe;

  // Grilla: mínimo 4 columnas visuales (C1–C4). Si el venue tiene más canchas reales, se añaden y
  // se habilita scroll horizontal. Columnas c >= courts = "sin cancha" (inexistente / no elegible).
  const courts = grid.fields.length;
  const cols = Math.max(4, courts);
  const scrollCols = cols > 4;

  // Scroll de la pantalla: se guarda en organizeState al ir a "Ver mi campeonato" y se restaura al volver.
  const scrollRef = useRef(null);
  const activeDateRef = useRef(null);   // celda de fecha activa → auto-scroll horizontal de la tira

  // Indicador vertical sutil de la grilla (aparece solo si hay overflow de horas).
  const gridVRef = useRef(null);
  const [gridThumb, setGridThumb] = useState({ show: false, track: 0, top: 0, height: 0 });
  const updateGridThumb = () => {
    const el = gridVRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight + 1) { setGridThumb(t => (t.show ? { show: false, track: 0, top: 0, height: 0 } : t)); return; }
    const h = Math.max(20, (clientHeight / scrollHeight) * clientHeight);
    const top = (scrollHeight - clientHeight ? scrollTop / (scrollHeight - clientHeight) : 0) * (clientHeight - h);
    setGridThumb({ show: true, track: clientHeight, top, height: h });
  };
  useEffect(() => { const id = requestAnimationFrame(updateGridThumb); return () => cancelAnimationFrame(id); }, [resolvedVenue, dateKey]); // eslint-disable-line

  // Cambiar filtros o fecha → mostrar el primer venue (que, para la fecha, es el primero que cumple).
  // Al cambiar distrito/formato/amenities, deshacer del filtro de Cancha las canchas que ya no son
  // compatibles (p. ej. al quitar el distrito de una cancha filtrada) para no quedar con un filtro
  // "fantasma" que no puede deseleccionarse desde el sheet (que se lista por distrito).
  useEffect(() => {
    if (!didMount.current) return;
    const allowed = new Set(championshipVenues(games, format, districts, amenities).map(v => v.id));
    setVenueFilter(prev => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter(id => allowed.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [format, districts, amenities, games]); // eslint-disable-line

  useEffect(() => { if (didMount.current) setVenueIdx(0); }, [format, districts, amenities, venueFilter, dateKey]);
  // Cambiar de venue/fecha/filtros/rango → limpiar el horario (queda SIN preseleccionar; el usuario elige).
  useEffect(() => { if (didMount.current) setSlotIdx(null); }, [format, districts, amenities, venueFilter, dateKey, groupId, venueIdx]);

  // CASO A ↔ disponibilidad: si NO existe disponibilidad GLOBAL, forzar personalización de Cancha
  // (bloqueada) y limpiar horario. Si vuelve a existir disponibilidad global, liberar el forzado.
  useEffect(() => {
    if (!showCanchaCard || !group || !format) return;       // no aplica (Liga / formato custom / sin rango / sin formato)
    if (!globalHasAnyAvailability) { setCourtForced(true); setCourtCustom(true); setSlotIdx(null); } // empty GLOBAL real
    else if (courtForced) { setCourtForced(false); setCourtCustom(false); } // NO autoselecciona horario
  }, [globalHasAnyAvailability, showCanchaCard, group, format]); // eslint-disable-line
  useEffect(() => { didMount.current = true; }, []);

  // Restaura el scroll al volver desde "Ver mi campeonato" (rAF×2 para esperar el layout).
  useEffect(() => {
    const y = restore?.scrollTop;
    if (!y || !scrollRef.current) return;
    requestAnimationFrame(() => requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: y, behavior: 'instant' })));
  }, []); // eslint-disable-line

  // Formato → Cancha: Cancha aparece solo cuando Formato está completo (Torneo con rango elegido).
  // Al pasar de incompleto→completo, auto-scroll suave UNA sola vez a la sección Cancha (progresión).
  const canchaRef = useRef(null);
  const canchaScrolledRef = useRef(false);
  const canchaReady = showCanchaCard && !!group;   // Formato completo → revelar Cancha
  useEffect(() => {
    if (!canchaReady) { canchaScrolledRef.current = false; return; } // se resetea si vuelve a incompleto
    if (canchaScrolledRef.current) return;          // ya hicimos el scroll una vez
    canchaScrolledRef.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = canchaRef.current, sc = scrollRef.current;
      if (!el || !sc) return;
      const r = el.getBoundingClientRect(), c = sc.getBoundingClientRect();
      sc.scrollTo({ top: Math.max(0, sc.scrollTop + (r.top - c.top) - 12), behavior: 'smooth' });
    }));
  }, [canchaReady]); // eslint-disable-line

  // Selección automática del día disponible más próximo. Se dispara al abrir Cancha (Formato completo) y
  // cuando un cambio de filtro/formato/inventario recalcula la disponibilidad (dateChecks). NO depende de
  // dateKey → NO salta si el usuario elige manualmente un día vacío (§7). Solo salta si el día actual NO
  // tiene disponibilidad y existe otro que sí. §3.
  useEffect(() => {
    if (!canchaReady) return;
    // Primer día con disponibilidad Y que cumpla la anticipación mínima (>= minAllowedKey).
    let target = null;
    for (const d of DATE_WINDOW) { const k = ymd(d); if (dateChecks.has(k) && (!minAllowedKey || k >= minAllowedKey)) { target = k; break; } }
    if (!target) return;                                                              // ningún día permitido con slot → sin salto
    if (dateChecks.has(dateKey) && (!minAllowedKey || dateKey >= minAllowedKey)) return; // día actual válido y permitido → respetar
    setDateKey(target);
  }, [canchaReady, dateChecks, minAllowedKey]); // eslint-disable-line

  // Scroll horizontal automático: centra en la tira el día seleccionado (auto-seleccionado o manual),
  // para que el día disponible más próximo quede a la vista sin que el usuario tenga que desplazar.
  useEffect(() => {
    if (!canchaReady) return;
    activeDateRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [dateKey, canchaReady]);

  // Al elegir un horario, si el bloque recomendado cae fuera del área visible de la grilla,
  // hacer un scroll VERTICAL sutil (smooth) para revelarlo. `startHour` es el índice de fila (HORA).
  useEffect(() => {
    const el = gridVRef.current;
    if (!el || !activeSlot) return;
    const ROW = 28; // celda 28px, filas SIN gap vertical (bloques continuos). startHour/endHour = segmentos → fila = seg/2.
    const firstTop = Math.floor(activeSlot.startHour / 2) * ROW;
    const lastBottom = Math.ceil((activeSlot.endHour ?? activeSlot.startHour + 2) / 2) * ROW;
    const inView = firstTop >= el.scrollTop && lastBottom <= el.scrollTop + el.clientHeight;
    if (inView) return;
    const target = Math.max(0, firstTop - 6);
    requestAnimationFrame(() => { el.scrollTo({ top: target, behavior: 'smooth' }); updateGridThumb(); });
  }, [slotIdx, activeSlot?.startHour, activeSlot?.endHour, venueIdx, dateKey]); // eslint-disable-line

  // Navega a "Ver mi campeonato" (modo demostración). Pasa (a) el estado para restaurar Organiza al
  // volver y (b) el resumen resuelto para pintar. Sin persistencia (frontend/mock).
  function goToView() {
    const organizeState = {
      mode, format, groupId, contactMe, courtCustom, leagueQty, leagueUnit,
      districts: [...districts], amenities: [...amenities], venueFilter: [...venueFilter],
      dateKey, venueIdx, slotIdx,
      venueId: resolvedVenue?.id ?? null,
      city: resolvedVenue?.city ?? null,     // ciudad REAL del venue (autoridad de config en checkout)
      selectedGameIds,                       // games.id REALES del horario elegido (para el hold)
      scrollTop: scrollRef.current?.scrollTop ?? 0,
    };
    const dsel = DATE_WINDOW.find(d => ymd(d) === dateKey);
    const lab = dsel ? dateChip(dsel) : null;
    const summary = {
      mode, contactMe, courtCustom,
      formatLabel: format,
      group: group ? { min: group.min, max: group.max } : null,
      // Liga: cantidad tentativa (equipos o personas). Alimenta el resumen de "Ver mi campeonato".
      leagueEstimate: mode === 'liga' ? { type: leagueUnit, quantity: leagueQty ? Number(leagueQty) : null } : null,
      dateLabel: lab ? `${lab.top} ${lab.bottom}` : null,
      venueName: resolvedVenue?.name ?? null,
      venueDistrict: resolvedVenue?.district ?? null,
      venueAddress: resolvedVenue?.address ?? null,
      slotLabel: activeSlot ? `${segLabel(activeSlot.startHour)} – ${segLabel(activeSlot.endHour)}` : null,
      configLabel: complies ? configLabel : null,
      complies,
      venueId: resolvedVenue?.id ?? null,
      city: resolvedVenue?.city ?? null,      // ciudad REAL del venue → checkout la usa para config/quote
      selectedGameIds,                        // se propaga hasta ChampionshipCheckout (hold real)
      // amenities REALES = objeto { parking:bool, showers:bool, covered:bool } → etiquetas de las activas.
      venueAmenities: resolvedVenue?.amenities
        ? Object.keys(resolvedVenue.amenities).filter(k => resolvedVenue.amenities[k]).map(a => AMENITY_LABEL[a] || a)
        : [],
    };
    navigate('/championships/view', { state: { organizeState, summary } });
  }

  function toggleSet(setter, value) {
    setter(prev => { const n = new Set(prev); n.has(value) ? n.delete(value) : n.add(value); return n; });
  }

  function cycleVenue(dir) {
    // Sin vuelta: se detiene en el primero y en el último (izquierda → derecha).
    setVenueIdx(i => Math.max(0, Math.min(candidates.length - 1, i + dir)));
  }

  // Recomendación textual del grupo (tarjeta de formato) + configuración concreta (aviso).
  const recoMain = group ? `${group.phases[0].courts} canchas · ${group.phases[0].hours} horas` : null;
  const recoExtra = group && group.phases[1] ? `+ ${group.phases[1].courts} canchas · ${group.phases[1].hours} hora adicional` : null;
  const configLabel = recoMain ? `${recoMain}${group.phases[1] ? ` + ${group.phases[1].courts} canchas · ${group.phases[1].hours} ${group.phases[1].hours === 1 ? 'hora' : 'horas'}` : ''}` : '';

  // Regla ÚNICA de habilitación del CTA "Ver mi campeonato":
  //   formatResolved = rango elegido O "que me contacten" (formato) O modo Liga
  //   courtResolved  = no aplica cancha (Liga/formato custom) O cancha custom O hay disponibilidad
  const formatResolved = mode === 'liga' || contactMe || groupId != null;
  const courtResolved = !showCanchaCard || courtCustom || (complies && slotIdx != null);
  const canContinue = formatResolved && courtResolved;

  // Aviso inferior (mismo lugar de siempre). Tres escenarios de disponibilidad:
  //   A) cero GLOBAL → mensaje destacado (se muestra aunque courtCustom esté forzado).
  //   B) existe global pero no con la selección/filtros actuales → mensaje corto (sin forzar personalización).
  //   C) hay disponibilidad con la selección actual → sin aviso.
  const status = (() => {
    if (!showCanchaCard || !group) return null;
    if (!format) return null;                                 // sin formato seleccionado → sin caja global
    // Empty state GLOBAL: SOLO cuando NO existe NINGUNA opción válida en ningún día/filtro/sede. §5/§6-B.
    if (!globalHasAnyAvailability) return { bg: '#FFF8EC', title: 'No encontramos disponibilidad', body: 'No te preocupes, continúa a Ver mi campeonato y te ayudaremos a encontrar una opción.' };
    // Caso A (§4/§6-A): hay disponibilidad en algún día/filtro pero el día/selección actual está vacío →
    // SIN caja grande; el feedback vive en el header "Sin horarios disponibles en esta selección".
    return null;
  })();

  const arrow = (d, enabled) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ transform: d === 'prev' ? 'none' : 'scaleX(-1)' }}>
      <path d="M15 5l-7 7 7 7" stroke={enabled ? TEXT : '#C7C7CC'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  // ── Paso INTRO: pantalla informativa previa al formulario. Contiene el MISMO texto que antes vivía
  // arriba del formulario (movido, no duplicado). "Continuar" → paso 'form'. Atrás → Campeonatos.
  if (step === 'intro') {
    return (
      <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: SOFT, overflow: 'hidden' }}>
        <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 9px)', paddingBottom: 9, paddingLeft: 8, paddingRight: 16, flexShrink: 0 }}>
          <div style={{ height: 26, display: 'flex', alignItems: 'center', position: 'relative' }}>
            <button onClick={() => navigate('/championships')} style={{ position: 'absolute', left: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>Crear nuevo campeonato</div>
          </div>
        </div>

        <div className="no-sb" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingLeft: 16, paddingRight: 16, paddingTop: 14 }}>
          <div style={{ display: 'flex', gap: 10, background: '#E8F1FF', borderRadius: 14, padding: '12px 12px 12px 12px', marginBottom: 16 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: BLUE, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" stroke="#fff" strokeWidth="1.7" strokeLinejoin="round" />
                <path d="M7 6H4.5v1.5A2.5 2.5 0 0 0 7 10M17 6h2.5v1.5A2.5 2.5 0 0 1 17 10" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12 14v3M9 20.5h6M9.5 20.5c0-1.4.8-2.3 2.5-2.3s2.5.9 2.5 2.3" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div style={{ minWidth: 0, fontSize: 13, color: SUB, lineHeight: 1.55 }}>
              <div>Te ayudamos con la organización: solo elige el <span style={{ color: BLUE, fontWeight: 700 }}>formato</span> y la <span style={{ color: BLUE, fontWeight: 700 }}>cancha</span>; nosotros nos encargamos del resto: organizador, árbitros y mucho más.</div>
              <div style={{ marginTop: 8 }}>En <span style={{ color: ORANGE, fontWeight: 700 }}>Ver mi campeonato</span> verás la etapa de <span style={{ textDecoration: 'underline' }}>Inscripciones</span> y <span style={{ textDecoration: 'underline' }}>Calendario y resultados</span>.</div>
              <div style={{ marginTop: 8 }}>Despreocúpate y juega.</div>
            </div>
          </div>
        </div>

        <div style={{ padding: '10px 16px calc(12px + env(safe-area-inset-bottom))', background: SOFT }}>
          <button onClick={() => setStep('form')} className="pressable" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: 54,
            background: ORANGE, color: '#1B1B1F', border: 'none', borderRadius: 18,
            boxShadow: '0 6px 18px rgba(245,165,36,0.40)', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 16, fontWeight: 800, letterSpacing: -0.2, WebkitTapHighlightColor: 'transparent', outline: 'none',
          }}>Continuar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: SOFT, overflow: 'hidden' }}>
      {/* Header compacto 44px */}
      <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 9px)', paddingBottom: 9, paddingLeft: 8, paddingRight: 16, flexShrink: 0 }}>
        <div style={{ height: 26, display: 'flex', alignItems: 'center', position: 'relative' }}>
          <button onClick={() => restore ? navigate('/championships') : setStep('intro')} style={{ position: 'absolute', left: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>Crear nuevo campeonato</div>
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
      <div ref={scrollRef} className="no-sb" style={{ position: 'absolute', inset: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingLeft: 16, paddingRight: 16, paddingTop: 14, paddingBottom: 24 }}>
        {/* ── Tarjeta Formato ── */}
        <div style={CARD}>
          <div style={SECTION_TITLE}>Formato</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Chip active={mode === 'oneday'} onClick={() => setMode('oneday')} style={{ flex: 1 }}>Torneo 1 día</Chip>
            <Chip active={mode === 'liga'} onClick={() => setMode('liga')} style={{ flex: 1 }}>Liga</Chip>
          </div>

          <div className="no-sb" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2, marginBottom: 12 }}>
            {FORMATS.map(f => <Chip key={f} active={format === f} onClick={() => setFormat(prev => prev === f ? null : f)}>{f}</Chip>)}
          </div>

          {mode === 'liga' ? (
            <>
              <div style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>¿Cuántos participan?</div>
              <div style={{ fontSize: 12.5, color: SUB, marginTop: 3, marginBottom: 10 }}>Indica una cantidad aproximada y si te refieres a equipos o personas.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={leagueQty} onChange={e => setLeagueQty(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" placeholder="Ej. 8" style={{ ...inputStyle, flex: 1 }} />
                <select value={leagueUnit} onChange={e => setLeagueUnit(e.target.value)} style={{ ...inputStyle, flex: '0 0 132px', appearance: 'none', WebkitAppearance: 'none', paddingRight: 30, background: `#fff url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23999' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 10px center` }}>
                  <option value="teams">Equipos</option>
                  <option value="people">Personas</option>
                </select>
              </div>
              <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 12, background: '#E8F1FF' }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT, marginBottom: 3 }}>Las ligas se coordinan a medida</div>
                <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.5 }}>No pagarás aquí. Continúa con "Ver mi campeonato": con la información que nos proporciones armamos el calendario de fechas y te contactamos.</div>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>¿Cuántos equipos participan?</div>
              <div style={{ fontSize: 12.5, color: SUB, marginTop: 3, marginBottom: 10 }}>Elige el tamaño del campeonato. Te sugerimos cuántas horas y canchas reservar; la cantidad exacta se ajusta después.</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                {RECOMMENDATION_GROUPS.map(g => {
                  const ppt = PLAYERS_PER_TEAM[format];
                  const active = groupId === g.id && !contactMe;
                  const teams = g.min === g.max ? `${g.min}` : `${g.min}–${g.max}`;
                  const pr = playersRange(g.min, g.max, ppt);   // rango referencial (min–max), admite suplentes
                  const players = `${pr.min}–${pr.max}`;
                  return (
                    <button key={g.id} onClick={() => { if (active) { setGroupId(null); } else { setGroupId(g.id); setContactMe(false); } }} className="pressable" style={{
                      textAlign: 'left', padding: '9px 10px', borderRadius: 12,
                      border: active ? '1px solid transparent' : `1px solid ${HAIR}`,
                      background: active ? '#E8F1FF' : '#fff', cursor: 'pointer', fontFamily: 'inherit',
                      WebkitTapHighlightColor: 'transparent', outline: 'none',
                    }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: active ? BLUE : TEXT, letterSpacing: -0.2, whiteSpace: 'nowrap' }}>{teams}</div>
                      <div style={{ fontSize: 11.5, color: SUB, marginTop: 1 }}>equipos</div>
                      <div style={{ fontSize: 11, color: SUB, marginTop: 2 }}>{players} jugadores</div>
                    </button>
                  );
                })}
              </div>

              <CheckboxCard
                checked={contactMe}
                onToggle={() => { setContactMe(v => !v); if (!contactMe) setGroupId(null); }}
                label="Quisiera que me contacten para personalizarlo"
                expanded={'Continúa con "Ver mi campeonato": nos pondremos en contacto contigo para coordinar todo.'}
              />

              {group && !contactMe && (
                <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 12, background: '#E8F1FF' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>Debes reservar: {group.courtHours} {group.courtHours === 1 ? 'hora' : 'horas'}</div>
                  </div>
                  <div style={{ fontSize: 12, color: SUB, lineHeight: 1.5, paddingLeft: 30 }}>
                    Buscamos la mejor disponibilidad. Partidos de 15 minutos + 5 de descanso. Todos los equipos juegan mínimo 3 partidos.
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Tarjeta Cancha — SOLO cuando Formato está completo (Torneo 1 día con rango elegido) ── */}
        {canchaReady && (
          <div ref={canchaRef} style={CARD}>
            <div style={SECTION_TITLE}>Cancha</div>

            <div className="no-sb" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 10 }}>
              <Chip active={districts.size > 0} onClick={() => setDistrictSheet(true)}>{districts.size > 0 ? `Distrito · ${districts.size}` : 'Distrito'}</Chip>
              <Chip active={venueFilter.size > 0} onClick={() => setVenueSheet(true)}>{venueFilter.size > 0 ? `Cancha · ${venueFilter.size}` : 'Cancha'}</Chip>
              {AMENITIES.map(a => <Chip key={a.key} active={amenities.has(a.key)} onClick={() => toggleSet(setAmenities, a.key)}>{a.label}</Chip>)}
            </div>

            <div className="no-sb" style={{ display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 8, marginBottom: 6 }}>
              {DATE_WINDOW.map(d => {
                const k = ymd(d); const lab = dateChip(d);
                const blocked = !!minAllowedKey && k < minAllowedKey;   // anticipación mínima no cumplida
                const noAvail = !dateChecks.has(k);                     // día sin disponibilidad → gris deshabilitado (como rentals)
                return <DateCell key={k} refEl={dateKey === k ? activeDateRef : null} top={lab.top} bottom={lab.bottom} isToday={k === TODAY_KEY} active={dateKey === k} check={dateChecks.has(k) && !blocked} disabled={blocked || noAvail} onClick={() => setDateKey(k)} />;
              })}
            </div>

            {invLoading ? (
              // minHeight reserva el alto del bloque de horarios+grilla → la pantalla no salta al cargar.
              <div style={{ fontSize: 13, color: SUB, padding: '8px 0', minHeight: 300 }}>Cargando disponibilidad…</div>
            ) : !resolvedVenue ? (
              // minHeight reserva el alto del bloque de horarios+grilla → al aparecer una cancha la pantalla no salta.
              <div style={{ fontSize: 13, color: SUB, padding: '8px 0', minHeight: 300 }}>{format ? `No hay canchas compatibles con ${format} para el filtro actual.` : 'Elige un formato para ver disponibilidad.'}</div>
            ) : (
              <>
                {/* Venue + grilla = UNA sola unidad (sub-marco) → clara separación de los filtros de arriba. */}
                <div style={{ border: `1px solid ${HAIR}`, borderRadius: 14, background: '#FBFBFD', padding: 12, marginBottom: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <button onClick={() => cycleVenue(-1)} disabled={venueIdx <= 0} style={arrowBtn}>{arrow('prev', venueIdx > 0)}</button>
                  <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{resolvedVenue.name}</div>
                    <div style={{ fontSize: 12, color: SUB }}>{resolvedVenue.address} · {resolvedVenue.district}</div>
                  </div>
                  {candidates.length > 1 && <div style={{ fontSize: 11.5, fontWeight: 600, color: SUB, flexShrink: 0 }}>{venueIdx + 1}/{candidates.length}</div>}
                  <button onClick={() => cycleVenue(1)} disabled={venueIdx >= candidates.length - 1} style={arrowBtn}>{arrow('next', venueIdx < candidates.length - 1)}</button>
                </div>

                {/* Grilla INFORMATIVA (canchas × horas) — algo más compacta (celdas 28, alto máx menor). */}
                <div style={{ position: 'relative', paddingRight: 8 }}>
                <div className="no-sb" style={{ overflowX: scrollCols ? 'auto' : 'visible', WebkitOverflowScrolling: 'touch' }}>
                  <div style={{ minWidth: scrollCols ? cols * 50 + GLABELW + 6 : undefined }}>
                    {/* Cabecera C1..Cn — alineada con las columnas del body (paddingLeft = ancho eje + gap). */}
                    <div style={{ display: 'flex', gap: 6, marginBottom: 5, paddingLeft: GLABELW + 6 }}>
                      {Array.from({ length: cols }, (_, c) => (
                        <div key={c} style={{ flex: scrollCols ? '0 0 44px' : 1, minWidth: 0, textAlign: 'center', fontSize: 11, color: c < courts ? SUB : '#C7C7CC' }}>C{c + 1}</div>
                      ))}
                    </div>
                    {/* Body: eje horario (nowrap) + columnas de píldoras. Cada game real = UNA píldora con
                        geometría por time+duration (soporta :15/:45 visual); games distintos = píldoras con
                        pequeño gap; mismo game.id cruzando una hora = una sola pieza continua. */}
                    <div ref={gridVRef} onScroll={updateGridThumb} className="no-sb" style={{ maxHeight: 4 * GROW, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
                      <div style={{ display: 'flex', height: visualRows * GROW, position: 'relative' }}>
                        {/* Línea punteada MUY fina en cada límite de hora (encima): una píldora que cruza la hora
                            (p.ej. 8:30–9:30) se ve pasar por el medio de esa línea → se entiende que abarca la hora. */}
                        {Array.from({ length: visualRows - 1 }, (_, i) => (
                          <div key={`hl${i}`} style={{ position: 'absolute', left: GLABELW + 6, right: 0, top: (i + 1) * GROW, borderTop: '1px dotted rgba(0,0,0,0.16)', pointerEvents: 'none', zIndex: 2 }} />
                        ))}
                        <div style={{ width: GLABELW, flexShrink: 0 }}>
                          {visualHours.map((hLabel, h) => (
                            <div key={h} style={{ height: GROW, fontSize: 11, color: SUB, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>{hLabel}</div>
                          ))}
                        </div>
                        <div style={{ flex: 1, display: 'flex', gap: 6, marginLeft: 6 }}>
                          {Array.from({ length: cols }, (_, c) => {
                            const exists = c < courts;               // columna con field real (c>=courts = placeholder)
                            const colStyle = { flex: scrollCols ? '0 0 44px' : 1, minWidth: 0, position: 'relative', height: visualRows * GROW };
                            // Base: una PÍLDORA por HORA (no disponible = gris; placeholder = rayado), separadas por gap.
                            const basePills = Array.from({ length: visualRows }, (_, h) => (
                              <div key={`b${h}`} style={{
                                position: 'absolute', left: 0, right: 0, top: h * GROW + GVINSET, height: GROW - 2 * GVINSET,
                                borderRadius: GRAD, ...(exists ? { background: '#ECECEF' } : NON_ELIGIBLE),
                              }} />
                            ));
                            // Píldoras de GAMES reales (disponible/seleccionado) por geometría time+duration. Una píldora = un
                            // game (una sola pieza), aunque cruce una hora. Games distintos = píldoras con pequeño gap.
                            const gamePills = exists ? (grid.fieldGames[c] || []).map(g => {
                              const top = ((g.startMin - gBaseMin) / 60) * GROW;
                              const hgt = (g.durationMin / 60) * GROW;
                              if (top + hgt <= 0 || top >= visualRows * GROW) return null; // fuera del viewport
                              const sel = selSet.has(g.id);
                              return (
                                <div key={g.id} style={{
                                  position: 'absolute', left: 0, right: 0,
                                  top: top + GVINSET, height: Math.max(6, hgt - 2 * GVINSET),
                                  borderRadius: GRAD, background: sel ? '#DCE8FF' : '#fff', border: `1px solid ${sel ? BLUE : HAIR}`,
                                }} />
                              );
                            }) : null;
                            return <div key={c} style={colStyle}>{basePills}{gamePills}</div>;
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Indicador vertical sutil (thumb móvil) — solo si hay overflow de horas */}
                {gridThumb.show && (
                  <div style={{ position: 'absolute', top: 20, right: 2, width: 3, height: gridThumb.track, borderRadius: 2, pointerEvents: 'none' }}>
                    <div style={{ position: 'absolute', top: gridThumb.top, width: 3, height: gridThumb.height, borderRadius: 2, background: 'rgba(0,0,0,0.20)' }} />
                  </div>
                )}
                </div>
                </div>{/* fin del sub-marco venue+grilla */}

                {/* ── DECISIÓN DEL USUARIO — elegir un horario disponible (protagonismo alto, tras el grid). ── */}
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${HAIR}` }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: TEXT, letterSpacing: -0.1, marginBottom: 8 }}>
                    Elige un horario disponible
                  </div>
                  <div className="no-sb" style={{ display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 2 }}>
                    {slots.length > 0 ? slots.map((s, i) => {
                      const on = slotIdx != null && i === Math.min(slotIdx, slots.length - 1);
                      // Selección FINAL con azul FILLED (más protagonismo que el azul claro de los filtros).
                      return (
                        <Chip key={s.startHour} active={on} onClick={() => { setCourtCustom(false); setSlotIdx(on ? null : i); }}
                          style={{ height: 30, padding: '0 11px', fontSize: 12.5, ...(on ? { background: BLUE, color: '#fff', border: '1px solid transparent', fontWeight: 700 } : { border: '1px solid #C9D6F5', fontWeight: 700 }) }}>
                          {segLabel(s.startHour)} – {segLabel(s.endHour)}
                        </Chip>
                      );
                    }) : (
                      <div style={{ flexShrink: 0, height: 34, padding: '0 14px', borderRadius: 999, border: `1px dashed ${HAIR}`, background: SOFT, color: SUB, fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', cursor: 'default' }}>
                        Sin horario disponible en esta selección
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Personalización de Cancha (equivalente a la de Formato). Al marcar → courtCustom=true,
                Cancha queda RESUELTA, se oculta el aviso de disponibilidad y el CTA queda habilitado.
                El mensaje crece HACIA ABAJO (inline, sin scrollTo/scrollIntoView → no mueve el scroll). */}
            <div style={{ marginTop: 12 }}>
              <CheckboxCard
                checked={courtCustom}
                locked={courtForced}
                onToggle={() => { const next = !courtCustom; setCourtCustom(next); if (next) setSlotIdx(null); }}
                label="No encuentro lo que busco. Quisiera que me contacten para personalizarlo."
                expanded={'Continúa con Ver mi campeonato; nos pondremos en contacto contigo para coordinar todo.'}
              />
            </div>
          </div>
        )}

        {/* Aviso de horas-cancha + CTA "Ver mi campeonato" — INLINE al final del formulario (antes
            flotaba absolute sobre el contenido). Misma lógica de disabled/onClick/goToView. */}
        {status && (
          <div style={{ padding: '10px 12px', borderRadius: 12, background: status.bg, marginTop: 16, marginBottom: 10 }}>
            {status.title && <div style={{ fontSize: 13.5, fontWeight: 800, color: status.titleColor || TEXT }}>{status.title}</div>}
            {status.body && <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.4, marginTop: status.title ? 3 : 0 }}>{status.body}</div>}
          </div>
        )}
        <button
          onClick={canContinue ? goToView : undefined}
          disabled={!canContinue}
          className={canContinue ? 'pressable' : undefined}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '100%', height: 54, marginTop: status ? 0 : 20,
            background: canContinue ? ORANGE : '#E8E8EC', color: canContinue ? '#1B1B1F' : '#9A9AA0',
            border: 'none', borderRadius: 18,
            boxShadow: canContinue ? '0 6px 18px rgba(245,165,36,0.40)' : 'none', cursor: canContinue ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit', fontSize: 16, fontWeight: 800, letterSpacing: -0.2, WebkitTapHighlightColor: 'transparent',
          }}>
          Ver mi campeonato
        </button>
      </div>
      </div>

      <TabBar />

      {districtSheet && (
        <PickSheet title="Elige distritos" onClose={() => setDistrictSheet(false)}
          items={championshipDistricts(games).map(d => ({ value: d, label: d }))}
          selected={districts} onToggle={(v) => toggleSet(setDistricts, v)} />
      )}
      {venueSheet && (
        <PickSheet title="Elige canchas" onClose={() => setVenueSheet(false)}
          items={championshipVenues(games, format, districts, amenities).map(v => ({ value: v.id, label: v.name, sub: `${v.district} · ${v.courts} canchas` }))}
          selected={venueFilter} onToggle={(v) => toggleSet(setVenueFilter, v)} />
      )}
    </div>
  );
}

const inputStyle = {
  width: '100%', height: 40, borderRadius: 10, border: `1px solid ${HAIR}`,
  padding: '0 12px', fontSize: 15, color: TEXT, fontFamily: 'inherit',
  background: '#fff', outline: 'none', boxSizing: 'border-box',
};
const arrowBtn = {
  width: 34, height: 34, borderRadius: 10, border: `1px solid ${HAIR}`, background: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  flexShrink: 0, padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none',
};
const swatch = { width: 12, height: 12, borderRadius: 3, display: 'inline-block' };
const legItem = { display: 'flex', alignItems: 'center', gap: 5 };
// Cancha inexistente / no elegible (rayado) — distinto de "ocupado" (gris sólido).
const NON_ELIGIBLE = { background: 'repeating-linear-gradient(45deg, #F2F2F4, #F2F2F4 3px, #E4E4E8 3px, #E4E4E8 6px)', border: '1px dashed #D1D1D6' };
