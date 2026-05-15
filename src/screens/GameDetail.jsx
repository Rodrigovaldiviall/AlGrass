import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { BLUE, TEXT, SUB, HAIR, ORANGE, SOFT, GREEN, DANGER, RED, WHATSAPP_NUMBER } from '../constants';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faWhatsapp } from '@fortawesome/free-brands-svg-icons';
import { faCommentSms } from '@fortawesome/free-solid-svg-icons';
import I from '../icons';
import { shareOrCopy } from '../utils/share';
import { GAMES, FIELD_INFO, GAME_DEFAULTS } from '../data/games';
import { getActivePlayers, getRoster, removePlayers, setTitularCanceled as markTitularCanceled, deleteRoster, getGameById } from '../services/gameService';
import TabBar from '../components/TabBar';
import RatingBlock from '../components/RatingBlock';
import { useAuth } from '../context/AuthContext';
import { cancelGamePlayer, cancelGuestPlayers } from '../services/reservationService';
import { supabase } from '../lib/supabase';
import { deriveGameState } from '../utils/deriveGameState';

const WAITLIST_KEY   = 'pichanga_waitlist';
const ATTENDANCE_KEY = 'pichanga_attendance';
const ROSTER_KEY_GD  = 'pichanga_game_rosters';

const _MON_MAP_DET = { 'Ene': 0, 'Feb': 1, 'Mar': 2, 'Abr': 3, 'May': 4, 'Jun': 5, 'Jul': 6, 'Ago': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dic': 11 };

const SEED_ATTENDANCE = {
  'seed-past-1': {
    'Carlos Pérez':  { status: 'a_tiempo', minsLate: 0  },
    'Luis Ramos':    { status: 'tarde',    minsLate: 8  },
    'Ana Torres':    { status: 'a_tiempo', minsLate: 0  },
    'Diego Morales': { status: 'tarde',    minsLate: 12 },
    'Pablo Suárez':  { status: 'a_tiempo', minsLate: 0  },
    'Marco Vela':    { status: 'a_tiempo', minsLate: 1  },
  },
};

function parseGameStart(g) {
  const d = (g.date || '').split(' ');
  if (d.length < 4) return null;
  const day = parseInt(d[1]), mon = _MON_MAP_DET[d[2]], yr = parseInt(d[3]);
  if (isNaN(day) || mon == null || isNaN(yr)) return null;
  const t = (g.time || '').split(' ');
  const [hStr = '0', mStr = '0'] = (t[0] || '').split(':');
  let h = parseInt(hStr) || 0, m = parseInt(mStr) || 0;
  if (t[1] === 'PM' && h !== 12) h += 12;
  if (t[1] === 'AM' && h === 12) h = 0;
  return new Date(yr, mon, day, h, m);
}

const _DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const _MON = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function formatDateEs(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
  if (!m) return 'Sáb 25 Abr 2026';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${_DOW[d.getDay()]} ${d.getDate()} ${_MON[d.getMonth()]} ${d.getFullYear()}`;
}

function totalSpotsFor(format) {
  const m = /^(\d+)v\1$/.exec(format || '');
  return m ? Number(m[1]) * 2 : 14;
}

function buildGame(sel) {
  if (!sel) {
    return {
      field: 'Xaloc', openSpots: 2, totalSpots: 14,
      date: 'Sáb 25 Abr 2026', time: '7:30 PM',
      duration: GAME_DEFAULTS.duration, fieldNumber: GAME_DEFAULTS.fieldNumber,
      address: FIELD_INFO['Xaloc'].address,
      chips: [
        { kind: 'format', label: '8v8' }, { kind: 'covered', label: 'Cubierto' },
        { kind: 'filmed', label: 'Filmado' }, { kind: 'women', label: 'Para mujeres' },
      ],
      description: GAME_DEFAULTS.description,
      recommendations: GAME_DEFAULTS.recommendations,
      organizer: GAME_DEFAULTS.organizer,
      players: GAME_DEFAULTS.players,
      price: 'S/. 8.49',
      priceNumber: 8.49,
      currency: 'S/.',
      format: '8v8',
    };
  }
  const fieldInfo = FIELD_INFO[sel.field] || { address: [sel.field, 'Dirección no disponible'] };
  const address = sel.address ? [sel.address] : fieldInfo.address;
  const total = totalSpotsFor(sel.format);
  const chips = [
    { kind: 'format',   label: sel.format || '7v7' },
    sel.covered   && { kind: 'covered',  label: 'Cubierto' },
    sel.filmed    && { kind: 'filmed',   label: 'Filmado' },
    sel.womenOnly && { kind: 'women',    label: 'Solo mujeres' },
    sel.master45  && { kind: 'master45', label: 'Master 45+' },
    sel.parking   && { kind: 'parking',  label: 'Estacionamiento' },
    sel.showers   && { kind: 'showers',  label: 'Duchas' },
  ].filter(Boolean);
  const confirmed = Math.max(0, total - (sel.openSpots ?? 0));
  const players = GAME_DEFAULTS.players.slice(0, Math.min(confirmed, GAME_DEFAULTS.players.length));
  return {
    id: sel.id,
    field: sel.field,
    openSpots: sel.openSpots ?? 0,
    totalSpots: total,
    date: sel.date || formatDateEs(sel.dateKey),
    time: `${sel.time || '7:00'} ${sel.ampm || 'PM'}`,
    duration: GAME_DEFAULTS.duration,
    fieldNumber: sel.fieldName || GAME_DEFAULTS.fieldNumber,
    address,
    chips,
    description: GAME_DEFAULTS.description,
    recommendations: GAME_DEFAULTS.recommendations,
    organizer: GAME_DEFAULTS.organizer,
    players,
    price: typeof sel.price === 'number'
      ? `S/. ${sel.price.toFixed(2)}`
      : sel.price || 'S/. 0.00',
    priceNumber: typeof sel.price === 'number'
      ? sel.price
      : parseFloat((sel.price || '').replace(/[^\d.]/g, '').replace(/^\./, '')) || 0,
    currency: 'S/.',
    format: sel.format || '7v7',
    paymentBreakdown:  sel.paymentBreakdown  ?? null,
    paidBy:            sel.paidBy            ?? null,
    paidByCode:        sel.paidByCode        ?? null,
    guestSubBreakdown: sel.guestSubBreakdown ?? null,
  };
}

// ── Header
function Header({ field, openSpots, onBack, onShare, infoMode, showShare }) {
  const cupoLabel = openSpots === 0 ? 'Lleno' : `${openSpots} ${openSpots === 1 ? 'cupo' : 'cupos'}`;
  return (
    <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 14px)', paddingBottom: 14, paddingLeft: 16, paddingRight: 16, position: 'relative' }}>
      <div style={{ height: 44, display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
        <button
          onClick={onBack}
          style={{ width: 36, height: 36, marginLeft: -8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, WebkitTapHighlightColor: 'transparent' }}>
          {I.back('#fff')}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{field}</div>
        </div>
        {!infoMode && (
          <div style={{
            height: 26, padding: '0 10px', borderRadius: 999,
            background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.45)',
            color: '#fff', fontSize: 12, fontWeight: 600,
            display: 'inline-flex', alignItems: 'center',
          }}>{cupoLabel}</div>
        )}
        {showShare && (
          <button
            onClick={onShare}
            style={{ width: 30, height: 26, marginRight: 10, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent' }}>
            {I.share('#fff')}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Hero placeholder
function HeroImage() {
  return (
    <div style={{
      width: '100%', aspectRatio: '16/6.3', background: SOFT,
      backgroundImage: 'repeating-linear-gradient(135deg, #E8E8EC 0 14px, #F2F2F4 14px 28px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: SUB, fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 12, letterSpacing: 0.4,
    }}>FOTO DEL CAMPO</div>
  );
}

// ── Info row
function InfoRow({ icon, primary, secondary, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
      <div style={{
        width: 42, height: 42, borderRadius: 12, background: SOFT,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--gd-ip, 15px)', fontWeight: 600, color: TEXT, lineHeight: 1.3 }}>{primary}</div>
        {secondary && (
          <div style={{ fontSize: 'var(--gd-is, 13px)', color: SUB, marginTop: 2, lineHeight: 1.35 }}>{secondary}</div>
        )}
      </div>
      {action}
    </div>
  );
}

function WAChatButton() {
  const [open, setOpen] = useState(false);
  const ph = WHATSAPP_NUMBER;
  const displayPhone = `+${ph.slice(0, 2)} ${ph.slice(2, 5)} ${ph.slice(5, 8)} ${ph.slice(8)}`;
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none', padding: '2px 0' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ color: SUB }}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span style={{ fontSize: 11, color: SUB, fontWeight: 700, textAlign: 'center', lineHeight: 1.25 }}>
          Comunícate con<br />el organizador
        </span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
          <div style={{ position: 'absolute', right: 0, bottom: 'calc(100% + 8px)', zIndex: 100, background: '#fff', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.15)', border: `1px solid ${HAIR}`, overflow: 'hidden', minWidth: 252 }}>
            <a href={`https://wa.me/${ph}`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}
              style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', textDecoration: 'none', borderBottom: `1px solid ${HAIR}` }}>
              <FontAwesomeIcon icon={faWhatsapp} style={{ fontSize: 22, color: '#25D366', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, lineHeight: 1.2 }}>WhatsApp</div>
                <div style={{ fontSize: 12.5, color: SUB, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayPhone}</div>
              </div>
            </a>
            <a href={`sms:+${ph}`} onClick={() => setOpen(false)}
              style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', textDecoration: 'none' }}>
              <FontAwesomeIcon icon={faCommentSms} style={{ fontSize: 22, color: BLUE, flexShrink: 0 }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>SMS</span>
            </a>
          </div>
        </>
      )}
    </div>
  );
}

// ── Chip
const _ParkingIcon = (c = TEXT) => (
  <svg width="11" height="13" viewBox="0 0 11 13" fill="none">
    <path d="M3 2v9M3 2h3c1.3 0 2.5 1.1 2.5 2.5S7.3 7 6 7H3" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const _ShowerIcon = (c = TEXT) => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <path d="M1.5 4.5h10M3 4.5V3c0-.8.7-1.5 1.5-1.5h4C9.3 1.5 10 2.2 10 3v1.5" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
    <path d="M3 8v.8M6.5 7.5v.8M10 8v.8M4.5 10.5v.8M8 10v.8" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);
const _StarIcon = (c = TEXT) => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <path d="M7 1.5l1.5 3.2 3.5.5-2.5 2.4.6 3.5L7 9.4l-3.1 1.7.6-3.5L2 5.2l3.5-.5L7 1.5z" stroke={c} strokeWidth="1.3" strokeLinejoin="round"/>
  </svg>
);
const CHIP_ICON = {
  format:   I.twoPeople,
  filmed:   I.camera,
  covered:  I.roof,
  women:    I.female,
  spots:    I.plus,
  master45: _StarIcon,
  parking:  _ParkingIcon,
  showers:  _ShowerIcon,
};
function Chip({ kind, label }) {
  const icon = CHIP_ICON[kind];
  return (
    <div style={{
      flex: '0 0 auto', height: 28, padding: '0 10px', borderRadius: 999,
      border: `1px solid ${HAIR}`, background: '#fff',
      display: 'inline-flex', alignItems: 'center', gap: 5,
      color: TEXT, fontSize: 'var(--gd-is, 12px)', fontWeight: 500, whiteSpace: 'nowrap',
    }}>
      {icon ? icon(TEXT) : null}
      <span>{label}</span>
    </div>
  );
}

// ── Section
function Section({ title, children }) {
  return (
    <div style={{ padding: '18px 16px', borderTop: `1px solid ${HAIR}` }}>
      <div style={{ fontSize: 'var(--gd-st, 16px)', fontWeight: 700, color: TEXT, letterSpacing: -0.1, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function PaymentDetail({ price, breakdown, paidBy, userName, titularCanceled = false, activeGuestCount = null, guestSubBreakdown = null, alwaysExpanded = false }) {
  const [open, setOpen] = useState(false);
  if (!paidBy && (!price || price === 'S/. 0.00')) return null;
  const fmt = n => `S/. ${Number(n || 0).toFixed(2)}`;
  const row = (label, value, bold, accent) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: bold ? 700 : 500, color: accent ? GREEN : TEXT }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
  const bdPromoDisc = breakdown?.promoDiscount ?? 0;
  const activeCount = activeGuestCount !== null ? activeGuestCount : (breakdown?.guestsCount ?? 0);
  const activeGuestsTotal = activeCount * (breakdown?.unitPrice || 0);
  const computedTotal = titularCanceled
    ? activeGuestsTotal
    : Math.max(0, (breakdown?.unitPrice || 0) - bdPromoDisc + activeGuestsTotal);
  const content = (
    <div style={{ padding: '12px 14px 14px', background: '#fff', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {paidBy ? (
        <>
          {(() => {
            const slotPrice = breakdown?.unitPrice || parseFloat((price || '').replace(/[^\d.]/g, '').replace(/^\./, '')) || 0;
            const subUnitPrice = guestSubBreakdown?.unitPrice || slotPrice;
            const ownGuestsTotal = activeCount * subUnitPrice;
            return (<>
              {row(`${userName || 'Usuario'} (Titular)`, fmt(slotPrice))}
              {row(`Pagado por ${paidBy}`, `−${fmt(slotPrice)}`, false, true)}
              {activeCount > 0 && row(`Invitados (${activeCount})`, fmt(ownGuestsTotal))}
              <div style={{ borderTop: `1px solid ${HAIR}`, paddingTop: 8 }}>
                {row('Total', fmt(ownGuestsTotal), true)}
              </div>
            </>);
          })()}
        </>
      ) : breakdown ? (
        <>
          {titularCanceled ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 500, color: SUB }}>
              <span>Titular</span>
              <span style={{ color: DANGER, fontWeight: 600, fontSize: 12 }}>Cancelado</span>
            </div>
          ) : (
            row('Titular', fmt(breakdown.unitPrice))
          )}
          {!titularCanceled && bdPromoDisc > 0 && row('Descuento', `−${fmt(bdPromoDisc)}`, false, true)}
          {activeCount > 0 && row(`Invitados (${activeCount})`, fmt(activeGuestsTotal))}
          <div style={{ borderTop: `1px solid ${HAIR}`, paddingTop: 8 }}>
            {row('Total', fmt(computedTotal), true)}
          </div>
        </>
      ) : (
        row('Total', price, true)
      )}
    </div>
  );
  if (alwaysExpanded) return content;
  return (
    <div style={{ margin: '12px 16px 12px', borderRadius: 14, border: `1.5px solid ${BLUE}`, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ width: '100%', height: 38, padding: '0 14px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: BLUE }}>Ver detalles del pago</span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
          <path d="M4 6l4 4 4-4" stroke={BLUE} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && <div style={{ borderTop: `1px solid ${HAIR}` }}>{content}</div>}
    </div>
  );
}

// ── PaymentDetailSheet
function PaymentDetailSheet({ price, breakdown, paidBy, userName, titularCanceled, activeGuestCount, guestSubBreakdown, onClose }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOpen(true), 20); return () => clearTimeout(t); }, []);
  function dismiss() { setOpen(false); setTimeout(onClose, 220); }
  return (
    <div className="sheet-overlay" onClick={dismiss} style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)', transition: 'background .22s ease' }}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ background: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, width: '100%', padding: '20px 16px calc(24px + env(safe-area-inset-bottom))', boxShadow: '0 -8px 32px rgba(0,0,0,0.12)', transform: open ? 'translateY(0)' : 'translateY(100%)', transition: 'transform .28s cubic-bezier(0.32,0.72,0,1)' }}>
        <div style={{ width: 42, height: 4, borderRadius: 2, background: '#D1D1D6', margin: '0 auto 20px' }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginBottom: 16, textAlign: 'center', letterSpacing: -0.2 }}>Detalles del pago</div>
        <PaymentDetail price={price} breakdown={breakdown} paidBy={paidBy} userName={userName} titularCanceled={titularCanceled} activeGuestCount={activeGuestCount} guestSubBreakdown={guestSubBreakdown} alwaysExpanded />
      </div>
    </div>
  );
}

// ── Avatar
function Avatar({ name, size = 36 }) {
  const initials = (name || '').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const hue = [...(name || '·')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `hsl(${hue} 35% 92%)`, color: `hsl(${hue} 45% 35%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size >= 44 ? 14 : 12, fontWeight: 700, flexShrink: 0,
    }}>{initials || '·'}</div>
  );
}

// ── Waitlist
function WaitlistRow({ inList, onToggle }) {
  return (
    <div style={{ padding: '10px 10px 0', background: '#fff', borderTop: `1px solid ${HAIR}` }}>
      <div style={{
        padding: '8px 10px 8px 12px',
        background: '#FFF8EC', border: '1px solid #F4E4C2', borderRadius: 14,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ flex: 1, fontSize: 13, color: TEXT, lineHeight: 1.35, fontWeight: 500 }}>
          {inList ? 'Te notificaremos si se libera una reserva' : 'Avísame si se libera una reserva'}
        </div>
        <button
          onClick={onToggle}
          style={{
            flexShrink: 0, height: 34, padding: '0 14px', borderRadius: 999,
            border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
            background: inList ? '#D7F0DD' : ORANGE,
            color: inList ? '#1F6B36' : '#1B1B1F',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            transition: 'background .15s ease, color .15s ease',
            WebkitTapHighlightColor: 'transparent', outline: 'none',
          }}>
          {inList && (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6.5l2.5 2.5L9.8 3.5" stroke="#1F6B36" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
          {inList ? 'En lista' : 'Lista de espera'}
        </button>
      </div>
    </div>
  );
}

// ── Attendance badge
function AttendanceBadge({ record, canMark, onMark }) {
  if (record) {
    if (record.status === 'a_tiempo') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6.5l2.5 2.5 5.5-5.5" stroke={GREEN} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 700, color: GREEN, whiteSpace: 'nowrap' }}>A tiempo</span>
        </div>
      );
    }
    return (
      <span style={{ fontSize: 11, fontWeight: 700, color: ORANGE, whiteSpace: 'nowrap', flexShrink: 0 }}>
        {record.minsLate} min tarde
      </span>
    );
  }
  if (!canMark) return null;
  return (
    <button
      onClick={e => { e.stopPropagation(); onMark(); }}
      style={{
        flexShrink: 0, height: 28, padding: '0 12px', borderRadius: 999,
        border: 'none', background: BLUE,
        fontSize: 12, fontWeight: 700, color: '#fff',
        cursor: 'pointer', outline: 'none', whiteSpace: 'nowrap',
        WebkitTapHighlightColor: 'transparent', fontFamily: 'inherit',
        boxShadow: '0 2px 8px rgba(0,123,255,0.35)',
      }}>
      Asistencia
    </button>
  );
}

// ── CTA
function CTA({ price, disabled, onPress, hideTopBorder }) {
  const [pressed, setPressed] = useState(false);
  return (
    <div style={{ padding: '12px 16px 12px', background: '#fff', borderTop: hideTopBorder ? 'none' : `1px solid ${HAIR}` }}>
      <button
        onClick={disabled ? undefined : onPress}
        disabled={!!disabled}
        onPointerDown={() => !disabled && setPressed(true)}
        onPointerUp={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
        style={{
          width: '100%', height: 54, borderRadius: 18,
          background: disabled ? '#E8E8EC' : ORANGE,
          color: disabled ? '#9A9AA0' : '#1B1B1F',
          border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 16, fontWeight: 700, letterSpacing: -0.1, fontFamily: 'inherit',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          boxShadow: disabled ? 'none' : (pressed ? '0 1px 4px rgba(0,0,0,0.08)' : '0 6px 18px rgba(245,165,36,0.40)'),
          transform: !disabled && pressed ? 'scale(0.985)' : 'scale(1)',
          transition: 'transform .12s ease, box-shadow .15s ease, background .15s ease, color .15s ease',
          WebkitTapHighlightColor: 'transparent', outline: 'none',
        }}>
        {!disabled && I.joinIcon('#1B1B1F')}
        <span>Únete al partido por {price}</span>
      </button>
    </div>
  );
}

// ── Player modal helpers
function normalizeForCode(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z]/g, '').toLowerCase();
}
function deterministicCode(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  const first = normalizeForCode(parts[0] || '');
  const last  = normalizeForCode(parts.slice(1).join(''));
  return '@' + first.slice(0, 6) + last.slice(0, 4);
}

function PlayerModal({ player, onClose }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOpen(true), 20); return () => clearTimeout(t); }, []);
  function dismiss() { setOpen(false); setTimeout(onClose, 220); }

  const displayName = (player.name || '').split(' ').slice(0, 2).join(' ');
  const code        = deterministicCode(player.name);
  const hue         = [...(player.name || '·')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const gamesPlayed = [...(player.name || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 35 + 8;
  const initials    = (player.name || '').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || '·';

  return (
    <div
      className="sheet-overlay"
      onClick={dismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: open ? 'rgba(0,0,0,0.50)' : 'rgba(0,0,0,0)',
        transition: 'background .22s ease',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 24px',
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 24, padding: '20px 20px 24px',
          width: '100%', maxWidth: 320,
          boxShadow: '0 12px 48px rgba(0,0,0,0.20)',
          transform: open ? 'scale(1) translateY(0)' : 'scale(0.90) translateY(20px)',
          opacity: open ? 1 : 0,
          transition: 'transform .24s cubic-bezier(0.32,0.72,0,1), opacity .2s ease',
          position: 'relative',
        }}>
        <button
          onClick={dismiss}
          style={{
            position: 'absolute', top: 14, right: 14,
            width: 28, height: 28, borderRadius: '50%', background: SOFT,
            border: 'none', cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            WebkitTapHighlightColor: 'transparent', outline: 'none',
          }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1 1l8 8M9 1L1 9" stroke={TEXT} strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>

        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 84 }}>
            <div style={{
              width: 68, height: 68, borderRadius: '50%',
              background: `hsl(${hue} 35% 92%)`, color: `hsl(${hue} 45% 35%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, fontWeight: 700, marginBottom: 8, flexShrink: 0,
            }}>{initials}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: TEXT, textAlign: 'center', lineHeight: 1.2, letterSpacing: -0.2 }}>
              {displayName}
            </div>
            <div style={{ fontSize: 12, color: BLUE, fontWeight: 600, marginTop: 3 }}>{code}</div>
            <div style={{ fontSize: 11, color: SUB, marginTop: 2 }}>Lima, Perú</div>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', paddingTop: 4 }}>
            {[
              { value: gamesPlayed, label: 'Partidos jugados' },
              { value: null, label: 'Posición' },
            ].map(({ value, label }, i) => {
              const stat = (v, l) => (
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.3, lineHeight: 1, color: v != null ? TEXT : '#C7C7CC' }}>
                    {v != null ? String(v) : '—'}
                  </div>
                  <div style={{ fontSize: 11, color: SUB, marginTop: 2 }}>{l}</div>
                </div>
              );
              if (i === 0) return (
                <div key={i} style={{ paddingBottom: 10 }}>
                  {stat(value, label)}
                </div>
              );
              return (
                <div key={i}>
                  <div style={{ height: 1, background: HAIR, marginBottom: 10 }} />
                  <div style={{ display: 'flex', gap: 0, paddingBottom: 10 }}>
                    <div style={{ flex: 1 }}>{stat('Hombre', 'Sexo')}</div>
                    <div style={{ flex: 1 }}>{stat(null, 'Edad')}</div>
                  </div>
                  <div style={{ height: 1, background: HAIR, marginBottom: 10 }} />
                  {stat(value, label)}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ModifySheet
function ModifySheet({ canAddGuests, openSpots, onClose, onAddGuests, onCancel, onPaymentDetail }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOpen(true), 20); return () => clearTimeout(t); }, []);
  function dismiss() { setOpen(false); setTimeout(onClose, 220); }
  const rowStyle = { width: '100%', padding: '14px 16px', borderRadius: 14, background: '#fff', border: `1px solid ${HAIR}`, display: 'flex', alignItems: 'center', marginBottom: 10, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', WebkitTapHighlightColor: 'transparent', outline: 'none' };
  const chevron = (color = SUB) => (
    <svg width="8" height="14" viewBox="0 0 8 14" fill="none">
      <path d="M1 1l6 6-6 6" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
  return (
    <div className="sheet-overlay" onClick={dismiss} style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)', transition: 'background .22s ease' }}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ background: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, width: '100%', padding: '20px 16px calc(20px + env(safe-area-inset-bottom))', boxShadow: '0 -8px 32px rgba(0,0,0,0.12)', transform: open ? 'translateY(0)' : 'translateY(100%)', transition: 'transform .28s cubic-bezier(0.32,0.72,0,1)' }}>
        <div style={{ width: 42, height: 4, borderRadius: 2, background: '#D1D1D6', margin: '0 auto 20px' }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginBottom: 16, textAlign: 'center', letterSpacing: -0.2 }}>Gestionar la reserva</div>
        <button onClick={onPaymentDetail} style={rowStyle}>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: TEXT }}>Ver detalles del pago</span>
          </div>
          {chevron()}
        </button>
        <button
          onClick={canAddGuests ? onAddGuests : undefined}
          style={{ ...rowStyle, cursor: canAddGuests ? 'pointer' : 'default', opacity: canAddGuests ? 1 : 0.45 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: TEXT }}>Agregar jugadores</span>
            <span style={{ fontSize: 13, color: canAddGuests ? SUB : '#BEBEC8' }}>
              · {canAddGuests ? `${openSpots} ${openSpots === 1 ? 'cupo disponible' : 'cupos disponibles'}` : 'Sin cupos'}
            </span>
          </div>
          {canAddGuests && chevron()}
        </button>
        <button onClick={onCancel} style={{ ...rowStyle, marginBottom: 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: DANGER }}>Cancelar reserva</div>
          </div>
          {chevron(DANGER + '80')}
        </button>
      </div>
    </div>
  );
}

// ── CancelSheet
function CancelSheet({ gameId, breakdown, price, guestList, userName, isGuest, guestId, guestSelfName, payerName, payerCode, onClose, onDone, titularAlreadyCanceled = false, guestSubBreakdown = null }) {
  const [open, setOpen]           = useState(false);
  const [step, setStep]           = useState('select');
  const [titularChecked, setTitularChecked]   = useState(false);
  const [checkedGuests, setCheckedGuests]     = useState(new Set());
  const [capturedRefund, setCapturedRefund]   = useState(0);
  const [selfChecked, setSelfChecked]         = useState(false);

  const parsedPrice   = parseFloat((price || '').replace(/[^\d.]/g, '').replace(/^\./, '')) || 0;
  const titularDiscount = breakdown
    ? (breakdown.promoDiscount != null ? breakdown.promoDiscount : (breakdown.discount ?? 0))
    : 0;
  const titularRefund = breakdown
    ? Math.max(0, (breakdown.unitPrice || 0) - titularDiscount)
    : parsedPrice;
  const guestRefund = isGuest
    ? (guestSubBreakdown?.unitPrice || breakdown?.unitPrice || parsedPrice)
    : (breakdown?.unitPrice || parsedPrice);
  const totalRefund = isGuest
    ? checkedGuests.size * guestRefund
    : (titularChecked ? titularRefund : 0) + checkedGuests.size * guestRefund;
  const canConfirm = isGuest ? (selfChecked || checkedGuests.size > 0) : totalRefund > 0;
  const fmt = n => `S/. ${Number(n).toFixed(2)}`;

  useEffect(() => { const t = setTimeout(() => setOpen(true), 20); return () => clearTimeout(t); }, []);

  function dismiss() {
    if (step === 'processing') return;
    setOpen(false);
    setTimeout(onClose, 220);
  }

  function confirm() {
    setCapturedRefund(totalRefund);
    setStep('processing');
    setTimeout(() => {
      if (isGuest) {
        removePlayers(gameId, [...checkedGuests, ...(selfChecked ? [guestId] : [])]);
        if (selfChecked) {
          try {
            const _sc = JSON.parse(localStorage.getItem('pichanga_self_cancelled_guests') || '{}');
            _sc[gameId] = true;
            localStorage.setItem('pichanga_self_cancelled_guests', JSON.stringify(_sc));
          } catch {}
          try {
            const _now = Date.now();
            const _d = new Date(_now);
            const notifs = JSON.parse(localStorage.getItem('pichanga_notifications_v2') || '[]');
            notifs.unshift({ id: 'notif-gc-' + _now, type: 'app', title: 'Algrass', gameDate: null, message: `${guestSelfName} canceló su reserva. El monto pagado ha retornado a tu crédito.`, time: String(_d.getHours()).padStart(2, '0') + ':' + String(_d.getMinutes()).padStart(2, '0'), dateKey: _d.toISOString().slice(0, 10), read: false, createdAt: _now });
            localStorage.setItem('pichanga_notifications_v2', JSON.stringify(notifs));
          } catch {}
          cancelGamePlayer(gameId).then(({ skipped, error }) => {
            if (!skipped && error) console.error('[cancel] guest self failed:', error);
          });
        }
        if (checkedGuests.size > 0) {
          cancelGuestPlayers(gameId, [...checkedGuests]).then(({ skipped, error }) => {
            if (!skipped && error) console.error('[cancel] guest sub-players failed:', error);
          });
        }
      } else {
        if (checkedGuests.size > 0) removePlayers(gameId, [...checkedGuests]);
        if (titularChecked) {
          const remaining = getActivePlayers(gameId);
          if (remaining.length > 0) {
            const titularCode = (() => { try { return (JSON.parse(localStorage.getItem('pichanga_profile') || '{}').userCode || '').trim().toUpperCase(); } catch { return ''; } })();
            markTitularCanceled(gameId, titularCode, breakdown || undefined);
          } else {
            deleteRoster(gameId);
          }
          try {
            const shown = JSON.parse(localStorage.getItem('pichanga_shown_confirmations') || '{}');
            if (shown[gameId]) { delete shown[gameId]; localStorage.setItem('pichanga_shown_confirmations', JSON.stringify(shown)); }
          } catch {}
          // titular first so cascade detection in cancelGuestPlayers sees titular as canceled
          cancelGamePlayer(gameId)
            .then(({ skipped, error }) => {
              if (skipped || error) { if (error) console.error('[cancel] titular failed:', error); return; }
              if (checkedGuests.size > 0) cancelGuestPlayers(gameId, [...checkedGuests]);
            })
            .catch(e => console.error('[cancel] chain threw:', e));
        } else if (checkedGuests.size > 0) {
          cancelGuestPlayers(gameId, [...checkedGuests]).then(({ skipped, error }) => {
            if (!skipped && error) console.error('[cancel] partial guest cancel failed:', error);
          });
        }
      }
      setStep('done');
      setTimeout(() => onDone({ titularCanceled: !isGuest && titularChecked }), 1600);
    }, 1800);
  }

  const checkboxStyle = (checked) => ({
    width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
    border: `2px solid ${checked ? BLUE : '#C7C7CC'}`,
    background: checked ? BLUE : '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });
  const checkMark = (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2 5l2.5 2.5L8 2.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );

  return (
    <div className="sheet-overlay" onClick={step !== 'processing' ? dismiss : undefined} style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)', transition: 'background .22s ease' }}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ background: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, width: '100%', boxShadow: '0 -8px 32px rgba(0,0,0,0.12)', transform: open ? 'translateY(0)' : 'translateY(100%)', transition: 'transform .28s cubic-bezier(0.32,0.72,0,1)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>

        {step === 'select' && (<>
          <div style={{ padding: '20px 16px 0', flexShrink: 0 }}>
            <div style={{ width: 42, height: 4, borderRadius: 2, background: '#D1D1D6', margin: '0 auto 16px' }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, letterSpacing: -0.2 }}>Cancelar reserva</div>
            <div style={{ fontSize: 13, color: SUB, marginTop: 4, marginBottom: 10 }}>Selecciona</div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 12px', borderRadius: 10, background: '#F0FFF4', marginBottom: 14 }}>
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="7.5" cy="7.5" r="6.5" stroke={GREEN} strokeWidth="1.4"/><path d="M7.5 5v4M7.5 10.5v.5" stroke={GREEN} strokeWidth="1.5" strokeLinecap="round"/></svg>
              <span style={{ fontSize: 12.5, color: GREEN, fontWeight: 500, lineHeight: 1.45 }}>Las cancelaciones generan un crédito aplicable a tu próxima reserva.</span>
            </div>
          </div>
          <div className="no-sb" style={{ overflowY: 'auto', flex: 1 }}>
            {isGuest ? (
              <>
                {/* Self row: checkable, refund goes to payer */}
                <button onClick={() => setSelfChecked(v => !v)} style={{ width: '100%', padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${HAIR}`, fontFamily: 'inherit', textAlign: 'left', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                  <span style={checkboxStyle(selfChecked)}>{selfChecked && checkMark}</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 600, color: BLUE }}>{guestSelfName} (Tú)</span>
                    {payerName && <div style={{ fontSize: 11.5, color: SUB, marginTop: 2, lineHeight: 1.3 }}>El reembolso se acreditará a {payerName}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {breakdown?.unitPrice > 0 && (
                      <span style={{ fontSize: 13, color: SUB, textDecoration: 'line-through' }}>{fmt(breakdown.unitPrice)}</span>
                    )}
                    <span style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>S/. 0.00</span>
                  </div>
                </button>
                {/* Guest user's own guests (those they paid for) */}
                {guestList.map(guest => {
                  const checked = checkedGuests.has(guest.id);
                  return (
                    <button key={guest.id} onClick={() => setCheckedGuests(prev => { const n = new Set(prev); checked ? n.delete(guest.id) : n.add(guest.id); return n; })} style={{ width: '100%', padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${HAIR}`, fontFamily: 'inherit', textAlign: 'left', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                      <span style={checkboxStyle(checked)}>{checked && checkMark}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 600, color: TEXT }}>{guest.name}</div>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, flexShrink: 0 }}>{fmt(guestRefund)}</div>
                    </button>
                  );
                })}
                {guestList.length > 0 && (() => {
                  const allSelected = selfChecked && checkedGuests.size === guestList.length;
                  return (
                    <button onClick={() => {
                      if (allSelected) { setSelfChecked(false); setCheckedGuests(new Set()); }
                      else { setSelfChecked(true); setCheckedGuests(new Set(guestList.map(g => g.id))); }
                    }} style={{ width: '100%', padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'inherit', textAlign: 'left', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                      <span style={checkboxStyle(allSelected)}>{allSelected && checkMark}</span>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: 14.5, fontWeight: 600, color: TEXT }}>Todas</span>
                      </div>
                    </button>
                  );
                })()}
              </>
            ) : (<>
              {titularAlreadyCanceled ? (
                <div style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${HAIR}` }}>
                  <span style={{ ...checkboxStyle(false), opacity: 0.35 }} />
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 600, color: SUB }}>{userName} (Titular)</span>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: DANGER }}>Cancelado</span>
                </div>
              ) : (
                <button onClick={() => setTitularChecked(v => !v)} style={{ width: '100%', padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${HAIR}`, fontFamily: 'inherit', textAlign: 'left', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                  <span style={checkboxStyle(titularChecked)}>{titularChecked && checkMark}</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 600, color: BLUE }}>{userName} (Titular)</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, flexShrink: 0 }}>{fmt(titularRefund)}</div>
                </button>
              )}
              {guestList.map(guest => {
                const checked = checkedGuests.has(guest.id);
                return (
                  <button key={guest.id} onClick={() => setCheckedGuests(prev => { const n = new Set(prev); checked ? n.delete(guest.id) : n.add(guest.id); return n; })} style={{ width: '100%', padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${HAIR}`, fontFamily: 'inherit', textAlign: 'left', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                    <span style={checkboxStyle(checked)}>{checked && checkMark}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 600, color: TEXT }}>{guest.name}</div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, flexShrink: 0 }}>{fmt(guestRefund)}</div>
                  </button>
                );
              })}
              {(() => {
                const cancelableCount = (titularAlreadyCanceled ? 0 : 1) + guestList.length;
                if (cancelableCount < 2) return null;
                const allSelected = titularAlreadyCanceled
                  ? checkedGuests.size === guestList.length && guestList.length > 0
                  : titularChecked && checkedGuests.size === guestList.length;
                return (
                  <button onClick={() => {
                    if (allSelected) {
                      if (!titularAlreadyCanceled) setTitularChecked(false);
                      setCheckedGuests(new Set());
                    } else {
                      if (!titularAlreadyCanceled) setTitularChecked(true);
                      setCheckedGuests(new Set(guestList.map(g => g.id)));
                    }
                  }} style={{ width: '100%', padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'inherit', textAlign: 'left', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                    <span style={checkboxStyle(allSelected)}>{allSelected && checkMark}</span>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 14.5, fontWeight: 600, color: TEXT }}>Todas</span>
                    </div>
                  </button>
                );
              })()}
            </>)}
          </div>
          <div style={{ padding: '12px 16px calc(12px + env(safe-area-inset-bottom))', borderTop: `1px solid ${HAIR}`, flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 14, color: SUB }}>Total a cancelar</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>{fmt(totalRefund)}</span>
            </div>
            <button onClick={canConfirm ? confirm : undefined} style={{ width: '100%', height: 50, borderRadius: 14, background: canConfirm ? DANGER : '#E8E8EC', color: canConfirm ? '#fff' : '#9A9AA0', border: 'none', cursor: canConfirm ? 'pointer' : 'not-allowed', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
              Confirmar cancelación
            </button>
          </div>
        </>)}

        {step === 'processing' && (
          <div style={{ padding: '48px 24px calc(48px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', border: `4px solid ${SOFT}`, borderTop: `4px solid ${BLUE}`, animation: 'spin 0.9s linear infinite' }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: TEXT }}>Procesando...</div>
          </div>
        )}

        {step === 'done' && (
          <div style={{ padding: '40px 24px calc(40px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#D7F0DD', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke={GREEN} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: TEXT }}>Cancelación procesada</div>
            {capturedRefund > 0 ? (
              <div style={{ fontSize: 14, color: SUB, textAlign: 'center', lineHeight: 1.45 }}>
                Se generó un crédito de <strong style={{ color: GREEN }}>{fmt(capturedRefund)}</strong> en tu perfil.
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Screen
export default function GameDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();

  const isPastGame = location.state?.isPast    ?? false;
  const rating     = location.state?.rating    ?? null;
  const backPath   = location.state?.backPath  ?? '/games';

  const [sbGame, setSbGame]   = useState(null);
  const [sbRoster, setSbRoster] = useState([]);

  const stateGame = location.state?.game ?? null;
  const sel = stateGame ?? sbGame ?? GAMES.find(g => g.id === id) ?? null;
  const g = useMemo(() => buildGame(sel), [sel]);

  const { user } = useAuth();
  const gameId  = sel?.id ?? id ?? null;
  const guestId = location.state?.game?.guestId ?? null;

  const gameState = useMemo(() => deriveGameState(sbRoster, user?.id), [sbRoster, user?.id]);
  const { isBooked, mySlotCanceled } = gameState;

  const guestCanceledView = location.state?.guestCanceledView ?? false;
  const infoMode  = (location.state?.infoMode ?? false) || isBooked;
  const isGuest   = !!g.paidBy;

  const confirmedRoster  = useMemo(() => sbRoster.filter(p => p.status === 'confirmed'), [sbRoster]);
  const guestsInRoster   = useMemo(() =>
    gameState.activeGuests.map(p => ({ ...p, id: p.user_id, name: p.full_name || p.user_code || 'Jugador' })),
    [gameState]);
  const hasConfirmedTitular = useMemo(() => sbRoster.some(p => p.user_id === p.payer_id && p.status === 'confirmed'), [sbRoster]);
  const hasCanceledTitular  = useMemo(() => sbRoster.some(p => p.user_id === p.payer_id && p.status === 'canceled'),  [sbRoster]);
  const titularCanceled     = !hasConfirmedTitular && hasCanceledTitular;
  const liveOpenSpots    = Math.max(0, g.totalSpots - confirmedRoster.length);
  const isFull = !infoMode && liveOpenSpots === 0;
  const openSpots = liveOpenSpots;
  const confirmed = g.totalSpots - openSpots;
  const [inWaitlist, setInWaitlist] = useState(() => {
    if (!gameId) return false;
    try { return !!(JSON.parse(localStorage.getItem(WAITLIST_KEY)) || {})[gameId]; }
    catch { return false; }
  });
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [modifyOpen, setModifyOpen] = useState(false);
  const [cancelOpen,  setCancelOpen]  = useState(false);
  const [paymentDetailOpen, setPaymentDetailOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [attendance, setAttendance] = useState(() => {
    try {
      const stored = (JSON.parse(localStorage.getItem(ATTENDANCE_KEY)) || {})[gameId] || {};
      return { ...(SEED_ATTENDANCE[gameId] || {}), ...stored };
    } catch { return SEED_ATTENDANCE[gameId] || {}; }
  });

  const gameStart = useMemo(() => parseGameStart(g), [g]);
  const attendanceOpen = infoMode && !!gameStart
    && now >= new Date(gameStart.getTime() - 15 * 60_000)
    && now <  new Date(gameStart.getTime() + 2 * 60 * 60_000);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!gameId) return;
    getGameById(gameId).then(fetched => {
      if (fetched) setSbGame(fetched);
    });
  }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  function fetchRoster() {
    if (!supabase || !gameId) return;
    supabase
      .from('game_players')
      .select('user_id, payer_id, status, joined_at, users:user_id(full_name, user_code, avatar_hue)')
      .eq('game_id', gameId)
      .then(({ data, error }) => {
        if (error) { console.error('[GameDetail] game_players fetch error:', error); return; }
        const rows = (data ?? []).map(p => ({
          ...p,
          full_name:  p.users?.full_name  ?? null,
          user_code:  p.users?.user_code  ?? null,
          avatar_hue: p.users?.avatar_hue ?? null,
        }));
        setSbRoster(rows);
      });
  }

  useEffect(() => { fetchRoster(); }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  function markAttendance(player) {
    if (!gameStart) return;
    const markedAt = new Date();
    const minsLate = Math.max(0, Math.round((markedAt.getTime() - gameStart.getTime()) / 60_000));
    const entry = { markedAt: markedAt.toISOString(), status: minsLate === 0 ? 'a_tiempo' : 'tarde', minsLate };
    const next = { ...attendance, [player.name]: entry };
    setAttendance(next);
    try {
      const all = JSON.parse(localStorage.getItem(ATTENDANCE_KEY)) || {};
      all[gameId] = next;
      localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(all));
    } catch {}
  }


  // guests that current user paid for — same derivation as guestsInRoster, scoped to me as payer
  const guestOwnGuests = guestsInRoster;

  // live breakdown derived from Supabase — overrides stale/null location.state price
  const liveUnitPrice  = sbGame?.price ?? g.paymentBreakdown?.unitPrice ?? g.priceNumber;
  const liveBreakdown  = liveUnitPrice
    ? { unitPrice: liveUnitPrice, promoDiscount: g.paymentBreakdown?.promoDiscount ?? 0 }
    : g.paymentBreakdown;
  // true when my own slot is canceled (Rule 3: show titular-cancelado, hide paidBy)
  const livePaidBy     = mySlotCanceled ? null : g.paidBy;

  const isCanceledWithGuests = (titularCanceled || guestCanceledView)
    && (guestCanceledView ? guestOwnGuests.length : guestsInRoster.length) > 0
    && !isBooked;

  function handleAddGuests() {
    setModifyOpen(false);
    const addGuestPrice = sbGame?.price ?? g.paymentBreakdown?.unitPrice ?? g.priceNumber;
    navigate('/checkout', { state: {
      game: {
        id:          gameId,
        field:       g.field,
        date:        g.date,
        time:        g.time,
        format:      g.format,
        price:       `S/. ${addGuestPrice.toFixed(2)}`,
        priceNumber: addGuestPrice,
        currency:    'S/.',
        source:      'pichanga',
        addGuestsMode: true,
        maxNewGuests:  liveOpenSpots,
      },
      user: { name: user?.name || 'Usuario', email: user?.email || '' },
    }});
  }

  function handleCancelDone() {
    setCancelOpen(false);
    fetchRoster();
    navigate(backPath);
  }

  const activeList = isCanceledWithGuests ? (guestCanceledView ? guestOwnGuests : guestsInRoster) : [];

  function handleWaitlistToggle() {
    if (!user) {
      navigate('/checkout', { state: { waitlistMode: true, backPath: id ? `/game/${id}` : '/games' } });
      return;
    }
    try {
      const wl = JSON.parse(localStorage.getItem(WAITLIST_KEY)) || {};
      if (inWaitlist) {
        delete wl[gameId];
      } else {
        wl[gameId] = { gameId, userId: user.email, joinedAt: new Date().toISOString() };
      }
      localStorage.setItem(WAITLIST_KEY, JSON.stringify(wl));
    } catch {}
    setInWaitlist(v => !v);
  }

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: BLUE, overflow: 'hidden' }}>
        <Header field={g.field} openSpots={openSpots} infoMode={infoMode} onBack={() => navigate(backPath)}
          showShare={(!isFull || isBooked) && !isPastGame}
          onShare={() => {
            if (!gameId) return;
            shareOrCopy({ url: `${window.location.origin}/game/${gameId}`, title: g.field, text: `${g.date} · ${g.time}`, onCopied: () => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); } });
          }} />
        <div className="no-sb" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: '#fff' }}>
          <HeroImage />

          {/* Status badge below photo */}
          {(isBooked || infoMode || isCanceledWithGuests) && (
            <div style={{ padding: '7px 16px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              {isCanceledWithGuests ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 14px', borderRadius: 999, background: '#FFF0F0', border: `1.2px solid ${RED}40`, fontSize: 13, fontWeight: 500, color: TEXT, whiteSpace: 'nowrap' }}>
                  <span style={{ fontWeight: 700, color: RED }}>Cancelado</span>
                  <span style={{ opacity: 0.35 }}>·</span>
                  <span>{activeList.length} {activeList.length === 1 ? 'invitado activo' : 'invitados activos'}</span>
                </span>
              ) : isPastGame ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', padding: '5px 14px', borderRadius: 999, background: '#F0FFF4', fontSize: 13, fontWeight: 600, color: GREEN }}>Finalizado</span>
              ) : g.paidBy ? (
                <button onClick={() => setSelectedPlayer({ name: g.paidBy })} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 14px', borderRadius: 999, background: '#F0FFF4', border: 'none', cursor: 'pointer', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: GREEN }}>Invitado por</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: BLUE }}>{g.paidBy}</span>
                  {guestOwnGuests.length > 0 && (
                    <>
                      <span style={{ fontSize: 12, color: TEXT, opacity: 0.35, marginLeft: 2 }}>·</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: TEXT }}>{guestOwnGuests.length}</span>
                      <span style={{ fontSize: 12, color: TEXT }}>{guestOwnGuests.length === 1 ? 'invitado tuyo activo' : 'invitados tuyos activos'}</span>
                    </>
                  )}
                </button>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 14px', borderRadius: 999, background: '#F0FFF4', fontSize: 13, fontWeight: 500, color: GREEN }}>
                  <span style={{ fontWeight: 600 }}>Inscrito</span>
                  {guestsInRoster.length > 0 && (
                    <>
                      <span style={{ opacity: 0.4 }}>·</span>
                      <span>{guestsInRoster.length} {guestsInRoster.length === 1 ? 'invitado activo' : 'invitados activos'}</span>
                    </>
                  )}
                </span>
              )}
            </div>
          )}

          {infoMode && isPastGame && (
            <RatingBlock gameId={sel?.id ?? id ?? 'unknown'} existingRating={rating} />
          )}

          <div style={{ padding: '12px 16px 4px' }}>
            <InfoRow
              icon={I.cal()}
              primary={g.date}
              secondary={`${g.time} · ${g.duration}`}
              action={<WAChatButton />}
            />
            <InfoRow
              icon={I.fieldIcon()}
              primary={g.fieldNumber}
              secondary={<span>{g.address[0]}{g.address[1] ? <><br />{g.address[1]}</> : null}</span>}
            />
          </div>

          <div style={{ padding: '8px 16px 18px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {g.chips.map((c, i) => <Chip key={i} kind={c.kind} label={c.label} />)}
          </div>

          <Section title="Descripción">
            {g.description.map((p, i) => (
              <p key={i} style={{ margin: '0 0 8px', fontSize: 'var(--gd-body, 14px)', lineHeight: 1.5, color: TEXT }}>{p}</p>
            ))}
          </Section>

          <Section title="Recomendaciones">
            {g.recommendations.map((p, i) => (
              <p key={i} style={{ margin: '0 0 6px', fontSize: 'var(--gd-body, 14px)', lineHeight: 1.5, color: TEXT }}>{p}</p>
            ))}
          </Section>

          <Section title="Organizador">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar name={g.organizer.name} size={44} />
              <div style={{ fontSize: 'var(--gd-body, 14px)', color: TEXT, lineHeight: 1.4 }}>
                Este juego es organizado por <span style={{ fontWeight: 700 }}>{g.organizer.name}</span>
              </div>
            </div>
          </Section>

          <Section title="Jugadores">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ color: TEXT, fontSize: 'var(--gd-is, 13.5px)', fontWeight: 600 }}>{confirmed} confirmados</span>
              <span style={{ color: SUB, fontSize: 'var(--gd-is, 13.5px)' }}>
                {openSpots === 0 ? '0 cupos libres' : `${openSpots} ${openSpots === 1 ? 'cupo libre' : 'cupos libres'}`}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {g.players.map((p, i) => {
                const displayName = (p.name || '').split(' ').slice(0, 2).join(' ');
                const attRecord   = attendance[p.name] ?? null;
                const showAtt     = attendanceOpen || isPastGame;
                return (
                  <div key={i}
                    onClick={() => setSelectedPlayer(p)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 12px', border: `1px solid ${HAIR}`, borderRadius: 14, background: '#fff',
                      cursor: 'pointer',
                    }}>
                    <Avatar name={p.name} size={36} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--gd-player, 14.5px)', fontWeight: 600, color: TEXT, lineHeight: 1.2 }}>
                        {displayName}
                      </div>
                      {(p.age != null || p.position) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, fontSize: 11.5, color: SUB }}>
                          {p.age != null && <span>{p.age} años</span>}
                          {p.age != null && p.position && <span style={{ color: '#D1D1D6' }}>|</span>}
                          {p.position && <span style={{ fontWeight: 600 }}>{p.position}</span>}
                        </div>
                      )}
                    </div>
                    {showAtt && (
                      <AttendanceBadge
                        record={attRecord}
                        canMark={attendanceOpen && !attRecord}
                        onMark={() => markAttendance(p)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </Section>

          <div style={{ height: 8 }} />
        </div>
        {!infoMode && (isFull || inWaitlist) && (
          <WaitlistRow inList={inWaitlist} onToggle={handleWaitlistToggle} />
        )}
        {(isBooked || infoMode) ? (
          <div style={{ background: '#fff', borderTop: `1px solid ${HAIR}` }}>
            {isPastGame && infoMode && <PaymentDetail price={g.price} breakdown={liveBreakdown} paidBy={livePaidBy} userName={user?.name || 'Usuario'} titularCanceled={titularCanceled || mySlotCanceled} activeGuestCount={isGuest ? guestOwnGuests.length : guestsInRoster.length} guestSubBreakdown={isGuest ? g.guestSubBreakdown : null} />}
            {(isBooked || guestsInRoster.length > 0) && !isPastGame && (
              <div style={{ padding: '12px 16px' }}>
                <button
                  onClick={() => setModifyOpen(true)}
                  style={{ width: '100%', padding: '8px 16px', background: 'transparent', border: `1.5px solid ${BLUE}`, borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 600, color: BLUE, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                  Gestionar mi reserva
                </button>
              </div>
            )}
          </div>
        ) : !infoMode && (
          <>
            {isCanceledWithGuests && (() => {
              return (
              <div style={{ background: '#fff', borderTop: `1px solid ${HAIR}` }}>
                {!isPastGame && (
                  <div style={{ padding: '12px 16px 0' }}>
                    <button
                      onClick={() => setModifyOpen(true)}
                      style={{ width: '100%', padding: '8px 16px', background: 'transparent', border: `1.5px solid ${BLUE}`, borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: BLUE, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                      Gestionar mi reserva
                    </button>
                  </div>
                )}
              </div>
              );
            })()}
            <CTA
              price={g.price}
              disabled={isFull}
              hideTopBorder={isFull || isCanceledWithGuests}
              onPress={() => {
                const checkoutGame = {
                  id:          g.id,
                  field:       g.field,
                  date:        g.date,
                  time:        g.time,
                  format:      g.format,
                  price:       g.price,
                  priceNumber: g.priceNumber,
                  currency:    g.currency,
                  source:      'pichanga',
                  openSpots:   g.openSpots,
                  wasInWaitlist: inWaitlist,
                  backPath:    id ? `/game/${id}` : '/games',
                  gameDetailBackPath: backPath,
                };
                navigate('/checkout', { state: { game: checkoutGame } });
              }}
            />
          </>
        )}
        <TabBar />
      {selectedPlayer && <PlayerModal player={selectedPlayer} onClose={() => setSelectedPlayer(null)} />}
      {modifyOpen && (
        <ModifySheet
          canAddGuests={liveOpenSpots > 0}
          openSpots={liveOpenSpots}
          onClose={() => setModifyOpen(false)}
          onAddGuests={handleAddGuests}
          onCancel={() => { setModifyOpen(false); setCancelOpen(true); }}
          onPaymentDetail={() => { setModifyOpen(false); setPaymentDetailOpen(true); }}
        />
      )}
      {paymentDetailOpen && (
        <PaymentDetailSheet
          price={g.price}
          breakdown={guestCanceledView ? g.guestSubBreakdown : liveBreakdown}
          paidBy={livePaidBy}
          userName={user?.name || 'Usuario'}
          titularCanceled={titularCanceled || guestCanceledView || mySlotCanceled}
          activeGuestCount={isGuest ? guestOwnGuests.length : (isCanceledWithGuests ? activeList.length : guestsInRoster.length)}
          guestSubBreakdown={isGuest ? g.guestSubBreakdown : null}
          onClose={() => setPaymentDetailOpen(false)}
        />
      )}
      {cancelOpen && (
        <CancelSheet
          gameId={gameId}
          breakdown={guestCanceledView ? g.guestSubBreakdown : liveBreakdown}
          price={g.price}
          guestList={isGuest ? guestOwnGuests : (guestCanceledView ? guestOwnGuests : guestsInRoster)}
          userName={user?.name || 'Usuario'}
          isGuest={isGuest}
          guestId={guestId}
          guestSelfName={user?.name || 'Usuario'}
          payerName={g.paidBy}
          payerCode={g.paidByCode}
          titularAlreadyCanceled={guestCanceledView || titularCanceled}
          guestSubBreakdown={g.guestSubBreakdown}
          onClose={() => setCancelOpen(false)}
          onDone={handleCancelDone}
        />
      )}
      {linkCopied && (
        <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '8px 18px', borderRadius: 20, fontSize: 14, fontWeight: 500, zIndex: 9999, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          Link copiado
        </div>
      )}
    </div>
  );
}
