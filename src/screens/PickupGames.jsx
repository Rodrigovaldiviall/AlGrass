import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BLUE, TEXT, SUB, HAIR, RED, GREEN, ORANGE } from '../constants';
import I from '../icons';
import { DATE_WINDOW, TODAY_KEY, TOMORROW_KEY, ymd, seedDemoWaitlist } from '../data/games';
import { getGames } from '../services/gameService';
seedDemoWaitlist();
import TabBar from '../components/TabBar';

const DOW_ES   = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTH_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function chipLabel(d) {
  const k = ymd(d);
  if (k === TODAY_KEY) return { top: 'Hoy', bottom: d.getDate() };
  return { top: DOW_ES[d.getDay()], bottom: d.getDate() };
}

function headerLabel(d) {
  const dayName = DOW_ES[d.getDay()];
  const base = `${dayName} ${d.getDate()} ${MONTH_ES[d.getMonth()]} ${d.getFullYear()}`;
  const k = ymd(d);
  if (k === TODAY_KEY) return `Hoy, ${base}`;
  if (k === TOMORROW_KEY) return `Mañana, ${base}`;
  return base;
}

// ── Filter state ───────────────────────────────────────────────────────────

const EMPTY_FLT = {
  cubierta: false, estacionamiento: false, duchas: false, mujeres: false, master45: false,
  formatos: [], minSpots: null, dias: [], horarios: [],
};

function parseHour(time, ampm) {
  let h = parseInt(time.split(':')[0], 10);
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return h;
}

function formatGameTime(t) {
  if (!t) return { hhmm: '--:--', ampm: '' };
  const [hStr, mStr] = t.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr.padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return { hhmm: `${h}:${m}`, ampm };
}

// ── Filter panel constants ─────────────────────────────────────────────────

const ParkingIcon = (c = TEXT) => (
  <svg width="11" height="13" viewBox="0 0 11 13" fill="none">
    <path d="M3 2v9M3 2h3c1.3 0 2.5 1.1 2.5 2.5S7.3 7 6 7H3" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const ShowerIcon = (c = TEXT) => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <path d="M1.5 4.5h10M3 4.5V3c0-.8.7-1.5 1.5-1.5h4C9.3 1.5 10 2.2 10 3v1.5" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
    <path d="M3 8v.8M6.5 7.5v.8M10 8v.8M4.5 10.5v.8M8 10v.8" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);
const StarIcon = (c = TEXT) => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <path d="M7 1.5l1.5 3.2 3.5.5-2.5 2.4.6 3.5L7 9.4l-3.1 1.7.6-3.5L2 5.2l3.5-.5L7 1.5z" stroke={c} strokeWidth="1.3" strokeLinejoin="round"/>
  </svg>
);

const PANEL_CHECKS = [
  { key: 'cubierta',        label: 'Cubierta',      icon: c => I.roof(c)      },
  { key: 'estacionamiento', label: 'Estacionamiento', icon: c => ParkingIcon(c) },
  { key: 'duchas',          label: 'Duchas',         icon: c => ShowerIcon(c)  },
  { key: 'mujeres',         label: 'Para mujeres',   icon: c => I.female(c)    },
  { key: 'master45',        label: 'Master 45+',     icon: c => StarIcon(c)    },
];
const PANEL_FORMATOS  = ['5v5', '6v6', '7v7', '8v8', '11v11'];
const PANEL_DIAS      = [
  { label: 'Lun', dow: 1 }, { label: 'Mar', dow: 2 }, { label: 'Mié', dow: 3 },
  { label: 'Jue', dow: 4 }, { label: 'Vie', dow: 5 }, { label: 'Sáb', dow: 6 },
  { label: 'Dom', dow: 0 },
];
const PANEL_HORARIOS  = [
  { id: 'manana', label: 'Mañana', sub: '7:00 – 11:30am' },
  { id: 'tarde',  label: 'Tarde',  sub: '12:00 – 5:30pm' },
  { id: 'noche',  label: 'Noche',  sub: '6:00 – 11:00pm' },
];
const ALL_SPOTS = Array.from({ length: 22 }, (_, i) => i + 1);

// ── Filter panel ───────────────────────────────────────────────────────────

function FilterPanel({ open, onClose, flt, setFlt }) {
  const [spotsExpanded, setSpotsExpanded] = useState(false);

  const toggleBool = k    => setFlt(f => ({ ...f, [k]: !f[k] }));
  const toggleArr  = (k, v) => setFlt(f => ({ ...f, [k]: f[k].includes(v) ? f[k].filter(x => x !== v) : [...f[k], v] }));
  const setSpots   = n    => setFlt(f => ({ ...f, minSpots: f.minSpots === n ? null : n }));
  const clearAll   = ()   => setFlt(EMPTY_FLT);

  const hasAny = flt.cubierta || flt.estacionamiento || flt.duchas || flt.mujeres || flt.master45 ||
    flt.formatos.length > 0 || flt.minSpots !== null || flt.dias.length > 0 || flt.horarios.length > 0;

  const visibleSpots = spotsExpanded ? ALL_SPOTS : ALL_SPOTS.slice(0, 6);

  useEffect(() => { if (!open) setSpotsExpanded(false); }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const btnBase = (active) => ({
    height: 32, padding: '0 11px', borderRadius: 9,
    border: `1.5px solid ${active ? BLUE : HAIR}`,
    background: active ? BLUE : '#fff',
    color: active ? '#fff' : TEXT,
    fontSize: 13, fontWeight: active ? 700 : 500,
    cursor: 'pointer', outline: 'none',
    WebkitTapHighlightColor: 'transparent', fontFamily: 'inherit',
    transition: 'background .12s, border-color .12s, color .12s',
  });

  const sectionLabel = (text) => (
    <div style={{ fontSize: 11.5, fontWeight: 700, color: SUB, letterSpacing: 0.4, textTransform: 'uppercase', padding: '9px 0 7px' }}>
      {text}
    </div>
  );

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)',
        transition: 'background .22s ease',
        pointerEvents: open ? 'auto' : 'none',
      }}>
      <div style={{
        background: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22,
        boxShadow: '0 -12px 40px rgba(0,0,0,0.18)',
        transform: open ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform .28s cubic-bezier(0.32,0.72,0,1)',
        maxHeight: '88%', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{ padding: '10px 16px 0', flexShrink: 0 }}>
          <div style={{ width: 42, height: 4, borderRadius: 2, background: '#D1D1D6', margin: '0 auto 12px' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottom: `1px solid ${HAIR}` }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: TEXT, letterSpacing: -0.2 }}>Filtros</span>
            {hasAny && (
              <button onClick={clearAll} style={{ padding: '4px 0', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: BLUE, fontFamily: 'inherit', outline: 'none', WebkitTapHighlightColor: 'transparent' }}>
                Limpiar
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="no-sb" style={{ flex: 1, overflowY: 'auto', padding: '0 14px', overscrollBehavior: 'none' }}>

          {/* Características */}
          <div style={{ borderBottom: `1px solid ${HAIR}`, paddingBottom: 10 }}>
            {sectionLabel('Características')}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {PANEL_CHECKS.map(({ key, label, icon }) => {
                const active = flt[key];
                const ic = active ? '#fff' : TEXT;
                return (
                  <button key={key} onClick={() => toggleBool(key)} style={{
                    height: 34, padding: '0 11px', borderRadius: 999,
                    border: `1px solid ${active ? BLUE : HAIR}`,
                    background: active ? BLUE : '#fff',
                    color: active ? '#fff' : TEXT,
                    fontSize: 13, fontWeight: active ? 600 : 500,
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    cursor: 'pointer', outline: 'none',
                    WebkitTapHighlightColor: 'transparent', fontFamily: 'inherit',
                    transition: 'background .12s, border-color .12s, color .12s',
                  }}>
                    {icon(ic)}
                    <span style={{ letterSpacing: -0.1 }}>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tamaño del equipo */}
          <div style={{ borderBottom: `1px solid ${HAIR}`, paddingBottom: 14 }}>
            {sectionLabel('Tamaño del equipo')}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {PANEL_FORMATOS.map(f => (
                <button key={f} onClick={() => toggleArr('formatos', f)} style={btnBase(flt.formatos.includes(f))}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Cupos disponibles */}
          <div style={{ borderBottom: `1px solid ${HAIR}`, paddingBottom: 14 }}>
            {sectionLabel('Cupos disponibles')}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {visibleSpots.map(n => (
                <button key={n} onClick={() => setSpots(n)} style={{ ...btnBase(flt.minSpots === n), minWidth: 44, padding: '0 12px', fontSize: 13.5 }}>
                  +{n}
                </button>
              ))}
            </div>
            {!spotsExpanded && (
              <button onClick={() => setSpotsExpanded(true)} style={{
                marginTop: 10, padding: '4px 2px', background: 'transparent', border: 'none',
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, color: BLUE,
                display: 'inline-flex', alignItems: 'center', gap: 4,
                outline: 'none', WebkitTapHighlightColor: 'transparent',
              }}>
                Ver más
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 4l4 4 4-4" stroke={BLUE} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>

          {/* Día de la semana */}
          <div style={{ borderBottom: `1px solid ${HAIR}`, paddingBottom: 14 }}>
            {sectionLabel('Día de la semana')}
            <div className="no-sb" style={{ display: 'flex', flexWrap: 'nowrap', gap: 8, overflowX: 'auto' }}>
              {PANEL_DIAS.map(({ label, dow }) => (
                <button key={dow} onClick={() => toggleArr('dias', dow)} style={{ ...btnBase(flt.dias.includes(dow)), flex: '0 0 auto' }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Horario de inicio */}
          <div style={{ paddingBottom: 14 }}>
            {sectionLabel('Horario de inicio')}
            <div style={{ display: 'flex', gap: 8 }}>
              {PANEL_HORARIOS.map(({ id, label, sub }) => {
                const active = flt.horarios.includes(id);
                return (
                  <button key={id} onClick={() => toggleArr('horarios', id)} style={{
                    flex: 1, padding: '10px 6px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    borderRadius: 10, border: `1.5px solid ${active ? BLUE : HAIR}`,
                    background: active ? `${BLUE}12` : '#fff',
                    cursor: 'pointer', outline: 'none',
                    WebkitTapHighlightColor: 'transparent', fontFamily: 'inherit',
                    transition: 'background .12s, border-color .12s',
                  }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: active ? BLUE : TEXT }}>{label}</span>
                    <span style={{ fontSize: 11, color: active ? BLUE : SUB, textAlign: 'center', lineHeight: 1.3 }}>{sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div style={{ padding: '10px 14px', paddingBottom: 'calc(10px + env(safe-area-inset-bottom))', borderTop: `1px solid ${HAIR}`, flexShrink: 0 }}>
          <button onClick={onClose} style={{
            width: '100%', height: 46, borderRadius: 16,
            background: BLUE, color: '#fff', border: 'none', cursor: 'pointer',
            fontSize: 15, fontWeight: 700, letterSpacing: -0.1, fontFamily: 'inherit',
            outline: 'none', WebkitTapHighlightColor: 'transparent',
          }}>
            Aplicar filtros
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Header ─────────────────────────────────────────────────────────────────

function Header() {
  return (
    <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 14px)', paddingBottom: 14, paddingLeft: 20, paddingRight: 20 }}>
      <div style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>Elije tu partido</div>
      </div>
    </div>
  );
}

// ── Filter chips ───────────────────────────────────────────────────────────

function Chip({ label, icon, active, onClick, last }) {
  const fg = active ? '#fff' : TEXT;
  return (
    <button onClick={onClick} style={{
      flex: '0 0 auto', height: 34, padding: '0 11px', borderRadius: 999,
      border: active ? `1px solid ${BLUE}` : `1px solid ${HAIR}`,
      background: active ? BLUE : '#fff',
      display: 'inline-flex', alignItems: 'center', gap: 5,
      color: fg, fontSize: 13, fontWeight: active ? 600 : 500, whiteSpace: 'nowrap',
      marginRight: last ? 16 : 0,
      cursor: 'pointer', outline: 'none',
      transition: 'background .15s, border-color .15s, color .15s',
      WebkitTapHighlightColor: 'transparent', fontFamily: 'inherit',
    }}>
      {icon && icon(fg)}
      <span style={{ letterSpacing: -0.1 }}>{label}</span>
    </button>
  );
}

function FilterButton({ onClick, hasActive }) {
  return (
    <button onClick={onClick} style={{
      flex: '0 0 auto', width: 38, height: 38, borderRadius: 999,
      border: `1px solid ${hasActive ? BLUE : HAIR}`,
      background: hasActive ? BLUE : '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', outline: 'none', WebkitTapHighlightColor: 'transparent', padding: 0,
    }}>
      {I.filtersBig(hasActive ? '#fff' : TEXT)}
    </button>
  );
}

const CHIP_DEFS = [
  { id: 'spots',           label: '+1 cupos',        icon: c => I.joinIcon(c)   },
  { id: 'cubierta',        label: 'Cubierto',         icon: c => I.roof(c)       },
  { id: 'mujeres',         label: 'Para mujeres',     icon: c => I.female(c)     },
  { id: 'estacionamiento', label: 'Estacionamiento',  icon: c => ParkingIcon(c)  },
  { id: 'duchas',          label: 'Duchas',           icon: c => ShowerIcon(c)   },
];

function FilterRow({ chipActive, onToggleChip, onOpenPanel, panelHasExtra }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 8px', background: '#fff' }}>
      <FilterButton onClick={onOpenPanel} hasActive={panelHasExtra} />
      <div style={{ width: 1, height: 22, background: HAIR, flexShrink: 0 }} />
      <div className="no-sb" style={{
        flex: 1, minWidth: 0, display: 'flex', gap: 8, overflowX: 'auto',
        scrollBehavior: 'smooth', WebkitOverflowScrolling: 'touch',
      }}>
        {CHIP_DEFS.map((c, i) => (
          <Chip key={c.id} label={c.label} icon={c.icon}
            active={!!chipActive[c.id]} onClick={() => onToggleChip(c.id)}
            last={i === CHIP_DEFS.length - 1} />
        ))}
      </div>
    </div>
  );
}

// ── Date strip ─────────────────────────────────────────────────────────────

function DateCell({ top, bottom, active, isToday, onClick, refEl, disabled }) {
  const bg = active ? BLUE : '#fff';
  const border = active ? `1px solid ${BLUE}` : `1px solid ${HAIR}`;
  const topColor = disabled ? '#D1D1D6' : (active ? '#fff' : (isToday ? BLUE : SUB));
  const bottomColor = disabled ? '#D1D1D6' : (active ? '#fff' : TEXT);
  return (
    <button ref={refEl} onClick={disabled ? undefined : onClick} style={{
      flex: '0 0 auto', width: 50, height: 58, borderRadius: 11,
      background: bg, border, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 2, padding: 0,
      cursor: disabled ? 'default' : 'pointer',
      outline: 'none', WebkitTapHighlightColor: 'transparent',
      fontFamily: 'inherit', transition: 'background .15s, border-color .15s',
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: topColor, lineHeight: 1, textTransform: 'uppercase', letterSpacing: 0.3 }}>{top}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: bottomColor, lineHeight: 1.1, marginTop: 3 }}>{bottom}</div>
    </button>
  );
}

function DateStrip({ dates, selectedKey, onSelect, scrollerRef, cellRefs, eventDates }) {
  return (
    <div ref={scrollerRef} className="no-sb" style={{
      display: 'flex', gap: 8, overflowX: 'auto',
      padding: '8px 16px 12px',
      scrollBehavior: 'smooth', WebkitOverflowScrolling: 'touch', background: '#fff',
    }}>
      {dates.map((d) => {
        const k = ymd(d);
        const lab = chipLabel(d);
        return (
          <DateCell
            key={k}
            refEl={(el) => { cellRefs.current[k] = el; }}
            top={lab.top} bottom={lab.bottom}
            isToday={k === TODAY_KEY}
            active={selectedKey === k}
            disabled={!eventDates.has(k)}
            onClick={() => onSelect(k)}
          />
        );
      })}
    </div>
  );
}

// ── List rows ──────────────────────────────────────────────────────────────

function StatusPill({ openSpots, booked, inWaitlist, guestInfo, canceledCount }) {
  if (canceledCount != null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <div style={{ height: 22, padding: '0 8px', borderRadius: 999, background: '#FFF0F0', border: `1.2px solid ${RED}40`, color: RED, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
          Cancelado
        </div>
        <div style={{ fontSize: 10.5, color: SUB, whiteSpace: 'nowrap' }}>
          {canceledCount} {canceledCount === 1 ? 'invitado activo' : 'invitados activos'}
        </div>
      </div>
    );
  }
  if (guestInfo) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <div style={{ height: 22, padding: '0 8px', borderRadius: 999, background: '#EDF5FF', border: `1.2px solid ${BLUE}40`, color: BLUE, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
          Invitado
        </div>
        <div style={{ fontSize: 10.5, color: SUB, whiteSpace: 'nowrap' }}>
          {guestInfo.activeGuestCount > 0
            ? `${guestInfo.activeGuestCount} ${guestInfo.activeGuestCount === 1 ? 'invitado activo' : 'invitados activos'}`
            : guestInfo.paidBy ? `por ${guestInfo.paidBy}` : null}
        </div>
      </div>
    );
  }
  if (booked) {
    return (
      <div style={{
        height: 22, padding: '0 8px', borderRadius: 999,
        background: BLUE, color: '#fff',
        fontSize: 'var(--gm-pill-fs, 11px)', fontWeight: 600,
        display: 'inline-flex', alignItems: 'center',
      }}>Inscrito</div>
    );
  }
  if (inWaitlist) {
    const capPill = openSpots <= 0 ? (
      <div style={{ height: 22, padding: '0 8px', borderRadius: 999, border: `1.2px solid ${RED}`, color: RED, fontSize: 'var(--gm-pill-fs, 11px)', fontWeight: 500, display: 'inline-flex', alignItems: 'center' }}>Completo</div>
    ) : (
      <div style={{ height: 22, width: 64, borderRadius: 999, background: '#F0FAF3', border: `1.2px solid ${GREEN}`, color: GREEN, fontSize: 'var(--gm-pill-fs, 11px)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{openSpots} {openSpots === 1 ? 'cupo' : 'cupos'}</div>
    );
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
        {capPill}
        <div style={{ fontSize: 11, fontWeight: 700, color: BLUE, letterSpacing: 0.2, alignSelf: 'flex-end', marginRight: 10 }}>En lista</div>
      </div>
    );
  }
  if (openSpots <= 0) {
    return (
      <div style={{
        height: 22, padding: '0 8px', borderRadius: 999,
        border: `1.2px solid ${RED}`, color: RED,
        fontSize: 'var(--gm-pill-fs, 11px)', fontWeight: 500,
        display: 'inline-flex', alignItems: 'center',
      }}>Completo</div>
    );
  }
  return (
    <div style={{
      height: 22, width: 64, borderRadius: 999,
      background: '#F0FAF3', border: `1.2px solid ${GREEN}`, color: GREEN,
      fontSize: 'var(--gm-pill-fs, 11px)', fontWeight: 600,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>{openSpots} {openSpots === 1 ? 'cupo' : 'cupos'}</div>
  );
}

function GameRow({ g, last, onOpen, booked, inWaitlist, guestInfo, canceledCount }) {
  const [pressed, setPressed] = useState(false);
  return (
    <div role="button" tabIndex={0}
      onClick={onOpen}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      style={{
        display: 'flex', alignItems: 'center',
        padding: '14px 16px 14px 10px',
        borderBottom: last ? 'none' : `1px solid ${HAIR}`,
        gap: 0, cursor: 'pointer',
        background: pressed ? '#F5F7FA' : '#fff',
        transform: pressed ? 'scale(0.985)' : 'scale(1)',
        boxShadow: pressed ? '0 2px 10px rgba(0,123,255,0.08)' : '0 0 0 rgba(0,0,0,0)',
        transition: 'transform .12s ease, background .15s ease, box-shadow .15s ease',
        WebkitTapHighlightColor: 'transparent', outline: 'none', userSelect: 'none',
      }}>
      <div style={{ width: 52, flexShrink: 0, textAlign: 'center', borderRight: `1px solid ${HAIR}`, marginRight: 6 }}>
        <div style={{ fontSize: 'var(--gm-time, 15px)', fontWeight: 600, color: TEXT, lineHeight: 1.1 }}>{formatGameTime(g.time).hhmm}</div>
        <div style={{ fontSize: 'var(--gm-ampm, 12px)', fontWeight: 500, color: SUB, lineHeight: 1.1, marginTop: 2 }}>{formatGameTime(g.time).ampm}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div style={{ fontSize: 'var(--gm-title, 16px)', fontWeight: 600, color: TEXT, lineHeight: 1.2, letterSpacing: -0.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.field}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, color: SUB, fontSize: 11, flexWrap: 'nowrap', overflow: 'hidden' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0, fontSize: 13, fontWeight: 500 }}>
            {I.twoPeople(SUB)}<span>{g.format}</span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0, overflow: 'hidden' }}>
            {g.womenOnly ? (
              <>
                {I.female(SUB)}<span style={{ whiteSpace: 'nowrap' }}>Para mujeres</span>
                {g.parking && <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 3 }}>{ParkingIcon(SUB)}</span>}
                {g.covered && <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 3 }}>{I.roof(SUB)}</span>}
              </>
            ) : g.parking ? (
              <>
                {ParkingIcon(SUB)}<span style={{ whiteSpace: 'nowrap' }}>Estacionamiento</span>
                {g.covered && <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 3 }}>{I.roof(SUB)}</span>}
              </>
            ) : g.covered ? (
              <>{I.roof(SUB)}<span style={{ whiteSpace: 'nowrap' }}>Cubierta</span></>
            ) : null}
          </span>
          {g.price !== undefined && (
            <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, fontSize: 13, fontWeight: 600, color: TEXT }}>
              S/.{g.price}
            </span>
          )}
        </div>
      </div>
      <StatusPill openSpots={g.openSpots} booked={booked} inWaitlist={inWaitlist} guestInfo={guestInfo} canceledCount={canceledCount} />
      <div style={{ pointerEvents: 'none', marginLeft: 6 }}>{I.chev()}</div>
    </div>
  );
}

function DateHeader({ dateKey, refEl }) {
  const d = new Date(dateKey + 'T00:00:00');
  return (
    <div data-date-header={dateKey} ref={refEl} style={{
      padding: '14px 16px 8px', color: SUB, fontSize: 'var(--gm-dhr, 13.5px)', fontWeight: 500,
      background: '#fff',
    }}>
      {headerLabel(d)}
    </div>
  );
}

// ── City onboarding sheet (shown once after welcome flow) ───────────────────

const _WELCOME_KEY  = 'pichanga_welcome_seen';
const _PROFILE_KEY  = 'pichanga_profile';
const _ONBOARD_CITIES = ['Arequipa', 'Lima', 'Cusco'];

function CityOnboardSheet({ onSelect }) {
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200 }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 201,
        background: '#fff', borderRadius: '20px 20px 0 0',
        padding: '20px 20px calc(env(safe-area-inset-bottom) + 28px)',
        animation: 'lp-slideup 0.32s cubic-bezier(0.32,0.72,0,1) forwards',
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: '#E0E0E6', margin: '0 auto 20px' }} />
        <div style={{ fontSize: 17, fontWeight: 700, color: TEXT, marginBottom: 4 }}>
          Elige tu ciudad
        </div>
        <div style={{ fontSize: 13, color: SUB, marginBottom: 18, lineHeight: 1.4 }}>
          Podrás cambiarla en cualquier momento desde Configuración.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {_ONBOARD_CITIES.map(c => (
            <button
              key={c}
              onClick={() => onSelect(c)}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 13,
                border: '1.5px solid #E5E5EA', background: '#fff',
                fontSize: 15, fontWeight: 500, color: TEXT,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                WebkitTapHighlightColor: 'transparent', outline: 'none',
              }}>
              {c}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────

export default function PickupGames() {
  const navigate = useNavigate();
  const location = useLocation();

  const [showCitySheet, setShowCitySheet] = useState(!!location.state?.showCitySheet);
  const [games, setGames] = useState([]);
  useEffect(() => { getGames().then(setGames); }, []);

  const [flt, setFlt]               = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('pg'))?.flt ?? EMPTY_FLT; } catch { return EMPTY_FLT; }
  });
  const [panelOpen, setPanelOpen]   = useState(false);
  const userCity = useState(() => {
    try { return JSON.parse(localStorage.getItem('pichanga_profile'))?.city || 'Arequipa'; } catch { return 'Arequipa'; }
  })[0];
  const [selectedKey, setSelectedKey] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('pg'))?.sel ?? TODAY_KEY; } catch { return TODAY_KEY; }
  });

  // Read scroll to restore at render time (before any effect can corrupt sessionStorage).
  // useRef persists across React StrictMode's fake unmount/remount, so the second
  // mount cycle reads this ref instead of the already-corrupted sessionStorage.
  const initScrollRef = useRef(undefined);
  if (initScrollRef.current === undefined) {
    try { initScrollRef.current = JSON.parse(sessionStorage.getItem('pg'))?.scroll ?? null; } catch { initScrollRef.current = null; }
  }

  const listRef            = useRef(null);
  const listScrollPosRef   = useRef(0);
  const headerRefs         = useRef({});
  const stripScrollerRef   = useRef(null);
  const stripCellRefs      = useRef({});
  const programmaticScrollRef = useRef(false);

  const bookedGameIds = useMemo(() => {
    try {
      const res = JSON.parse(localStorage.getItem('pichanga_reservations')) || [];
      return new Set(res.filter(r => r.type !== 'campo').map(r => r.id));
    } catch { return new Set(); }
  }, []);

  const waitlistGameIds = useMemo(() => {
    try {
      const wl = JSON.parse(localStorage.getItem('pichanga_waitlist')) || {};
      return new Set(Object.keys(wl));
    } catch { return new Set(); }
  }, []);

  const guestGamesMap = useMemo(() => {
    try {
      const rosters = JSON.parse(localStorage.getItem('pichanga_game_rosters') || '{}');
      const profile  = JSON.parse(localStorage.getItem('pichanga_profile') || '{}');
      const myCode   = (profile.userCode || '').trim().toUpperCase();
      if (!myCode) return new Map();
      const sc = JSON.parse(localStorage.getItem('pichanga_self_cancelled_guests') || '{}');
      const map = new Map();
      for (const [gameId, roster] of Object.entries(rosters)) {
        if (sc[gameId]) continue;
        if (!roster?.players?.length) continue;
        const myEntry = roster.players.find(p => (p.code || '').trim().toUpperCase() === myCode);
        if (!myEntry) continue;
        const subGuests = roster.players.filter(p => (p.addedByCode || '').trim().toUpperCase() === myCode);
        map.set(gameId, { paidBy: roster.payerName || 'Usuario', payerCode: roster.payerCode || null, guestId: myEntry.id, activeGuestCount: subGuests.length });
      }
      return map;
    } catch { return new Map(); }
  }, []);

  const canceledWithGuestsMap = useMemo(() => {
    try {
      const rosters = JSON.parse(localStorage.getItem('pichanga_game_rosters') || '{}');
      const profile  = JSON.parse(localStorage.getItem('pichanga_profile') || '{}');
      const myCode   = (profile.userCode || '').trim().toUpperCase();
      if (!myCode) return new Map();
      const map = new Map();
      for (const [gameId, roster] of Object.entries(rosters)) {
        if (!roster?.players?.length) continue;
        const myEntry     = roster.players.find(p => (p.code || '').trim().toUpperCase() === myCode);
        const mySubGuests = roster.players.filter(p => (p.addedByCode || '').trim().toUpperCase() === myCode);
        if (!myEntry && mySubGuests.length > 0 && roster.guestSubBreakdowns?.[myCode]) {
          map.set(gameId, { count: mySubGuests.length, isGuestCanceled: true, guestSubBreakdown: roster.guestSubBreakdowns[myCode] });
        } else if (roster.titularCanceled && (roster.titularCode || '').trim().toUpperCase() === myCode) {
          map.set(gameId, { count: roster.players.length, isGuestCanceled: false, guestSubBreakdown: null });
        }
      }
      return map;
    } catch { return new Map(); }
  }, []);

  // Chip active state mirrors flt
  const chipActive = {
    spots:           flt.minSpots !== null,
    cubierta:        flt.cubierta,
    mujeres:         flt.mujeres,
    estacionamiento: flt.estacionamiento,
    duchas:          flt.duchas,
  };

  // FilterButton badge: panel-exclusive filters (not covered by chips)
  const panelHasExtra = flt.master45 ||
    flt.formatos.length > 0 || flt.dias.length > 0 || flt.horarios.length > 0 ||
    (flt.minSpots !== null && flt.minSpots !== 1);

  function toggleChip(id) {
    if (id === 'spots') setFlt(f => ({ ...f, minSpots: f.minSpots !== null ? null : 1 }));
    else setFlt(f => ({ ...f, [id]: !f[id] }));
  }

  const filteredGames = useMemo(() => {
    return games.filter(g => {
      if (g.city && g.city !== userCity) return false;
      if (flt.cubierta        && !g.covered)   return false;
      if (flt.estacionamiento && !g.parking)   return false;
      if (flt.duchas          && !g.showers)   return false;
      if (flt.mujeres         && !g.womenOnly) return false;
      if (flt.master45        && !g.master45)  return false;
      if (flt.minSpots !== null && g.openSpots < flt.minSpots) return false;
      if (flt.formatos.length && !flt.formatos.includes(g.format)) return false;
      if (flt.dias.length) {
        const dow = new Date(g.dateKey + 'T00:00:00').getDay();
        if (!flt.dias.includes(dow)) return false;
      }
      if (flt.horarios.length) {
        const h = parseHour(g.time, g.ampm);
        const ok =
          (flt.horarios.includes('manana') && h >= 7  && h < 12) ||
          (flt.horarios.includes('tarde')  && h >= 12 && h < 18) ||
          (flt.horarios.includes('noche')  && h >= 18 && h <= 23);
        if (!ok) return false;
      }
      return true;
    });
  }, [flt, userCity, games]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const g of filteredGames) {
      if (!map.has(g.dateKey)) map.set(g.dateKey, []);
      map.get(g.dateKey).push(g);
    }
    return [...map.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
  }, [filteredGames]);

  const eventDates  = useMemo(() => new Set(grouped.map(([k]) => k)), [grouped]);
  const maxEventKey = useMemo(() => games.reduce((max, g) => g.dateKey > max ? g.dateKey : max, ''), [games]);

  useEffect(() => {
    if (grouped.length === 0 || eventDates.has(selectedKey)) return;
    const keys = grouped.map(([k]) => k);
    const next = keys.find(k => k >= selectedKey) ?? keys[0];
    setSelectedKey(next);
    centerChip(next);
  }, [grouped]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const s = stripScrollerRef.current;
    const t = stripCellRefs.current[selectedKey];
    if (s && t) {
      const relLeft = t.getBoundingClientRect().left - s.getBoundingClientRect().left + s.scrollLeft;
      s.scrollTo({ left: Math.max(0, relLeft - s.clientWidth / 2 + t.clientWidth / 2), behavior: 'instant' });
    }
  }, []); // eslint-disable-line

  const fltRef    = useRef(flt);
  useEffect(() => { fltRef.current = flt; }, [flt]);
  const selKeyRef = useRef(selectedKey);
  useEffect(() => { selKeyRef.current = selectedKey; }, [selectedKey]);

  useEffect(() => {
    const el = listRef.current;
    if (!el || initScrollRef.current == null) return;
    const target = Number(initScrollRef.current);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        programmaticScrollRef.current = true;
        el.scrollTo({ top: target, behavior: 'instant' });
        setTimeout(() => { programmaticScrollRef.current = false; }, 50);
      });
    });
  }, []); // eslint-disable-line

  useEffect(() => {
    return () => {
      try {
        sessionStorage.setItem('pg', JSON.stringify({
          flt: fltRef.current,
          sel: selKeyRef.current,
          scroll: listScrollPosRef.current,
        }));
      } catch {}
    };
  }, []); // eslint-disable-line

  useEffect(() => {
    function onTabScrollTop(e) {
      if (e.detail === 'partidos') listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
    window.addEventListener('tab-scroll-top', onTabScrollTop);
    return () => window.removeEventListener('tab-scroll-top', onTabScrollTop);
  }, []);

  const centerChip = (key) => {
    const s = stripScrollerRef.current;
    const t = stripCellRefs.current[key];
    if (!s || !t) return;
    const relLeft = t.getBoundingClientRect().left - s.getBoundingClientRect().left + s.scrollLeft;
    s.scrollTo({ left: Math.max(0, relLeft - s.clientWidth / 2 + t.clientWidth / 2), behavior: 'smooth' });
  };

  const handleSelectDate = (key) => {
    setSelectedKey(key);
    centerChip(key);
    const list = listRef.current;
    const target = headerRefs.current[key];
    if (list && target) {
      programmaticScrollRef.current = true;
      const offset = target.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
      list.scrollTo({ top: offset - 4, behavior: 'smooth' });
      setTimeout(() => { programmaticScrollRef.current = false; }, 600);
    } else if (list) {
      list.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const onListScroll = () => {
    const list = listRef.current;
    if (!list) return;
    listScrollPosRef.current = list.scrollTop;
    if (programmaticScrollRef.current) return;
    const listTop = list.getBoundingClientRect().top;
    let currentKey = grouped.length ? grouped[0][0] : null;
    for (const [key] of grouped) {
      const el = headerRefs.current[key];
      if (!el) continue;
      const offset = el.getBoundingClientRect().top - listTop;
      if (offset <= 1) currentKey = key;
      else break;
    }
    if (currentKey && currentKey !== selectedKey) {
      setSelectedKey(currentKey);
      centerChip(currentKey);
    }
  };

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: BLUE, overflow: 'hidden' }}>
      <Header />
      <FilterRow
        chipActive={chipActive}
        onToggleChip={toggleChip}
        onOpenPanel={() => setPanelOpen(true)}
        panelHasExtra={panelHasExtra}
      />
      <DateStrip
        dates={DATE_WINDOW}
        selectedKey={selectedKey}
        onSelect={handleSelectDate}
        scrollerRef={stripScrollerRef}
        cellRefs={stripCellRefs}
        eventDates={eventDates}
      />
      <div ref={listRef} onScroll={onListScroll} className="no-sb"
        style={{ flex: 1, overflowY: 'auto', paddingBottom: 8, scrollBehavior: 'smooth', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', background: '#fff' }}>
        {grouped.length === 0 ? (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: SUB, fontSize: 14 }}>
            No hay partidos con esos filtros.
          </div>
        ) : grouped.map(([dateKey, games], gi) => {
          const isLast = gi === grouped.length - 1;
          return (
            <div key={dateKey} style={isLast ? { minHeight: 'calc(100% - 4px)' } : null}>
              <DateHeader dateKey={dateKey} refEl={(el) => { headerRefs.current[dateKey] = el; }} />
              {games.map((g, i) => (
                <GameRow key={g.id} g={g}
                  last={i === games.length - 1 && isLast}
                  booked={bookedGameIds.has(g.id)}
                  inWaitlist={waitlistGameIds.has(g.id)}
                  guestInfo={guestGamesMap.get(g.id)}
                  canceledCount={canceledWithGuestsMap.has(g.id) ? canceledWithGuestsMap.get(g.id).count : undefined}
                  onOpen={() => {
                    const gi  = guestGamesMap.get(g.id);
                    const ci  = canceledWithGuestsMap.get(g.id);
                    if (gi) {
                      navigate(`/game/${g.id}`, { state: { game: { ...g, paidBy: gi.paidBy, paidByCode: gi.payerCode, guestId: gi.guestId }, infoMode: true, backPath: '/games' } });
                    } else if (ci?.isGuestCanceled) {
                      navigate(`/game/${g.id}`, { state: { guestCanceledView: true, infoMode: false, backPath: '/games', game: { ...g, guestSubBreakdown: ci.guestSubBreakdown, guestCanceledView: true, paymentBreakdown: null } } });
                    } else {
                      navigate(`/game/${g.id}`, { state: { game: g, backPath: '/games' } });
                    }
                  }}
                />
              ))}
              {isLast && dateKey === maxEventKey && (
                <div style={{
                  padding: '28px 16px 20px', textAlign: 'center',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: SUB, fontSize: 13, fontWeight: 500 }}>
                    <div style={{ width: 24, height: 1, background: HAIR }} />
                    <span>Alcanzaste el final</span>
                    <div style={{ width: 24, height: 1, background: HAIR }} />
                  </div>
                  <button
                    onClick={() => {
                      const list = listRef.current;
                      if (!list) return;
                      programmaticScrollRef.current = true;
                      list.scrollTo({ top: 0, behavior: 'smooth' });
                      setSelectedKey(grouped[0][0]);
                      centerChip(grouped[0][0]);
                      setTimeout(() => { programmaticScrollRef.current = false; }, 700);
                    }}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      height: 38, padding: '0 16px', borderRadius: 999,
                      border: `1px solid ${BLUE}`, background: '#fff',
                      color: BLUE, fontSize: 14, fontWeight: 600,
                      cursor: 'pointer', outline: 'none',
                      WebkitTapHighlightColor: 'transparent', fontFamily: 'inherit',
                    }}>
                    {I.arrowUp(BLUE)}
                    Volver arriba
                  </button>
                </div>
              )}
            </div>
          );
        })}
        <div style={{ height: 8 }} />
      </div>
      <TabBar activeTab="partidos" />
      <FilterPanel open={panelOpen} onClose={() => setPanelOpen(false)} flt={flt} setFlt={setFlt} />
      {showCitySheet && (
        <CityOnboardSheet onSelect={city => {
          try {
            const p = JSON.parse(localStorage.getItem(_PROFILE_KEY)) || {};
            localStorage.setItem(_PROFILE_KEY, JSON.stringify({ ...p, city }));
          } catch {}
          localStorage.setItem(_WELCOME_KEY, '1');
          setShowCitySheet(false);
          navigate('/games', { replace: true });
        }} />
      )}
    </div>
  );
}
