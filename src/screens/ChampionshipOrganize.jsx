import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BLUE, TEXT, SUB, HAIR, ORANGE, SOFT, GREEN } from '../constants';
import TabBar from '../components/TabBar';
import { useSheetPull } from '../hooks/useSheetPull';
import { DATE_WINDOW, TODAY_KEY, ymd } from '../data/games';
import {
  FORMATS, DEFAULT_FORMAT, PLAYERS_PER_TEAM, RECOMMENDATION_GROUPS,
  DISTRICTS, AMENITIES, HOURS, compatibleVenues, venueMatrix, findValidTournamentSlots,
} from '../data/championshipFormats';

// Etiqueta de reloj a partir del índice de franja (índice 0 = 3:00 pm … cada franja +1h).
const clockLabel = (i) => { const hr = 15 + i; const ampm = hr >= 12 ? 'pm' : 'am'; const h12 = hr % 12 || 12; return `${h12}:00 ${ampm}`; };

// Mismo patrón de fechas que Partidos (DateCell): día abreviado + número, 30 días de horizonte.
const DOW_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
function dateChip(d) {
  const k = ymd(d);
  if (k === TODAY_KEY) return { top: 'Hoy', bottom: d.getDate() };
  return { top: DOW_ES[d.getDay()], bottom: d.getDate() };
}
function DateCell({ top, bottom, active, isToday, onClick, check }) {
  const topColor = active ? '#fff' : (isToday ? BLUE : SUB);
  const bottomColor = active ? '#fff' : TEXT;
  return (
    <button onClick={onClick} style={{
      position: 'relative',
      flex: '0 0 auto', width: 50, height: 52, borderRadius: 11,
      background: active ? BLUE : '#fff', border: `1px solid ${active ? BLUE : HAIR}`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: 0,
      cursor: 'pointer', outline: 'none', WebkitTapHighlightColor: 'transparent', fontFamily: 'inherit',
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
function CheckboxCard({ checked, onToggle, label, expanded }) {
  return (
    <div style={{ border: `1px solid ${checked ? BLUE : HAIR}`, borderRadius: 12, padding: '12px 14px', background: checked ? '#F5F8FF' : '#fff' }}>
      <button onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
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

  const [mode, setMode] = useState('oneday');            // 'oneday' | 'liga'
  const [format, setFormat] = useState(DEFAULT_FORMAT);  // 7v7 por defecto
  const [groupId, setGroupId] = useState(null);          // rango de tamaño (uno de los 4 grupos)
  const [contactMe, setContactMe] = useState(false);
  const [leagueTeams, setLeagueTeams] = useState('');
  const [leaguePlayers, setLeaguePlayers] = useState('');

  const [districts, setDistricts] = useState(() => new Set());
  const [venueFilter, setVenueFilter] = useState(() => new Set());
  const [amenities, setAmenities] = useState(() => new Set());
  const [dateKey, setDateKey] = useState(TODAY_KEY);
  const [venueIdx, setVenueIdx] = useState(0);
  const [slotIdx, setSlotIdx] = useState(0);
  const [courtCustom, setCourtCustom] = useState(false); // "que me contacten" en Cancha
  const [districtSheet, setDistrictSheet] = useState(false);
  const [venueSheet, setVenueSheet] = useState(false);

  const group = RECOMMENDATION_GROUPS.find(g => g.id === groupId) || null;

  // Sedes base: formato compatible + distritos + amenities + filtro de cancha (respeta TODOS los filtros).
  const baseVenues = useMemo(() => {
    const base = compatibleVenues(format, districts, amenities);
    return venueFilter.size === 0 ? base : base.filter(v => venueFilter.has(v.id));
  }, [format, districts, amenities, venueFilter]);

  // ÚNICA fuente de verdad: ¿este venue tiene AL MENOS un horario válido completo esa fecha?
  const venueComplies = (v, k) => group != null && findValidTournamentSlots(venueMatrix(v, k), group).length > 0;

  // Check de fechas: una fecha tiene check si AL MENOS un venue base tiene ≥1 horario válido ese día.
  const dateChecks = useMemo(() => {
    const s = new Set();
    if (!group) return s;
    for (const d of DATE_WINDOW) { const k = ymd(d); if (baseVenues.some(v => venueComplies(v, k))) s.add(k); }
    return s;
  }, [group, baseVenues]);

  // Orden de venues para la fecha activa: primero los que cumplen, luego el resto (mismo orden base).
  const candidates = useMemo(() => {
    if (!group) return baseVenues;
    const yes = [], no = [];
    for (const v of baseVenues) (venueComplies(v, dateKey) ? yes : no).push(v);
    return [...yes, ...no];
  }, [baseVenues, group, dateKey]);

  const resolvedVenue = candidates[Math.min(venueIdx, Math.max(0, candidates.length - 1))] || null;
  const matrix = useMemo(() => (resolvedVenue ? venueMatrix(resolvedVenue, dateKey) : []), [resolvedVenue, dateKey]);

  // Todos los horarios válidos del venue (misma función única). El usuario elige UNA franja completa.
  const slots = useMemo(() => (group ? findValidTournamentSlots(matrix, group) : []), [matrix, group]);
  const complies = slots.length > 0;
  const activeSlot = complies ? slots[Math.min(slotIdx, slots.length - 1)] : null;
  const block = activeSlot ? activeSlot.cells : new Set(); // celdas del horario seleccionado (solo visual)

  const showCanchaCard = mode === 'oneday' && !contactMe;

  // Grilla: mínimo 4 columnas visuales (C1–C4). Si el venue tiene más canchas reales, se añaden y
  // se habilita scroll horizontal. Columnas c >= courts = "sin cancha" (inexistente / no elegible).
  const courts = resolvedVenue?.courts || 0;
  const cols = Math.max(4, courts);
  const scrollCols = cols > 4;

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
  useEffect(() => { setVenueIdx(0); }, [format, districts, amenities, venueFilter, dateKey]);
  // Cambiar de venue/fecha/filtros/rango → seleccionar automáticamente el primer horario válido.
  useEffect(() => { setSlotIdx(0); }, [format, districts, amenities, venueFilter, dateKey, groupId, venueIdx]);

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
  const configLabel = recoMain ? `${recoMain}${group.phases[1] ? ` + ${group.phases[1].courts} canchas · ${group.phases[1].hours} hora adicional` : ''}` : '';

  // Regla ÚNICA de habilitación del CTA "Ver mi campeonato":
  //   formatResolved = rango elegido O "que me contacten" (formato) O modo Liga
  //   courtResolved  = no aplica cancha (Liga/formato custom) O cancha custom O hay disponibilidad
  const formatResolved = mode === 'liga' || contactMe || groupId != null;
  const courtResolved = !showCanchaCard || courtCustom || complies;
  const canContinue = formatResolved && courtResolved;

  // Aviso inferior: verde si AlGrass encontró el bloque exacto; ámbar si no. SE OCULTA por completo
  // si el usuario eligió personalizar Cancha (courtCustom) → ya no evaluamos el flujo estándar.
  const status = (() => {
    if (!showCanchaCard || courtCustom || !group || !resolvedVenue) return null;
    if (complies) return { bg: '#D7F0DD', title: 'Excelente, encontramos la disponibilidad', titleColor: GREEN, body: configLabel };
    return { bg: '#FFF8EC', title: 'No se encuentra la disponibilidad recomendada.', body: 'Prueba otra cancha o selecciona personalizar.' };
  })();

  const arrow = (d, enabled) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ transform: d === 'prev' ? 'none' : 'scaleX(-1)' }}>
      <path d="M15 5l-7 7 7 7" stroke={enabled ? TEXT : '#C7C7CC'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: SOFT, overflow: 'hidden' }}>
      {/* Header compacto 44px */}
      <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 9px)', paddingBottom: 9, paddingLeft: 8, paddingRight: 16, flexShrink: 0 }}>
        <div style={{ height: 26, display: 'flex', alignItems: 'center', position: 'relative' }}>
          <button onClick={() => navigate('/championships')} style={{ position: 'absolute', left: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div style={{ flex: 1, textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>Organiza tu campeonato</div>
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
      <div className="no-sb" style={{ position: 'absolute', inset: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingLeft: 16, paddingRight: 16, paddingTop: 14, paddingBottom: status ? 130 : 88 }}>
        <div style={{ fontSize: 13, color: SUB, lineHeight: 1.55, marginBottom: 14 }}>
          Disfruta de un torneo sin preocuparte por la organización: bríndanos los datos de formato y cancha, y nosotros nos encargamos del resto — cancha, árbitros, agua y mucho más. En "Ver mi campeonato" te mostraremos la fase de inscripciones y de resultados, para que todos puedan participar. Despreocúpate y juega.
        </div>

        {/* ── Tarjeta Formato ── */}
        <div style={CARD}>
          <div style={SECTION_TITLE}>Formato</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Chip active={mode === 'oneday'} onClick={() => setMode('oneday')} style={{ flex: 1 }}>Torneo 1 día</Chip>
            <Chip active={mode === 'liga'} onClick={() => setMode('liga')} style={{ flex: 1 }}>Liga</Chip>
          </div>

          <div className="no-sb" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2, marginBottom: 12 }}>
            {FORMATS.map(f => <Chip key={f} active={format === f} onClick={() => setFormat(f)}>{f}</Chip>)}
          </div>

          {mode === 'liga' ? (
            <>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: SUB, marginBottom: 4 }}>Equipos</div>
                  <input value={leagueTeams} onChange={e => setLeagueTeams(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="Ej. 10" style={inputStyle} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: SUB, marginBottom: 4 }}>Jugadores</div>
                  <input value={leaguePlayers} onChange={e => setLeaguePlayers(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="Ej. 70" style={inputStyle} />
                </div>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                {RECOMMENDATION_GROUPS.map(g => {
                  const ppt = PLAYERS_PER_TEAM[format];
                  const active = groupId === g.id && !contactMe;
                  return (
                    <button key={g.id} onClick={() => { setGroupId(g.id); setContactMe(false); }} className="pressable" style={{
                      textAlign: 'left', padding: '10px 12px', borderRadius: 12,
                      border: active ? '1px solid transparent' : `1px solid ${HAIR}`,
                      background: active ? '#E8F1FF' : '#fff', cursor: 'pointer', fontFamily: 'inherit',
                      WebkitTapHighlightColor: 'transparent', outline: 'none',
                    }}>
                      <div style={{ fontSize: 14.5, fontWeight: 800, color: active ? BLUE : TEXT, letterSpacing: -0.2 }}>{g.min}–{g.max} equipos</div>
                      <div style={{ fontSize: 12, color: SUB, marginTop: 2 }}>{g.min * ppt}–{g.max * ppt} jugadores</div>
                    </button>
                  );
                })}
              </div>

              <CheckboxCard
                checked={contactMe}
                onToggle={() => { setContactMe(v => !v); if (!contactMe) setGroupId(null); }}
                label="Prefiero que me contacten para personalizarlo"
                expanded={'Continúa con "Ver mi campeonato": nos pondremos en contacto contigo para coordinar todo.'}
              />

              {group && !contactMe && (
                <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 12, background: '#E8F1FF' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>Recomendado: {recoMain}</div>
                  </div>
                  {recoExtra && <div style={{ fontSize: 13, fontWeight: 700, color: BLUE, paddingLeft: 30, marginBottom: 4 }}>{recoExtra}</div>}
                  <div style={{ fontSize: 12, color: SUB, lineHeight: 1.5, paddingLeft: 30 }}>
                    Buscamos la mejor disponibilidad — puedes ajustarla. Partidos de 15 minutos + 5 de descanso. Duración de reloj ~{group.clockHours} horas.
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Tarjeta Cancha (solo Torneo 1 día y sin "que me contacten") ── */}
        {showCanchaCard && (
          <div style={CARD}>
            <div style={SECTION_TITLE}>Cancha</div>

            <div className="no-sb" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 10 }}>
              <Chip active={districts.size > 0} onClick={() => setDistrictSheet(true)}>{districts.size > 0 ? `Distrito · ${districts.size}` : 'Distrito'}</Chip>
              <Chip active={venueFilter.size > 0} onClick={() => setVenueSheet(true)}>{venueFilter.size > 0 ? `Cancha · ${venueFilter.size}` : 'Cancha'}</Chip>
              {AMENITIES.map(a => <Chip key={a.key} active={amenities.has(a.key)} onClick={() => toggleSet(setAmenities, a.key)}>{a.label}</Chip>)}
            </div>

            <div className="no-sb" style={{ display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 8, marginBottom: 6 }}>
              {DATE_WINDOW.map(d => {
                const k = ymd(d); const lab = dateChip(d);
                return <DateCell key={k} top={lab.top} bottom={lab.bottom} isToday={k === TODAY_KEY} active={dateKey === k} check={dateChecks.has(k)} onClick={() => setDateKey(k)} />;
              })}
            </div>

            {!resolvedVenue ? (
              <div style={{ fontSize: 13, color: SUB, padding: '8px 0' }}>No hay canchas compatibles con {format} para el filtro actual.</div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <button onClick={() => cycleVenue(-1)} disabled={venueIdx <= 0} style={arrowBtn}>{arrow('prev', venueIdx > 0)}</button>
                  <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{resolvedVenue.name}</div>
                    <div style={{ fontSize: 12, color: SUB }}>{resolvedVenue.address} · {resolvedVenue.district}</div>
                  </div>
                  {candidates.length > 1 && <div style={{ fontSize: 11.5, fontWeight: 600, color: SUB, flexShrink: 0 }}>{venueIdx + 1}/{candidates.length}</div>}
                  <button onClick={() => cycleVenue(1)} disabled={venueIdx >= candidates.length - 1} style={arrowBtn}>{arrow('next', venueIdx < candidates.length - 1)}</button>
                </div>

                {/* Selector de HORARIOS válidos — SIEMPRE presente (evita salto de layout). Con 0
                    horarios muestra un badge de estado no clicable en el mismo espacio de los chips. */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT, marginBottom: 8 }}>
                    {slots.length} {slots.length === 1 ? 'horario disponible' : 'horarios disponibles'}
                  </div>
                  <div className="no-sb" style={{ display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 2 }}>
                    {slots.length > 0 ? slots.map((s, i) => (
                      <Chip key={s.startHour} active={i === Math.min(slotIdx, slots.length - 1)} onClick={() => setSlotIdx(i)}>
                        {clockLabel(s.startHour)} – {clockLabel(s.endHour)}
                      </Chip>
                    )) : (
                      <div style={{ flexShrink: 0, height: 34, padding: '0 14px', borderRadius: 999, border: `1px dashed ${HAIR}`, background: SOFT, color: SUB, fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', cursor: 'default' }}>
                        Sin horario disponible
                      </div>
                    )}
                  </div>
                </div>

                {/* Leyenda: 3 estados de celda + "sin cancha" (inexistente) */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 8, fontSize: 11, color: SUB }}>
                  <span style={legItem}><i style={{ ...swatch, background: '#fff', border: `1px solid ${HAIR}` }} />Libre</span>
                  <span style={legItem}><i style={{ ...swatch, background: '#DCE8FF', border: `1px solid ${BLUE}` }} />Recomendado</span>
                  <span style={legItem}><i style={{ ...swatch, background: '#E8E8EC', border: '1px solid #E8E8EC' }} />Ocupado</span>
                  <span style={legItem}><i style={{ ...swatch, ...NON_ELIGIBLE }} />Sin cancha</span>
                </div>

                {/* Grilla: mín. 4 columnas; scroll horizontal si el venue tiene más de 4 canchas.
                    Wrapper relative con carril de 8px a la derecha para el indicador de scroll vertical. */}
                <div style={{ position: 'relative', paddingRight: 8 }}>
                <div className="no-sb" style={{ overflowX: scrollCols ? 'auto' : 'visible', WebkitOverflowScrolling: 'touch' }}>
                  <div style={{ minWidth: scrollCols ? cols * 50 + 52 : undefined }}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6, paddingLeft: 52 }}>
                      {Array.from({ length: cols }, (_, c) => (
                        <div key={c} style={{ flex: scrollCols ? '0 0 44px' : 1, minWidth: 0, textAlign: 'center', fontSize: 11, color: c < courts ? SUB : '#C7C7CC' }}>C{c + 1}</div>
                      ))}
                    </div>
                    {/* Máx. 4 franjas visibles (4×38); el resto con scroll VERTICAL interno (cabecera fija arriba) */}
                    <div ref={gridVRef} onScroll={updateGridThumb} className="no-sb" style={{ maxHeight: 152, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
                    {HOURS.map((hLabel, h) => (
                      <div key={h} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                        <div style={{ width: 46, fontSize: 11, color: SUB, flexShrink: 0 }}>{hLabel}</div>
                        {Array.from({ length: cols }, (_, c) => {
                          // Solo VISUALIZACIÓN (no editable): bloque recomendado / libre no usada / ocupada / sin cancha.
                          const exists = c < courts;
                          const inBlock = block.has(`${c}-${h}`);
                          const free = exists && matrix[c][h];
                          const cell = !exists ? NON_ELIGIBLE
                            : inBlock ? { background: '#DCE8FF', border: `1px solid ${BLUE}` }
                            : free ? { background: '#fff', border: `1px solid ${HAIR}` }
                            : { background: '#E8E8EC', border: '1px solid #E8E8EC' };
                          return (
                            <div key={c} style={{ flex: scrollCols ? '0 0 44px' : 1, minWidth: 0, height: 32, borderRadius: 8, ...cell }} />
                          );
                        })}
                      </div>
                    ))}
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
              </>
            )}

            {/* Personalización de Cancha (equivalente a la de Formato). Al marcar → courtCustom=true,
                Cancha queda RESUELTA, se oculta el aviso de disponibilidad y el CTA queda habilitado.
                El mensaje crece HACIA ABAJO (inline, sin scrollTo/scrollIntoView → no mueve el scroll). */}
            <div style={{ marginTop: 12 }}>
              <CheckboxCard
                checked={courtCustom}
                onToggle={() => setCourtCustom(v => !v)}
                label="No encuentro lo que busco. Quisiera que me contacten para personalizarlo."
                expanded={'Continúa con Ver mi campeonato; nos pondremos en contacto contigo para coordinar todo.'}
              />
            </div>
          </div>
        )}
      </div>

      {/* Aviso de horas-cancha + CTA final, ambos flotantes sobre el contenido (sin holder blanco),
          dentro del contenedor relative → encima del TabBar. */}
      <div style={{ position: 'absolute', left: 16, right: 16, bottom: 12, pointerEvents: 'none' }}>
        {status && (
          <div style={{ padding: '10px 12px', borderRadius: 12, background: status.bg, marginBottom: 10, boxShadow: '0 2px 12px rgba(0,0,0,0.10)' }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: status.titleColor || TEXT }}>{status.title}</div>
            {status.body && <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.4, marginTop: 3 }}>{status.body}</div>}
          </div>
        )}
        <button
          onClick={() => { /* "Ver mi campeonato" pendiente: se implementará desde docs/campeonatos-ux.md */ }}
          disabled={!canContinue}
          className={canContinue ? 'pressable' : undefined}
          style={{
            pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '100%', height: 54,
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
          items={DISTRICTS.map(d => ({ value: d, label: d }))}
          selected={districts} onToggle={(v) => toggleSet(setDistricts, v)} />
      )}
      {venueSheet && (
        <PickSheet title="Elige canchas" onClose={() => setVenueSheet(false)}
          items={compatibleVenues(format, districts, amenities).map(v => ({ value: v.id, label: v.name, sub: `${v.district} · ${v.courts} canchas` }))}
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
