import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BLUE, TEXT, SUB, HAIR } from '../constants';
import I from '../icons';
import { DATE_WINDOW, TODAY_KEY, TOMORROW_KEY, ymd } from '../data/games';
import { FIELDS } from '../data/fields';
import TabBar from '../components/TabBar';
import fieldImg from '../assets/cancha.jpg';
import { supabase } from '../lib/supabase';
import { getVenueCoverUrl } from '../utils/venue';

const DOW_ES   = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTH_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function chipLabel(d) {
  if (ymd(d) === TODAY_KEY) return { top: 'Hoy', bottom: d.getDate() };
  return { top: DOW_ES[d.getDay()], bottom: d.getDate() };
}

function headerLabel(d) {
  const base = `${DOW_ES[d.getDay()]} ${d.getDate()} ${MONTH_ES[d.getMonth()]} ${d.getFullYear()}`;
  const k = ymd(d);
  if (k === TODAY_KEY)    return `Hoy, ${base}`;
  if (k === TOMORROW_KEY) return `Mañana, ${base}`;
  return base;
}

// ── Filter state ───────────────────────────────────────────────────────────

const EMPTY_FLT = {
  cubierta: false, estacionamiento: false, duchas: false, noDisp: true,
  formatos: [], dias: [], horarios: [],
};

function parseHour(time, ampm) {
  let h = parseInt(time.split(':')[0], 10);
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return h;
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
const LockIcon = (c = TEXT) => (
  <svg width="11" height="13" viewBox="0 0 11 13" fill="none">
    <rect x="1.5" y="5.5" width="8" height="6.5" rx="1.5" stroke={c} strokeWidth="1.3"/>
    <path d="M3.5 5.5V3.5a2 2 0 0 1 4 0V5.5" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);

const PANEL_CHECKS = [
  { key: 'cubierta',        label: 'Cubierta',        icon: c => I.roof(c)       },
  { key: 'estacionamiento', label: 'Estacionamiento', icon: c => ParkingIcon(c)  },
  { key: 'duchas',          label: 'Duchas',           icon: c => ShowerIcon(c)   },
  { key: 'noDisp',          label: 'Ocultar No disp.', icon: c => LockIcon(c)     },
];
const PANEL_FORMATOS = ['5v5', '6v6', '7v7', '8v8', '11v11'];
const PANEL_DIAS = [
  { label: 'Lun', dow: 1 }, { label: 'Mar', dow: 2 }, { label: 'Mié', dow: 3 },
  { label: 'Jue', dow: 4 }, { label: 'Vie', dow: 5 }, { label: 'Sáb', dow: 6 },
  { label: 'Dom', dow: 0 },
];
const PANEL_HORARIOS = [
  { id: 'manana', label: 'Mañana', sub: '7:00 – 11:30am' },
  { id: 'tarde',  label: 'Tarde',  sub: '12:00 – 5:30pm' },
  { id: 'noche',  label: 'Noche',  sub: '6:00 – 11:00pm' },
];

// ── Filter panel ───────────────────────────────────────────────────────────

function FilterPanel({ open, onClose, flt, setFlt }) {
  const toggleBool = k      => setFlt(f => ({ ...f, [k]: !f[k] }));
  const toggleArr  = (k, v) => setFlt(f => ({ ...f, [k]: f[k].includes(v) ? f[k].filter(x => x !== v) : [...f[k], v] }));
  const clearAll   = ()     => setFlt(EMPTY_FLT);

  const hasAny = flt.cubierta || flt.estacionamiento || flt.duchas || !flt.noDisp ||
    flt.formatos.length > 0 || flt.dias.length > 0 || flt.horarios.length > 0;

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
                const active = key === 'noDisp' ? !flt[key] : flt[key];
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

// ── Header
function Header() {
  return (
    <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 14px)', paddingBottom: 14, paddingLeft: 20, paddingRight: 20 }}>
      <div style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>Elige tu cancha</div>
      </div>
    </div>
  );
}

// ── Filter chips ───────────────────────────────────────────────────────────

function Chip({ label, icon, active, onClick, last, labelStyle }) {
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
      <span style={{ letterSpacing: -0.1, ...labelStyle }}>{label}</span>
    </button>
  );
}

function FilterButton({ onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: '0 0 auto', width: 38, height: 38, borderRadius: 999,
      border: `1px solid ${HAIR}`,
      background: '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', outline: 'none', WebkitTapHighlightColor: 'transparent', padding: 0,
    }}>
      {I.filtersBig(TEXT)}
    </button>
  );
}

const CHIP_DEFS = [
  { id: 'cubierta',        label: 'Cubierto',        icon: c => I.roof(c)       },
  { id: 'estacionamiento', label: 'Estacionamiento', icon: c => ParkingIcon(c)  },
  { id: 'duchas',          label: 'Duchas',           icon: c => ShowerIcon(c)   },
  { id: 'noDisp',          label: 'Ocultar No disp.',  icon: c => LockIcon(c)     },
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
            last={i === CHIP_DEFS.length - 1} labelStyle={c.labelStyle} />
        ))}
      </div>
    </div>
  );
}

// ── Date strip
function DateCell({ top, bottom, active, isToday, onClick, refEl, disabled }) {
  const topColor    = disabled ? '#D1D1D6' : (active ? '#fff' : (isToday ? BLUE : SUB));
  const bottomColor = disabled ? '#D1D1D6' : (active ? '#fff' : TEXT);
  return (
    <button ref={refEl} onClick={disabled ? undefined : onClick} style={{
      flex: '0 0 auto', width: 56, height: 64, borderRadius: 12,
      background: active ? BLUE : '#fff',
      border: active ? `1px solid ${BLUE}` : `1px solid ${HAIR}`,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 2, padding: 0,
      cursor: disabled ? 'default' : 'pointer',
      outline: 'none', WebkitTapHighlightColor: 'transparent',
      fontFamily: 'inherit', transition: 'background .15s, border-color .15s',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, lineHeight: 1, textTransform: 'uppercase', letterSpacing: 0.3, color: topColor }}>{top}</div>
      <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1, marginTop: 4, color: bottomColor }}>{bottom}</div>
    </button>
  );
}

function DateStrip({ dates, selectedKey, onSelect, scrollerRef, cellRefs, eventDates }) {
  return (
    <div ref={scrollerRef} className="no-sb" style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '8px 16px 12px', scrollBehavior: 'smooth' }}>
      {dates.map((d) => {
        const k   = ymd(d);
        const lab = chipLabel(d);
        return (
          <DateCell key={k}
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

// ── Field row
function FieldThumbnail({ price, reserved, userBooked, coverPath, coverVersion }) {
  const src     = (coverPath ? getVenueCoverUrl(supabase, coverPath, coverVersion) : null) || fieldImg;
  const label   = reserved ? 'NO DISP.' : userBooked ? 'RESERVADO' : null;
  const overlay = reserved ? 'rgba(0,0,0,0.54)' : userBooked ? 'rgba(22,101,52,0.68)' : 'linear-gradient(160deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.66) 100%)';
  return (
    <div style={{ position: 'relative', width: 76, height: 56, borderRadius: 10, overflow: 'hidden', flexShrink: 0, opacity: reserved ? 0.55 : 1 }}>
      <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      <div style={{
        position: 'absolute', inset: 0, background: overlay,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{
          color: '#fff', fontWeight: 800, fontFamily: 'inherit',
          fontSize:      label ? 9.5 : 15,
          letterSpacing: label ? 0.4 : -0.2,
          textShadow: '0 1px 4px rgba(0,0,0,0.55)',
        }}>
          {label ?? price}
        </span>
      </div>
    </div>
  );
}

function FieldRow({ f, last, onPress, userBooked, coverPath, coverVersion }) {
  const [pressed, setPressed] = useState(false);
  const interactive = !f.reserved;
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onPress : undefined}
      onPointerDown={() => interactive && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      style={{
        display: 'flex', alignItems: 'center',
        padding: '14px 16px',
        borderBottom: last ? 'none' : `1px solid ${HAIR}`,
        gap: 12,
        cursor: interactive ? 'pointer' : 'default',
        background: pressed ? '#F5F7FA' : '#fff',
        transform: pressed ? 'scale(0.985)' : 'scale(1)',
        boxShadow: pressed ? '0 2px 10px rgba(0,123,255,0.08)' : '0 0 0 rgba(0,0,0,0)',
        transition: 'transform .12s ease, background .15s ease, box-shadow .15s ease',
        WebkitTapHighlightColor: 'transparent', outline: 'none', userSelect: 'none',
      }}>
      <div style={{ width: 52, flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: TEXT, lineHeight: 1.1 }}>{f.time}</div>
        <div style={{ fontSize: 12, fontWeight: 500, color: SUB,  lineHeight: 1.1, marginTop: 2 }}>{f.ampm}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: TEXT, lineHeight: 1.2, letterSpacing: -0.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.field}</div>
        {f.reserved ? (
          <div style={{ marginTop: 4, fontSize: 12.5, color: SUB, fontWeight: 500 }}>No disponible</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, color: SUB, fontSize: 12.5, overflow: 'hidden' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              {I.twoPeople(SUB)}<span>{f.format}</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
              {I.pin(SUB)}<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.address}</span>
            </span>
          </div>
        )}
      </div>
      <FieldThumbnail price={f.price} reserved={f.reserved} userBooked={userBooked} coverPath={coverPath} coverVersion={coverVersion} />
      <div style={{ width: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', pointerEvents: 'none' }}>
        {interactive && I.chev()}
      </div>
    </div>
  );
}

function DateHeader({ dateKey, refEl }) {
  const [_y, _mo, _d] = dateKey.split('-').map(Number);
  const d = new Date(_y, _mo - 1, _d);
  return (
    <div data-date-header={dateKey} ref={refEl} style={{ padding: '14px 16px 8px', color: SUB, fontSize: 13.5, fontWeight: 500, background: '#fff' }}>
      {headerLabel(d)}
    </div>
  );
}

// ── Screen
export default function Fields() {
  const navigate = useNavigate();
  const [flt, setFlt]               = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('fl'))?.flt ?? EMPTY_FLT; } catch { return EMPTY_FLT; }
  });
  const [panelOpen, setPanelOpen]   = useState(false);
  const userCity = useState(() => {
    try { return JSON.parse(localStorage.getItem('pichanga_profile'))?.city || 'Arequipa'; } catch { return 'Arequipa'; }
  })[0];
  const [selectedKey, setSelectedKey] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('fl'))?.sel ?? TODAY_KEY; } catch { return TODAY_KEY; }
  });

  // Read scroll to restore at render time — survives StrictMode fake unmount/remount.
  const initScrollRef = useRef(undefined);
  if (initScrollRef.current === undefined) {
    try { initScrollRef.current = JSON.parse(sessionStorage.getItem('fl'))?.scroll ?? null; } catch { initScrollRef.current = null; }
  }

  const listRef            = useRef(null);
  const listScrollPosRef   = useRef(0);
  const headerRefs         = useRef({});
  const stripScrollerRef   = useRef(null);
  const stripCellRefs      = useRef({});
  const programmaticScroll = useRef(false);

  const bookedFieldIds = useMemo(() => {
    try {
      const res = JSON.parse(localStorage.getItem('pichanga_reservations')) || [];
      return new Set(res.filter(r => r.type === 'campo').map(r => r.id));
    } catch { return new Set(); }
  }, []);

  const [venueCoverMap, setVenueCoverMap] = useState({});
  useEffect(() => {
    if (!supabase) return;
    supabase.from('venues').select('name, cover_image_path, cover_updated_at')
      .then(({ data }) => {
        if (!data) return;
        const m = {};
        data.forEach(v => {
          if (v.cover_image_path) m[v.name] = {
            path:    v.cover_image_path,
            version: v.cover_updated_at ? new Date(v.cover_updated_at).getTime() : null,
          };
        });
        setVenueCoverMap(m);
      });
  }, []);

  const chipActive = {
    cubierta:        flt.cubierta,
    estacionamiento: flt.estacionamiento,
    duchas:          flt.duchas,
    noDisp:          !flt.noDisp,
  };

  const panelHasExtra = flt.cubierta || flt.estacionamiento || flt.duchas || !flt.noDisp ||
    flt.formatos.length > 0 || flt.dias.length > 0 || flt.horarios.length > 0;

  function toggleChip(id) {
    setFlt(f => ({ ...f, [id]: !f[id] }));
  }

  const filteredFields = useMemo(() => FIELDS.filter(f => {
    if (f.city && f.city !== userCity) return false;
    if (flt.cubierta        && !f.covered)  return false;
    if (flt.estacionamiento && !f.parking)  return false;
    if (flt.duchas          && !f.showers)  return false;
    if (!flt.noDisp         && f.reserved)  return false;
    if (flt.formatos.length && !flt.formatos.includes(f.format)) return false;
    if (flt.dias.length) {
      const [_y, _mo, _d] = f.dateKey.split('-').map(Number);
      const dow = new Date(_y, _mo - 1, _d).getDay();
      if (!flt.dias.includes(dow)) return false;
    }
    if (flt.horarios.length) {
      const h = parseHour(f.time, f.ampm);
      const ok =
        (flt.horarios.includes('manana') && h >= 7  && h < 12) ||
        (flt.horarios.includes('tarde')  && h >= 12 && h < 18) ||
        (flt.horarios.includes('noche')  && h >= 18 && h <= 23);
      if (!ok) return false;
    }
    return true;
  }), [flt, userCity]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const f of filteredFields) {
      if (!map.has(f.dateKey)) map.set(f.dateKey, []);
      map.get(f.dateKey).push(f);
    }
    return [...map.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
  }, [filteredFields]);

  const eventDates  = useMemo(() => new Set(grouped.map(([k]) => k)), [grouped]);
  const maxEventKey = useMemo(() => FIELDS.reduce((max, f) => f.dateKey > max ? f.dateKey : max, ''), []);

  // Auto-advance selected date when filters remove events from the current day
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
        programmaticScroll.current = true;
        el.scrollTo({ top: target, behavior: 'instant' });
        setTimeout(() => { programmaticScroll.current = false; }, 50);
      });
    });
  }, []); // eslint-disable-line

  useEffect(() => {
    return () => {
      try {
        sessionStorage.setItem('fl', JSON.stringify({
          flt: fltRef.current,
          sel: selKeyRef.current,
          scroll: listScrollPosRef.current,
        }));
      } catch {}
    };
  }, []); // eslint-disable-line

  useEffect(() => {
    function onTabScrollTop(e) {
      if (e.detail === 'campos') listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
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
    const list   = listRef.current;
    const target = headerRefs.current[key];
    if (list && target) {
      programmaticScroll.current = true;
      list.scrollTo({ top: target.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - 4, behavior: 'smooth' });
      setTimeout(() => { programmaticScroll.current = false; }, 600);
    } else if (list) {
      list.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const onListScroll = () => {
    const list = listRef.current;
    if (!list) return;
    listScrollPosRef.current = list.scrollTop;
    if (programmaticScroll.current) return;
    const listTop = list.getBoundingClientRect().top;
    let currentKey = grouped.length ? grouped[0][0] : null;
    for (const [key] of grouped) {
      const el = headerRefs.current[key];
      if (!el) continue;
      if (el.getBoundingClientRect().top - listTop <= 1) currentKey = key;
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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
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
          style={{ flex: 1, overflowY: 'auto', paddingBottom: 8, overscrollBehavior: 'contain' }}>
          {grouped.length === 0 ? (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: SUB, fontSize: 14 }}>
              No hay campos con esos filtros.
            </div>
          ) : grouped.map(([dateKey, fields], gi) => {
            const isLast = gi === grouped.length - 1;
            return (
              <div key={dateKey} style={isLast ? { minHeight: 'calc(100% - 4px)' } : null}>
                <DateHeader dateKey={dateKey} refEl={(el) => { headerRefs.current[dateKey] = el; }} />
                {fields.map((f, i) => (
                  <FieldRow key={f.id} f={f} last={i === fields.length - 1 && isLast}
                    userBooked={bookedFieldIds.has(f.id)}
                    coverPath={venueCoverMap[f.field]?.path ?? null}
                    coverVersion={venueCoverMap[f.field]?.version ?? null}
                    onPress={() => navigate(`/field/${f.id}`, { state: { field: { ...f, venueCoverPath: venueCoverMap[f.field]?.path ?? null, venueCoverVersion: venueCoverMap[f.field]?.version ?? null } } })} />
                ))}
                {isLast && dateKey === maxEventKey && (
                  <div style={{ padding: '28px 16px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: SUB, fontSize: 13, fontWeight: 500 }}>
                      <div style={{ width: 24, height: 1, background: HAIR }} />
                      <span>Alcanzaste el final</span>
                      <div style={{ width: 24, height: 1, background: HAIR }} />
                    </div>
                    <button
                      onClick={() => {
                        const list = listRef.current;
                        if (!list) return;
                        programmaticScroll.current = true;
                        list.scrollTo({ top: 0, behavior: 'smooth' });
                        setSelectedKey(grouped[0][0]);
                        centerChip(grouped[0][0]);
                        setTimeout(() => { programmaticScroll.current = false; }, 700);
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
        <TabBar />
      </div>
      <FilterPanel open={panelOpen} onClose={() => setPanelOpen(false)} flt={flt} setFlt={setFlt} />
    </div>
  );
}
