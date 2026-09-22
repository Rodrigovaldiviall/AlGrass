import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BLUE, TEXT, SUB, HAIR, ORANGE, SOFT, GREEN } from '../constants';
import { useSheetPull } from '../hooks/useSheetPull';
import { DATE_WINDOW, TODAY, TODAY_KEY, ymd } from '../data/games';
import { getChampionshipConfig } from '../services/championshipService';
import {
  FORMATS, DEFAULT_FORMAT, PLAYERS_PER_TEAM, RECOMMENDATION_GROUPS, AMENITIES, playersRange,
} from '../data/championshipFormats';
import {
  fetchChampionshipInventory, championshipVenues, championshipDistricts,
  championshipVenueGrid, championshipSlots, hourLabel, clockFromMin, gameBlockedByChampionship,
  buildInsufficientPreview, championshipSlotForAnchor, championshipCombinationValid,
} from '../services/championshipAvailabilityService';
import ConfirmExitDialog from '../components/ConfirmExitDialog';
import './ChampionshipIntroContent.css';
import cimg01 from '../assets/championship-intro/01-app.webp';
import cimg02 from '../assets/championship-intro/02-arbitro.webp';
import cimg03 from '../assets/championship-intro/03-organizador.webp';
import cimg04 from '../assets/championship-intro/04-celebracion.webp';

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

// Borrador de "Crear campeonato" persistido en sessionStorage: sobrevive a CUALQUIER salida/vuelta
// (atrás del dispositivo, "Ver mi campeonato", etc.). "Crear nuevo campeonato" (Championships) lo BORRA
// → arranque limpio. Es el mismo patrón de session-state que championship_view_state.
const ORG_DRAFT_KEY = 'championship_organize_draft';
function readOrgDraft() { try { return JSON.parse(sessionStorage.getItem(ORG_DRAFT_KEY)); } catch { return null; } }

export default function ChampionshipOrganize() {
  const navigate = useNavigate();
  const location = useLocation();
  // Estado restaurado: prioridad al state de navegación (volver desde "Ver mi campeonato"); si no, el
  // borrador de sessionStorage (atrás/re-montaje). "Crear nuevo campeonato" limpia el borrador → null.
  const restore = location.state?.organizeState || readOrgDraft();

  // Paso del flujo de creación: 'intro' (pantalla informativa) → 'form' (configuración actual).
  // Al VOLVER a editar (restore presente) se entra directo al formulario (la intro solo aparece al
  // crear desde cero). Es un step interno: NO añade ruta ni cambia el back de la edición.
  const [step, setStep] = useState(restore ? 'form' : 'intro');
  const [confirmExit, setConfirmExit] = useState(false);   // X = salir del flujo → confirmación

  const [mode, setMode] = useState(restore?.mode ?? 'oneday');            // 'oneday' | 'liga'
  const [format, setFormat] = useState(restore?.format ?? DEFAULT_FORMAT);  // nuevo → 7v7 por defecto; restore → restaura
  // NUEVO campeonato → SIN cantidad/grupo de equipos preseleccionado (null). Restore/edición → respeta
  // EXACTAMENTE la selección previa (incluido null). La primera elección la hace el usuario.
  const [groupId, setGroupId] = useState(restore ? (restore.groupId ?? null) : null);
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
  // Variante MANUAL válida elegida desde la tabla (p.ej. A+B+D en vez de la representativa A+B+C del slot).
  // Validada por championshipSlotForAnchor (misma autoridad). Si está, SUSTITUYE a los gameIds del slot
  // representativo como selección real; slotIdx apunta al slot representativo del MISMO horario (highlight
  // de la zona inferior sin duplicar opciones). null = se usa la combinación representativa del slot.
  const [manualGameIds, setManualGameIds] = useState(restore?.manualGameIds ?? null);
  // Identidad ESTABLE de la selección real (gameIds + venue + horario), independiente de índices de slots.
  // Se fija al COMMITear una selección y sirve para, al cambiar FILTROS, revalidarla contra el nuevo contexto
  // (mismo venue/fecha) y preservarla si sigue siendo válida — sin depender de un slotIdx viejo (los arrays
  // de slots pueden reordenarse). Restore la inicializa con la selección restaurada (startHour se deriva).
  const selMetaRef = useRef(
    restore && Array.isArray(restore.selectedGameIds) && restore.selectedGameIds.length
      ? { gameIds: restore.selectedGameIds, venueId: restore.venueId ?? null, startHour: null }
      : null
  );
  const commitSel = (gameIds, venueId, startHour) => { selMetaRef.current = (Array.isArray(gameIds) && gameIds.length) ? { gameIds, venueId: venueId ?? null, startHour: startHour ?? null } : null; };
  const clearSelMeta = () => { selMetaRef.current = null; };
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
  const [champCfgResolved, setChampCfgResolved] = useState(false);   // fetch de config terminado (éxito o error)
  useEffect(() => {
    if (!invCity) { setChampCfg(null); setChampCfgResolved(true); return; }
    setChampCfgResolved(false);
    let alive = true;
    getChampionshipConfig({ city: invCity }).then(({ data, error }) => { if (alive) { setChampCfg(error ? null : data); setChampCfgResolved(true); } });
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

  // ── Booking lead (UX): usa champCfg (ciudad del inventario) → días de anticipación por rango del grupo. ──
  // Bloquea fechas < HOY_LIMA + lead. Autoridad final = backend (quote/hold re-validan BOOKING_LEAD_NOT_MET).
  // Misma regla conceptual del backend: EXACTAMENTE una booking_lead_rule que contenga [group.min, group.max].
  // Se declara ANTES de globalHasAnyAvailability porque el empty-state (isEmptyFormat) también debe respetar
  // la anticipación: un formato cuya ÚNICA disponibilidad cae dentro del lead = SIN fecha válida = empty.
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

  // Disponibilidad GLOBAL REAL: ¿existe ALGÚN día VÁLIDO (IGNORANDO distrito/sede/amenities) con una
  // combinación válida para el formato Y que cumpla la anticipación mínima (minAllowedKey)? true = hay
  // opciones bookeables en alguna parte; false = NO existe NINGUNA fecha/slot válido (empty global). §5.
  // Mismo criterio que usa el auto-select (dateChecks + minAllowedKey) → todos los formatos comparten ruta:
  // si existe ≥1 fecha válida → flujo normal; si no → MISMO empty state para 4 / 5-6 / 7-8.
  const globalVenues = useMemo(() => championshipVenues(games, format, new Set(), new Set()), [games, format]);
  const globalHasAnyAvailability = useMemo(() => {
    if (!group) return false;
    for (const d of DATE_WINDOW) { const k = ymd(d); if ((!minAllowedKey || k >= minAllowedKey) && globalVenues.some(v => venueComplies(v, k))) return true; }
    return false;
  }, [globalVenues, group, games, format, minAllowedKey]); // eslint-disable-line

  const resolvedVenue = candidates[Math.min(venueIdx, Math.max(0, candidates.length - 1))] || null;

  // EMPTY_FORMAT = el formato NO tiene NINGUNA disponibilidad real utilizable en ningún venue ni fecha del
  // inventario Championship, ANTES de aplicar filtros del usuario. Autoridad = globalHasAnyAvailability
  // (recorre TODAS las fechas de DATE_WINDOW y TODOS los globalVenues —sin distrito/amenities/venueFilter—
  // comprobando venueComplies = existe ≥1 slot válido). NO es globalVenues.length (eso es compatibilidad
  // ESTRUCTURAL, no disponibilidad). Cuando es true → se oculta TODA la UI de selección de cancha.
  const isEmptyFormat = !!group && !!format && !globalHasAnyAvailability;

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
  // games.id REALES del horario seleccionado (para el hold): variante MANUAL validada si existe, si no la
  // combinación representativa del slot. En ambos casos son gameIds validados por la misma autoridad.
  const selectedGameIds = manualGameIds ?? (activeSlot ? activeSlot.gameIds : []);
  // Render de píldoras: geometría por game REAL (time+duration); selección por game.id.
  const selSet = new Set(selectedGameIds);
  const GROW = 28, GVINSET = 2, GRAD = 7, GLABELW = 54; // alto/hora, inset vertical (gap entre píldoras), radio, ancho eje
  const gBaseMin = gridBaseHour * 60;

  // ── Tabla como ACCESO ALTERNATIVO de selección (misma fuente de verdad = slotIdx). ────────────────
  // Al pulsar una píldora (game real) resolvemos a qué opción de "Elige un horario" pertenece usando la
  // MISMA autoridad (championshipSlots → slot.gameIds). NO se recalcula disponibilidad ni se crea estado
  // propio de selección en la tabla. Si el game está en ≥1 slot → seleccionamos el de menor startHour
  // (mismo criterio que el auto-select). Si NO está en ningún slot completo → PREVIEW visual insuficiente.
  //
  // PREVIEW INSUFICIENTE = estado local EXCLUSIVAMENTE visual (buildInsufficientPreview): representa el
  // INTENTO COMPLETO del formato en celdas-hora completas, y COMO LA COMBINACIÓN NO CUMPLE, TODO el intento
  // (games existentes + bloques faltantes) se pinta en ROJO — nunca azul/parcial. NO crea slot, NO toca
  // slotIdx/selectedGameIds/canContinue/quote/hold; NUNCA declara reservable (eso solo championshipSlots).
  // El ROJO es TEMPORAL (shake inicial + fade ~1s vía CSS, luego se limpia); el MENSAJE PERSISTE aparte.
  const [preview, setPreview] = useState(null);           // { availIds→existingIds, missing:[{f,seg}] } | null (visual temporal)
  const [insufMsg, setInsufMsg] = useState(false);        // mensaje inferior de insuficiencia (persiste tras el fade)
  const previewTimer = useRef(null);
  const clearPreview = () => { setPreview(null); setInsufMsg(false); if (previewTimer.current) clearTimeout(previewTimer.current); };
  useEffect(() => () => { if (previewTimer.current) clearTimeout(previewTimer.current); }, []);
  function selectFromGrid(gameId) {
    // 1) TOGGLE: si el game pulsado ya está en la selección real ACTUAL (representativa o manual) → quitar.
    //    Cuenta como interacción manual (auto-select no la recupera; no vuelve a la representativa).
    if (slotIdx != null && selectedGameIds.includes(gameId)) { setSlotIdx(null); setManualGameIds(null); clearSelMeta(); return; }
    // 2) El game pertenece a la combinación REPRESENTATIVA de algún slot → seleccionar ese slot (sin variante).
    const idx = slots.findIndex(s => s.gameIds.includes(gameId));  // slots asc → primera = más temprana
    if (idx >= 0) { clearPreview(); setManualGameIds(null); setCourtCustom(false); setSlotIdx(idx); commitSel(slots[idx].gameIds, resolvedVenue?.id, slots[idx].startHour); return; }
    // 3) Game "alternativo": ¿existe una combinación VÁLIDA (misma autoridad) que lo INCLUYA? → variante manual.
    //    Ej.: A+B+C representativa; pulso D y A+B+D también cumple → se selecciona A+B+D (cambio de alternativa).
    const variant = championshipSlotForAnchor(grid, group, gameId);
    if (variant) {
      const repIdx = slots.findIndex(s => s.startHour === variant.startHour);   // slot representativo del MISMO horario
      clearPreview(); setCourtCustom(false);
      setManualGameIds(variant.gameIds);
      setSlotIdx(repIdx >= 0 ? repIdx : null);                  // highlight de la zona inferior sin duplicar opción
      commitSel(variant.gameIds, resolvedVenue?.id, variant.startHour);
      return;
    }
    // 4) NO existe combinación válida que incluya el game → NUEVA intención INVÁLIDA. Un click manual en otra
    //    celda sustituye la intención: se ABANDONA la selección válida anterior ANTES de pintar el rojo (nunca
    //    azul+rojo a la vez) y NO se restaura tras el fade. Deriva todo lo demás: la zona inferior se desmarca,
    //    selectedGameIds→[], canContinue→false (slotIdx null; auto-select por groupId ya aplicado → no la recupera).
    setSlotIdx(null); setManualGameIds(null); clearSelMeta();
    if (previewTimer.current) clearTimeout(previewTimer.current);
    const p = buildInsufficientPreview(grid, group, gameId, cols);
    setInsufMsg(true);
    if (p) {
      setPreview(p);
      previewTimer.current = setTimeout(() => setPreview(null), 1000);   // fade CSS ~1s → limpiar rojo; el mensaje QUEDA
    } else {
      setPreview(null);
    }
  }
  const errSet = preview ? new Set(preview.existingIds) : null;   // games del intento inválido → ROJO
  // Limpiar preview + mensaje al cambiar formato/fecha/venue/filtros (contexto de disponibilidad).
  useEffect(() => { clearPreview(); }, [groupId, dateKey, venueIdx, format, districts, amenities, venueFilter]); // eslint-disable-line

  const showCanchaCard = mode === 'oneday' && !contactMe;

  // Grilla: mínimo 4 columnas visuales (C1–C4). Si el venue tiene más canchas reales, se añaden y
  // se habilita scroll horizontal. Columnas c >= courts = "sin cancha" (inexistente / no elegible).
  const courts = grid.fields.length;
  const cols = Math.max(4, courts);
  const scrollCols = cols > 4;

  // Scroll de la pantalla: se guarda en organizeState al ir a "Ver mi campeonato" y se restaura al volver.
  const scrollRef = useRef(null);
  const scrollTopRef = useRef(restore?.scrollTop ?? 0);   // scrollTop vivo (onScroll) → persistir aun al desmontar
  const activeDateRef = useRef(null);   // celda de fecha activa → auto-scroll horizontal de la tira
  // Centra en la tira la fecha YA seleccionada por la lógica existente (no decide fecha; solo desplaza).
  // Único helper de scroll horizontal → reutilizado por el effect de dateKey y por el reveal del veil.
  const centerActiveDate = (behavior = 'smooth') => {
    activeDateRef.current?.scrollIntoView({ behavior, inline: 'center', block: 'nearest' });
  };

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

  // Reset de contexto NO-filtros (formato/fecha): mostrar el primer venue. Los FILTROS se tratan aparte
  // (abajo) para poder PRESERVAR una selección que siga siendo válida. El cambio manual de venue lo maneja
  // cycleVenue directamente (por eso venueIdx ya no dispara el limpiado de horario).
  useEffect(() => { if (didMount.current) setVenueIdx(0); }, [format, dateKey]);
  // Formato/fecha/rango → limpiar el horario (queda SIN preseleccionar; el usuario elige). NO incluye filtros
  // ni venueIdx: los filtros preservan si siguen válidos; el venue manual limpia en cycleVenue.
  useEffect(() => { if (didMount.current) { setSlotIdx(null); setManualGameIds(null); clearSelMeta(); } }, [format, dateKey, groupId]);

  // FILTROS (distrito/cancha/amenities): un cambio de filtro NO es un cambio de intención. Si la selección
  // actual sigue siendo VÁLIDA en el nuevo contexto (mismo venue presente + games siguen formando una
  // combinación válida según la MISMA autoridad), se PRESERVA exactamente (representativa o manual) y se
  // recalcula venueIdx/slotIdx de forma derivada (por identidad/horario, NO por índice viejo). Si deja de
  // ser válida (venue excluido o combinación inválida) → se limpia. Sin selección → primer venue.
  useEffect(() => {
    if (!didMount.current) return;
    const meta = selMetaRef.current;
    if (!meta || !meta.gameIds?.length) { setVenueIdx(0); return; }        // sin selección → comportamiento previo
    const vIdx = candidates.findIndex(v => v.id === meta.venueId);         // ¿el venue de la selección sigue disponible?
    const g = vIdx >= 0 ? championshipVenueGrid(games, meta.venueId, dateKey, format) : null;
    if (!g || !championshipCombinationValid(g, group, meta.gameIds)) {     // venue excluido o combinación ya no válida
      clearSelMeta(); setManualGameIds(null); setSlotIdx(null); setVenueIdx(0);
      return;
    }
    // PRESERVAR: fijar venueIdx al venue de la selección + recalcular slotIdx por HORARIO (no por índice).
    setVenueIdx(vIdx);
    const nslots = championshipSlots(g, group);
    let sh = meta.startHour;
    if (sh == null) { const v = championshipSlotForAnchor(g, group, meta.gameIds[0]); sh = v?.startHour ?? null; selMetaRef.current = { ...meta, startHour: sh }; }
    const nIdx = sh != null ? nslots.findIndex(s => s.startHour === sh) : -1;
    setSlotIdx(nIdx >= 0 ? nIdx : null);                                   // manualGameIds se mantiene tal cual
  }, [districts, amenities, venueFilter]); // eslint-disable-line

  // Ciclo de auto-select por FORMATO+GRUPO mediante flags "armados". Un CAMBIO REAL de format/group los ARMA
  // (rearma el ciclo) — incluso si el formato intermedio no tenía disponibilidad (5–6 → 7–8 EMPTY → 5–6: el
  // 7–8 no consume el flag, así que al volver a 5–6 SÍ vuelve a auto-seleccionar). La deselección MANUAL no
  // cambia format/group → no rearma. Restore/back arranca DESARMADO → NO auto-selecciona (respeta la
  // selección restaurada). El guard didMount salta el disparo del montaje (declarado antes del didMount-effect).
  const autoDateArmedRef = useRef(!restore);
  const autoSlotArmedRef = useRef(!restore);
  useEffect(() => { if (didMount.current) { autoDateArmedRef.current = true; autoSlotArmedRef.current = true; } }, [format, groupId]); // eslint-disable-line

  // Validación del restore (View → Back): al cargar el inventario, si el DÍA restaurado ya NO tiene
  // disponibilidad (p.ej. cambió la fecha/el inventario), la selección restaurada quedó OBSOLETA → se limpia
  // y se REARMA el auto-select como un ciclo nuevo (día válido más próximo + primer horario). Si el día sigue
  // válido, no toca nada (respeta la selección). Corre UNA vez tras !invLoading.
  const restoreCheckedRef = useRef(false);
  useEffect(() => {
    if (restoreCheckedRef.current || !restore || invLoading) return;
    if (invCity && !champCfgResolved) return;   // esperar a que resuelva champCfg → minAllowedKey (anticipación) y blocks finales
    restoreCheckedRef.current = true;
    // Día restaurado válido = tiene disponibilidad Y cumple la anticipación mínima (minAllowedKey).
    const dateOk = group && dateChecks.has(dateKey) && (!minAllowedKey || dateKey >= minAllowedKey);
    if (group && dateChecks.size > 0 && !dateOk) {
      setSlotIdx(null); setManualGameIds(null); clearSelMeta();
      autoDateArmedRef.current = true;
      autoSlotArmedRef.current = true;
    }
  }, [invLoading, champCfgResolved, dateChecks, minAllowedKey]); // eslint-disable-line

  // CASO A ↔ disponibilidad: si NO existe disponibilidad GLOBAL, forzar personalización de Cancha
  // (bloqueada) y limpiar horario. Si vuelve a existir disponibilidad global, liberar el forzado.
  useEffect(() => {
    if (invLoading) return;                                 // durante la carga del inventario NO es "empty" real → no forzar ni limpiar (preserva restore)
    if (!showCanchaCard || !group || !format) return;       // no aplica (Liga / formato custom / sin rango / sin formato)
    if (!globalHasAnyAvailability) { setCourtForced(true); setCourtCustom(true); setSlotIdx(null); setManualGameIds(null); clearSelMeta(); } // empty GLOBAL real
    else if (courtForced) { setCourtForced(false); setCourtCustom(false); } // NO autoselecciona horario
  }, [globalHasAnyAvailability, showCanchaCard, group, format, invLoading]); // eslint-disable-line
  useEffect(() => { didMount.current = true; }, []);

  // Restaura el scroll al volver desde "Ver mi campeonato". DEBE esperar a que cargue el inventario para que
  // el contenido (tabla/horarios) esté maquetado y el scroll pueda alcanzar la posición guardada; se aplica
  // UNA sola vez. Mientras tanto, restoringRef suprime los auto-scrolls (a Cancha / tira de fechas) para que
  // no "suban" la pantalla y peleen con el restore.
  const restoringRef = useRef(!!restore?.scrollTop);
  const scrollRestoredRef = useRef(false);
  // Velo de loading SOLO cuando hay scroll que restaurar (View → Back): el contenido se monta pero se oculta
  // (visibility:hidden → conserva layout/scrollHeight) hasta que el scroll se aplica → el usuario NO ve el
  // contenido arriba ni el salto. En nueva creación (sin restore.scrollTop) es false → comportamiento actual.
  const [restoreVeil, setRestoreVeil] = useState(!!restore?.scrollTop);
  useEffect(() => {
    if (scrollRestoredRef.current) return;
    const y = restore?.scrollTop;
    if (!y) { scrollRestoredRef.current = true; restoringRef.current = false; setRestoreVeil(false); return; }
    if (invLoading || !scrollRef.current) return;   // esperar el contenido final (inventario cargado) → hay altura para el scroll
    if (invCity && !champCfgResolved) return;        // esperar a que resuelva champCfg → minAllowedKey (anticipación) y blocks finales
    // Esperar además a que el contenido esté ASENTADO: día VÁLIDO (con disponibilidad Y que cumpla la
    // anticipación mínima) o sin cancha / sin disponibilidad (nada que corregir). Así el velo NO se retira
    // mostrando "hoy" para luego saltar al primer día realmente válido.
    const cancha = mode === 'oneday' && !contactMe && !!group;   // = canchaReady (aún no declarado aquí)
    const dateOk = dateChecks.has(dateKey) && (!minAllowedKey || dateKey >= minAllowedKey);
    const settled = !cancha || courtCustom || dateChecks.size === 0 || dateOk;
    if (!settled) return;
    scrollRestoredRef.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: y, behavior: 'instant' });
      if (dateOk) centerActiveDate('instant');       // fecha válida marcada → dejarla visible en la tira ANTES de revelar (empty/no-fecha → no scroll)
      restoringRef.current = false;                 // liberar auto-scrolls tras restaurar
      setRestoreVeil(false);                         // scroll ya aplicado + contenido asentado → revelar (sin flash/salto)
    }));
  }, [invLoading, champCfgResolved, mode, contactMe, group, courtCustom, dateChecks, dateKey, minAllowedKey]); // eslint-disable-line

  // Formato → Cancha: Cancha aparece solo cuando Formato está completo (Torneo con rango elegido).
  // Al pasar de incompleto→completo, auto-scroll suave UNA sola vez a la sección Cancha (progresión).
  const canchaRef = useRef(null);
  const canchaScrolledRef = useRef(false);
  const canchaReady = showCanchaCard && !!group;   // Formato completo → revelar Cancha
  useEffect(() => {
    if (!canchaReady) { canchaScrolledRef.current = false; return; } // se resetea si vuelve a incompleto
    if (restoringRef.current) { canchaScrolledRef.current = true; return; } // restaurando scroll → no auto-scrollear a Cancha
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
  // Día válido más próximo. ARMADO (ciclo nuevo: cambio de formato/grupo) → SIEMPRE salta al más próximo del
  // nuevo formato, aunque el día anterior siguiera siendo válido. DESARMADO (mismo ciclo) → respeta el día
  // elegido por el usuario si mantiene disponibilidad. Usa la MISMA autoridad (dateChecks).
  useEffect(() => {
    if (!canchaReady) return;
    // Primer día con disponibilidad Y que cumpla la anticipación mínima (>= minAllowedKey).
    let target = null;
    for (const d of DATE_WINDOW) { const k = ymd(d); if (dateChecks.has(k) && (!minAllowedKey || k >= minAllowedKey)) { target = k; break; } }
    if (!target) return;                                                              // ningún día permitido con slot → sin salto
    if (!autoDateArmedRef.current && dateChecks.has(dateKey) && (!minAllowedKey || dateKey >= minAllowedKey)) return; // desarmado + día válido → respetar
    autoDateArmedRef.current = false;
    if (dateKey !== target) setDateKey(target);                                       // ciclo nuevo O día actual inválido → día más próximo
  }, [canchaReady, dateChecks, minAllowedKey]); // eslint-disable-line

  // Preselección del primer horario válido del día más próximo — UN ciclo por cada FORMATO+GRUPO (NO solo
  // groupId, para que cambiar el formato de fútbol 7v7→6v6 rearme el ciclo aunque el groupId no cambie). La
  // deselección/selección MANUAL del usuario NO lo rearma (el key del ciclo no cambia). Solo auto-selecciona
  // cuando la fecha ya es la MÁS PRÓXIMA del ciclo (el date-effect ya la fijó) → evita consumir el ciclo en la
  // fecha anterior antes de que salte. Restore: se inicializa con el key restaurado → NO auto-selecciona.
  useEffect(() => {
    if (!groupId || !format) return;
    if (invLoading || !canchaReady || courtCustom) return;                  // esperar disponibilidad real / no imponer si personaliza
    if (!autoSlotArmedRef.current) return;                                  // consumido / restore / deselección manual → NO imponer
    if (slots.length === 0) return;                                         // aún sin horarios → esperar
    // Esperar a que la fecha se asiente en la más próxima del ciclo (misma autoridad dateChecks) → así el
    // auto-select ocurre en la fecha correcta y no se consume en la fecha anterior antes de que salte.
    let nearest = null;
    for (const d of DATE_WINDOW) { const k = ymd(d); if (dateChecks.has(k) && (!minAllowedKey || k >= minAllowedKey)) { nearest = k; break; } }
    if (nearest && dateKey !== nearest) return;
    setSlotIdx(0);                                                          // primer horario del día más próximo
    commitSel(slots[0].gameIds, resolvedVenue?.id, slots[0].startHour);     // identidad estable para preservar ante filtros
    autoSlotArmedRef.current = false;
  }, [format, groupId, invLoading, canchaReady, courtCustom, slots, dateKey, dateChecks, minAllowedKey]); // eslint-disable-line

  // Scroll horizontal automático: centra en la tira el día seleccionado (auto-seleccionado o manual),
  // para que el día disponible más próximo quede a la vista sin que el usuario tenga que desplazar.
  useEffect(() => {
    if (!canchaReady || restoringRef.current) return;   // durante la restauración de scroll no mover la vista (el reveal del veil la centra)
    centerActiveDate('smooth');
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

  // Snapshot COMPLETO del estado de Organize (selección + scroll) — fuente única para navegar a "Ver mi
  // campeonato" (location.state) y para persistir el borrador (sessionStorage) al salir/desmontar.
  const buildOrganizeState = () => ({
    mode, format, groupId, contactMe, courtCustom, leagueQty, leagueUnit,
    districts: [...districts], amenities: [...amenities], venueFilter: [...venueFilter],
    dateKey, venueIdx, slotIdx, manualGameIds,   // manualGameIds = variante manual válida (o null → representativa)
    venueId: resolvedVenue?.id ?? null,
    city: resolvedVenue?.city ?? null,     // ciudad REAL del venue (autoridad de config en checkout)
    selectedGameIds,                       // games.id REALES del horario elegido (para el hold)
    scrollTop: scrollRef.current?.scrollTop ?? scrollTopRef.current ?? 0,
  });
  // Persistir el borrador al desmontar (atrás del dispositivo, ir a Ver mi campeonato, etc.) con el estado
  // más reciente. Un ref a la última versión evita capturar un cierre obsoleto. SOLO si el usuario ya está en
  // el formulario (paso 'form'): en la intro no hay nada que guardar (y evita re-persistir un default en el
  // doble-montaje de StrictMode tras "Crear nuevo", que debe arrancar en intro).
  const buildRef = useRef(buildOrganizeState); buildRef.current = buildOrganizeState;
  const stepRef = useRef(step); stepRef.current = step;
  useEffect(() => () => { if (stepRef.current !== 'form') return; try { sessionStorage.setItem(ORG_DRAFT_KEY, JSON.stringify(buildRef.current())); } catch {} }, []);

  // Navega a "Ver mi campeonato" (modo demostración). Pasa (a) el estado para restaurar Organiza al
  // volver y (b) el resumen resuelto para pintar. También persiste el borrador (sessionStorage).
  function goToView() {
    const organizeState = buildOrganizeState();
    try { sessionStorage.setItem(ORG_DRAFT_KEY, JSON.stringify(organizeState)); } catch {}
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
    // Cambio MANUAL de venue = cambio de contexto → limpiar el horario/variante (el usuario elige en el nuevo venue).
    setSlotIdx(null); setManualGameIds(null); clearSelMeta();
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
    // Empty state GLOBAL (EMPTY_FORMAT): ya lo comunica el holder amarillo dentro de la sección Cancha
    // (ver isEmptyFormat) → aquí NO se duplica el aviso.
    if (!globalHasAnyAvailability) return null;
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
      <div className="screen-shell championship-intro-shell" style={{ display: 'flex', flexDirection: 'column', background: SOFT, overflow: 'hidden' }}>
        {/* Header azul del intro: se OCULTA en desktop (>=1024, donde la nav global es el sidebar);
            en mobile se conserva intacto (flecha/X = salida directa a /championships, sin confirm). */}
        <div className="championship-intro-header" style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 9px)', paddingBottom: 9, paddingLeft: 8, paddingRight: 16, flexShrink: 0 }}>
          <div style={{ height: 26, display: 'flex', alignItems: 'center', position: 'relative' }}>
            <button onClick={() => navigate('/championships')} style={{ position: 'absolute', left: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>Crear nuevo campeonato</div>
            {/* X en el INTRO: salida DIRECTA a Campeonatos, SIN confirmación (aún no hay datos que perder). */}
            <button onClick={() => navigate('/championships')} aria-label="Salir" style={{ position: 'absolute', right: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>

        <div className="no-sb" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingLeft: 16, paddingRight: 16, paddingTop: 14 }}>
          {/* Contenido informativo (docs/championship-intro): vive DENTRO de este .no-sb; el header azul,
              el scroll y el footer "Empezar" los aporta este mismo step. Estilos en ChampionshipIntroContent.css. */}
          <div className="champ-intro">
            <div className="ci-content">

              <section className="intro">
                <div className="intro__texto">
                  <p className="antetitulo">Campeonatos de fútbol</p>
                  <h1>Organiza tu campeonato con AlGrass. <span>Despreocúpate y juega.</span></h1>
                </div>
                <p className="bajada">
                  <strong>Todo en un solo lugar.</strong> Olvídate de cotizar canchas, conseguir árbitros y buscar quién se haga cargo. Nosotros nos encargamos de todo.
                </p>
              </section>

              <section className="tira" aria-label="Cómo se vive un campeonato AlGrass">
                <img src={cimg01} width="1200" height="600" loading="lazy" alt="Dos personas siguen la tabla de posiciones del campeonato desde el celular." />
                <img src={cimg02} width="1200" height="600" loading="lazy" alt="Un árbitro señala una falta durante un partido en cancha de grass." />
                <img src={cimg03} width="1200" height="600" loading="lazy" alt="El organizador mira tranquilo el partido desde su escritorio." />
                <img src={cimg04} width="1200" height="600" loading="lazy" alt="El equipo campeón levanta el trofeo con las medallas puestas." />
              </section>

              <section className="paneles">

                <div className="panel-tu">
                  <h2 className="rotulo">Lo que haces tú</h2>

                  <div className="paso">
                    <span className="paso__num">01</span>
                    <div>
                      <div className="paso__titulo">Elige el formato</div>
                      <p>Torneo o liga, fútbol 7, 8, 11… y cantidad de equipos (personas).</p>
                    </div>
                  </div>

                  <div className="separador"></div>

                  <div className="paso">
                    <span className="paso__num">02</span>
                    <div>
                      <div className="paso__titulo">Elige la cancha</div>
                      <p>Disponibilidad real. Reservas todas las fechas de una vez.</p>
                    </div>
                  </div>

                  <div className="aviso">
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#B34A0C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L3 21l1.1-3.4A8.4 8.4 0 1 1 21 11.5z"></path></svg>
                    <p>¿No encuentras lo que buscas? No te preocupes, nos pondremos en contacto contigo.</p>
                  </div>
                </div>

                <div className="panel-nosotros">
                  <h2 className="rotulo">Lo que hacemos nosotros</h2>

                  {/* HOLDER BLANCO 1 — Experiencia (Inscripciones / Calendario como mini-cards) */}
                  <div className="tarjeta kit">
                    <div className="tarjeta__titulo">Brindamos una experiencia de campeonato profesional</div>
                    <div className="kit__items kit__items--stack">
                      <div className="kit__card">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1B4FD1" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.4"></circle><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"></path><path d="M17 5.2a3.4 3.4 0 0 1 0 5.6"></path><path d="M19 13.8c1.6 1.2 2.5 3.1 2.5 5.2"></path></svg>
                        <div>
                          <div className="kit__card-title">Inscripciones</div>
                          <div className="kit__card-text">Tus jugadores se inscriben solos: crean sus equipos y se suman con un link. Tú no persigues a nadie ni armas listas.</div>
                        </div>
                      </div>
                      <div className="kit__card">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1B4FD1" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"></rect><path d="M3 10h18"></path><path d="M8 3v4"></path><path d="M16 3v4"></path><path d="M8 14.5h3"></path><path d="M14 14.5h2"></path></svg>
                        <div>
                          <div className="kit__card-title">Calendario y resultados</div>
                          <div className="kit__card-text">Fixture con fechas y horas, resultados, tabla y goleadores. Lo siguen todos los jugadores y quien tú invites.</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* HOLDER BLANCO 2 — Logística */}
                  <div className="tarjeta kit">
                    <div className="tarjeta__titulo">Nos encargamos de toda la logística y más</div>
                    <div className="kit__items">
                      <div className="kit__item">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1B4FD1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4.5 20.5c0-4.1 3.4-7.5 7.5-7.5s7.5 3.4 7.5 7.5"></path></svg>
                        <span>Organizador</span>
                      </div>
                      <div className="kit__item">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1B4FD1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 21V4"></path><path d="M5 5h12l-2.2 4L17 13H5"></path></svg>
                        <span>Árbitros</span>
                      </div>
                      <div className="kit__item">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1B4FD1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8l9-5 9 5v8l-9 5-9-5z"></path><path d="M3 8l9 5 9-5"></path></svg>
                        <span>Chalecos y balón</span>
                      </div>
                      <div className="kit__item">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1B4FD1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8.5h4l1.5-2.5h7L17 8.5h4v11H3z"></path><circle cx="12" cy="13.5" r="3.2"></circle></svg>
                        <span>Fotos</span>
                      </div>
                    </div>
                    <p className="kit__extra">Y lo que quieras sumar: trofeo, medallas, premiación.</p>
                  </div>
                </div>

              </section>

            </div>
          </div>
        </div>

        <div className="championship-intro-footer" style={{ padding: '10px 16px calc(12px + env(safe-area-inset-bottom))', background: SOFT }}>
          <button onClick={() => setStep('form')} className="pressable championship-intro-cta" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: 54,
            background: ORANGE, color: '#1B1B1F', border: 'none', borderRadius: 18,
            boxShadow: '0 6px 18px rgba(245,165,36,0.40)', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 16, fontWeight: 800, letterSpacing: -0.2, WebkitTapHighlightColor: 'transparent', outline: 'none',
          }}>Empezar</button>
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
          {/* X = SALIR del flujo → confirmación → listado (NO navigate(-1); la flecha izquierda vuelve un nivel). */}
          <button onClick={() => setConfirmExit(true)} aria-label="Salir" style={{ position: 'absolute', right: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
      {/* SKELETON del restore (View → Back): capa visual mientras el contenido real (detrás, visibility:hidden)
          conserva layout/scrollHeight y se aplica el scroll. Como el regreso siempre queda al fondo (solo se
          entra a View pulsando el botón, que está abajo), el skeleton representa esa vista: el HOLDER de Cancha
          llenando el alto + "No encuentro" + el botón "Ver mi campeonato". NO spinner. */}
      {restoreVeil && (
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 5, background: SOFT, overflow: 'hidden', padding: '14px 16px', display: 'flex', flexDirection: 'column' }}>
          {/* Holder de Cancha (ocupa el alto disponible) */}
          <div style={{ flex: 1, minHeight: 0, background: '#fff', border: `1px solid ${HAIR}`, borderRadius: 16, padding: 16, marginBottom: 12, display: 'flex', flexDirection: 'column' }}>
            <div className="champ-skel" style={{ width: 70, height: 14, marginBottom: 12 }} />
            {/* Bloque superior neutro: filtros + fechas + tabla */}
            <div style={{ flex: 1, minHeight: 0, background: '#ECEDF1', borderRadius: 14, padding: 10, marginBottom: 12, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="champ-skel" style={{ width: 64, height: 28, borderRadius: 999 }} />)}
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="champ-skel" style={{ width: 50, height: 52, borderRadius: 11 }} />)}
              </div>
              <div style={{ flex: 1, minHeight: 0, background: '#FBFBFD', border: `1px solid ${HAIR}`, borderRadius: 14, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="champ-skel" style={{ width: '55%', height: 12, marginBottom: 4 }} />
                {Array.from({ length: 5 }).map((_, i) => <div key={i} className="champ-skel" style={{ flex: 1, minHeight: 14 }} />)}
              </div>
            </div>
            {/* "Elige un horario disponible" */}
            <div style={{ display: 'flex', gap: 8 }}>
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="champ-skel" style={{ width: 96, height: 30, borderRadius: 999 }} />)}
            </div>
          </div>
          {/* "No encuentro lo que busco" */}
          <div className="champ-skel" style={{ height: 48, borderRadius: 14, marginBottom: 16 }} />
          {/* Botón "Ver mi campeonato" */}
          <div className="champ-skel" style={{ height: 54, borderRadius: 18 }} />
        </div>
      )}
      <div ref={scrollRef} onScroll={e => { scrollTopRef.current = e.currentTarget.scrollTop; }} className="no-sb" style={{ position: 'absolute', inset: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingLeft: 16, paddingRight: 16, paddingTop: 14, paddingBottom: 24, visibility: restoreVeil ? 'hidden' : 'visible' }}>
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
                  // Sin formato aún → el nº de jugadores por equipo no está definido: se omite el rango (no NaN).
                  const pr = ppt ? playersRange(g.min, g.max, ppt) : null;   // rango referencial (min–max), admite suplentes
                  const players = pr ? `${pr.min}–${pr.max}` : null;
                  return (
                    <button key={g.id} onClick={() => { if (active) { setGroupId(null); } else { setGroupId(g.id); setContactMe(false); } }} className="pressable" style={{
                      textAlign: 'left', padding: '9px 10px', borderRadius: 12,
                      border: active ? '1px solid transparent' : `1px solid ${HAIR}`,
                      background: active ? '#E8F1FF' : '#fff', cursor: 'pointer', fontFamily: 'inherit',
                      WebkitTapHighlightColor: 'transparent', outline: 'none',
                    }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: active ? BLUE : TEXT, letterSpacing: -0.2, whiteSpace: 'nowrap' }}>{teams}</div>
                      <div style={{ fontSize: 11.5, color: SUB, marginTop: 1 }}>equipos</div>
                      <div style={{ fontSize: 11, color: SUB, marginTop: 2 }}>{players ? `${players} jugadores` : ' '}</div>
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
                    <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>Debes reservar: {group.courtHours} {group.courtHours === 1 ? 'hora' : 'horas'}.</div>
                  </div>
                  <div style={{ fontSize: 12, color: SUB, lineHeight: 1.5, paddingLeft: 30 }}>
                    Todos los equipos juegan mínimo 3 partidos de 15 minutos + 5 de descanso.
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

            {/* ── BLOQUE SUPERIOR (buscar/filtrar disponibilidad): filtros + fechas + tabla. Superficie neutra
                 (protagonismo reducido). NO disabled / NO opacity: todo sigue 100% interactivo y legible.
                 FILTROS y FECHAS permanecen SIEMPRE visibles (también en EMPTY_FILTERS y EMPTY_FORMAT). ── */}
            <div style={{ background: '#ECEDF1', borderRadius: 14, padding: 10, marginBottom: 12 }}>

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
            ) : (isEmptyFormat || !resolvedVenue) ? (
              // EMPTY_FORMAT y EMPTY_FILTERS sustituyen EXACTAMENTE la MISMA zona (selector de venue + tabla +
              // "Elige un horario") por un holder vacío del MISMO minHeight. Filtros y fechas (arriba) siguen
              // visibles en ambos. Única diferencia:
              //   · EMPTY_FORMAT (isEmptyFormat): mensaje con fondo AMARILLO; "No encuentro" marcado (courtForced).
              //   · EMPTY_FILTERS (!resolvedVenue): mensaje SIN amarillo; "No encuentro" sin marcar.
              <div style={{ minHeight: 270, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 12px' }}>
                {isEmptyFormat ? (
                  <div style={{ maxWidth: 320, padding: '12px 14px', borderRadius: 12, background: '#FFF8EC', border: '1px solid #F0D8A0', textAlign: 'center', fontSize: 13, fontWeight: 600, color: TEXT, lineHeight: 1.5 }}>
                    No hay disponibilidad para {format}{group ? ` de ${group.min === group.max ? group.min : `${group.min}–${group.max}`} equipos` : ''}. Prueba otra opción o continúa con «Ver mi campeonato».
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', fontSize: 13.5, fontWeight: 600, color: SUB, lineHeight: 1.5 }}>
                    {format ? `No hay canchas compatibles con ${format} en esta selección. Intenta otros filtros.` : 'Elige un formato para ver disponibilidad.'}
                  </div>
                )}
              </div>
            ) : (
                /* Venue + grilla = UNA sola unidad (sub-marco), dentro del bloque superior neutro. */
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
                              const sel = selSet.has(g.id);                        // selección REAL (slot) → azul
                              const err = !!(errSet && errSet.has(g.id));          // parte del intento INVÁLIDO → rojo
                              // SOLO las píldoras de game (disponibilidad real) son tocables → acceso alternativo
                              // de selección. No hover: click/tap directo. base/placeholder NO son tocables.
                              return (
                                <div key={g.id}
                                  role="button"
                                  onClick={() => selectFromGrid(g.id)}
                                  className={err ? 'champ-invalid' : undefined}
                                  style={{
                                  position: 'absolute', left: 0, right: 0,
                                  top: top + GVINSET, height: Math.max(6, hgt - 2 * GVINSET),
                                  borderRadius: GRAD,
                                  background: err ? '#FDECEC' : sel ? '#DCE8FF' : '#fff',
                                  border: `1px solid ${err ? '#E24A4A' : sel ? BLUE : HAIR}`,
                                  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                                }} />
                              );
                            }) : null;
                            // Bloques FALTANTES (rojos) del intento inválido para esta columna. NO son games (sin gameId):
                            // recuadro COMPLETO de una HORA (GROW), nunca media celda. Shake+fade con la misma animación.
                            const missPills = preview ? preview.missing.filter(m => m.f === c).map(m => (
                              <div key={`x${m.seg}`}
                                className="champ-invalid"
                                style={{
                                  position: 'absolute', left: 0, right: 0,
                                  top: m.seg * (GROW / 2) + GVINSET, height: GROW - 2 * GVINSET,
                                  borderRadius: GRAD, background: '#FDECEC', border: '1px solid #E24A4A',
                                }} />
                            )) : null;
                            return <div key={c} style={colStyle}>{basePills}{gamePills}{missPills}</div>;
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
                </div>
            )}

            {/* Mensaje de insuficiencia (X = horas requeridas del formato). PERSISTE tras el fade del rojo;
                se limpia al seleccionar un slot válido o al cambiar formato/fecha/venue/filtros. */}
            {insufMsg && group && (
              <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 10, background: '#FDECEC', border: '1px solid #F3C0C0', color: '#B03A3A', fontSize: 12, fontWeight: 600, lineHeight: 1.4 }}>
                Esta disponibilidad no cubre las {group.courtHours} horas en el formato adecuado.
              </div>
            )}
            </div>{/* ── fin BLOQUE SUPERIOR (buscar/filtrar) neutro ── */}

            {/* ── ZONA DE DECISIÓN (BLANCA, protagonista) — elegir un horario disponible. Se muestra en cuanto
                 hay una cancha resuelta con disponibilidad cargada. Mismo lenguaje visual y misma lógica. ── */}
            {!invLoading && resolvedVenue && !isEmptyFormat && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: TEXT, letterSpacing: -0.1, marginBottom: 8 }}>
                  Elige un horario disponible
                </div>
                <div className="no-sb" style={{ display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 2 }}>
                  {slots.length > 0 ? slots.map((s, i) => {
                    const on = slotIdx != null && i === Math.min(slotIdx, slots.length - 1);
                    // Selección FINAL con azul FILLED (más protagonismo que el azul claro de los filtros).
                    return (
                      <Chip key={s.startHour} active={on} onClick={() => { setCourtCustom(false); setManualGameIds(null); setSlotIdx(on ? null : i); if (on) clearSelMeta(); else commitSel(s.gameIds, resolvedVenue?.id, s.startHour); }}
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
            )}

            {/* Personalización de Cancha (equivalente a la de Formato). Al marcar → courtCustom=true,
                Cancha queda RESUELTA, se oculta el aviso de disponibilidad y el CTA queda habilitado.
                El mensaje crece HACIA ABAJO (inline, sin scrollTo/scrollIntoView → no mueve el scroll). */}
            <div style={{ marginTop: 12 }}>
              <CheckboxCard
                checked={courtCustom}
                locked={courtForced}
                onToggle={() => { const next = !courtCustom; setCourtCustom(next); if (next) { setSlotIdx(null); setManualGameIds(null); clearSelMeta(); } }}
                label="No encuentro lo que busco"
                expanded={'Continúa con "Ver mi campeonato"; nos pondremos en contacto contigo para coordinarlo de forma personalizada.'}
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
      {confirmExit && (
        <ConfirmExitDialog onCancel={() => setConfirmExit(false)} onConfirm={() => navigate('/championships')} />
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
