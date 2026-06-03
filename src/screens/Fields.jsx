import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BLUE, TEXT, SUB, HAIR, ORANGE } from '../constants';
import { useAuth } from '../context/AuthContext';
import I from '../icons';
import { DATE_WINDOW, TODAY_KEY, TOMORROW_KEY, ymd } from '../data/games';
import logo from '../assets/logo.webp';
import TabBar from '../components/TabBar';
import fieldPriceBg from '../assets/field price.webp';
import fieldNoAvailable from '../assets/Field no available.webp';
import { supabase } from '../lib/supabase';
import { getVenueCoverUrl } from '../utils/venue';
import { getRentalGames } from '../services/gameService';
import { getMyBookedGameIds } from '../services/reservationService';
import { GameMetaLine } from '../components/GameMetaLine';
import { isGamePast } from '../utils/deriveGameState';

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
  organiza: false,
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
  const [mounted, setMounted] = useState(false);
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

  useEffect(() => { if (open) setMounted(true); }, [open]);

  if (!mounted) return null;

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
      <div onTransitionEnd={() => { if (!open) setMounted(false); }} style={{
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
function Header({ city, onCityTap }) {
  return (
    <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 14px)', paddingBottom: 14, paddingLeft: 20, paddingRight: 20 }}>
      <div style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        <div style={{ color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>Elige tu cancha</div>
        {city && (
          <button onClick={onCityTap} style={{
            position: 'absolute', right: 0, top: '72%', transform: 'translateY(-50%)',
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'transparent', border: 'none',
            padding: '5px 10px 5px 8px', cursor: 'pointer', outline: 'none',
            WebkitTapHighlightColor: 'transparent',
          }}>
            <img src={logo} alt="" style={{ width: 28, height: 'auto', objectFit: 'contain' }} />
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 500, letterSpacing: -0.1 }}>{city}</span>
            <svg width="9" height="6" viewBox="0 0 9 6" fill="none"><path d="M1 1l3.5 3.5L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        )}
      </div>
    </div>
  );
}

function CitySheet({ cities, current, onSelect, onClose }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200 }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 201,
        background: '#fff', borderRadius: '20px 20px 0 0',
        padding: '20px 20px calc(env(safe-area-inset-bottom) + 24px)',
        animation: 'lp-slideup 0.28s cubic-bezier(0.32,0.72,0,1) forwards',
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: '#E0E0E6', margin: '0 auto 16px' }} />
        <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 14 }}>Ciudad</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cities.map(c => (
            <button key={c} onClick={() => onSelect(c)} style={{
              width: '100%', padding: '13px 16px', borderRadius: 12,
              border: `1.5px solid ${c === current ? BLUE : '#E5E5EA'}`,
              background: c === current ? 'rgba(0,100,255,0.06)' : '#fff',
              fontSize: 15, fontWeight: c === current ? 600 : 500,
              color: c === current ? BLUE : TEXT,
              cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              WebkitTapHighlightColor: 'transparent', outline: 'none',
            }}>
              {c}
              {c === current && <svg width="16" height="12" viewBox="0 0 16 12" fill="none"><path d="M1.5 6l4 4L14.5 1.5" stroke={BLUE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </button>
          ))}
        </div>
      </div>
    </>
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
  { id: 'cubierta',        label: 'Techado',        icon: c => I.roof(c)       },
  { id: 'estacionamiento', label: 'Estacionamiento', icon: c => ParkingIcon(c)  },
  { id: 'duchas',          label: 'Duchas',           icon: c => ShowerIcon(c)   },
  { id: 'noDisp',          label: 'Ocultar No disp.',  icon: c => LockIcon(c)     },
];

function FilterRow({ chipActive, onToggleChip, onOpenPanel, panelHasExtra, hasHostedInFeed }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 8px', background: '#fff' }}>
      <FilterButton onClick={onOpenPanel} hasActive={panelHasExtra} />
      <div style={{ width: 1, height: 22, background: HAIR, flexShrink: 0 }} />
      <div className="no-sb" style={{
        flex: 1, minWidth: 0, display: 'flex', gap: 8, overflowX: 'auto',
        scrollBehavior: 'smooth', WebkitOverflowScrolling: 'touch',
      }}>
        {hasHostedInFeed && (
          <Chip key="organiza" label="Organiza"
            icon={c => <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="5" cy="4" r="2.5" stroke={c} strokeWidth="1.4"/><path d="M1 12c0-2.2 1.8-4 4-4" stroke={c} strokeWidth="1.4" strokeLinecap="round"/><circle cx="10" cy="8.5" r="2.5" stroke={c} strokeWidth="1.4"/><path d="M7 13c0-1.7 1.3-3 3-3s3 1.3 3 3" stroke={c} strokeWidth="1.4" strokeLinecap="round"/></svg>}
            active={!!chipActive.organiza} onClick={() => onToggleChip('organiza')}
            last={CHIP_DEFS.length === 0} />
        )}
        {CHIP_DEFS.map((c, i) => (
          <Chip key={c.id} label={c.label} icon={c.icon}
            active={!!chipActive[c.id]} onClick={() => onToggleChip(c.id)}
            last={!hasHostedInFeed && i === CHIP_DEFS.length - 1} labelStyle={c.labelStyle} />
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
      flex: '0 0 auto', width: 50, height: 58, borderRadius: 11,
      background: active ? BLUE : '#fff',
      border: active ? `1px solid ${BLUE}` : `1px solid ${HAIR}`,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 2, padding: 0,
      cursor: disabled ? 'default' : 'pointer',
      outline: 'none', WebkitTapHighlightColor: 'transparent',
      fontFamily: 'inherit', transition: 'background .15s, border-color .15s',
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, lineHeight: 1, textTransform: 'uppercase', letterSpacing: 0.3, color: topColor }}>{top}</div>
      <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.1, marginTop: 3, color: bottomColor }}>{bottom}</div>
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
function FieldThumbnail({ price, reserved, userBooked, isHost, coverPath, coverVersion }) {
  const src         = coverPath ? getVenueCoverUrl(supabase, coverPath, coverVersion) : null;
  const unavailable = reserved && !userBooked && !isHost;
  const bgStyle     = (asset) => ({ position: 'absolute', inset: 0, backgroundImage: `url(${asset})`, backgroundSize: '120%', backgroundPosition: 'center', backgroundRepeat: 'no-repeat', display: 'flex', alignItems: 'center', justifyContent: 'center' });
  return (
    <div style={{ position: 'relative', width: 88, height: 56, borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
      {!unavailable && src && <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${src})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />}

      {isHost ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: ORANGE, color: '#1B1B1F', fontFamily: 'inherit', padding: '4px 10px', borderRadius: 999, display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.2 }}>Organiza</span>
            <span style={{ fontSize: 10, fontWeight: 600, lineHeight: 1.2, opacity: 0.75 }}>Cancha</span>
          </div>
        </div>
      ) : userBooked ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: BLUE, color: '#fff', fontFamily: 'inherit', padding: '4px 10px', borderRadius: 999, display: 'inline-flex', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.2 }}>Reservado</span>
          </div>
        </div>
      ) : unavailable ? (
        <div style={bgStyle(fieldNoAvailable)}>
          <span style={{ color: '#fff', fontWeight: 700, fontFamily: 'inherit', fontSize: 10, letterSpacing: 0.1, textShadow: '0 1px 4px rgba(0,0,0,0.8)', marginTop: -6 }}>No disponible</span>
        </div>
      ) : (
        <div style={bgStyle(fieldPriceBg)}>
          <span style={{ color: '#fff', fontWeight: 800, fontFamily: 'inherit', fontSize: 15, letterSpacing: -0.2, textShadow: '0 1px 6px rgba(0,0,0,0.65)', lineHeight: 1, display: 'block', marginTop: -6 }}>{price}</span>
        </div>
      )}
    </div>
  );
}

function FieldRow({ f, last, onPress, userBooked, isHost, coverPath, coverVersion }) {
  const [pressed, setPressed] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPress}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      style={{
        display: 'flex', alignItems: 'center',
        padding: '14px 16px 14px 10px',
        borderBottom: last ? 'none' : `1px solid ${HAIR}`,
        gap: 0,
        cursor: 'pointer',
        background: pressed ? '#F5F7FA' : '#fff',
        transform: pressed ? 'scale(0.985)' : 'scale(1)',
        boxShadow: pressed ? '0 2px 10px rgba(0,123,255,0.08)' : '0 0 0 rgba(0,0,0,0)',
        transition: 'transform .12s ease, background .15s ease, box-shadow .15s ease',
        WebkitTapHighlightColor: 'transparent', outline: 'none', userSelect: 'none',
      }}>
      <div style={{ width: 52, flexShrink: 0, textAlign: 'center', borderRight: `1px solid ${HAIR}`, marginRight: 6 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: TEXT, lineHeight: 1.1 }}>{f.time}</div>
        <div style={{ fontSize: 12, fontWeight: 500, color: SUB, lineHeight: 1.1, marginTop: 2 }}>{f.ampm}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: TEXT, lineHeight: 1.2, letterSpacing: -0.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.field}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, color: SUB, fontSize: 11, overflow: 'hidden' }}>
          <GameMetaLine format={f.format} durationMin={f.durationMin} parking={f.parking} covered={f.covered} womenOnly={false} />
        </div>
      </div>
      <FieldThumbnail price={isHost ? null : f.price} reserved={f.reserved} userBooked={userBooked} isHost={isHost} coverPath={coverPath} coverVersion={coverVersion} />
      <div style={{ pointerEvents: 'none', marginLeft: 6 }}>{I.chev()}</div>
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
let _rentalCache = [];

export default function Fields() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [flt, setFlt]               = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('fl'))?.flt ?? EMPTY_FLT; } catch { return EMPTY_FLT; }
  });
  const [panelOpen, setPanelOpen]   = useState(false);
  const [userCity, setUserCity] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pichanga_profile'))?.city || ''; } catch { return ''; }
  });
  const [citySheetOpen, setCitySheetOpen] = useState(false);
  const [availableCities, setAvailableCities] = useState([]);
  useEffect(() => {
    supabase.from('venues').select('city').not('city', 'is', null).then(({ data }) => {
      const cities = [...new Set((data ?? []).map(r => r.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
      setAvailableCities(cities);
      if (!userCity && cities.length > 0) setUserCity(cities[0]);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function handleCityChange(c) {
    setUserCity(c);
    setCitySheetOpen(false);
    try {
      const p = JSON.parse(localStorage.getItem('pichanga_profile')) || {};
      localStorage.setItem('pichanga_profile', JSON.stringify({ ...p, city: c }));
    } catch {}
    if (user?.id) supabase.from('users').update({ city: c }).eq('id', user.id);
  }
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

  const [myBookedIds, setMyBookedIds]   = useState(new Set());
  const [rentalGames, setRentalGames]   = useState(() => _rentalCache);
  const [loading, setLoading]           = useState(_rentalCache.length === 0);
  useEffect(() => {
    getRentalGames().then(data => {
      _rentalCache = data;
      setRentalGames(data);
      setLoading(false);
      if (user?.id && data.length) {
        getMyBookedGameIds(data.map(f => f.id)).then(setMyBookedIds);
      }
    });
  }, []); // eslint-disable-line

  const hasHostedInFeed = useMemo(
    () => !!user?.id && rentalGames.some(f => f.hostUserId === user.id),
    [rentalGames, user?.id]
  );

  const chipActive = {
    organiza:        flt.organiza,
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

  const filteredFields = useMemo(() => rentalGames.filter(f => {
    if (isGamePast(f.dateKey, f.time24, f.durationMin)) return false;
    if (flt.organiza && f.hostUserId !== user?.id) return false;
    if (userCity && f.city && f.city !== userCity) return false;
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
  }), [flt, userCity, rentalGames]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const f of filteredFields) {
      if (!map.has(f.dateKey)) map.set(f.dateKey, []);
      map.get(f.dateKey).push(f);
    }
    const toMins = t24 => { const [h, m] = (t24 ?? '00:00').split(':').map(Number); return h * 60 + m; };
    for (const slots of map.values()) slots.sort((a, b) => toMins(a.time24) - toMins(b.time24));
    // Always keep today visible even when all its slots are past
    if (!map.has(TODAY_KEY)) map.set(TODAY_KEY, []);
    return [...map.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
  }, [filteredFields]);

  const eventDates  = useMemo(() => new Set(grouped.map(([k]) => k)), [grouped]);
  const maxEventKey = useMemo(() => rentalGames.reduce((max, f) => f.dateKey > max ? f.dateKey : max, ''), [rentalGames]);

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
      <Header city={userCity} onCityTap={() => setCitySheetOpen(true)} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
        <FilterRow
          chipActive={chipActive}
          onToggleChip={toggleChip}
          onOpenPanel={() => setPanelOpen(true)}
          panelHasExtra={panelHasExtra}
          hasHostedInFeed={hasHostedInFeed}
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
          {loading ? (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: SUB, fontSize: 14 }}>
              Cargando canchas...
            </div>
          ) : filteredFields.length === 0 ? (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: SUB, fontSize: 14 }}>
              No hay campos con esos filtros.
            </div>
          ) : grouped.map(([dateKey, fields], gi) => {
            const isLast = gi === grouped.length - 1;
            return (
              <div key={dateKey} style={isLast ? { minHeight: 'calc(100% - 4px)' } : null}>
                <DateHeader dateKey={dateKey} refEl={(el) => { headerRefs.current[dateKey] = el; }} />
                {dateKey === TODAY_KEY && fields.length === 0 ? (
                  <div style={{ padding: '12px 20px', color: SUB, fontSize: 14 }}>
                    No hay más canchas disponibles para hoy.
                  </div>
                ) : fields.map((f, i) => (
                  <FieldRow key={f.id} f={f} last={i === fields.length - 1 && isLast}
                    userBooked={myBookedIds.has(f.id)}
                    isHost={!!user?.id && !!f.hostUserId && f.hostUserId === user.id}
                    coverPath={f.venueCoverPath ?? null}
                    coverVersion={f.venueCoverVersion ?? null}
                    onPress={() => navigate(`/rental/${f.id}`, { state: { field: f } })} />
                ))}
                {isLast && dateKey === maxEventKey && fields.length > 0 && (
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
      {citySheetOpen && (
        <CitySheet
          cities={availableCities}
          current={userCity}
          onSelect={handleCityChange}
          onClose={() => setCitySheetOpen(false)}
        />
      )}
    </div>
  );
}
