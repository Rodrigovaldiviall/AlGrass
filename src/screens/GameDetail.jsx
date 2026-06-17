import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useSheetPull } from '../hooks/useSheetPull';
import { BLUE, TEXT, SUB, HAIR, ORANGE, SOFT, GREEN, DANGER, RED, WHATSAPP_NUMBER } from '../constants';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faWhatsapp } from '@fortawesome/free-brands-svg-icons';
import { faCommentSms, faTowerBroadcast } from '@fortawesome/free-solid-svg-icons';
import I from '../icons';
import { shareOrCopy } from '../utils/share';
import { GAMES, FIELD_INFO, GAME_DEFAULTS } from '../data/games';
import { getActivePlayers, getRoster, removePlayers, setTitularCanceled as markTitularCanceled, deleteRoster, getGameById } from '../services/gameService';
import TabBar from '../components/TabBar';
import { useForegroundTick } from '../hooks/useForegroundTick';
import RatingBlock from '../components/RatingBlock';
import { useAuth } from '../context/AuthContext';
import { cancelGamePlayer, cancelGuestPlayers, cancelInvitedPlayers } from '../services/reservationService';
import { supabase } from '../lib/supabase';
import { getAvatarUrl } from '../utils/avatar';
import { getVenueCoverUrl } from '../utils/venue';
import { deriveGameState, requiredPlayers, gameStartDate, gameEndDate, isGamePast, isGameStarted, deriveAttendance } from '../utils/deriveGameState';
import { joinWaitlist, leaveWaitlist, getMyWaitlistGameIds } from '../services/waitlistService';
const ROSTER_KEY_GD = 'pichanga_game_rosters';


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
      date: 'Sáb 25 Abr 2026', time: '7:30', ampm: 'PM',
      duration: GAME_DEFAULTS.duration, fieldNumber: GAME_DEFAULTS.fieldNumber,
      address: FIELD_INFO['Xaloc'].address,
      chips: [
        { kind: 'format', label: '8v8' }, { kind: 'covered', label: 'Techado' },
        { kind: 'filmed', label: 'Filmado' }, { kind: 'women', label: 'Femenino' },
      ],
      description: GAME_DEFAULTS.description,
      recommendations: GAME_DEFAULTS.recommendations,
      organizer: GAME_DEFAULTS.organizer,
      players: [],
      price: 'S/. 8.49',
      priceNumber: 8.49,
      currency: 'S/.',
      format: '8v8',
    };
  }
  const fieldInfo = FIELD_INFO[sel.field] || { address: [sel.field, 'Dirección no disponible'] };
  const address = sel.address ? [sel.address] : fieldInfo.address;
  const total = sel.totalSpots || totalSpotsFor(sel.format);
  const chips = [
    { kind: 'format',   label: sel.format || '7v7' },
    total > requiredPlayers(sel.format) && { kind: 'suplentes', label: 'Con suplentes' },
    sel.covered   && { kind: 'covered',  label: 'Techado' },
    sel.filmed    && { kind: 'filmed',   label: 'Filmado' },
    sel.womenOnly && { kind: 'women',    label: 'Femenino' },
    sel.master45  && { kind: 'master45', label: 'Master 45+' },
    sel.parking   && { kind: 'parking',  label: 'Estacionamiento' },
    sel.showers   && { kind: 'showers',  label: 'Duchas' },
  ].filter(Boolean);
  const confirmed = Math.max(0, total - (sel.openSpots ?? 0));
  const players = [];
  return {
    id: sel.id,
    field: sel.field,
    openSpots: sel.openSpots ?? 0,
    totalSpots: total,
    date: sel.date || formatDateEs(sel.dateKey),
    time: sel.time || '7:00',
    ampm: sel.ampm || 'PM',
    duration: `${sel.durationMin ?? 60} min`,
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
    dateKey:           sel.dateKey           ?? null,
    time24:            sel.time24            ?? null,
    durationMin:       sel.durationMin       ?? null,
    hostUserId:        sel.hostUserId        ?? null,
    effectiveHostUserId: sel.effectiveHostUserId ?? null,
    type:              sel.type              ?? null,
  };
}

// ── Header
function Header({ field, openSpots, onBack, onShare, infoMode, showShare, live = false }) {
  const cupoLabel = openSpots === 0 ? 'Lleno' : `${openSpots} ${openSpots === 1 ? 'cupo' : 'cupos'}`;
  return (
    <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 9px)', paddingBottom: 9, paddingLeft: 16, paddingRight: 16, position: 'relative' }}>
      <div style={{ height: 44, display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
        <button
          onClick={onBack}
          style={{ width: 36, height: 36, marginLeft: -8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, WebkitTapHighlightColor: 'transparent' }}>
          {I.back('#fff')}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{field}</div>
        </div>
        {live ? (
          <div style={{
            height: 26, padding: '0 10px', borderRadius: 999,
            background: RED, color: '#fff', fontSize: 12, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
          }}>
            <FontAwesomeIcon icon={faTowerBroadcast} style={{ fontSize: 12 }} />
            Ahora
          </div>
        ) : !infoMode ? (
          <div style={{
            height: 26, padding: '0 10px', borderRadius: 999,
            background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.45)',
            color: '#fff', fontSize: 12, fontWeight: 600,
            display: 'inline-flex', alignItems: 'center',
          }}>{cupoLabel}</div>
        ) : null}
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

// ── Hero image
function HeroImage({ coverPath, coverVersion }) {
  const src = coverPath ? getVenueCoverUrl(supabase, coverPath, coverVersion) : null;
  if (src) {
    return (
      <div className="game-hero-image" style={{ width: '100%', aspectRatio: '16/6.3', overflow: 'hidden', flexShrink: 0 }}>
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
    );
  }
  return (
    <div className="game-hero-image" style={{
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
  format:    I.twoPeople,
  filmed:    I.camera,
  covered:   I.roof,
  women:     I.female,
  spots:     I.plus,
  master45:  _StarIcon,
  parking:   _ParkingIcon,
  showers:   _ShowerIcon,
  suplentes: I.sub,
};
function Chip({ kind, label }) {
  const icon = CHIP_ICON[kind];
  const isSubs = kind === 'suplentes';
  return (
    <div style={{
      flex: '0 0 auto', height: isSubs ? 'auto' : 28, padding: isSubs ? '4px 10px' : '0 10px',
      borderRadius: 999, border: `1px solid ${HAIR}`, background: '#fff',
      display: 'inline-flex', alignItems: 'center', gap: 5,
      color: TEXT, fontSize: 'var(--gd-is, 12px)', fontWeight: 500,
      whiteSpace: isSubs ? 'normal' : 'nowrap',
    }}>
      {icon ? icon(TEXT) : null}
      {isSubs
        ? <span style={{ lineHeight: 1.2, textAlign: 'center' }}>Con<br/>suplentes</span>
        : <span>{label}</span>
      }
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
  const { rootRef, dragY, dragging } = useSheetPull({ onClose: dismiss });
  return (
    <div className="sheet-overlay" onClick={dismiss} style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)', transition: 'background .22s ease', pointerEvents: open ? 'auto' : 'none' }}>
      <div className="sheet-panel" ref={rootRef} onClick={e => e.stopPropagation()} style={{ background: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, width: '100%', padding: '20px 16px calc(24px + env(safe-area-inset-bottom))', boxShadow: '0 -8px 32px rgba(0,0,0,0.12)', transform: open ? `translateY(${dragY}px)` : 'translateY(100%)', transition: dragging ? 'none' : 'transform .28s cubic-bezier(0.32,0.72,0,1)' }}>
        <div style={{ width: 42, height: 4, borderRadius: 2, background: '#D1D1D6', margin: '0 auto 20px' }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginBottom: 16, textAlign: 'center', letterSpacing: -0.2 }}>Detalles del pago</div>
        <PaymentDetail price={price} breakdown={breakdown} paidBy={paidBy} userName={userName} titularCanceled={titularCanceled} activeGuestCount={activeGuestCount} guestSubBreakdown={guestSubBreakdown} alwaysExpanded />
      </div>
    </div>
  );
}

// ── Avatar
function Avatar({ name, size = 36, hue = null, avatarPath = null, avatarVersion = null }) {
  const src = avatarPath ? getAvatarUrl(supabase, avatarPath, avatarVersion) : null;
  const initials = (name || '').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const derivedHue = hue ?? ([...(name || '·')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360);
  if (src) {
    return (
      <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `hsl(${derivedHue} 35% 92%)`, color: `hsl(${derivedHue} 45% 35%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size >= 44 ? 14 : 12, fontWeight: 700, flexShrink: 0,
    }}>{initials || '·'}</div>
  );
}

// ── Waitlist
function WaitlistRow({ inList, openSpots = 0, onToggle }) {
  const spotFreed = inList && openSpots > 0;
  return (
    <div style={{ padding: '10px', background: '#fff', borderTop: `1px solid ${HAIR}` }}>
      <div style={{
        padding: '8px 10px 8px 12px',
        background: spotFreed ? '#F0FAF3' : '#FFF8EC',
        border: `1px solid ${spotFreed ? '#B2DFC0' : '#F4E4C2'}`,
        borderRadius: 14,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ flex: 1, fontSize: 13, color: TEXT, lineHeight: 1.35, fontWeight: 500 }}>
          {spotFreed
            ? 'Se liberó un cupo. ¡Reserva ahora!'
            : inList ? 'Te notificaremos si se libera una reserva' : 'Avísame si se libera una reserva'}
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

// ── Attendance badge — all state derived from checked_in_at + game timing
function ResetBtn({ onReset }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onReset(); }}
      style={{
        flexShrink: 0, width: 18, height: 18, borderRadius: '50%',
        border: 'none', background: 'rgba(0,0,0,0.08)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', outline: 'none', padding: 0,
        WebkitTapHighlightColor: 'transparent',
      }}>
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" stroke={SUB} strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    </button>
  );
}

function AttendanceBadge({ checkedInAt, gameStart, isPast, canMark, onMark, canReset, onReset }) {
  const att = deriveAttendance(checkedInAt, gameStart, isPast);
  if (att) {
    if (att.status === 'a_tiempo') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6.5l2.5 2.5 5.5-5.5" stroke={GREEN} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 700, color: GREEN, whiteSpace: 'nowrap' }}>A tiempo</span>
          {canReset && <ResetBtn onReset={onReset} />}
        </div>
      );
    }
    if (att.status === 'tarde') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: ORANGE, whiteSpace: 'nowrap' }}>
            {att.minsLate} min tarde
          </span>
          {canReset && <ResetBtn onReset={onReset} />}
        </div>
      );
    }
    return (
      <span style={{ fontSize: 11, fontWeight: 600, color: SUB, whiteSpace: 'nowrap', flexShrink: 0 }}>
        Ausente
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

function PlayerModal({ player, onClose, isHost = false }) {
  const [open, setOpen]           = useState(false);
  const [profile, setProfile]     = useState(null);
  const [isVerified, setVerified] = useState(false);
  const [gamesPlayed, setGamesPlayed] = useState(null);
  const [isPrivate, setIsPrivate]     = useState(false);

  useEffect(() => { const t = setTimeout(() => setOpen(true), 20); return () => clearTimeout(t); }, []);

  useEffect(() => {
    if (!player.user_id || !supabase) return;
    supabase
      .from('users_public')
      .select('full_name, user_code, avatar_hue, avatar_path, avatar_updated_at, sex, age, preferred_position, city, profile_private, profile_complete')
      .eq('id', player.user_id)
      .maybeSingle()
      .then(({ data, error }) => {
        console.log('[PlayerModal] profile fetch', { data, error });
        if (data) {
          setProfile(data);
          setIsPrivate(data.profile_private === true);
        }
      });
    supabase
      .from('game_players')
      .select('id')
      .eq('user_id', player.user_id)
      .eq('status', 'confirmed')
      .limit(1)
      .then(({ data }) => { if (data?.length) setVerified(true); });
    // Fallback: users who reserved as titular (reservations row) may not have a game_players row
    supabase
      .from('reservations')
      .select('id')
      .eq('user_id', player.user_id)
      .eq('status', 'spend')
      .limit(1)
      .then(({ data }) => { if (data?.length) setVerified(true); });
    // Games played count
    supabase
      .from('game_players')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', player.user_id)
      .eq('status', 'confirmed')
      .then(({ count }) => { if (count != null) setGamesPlayed(count); });
  }, [player.user_id]);

  function dismiss() { setOpen(false); setTimeout(onClose, 220); }

  function ageFromIso(iso) {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    const today = new Date();
    let a = today.getFullYear() - y;
    const mo = today.getMonth() + 1 - m;
    if (mo < 0 || (mo === 0 && today.getDate() < d)) a--;
    return a >= 0 ? a : null;
  }

  const name     = profile?.full_name || player.name || '';
  const hue      = profile?.avatar_hue ?? ([...(name || '·')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360);
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || '·';
  const code     = profile?.user_code ? '@' + profile.user_code : deterministicCode(name);
  const sex      = profile?.sex || null;
  const age      = profile ? (profile.age ?? null) : (player.age ?? null);
  const position = profile
    ? (Array.isArray(profile.preferred_position) ? profile.preferred_position.join(' · ') : (profile.preferred_position || null))
    : (player.position || null);
  const city = profile?.city ?? null;

  const isProfileComplete = !!(profile && profile.profile_complete);

  const stat = (v, l) => (
    <div>
      <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.3, lineHeight: 1, color: v != null ? TEXT : '#C7C7CC' }}>
        {v != null ? String(v) : '—'}
      </div>
      <div style={{ fontSize: 11, color: SUB, marginTop: 2 }}>{l}</div>
    </div>
  );

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
        pointerEvents: open ? 'auto' : 'none',
      }}>
      <div
        className="player-card-inner"
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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 96, flexShrink: 0 }}>
            <div style={{ position: 'relative', marginBottom: 8 }}>
              {profile?.avatar_path ? (
                <div style={{
                  width: 68, height: 68, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                  boxShadow: isHost ? `0 0 0 2.5px #fff, 0 0 0 5px ${ORANGE}` : undefined,
                }}>
                  <img src={getAvatarUrl(supabase, profile.avatar_path, profile.avatar_updated_at ? new Date(profile.avatar_updated_at).getTime() : null)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ) : (
                <div style={{
                  width: 68, height: 68, borderRadius: '50%',
                  background: `hsl(${hue} 35% 92%)`, color: `hsl(${hue} 45% 35%)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, fontWeight: 700, flexShrink: 0,
                  boxShadow: isHost ? `0 0 0 2.5px #fff, 0 0 0 5px ${ORANGE}` : undefined,
                }}>{initials}</div>
              )}
              {isProfileComplete ? (
                <div style={{
                  position: 'absolute', bottom: 1, right: 1,
                  width: 20, height: 20, borderRadius: '50%',
                  background: ORANGE, border: '2px solid #fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="#fff">
                    <path d="M6 1l1.3 3.3H11l-2.8 2 1.1 3.3L6 7.7l-3.3 1.6 1.1-3.3L1 4.3h3.7z"/>
                  </svg>
                </div>
              ) : isVerified ? (
                <div style={{
                  position: 'absolute', bottom: 1, right: 1,
                  width: 20, height: 20, borderRadius: '50%',
                  background: GREEN, border: '2px solid #fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                    <path d="M3 7l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              ) : null}
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: TEXT, textAlign: 'center', lineHeight: 1.25, letterSpacing: -0.2, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', width: '100%' }}>
              {name}
            </div>
            <div style={{ fontSize: 12, color: BLUE, fontWeight: 600, marginTop: 3 }}>{code}</div>
            {city && <div style={{ fontSize: 11.5, color: SUB, fontWeight: 500, marginTop: 3 }}>{city}</div>}
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', paddingTop: 4 }}>
            <div style={{ paddingBottom: 10 }}>
              {stat(gamesPlayed, 'Partidos jugados')}
            </div>
            <div style={{ height: 1, background: HAIR, marginBottom: 10 }} />
            <div style={{ display: 'flex', gap: 0, paddingBottom: 10 }}>
              <div style={{ flex: 1 }}>{stat(isPrivate ? null : sex, 'Sexo')}</div>
              <div style={{ flex: 1 }}>{stat(isPrivate ? null : (age != null ? String(age) : null), 'Edad')}</div>
            </div>
            <div style={{ height: 1, background: HAIR, marginBottom: 10 }} />
            {stat(position, 'Posición')}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ModifySheet
function ModifySheet({ canAddGuests, openSpots, onClose, onAddGuests, onCancel, onPaymentDetail, isHost = false, canAddPlayers = true, invitedCount = 0 }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOpen(true), 20); return () => clearTimeout(t); }, []);
  function dismiss() { setOpen(false); setTimeout(onClose, 220); }
  const { rootRef, dragY, dragging } = useSheetPull({ onClose: dismiss });
  const rowStyle = { width: '100%', padding: '14px 16px', borderRadius: 14, background: '#fff', border: `1px solid ${HAIR}`, display: 'flex', alignItems: 'center', marginBottom: 10, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', WebkitTapHighlightColor: 'transparent', outline: 'none' };
  const chevron = (color = SUB) => (
    <svg width="8" height="14" viewBox="0 0 8 14" fill="none">
      <path d="M1 1l6 6-6 6" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
  const canAdd = isHost ? (canAddPlayers && canAddGuests) : canAddGuests;
  return (
    <div className="sheet-overlay" onClick={dismiss} style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)', transition: 'background .22s ease', pointerEvents: open ? 'auto' : 'none' }}>
      <div className="sheet-panel" ref={rootRef} onClick={e => e.stopPropagation()} style={{ background: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, width: '100%', padding: '20px 16px calc(20px + env(safe-area-inset-bottom))', boxShadow: '0 -8px 32px rgba(0,0,0,0.12)', transform: open ? `translateY(${dragY}px)` : 'translateY(100%)', transition: dragging ? 'none' : 'transform .28s cubic-bezier(0.32,0.72,0,1)' }}>
        <div style={{ width: 42, height: 4, borderRadius: 2, background: '#D1D1D6', margin: '0 auto 20px' }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginBottom: 16, textAlign: 'center', letterSpacing: -0.2 }}>
          {isHost ? 'Gestionar el partido' : 'Gestionar la reserva'}
        </div>
        {!isHost && (
          <button onClick={onPaymentDetail} style={rowStyle}>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: TEXT }}>Ver detalles del pago</span>
            </div>
            {chevron()}
          </button>
        )}
        <button
          onClick={canAdd ? onAddGuests : undefined}
          style={{ ...rowStyle, cursor: canAdd ? 'pointer' : 'default', opacity: canAdd ? 1 : 0.45 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: TEXT }}>Agregar jugadores</span>
            <span style={{ fontSize: 13, color: canAdd ? SUB : '#BEBEC8' }}>
              {isHost && !canAddPlayers
                ? '· Solo desde 1h antes'
                : canAdd
                  ? `· ${openSpots} ${openSpots === 1 ? 'cupo disponible' : 'cupos disponibles'}`
                  : '· Sin cupos'}
            </span>
          </div>
          {canAdd && chevron()}
        </button>
        {isHost ? (
          invitedCount > 0 && (
            <button onClick={onCancel} style={{ ...rowStyle, marginBottom: 0 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: DANGER }}>Cancelar jugadores invitados</div>
                <div style={{ fontSize: 12.5, color: SUB, marginTop: 1 }}>{invitedCount} {invitedCount === 1 ? 'jugador invitado' : 'jugadores invitados'}</div>
              </div>
              {chevron(DANGER + '80')}
            </button>
          )
        ) : (
          <button onClick={onCancel} style={{ ...rowStyle, marginBottom: 0 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: DANGER }}>Cancelar reserva</div>
            </div>
            {chevron(DANGER + '80')}
          </button>
        )}
      </div>
    </div>
  );
}

// ── HostCancelInvitedSheet
function HostCancelInvitedSheet({ gameId, invitedPlayers, unitPrice = 0, onClose, onDone }) {
  const [open,    setOpen]    = useState(false);
  const [checked, setChecked] = useState(new Set());
  const [step,    setStep]    = useState('select');

  useEffect(() => { const t = setTimeout(() => setOpen(true), 20); return () => clearTimeout(t); }, []);
  function dismiss() { if (step === 'processing') return; setOpen(false); setTimeout(onClose, 220); }

  function toggle(uid) {
    setChecked(prev => { const n = new Set(prev); n.has(uid) ? n.delete(uid) : n.add(uid); return n; });
  }

  async function confirm() {
    if (!checked.size) return;
    setStep('processing');
    const { error } = await cancelInvitedPlayers(gameId, [...checked], unitPrice);
    if (error) { setStep('select'); return; }
    setTimeout(() => { setStep('done'); setTimeout(onDone, 1200); }, 600);
  }

  const checkboxStyle = active => ({
    width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
    border: `2px solid ${active ? DANGER : '#C7C7CC'}`,
    background: active ? DANGER : '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });
  const checkMark = (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2 5l2.5 2.5L8 2.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );

  return (
    <div className="sheet-overlay" onClick={step !== 'processing' ? dismiss : undefined}
      style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)', transition: 'background .22s ease', pointerEvents: open ? 'auto' : 'none' }}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, width: '100%', boxShadow: '0 -8px 32px rgba(0,0,0,0.12)', transform: open ? 'translateY(0)' : 'translateY(100%)', transition: 'transform .28s cubic-bezier(0.32,0.72,0,1)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>

        {step === 'done' ? (
          <div style={{ padding: '32px 20px calc(32px + env(safe-area-inset-bottom))', textAlign: 'center' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: TEXT }}>Cancelación completada</div>
            <div style={{ fontSize: 13, color: SUB, marginTop: 6 }}>
              {checked.size === 1 ? '1 jugador removido del partido' : `${checked.size} jugadores removidos del partido`}
            </div>
          </div>
        ) : (
          <>
            <div style={{ padding: '20px 16px 0', flexShrink: 0 }}>
              <div style={{ width: 42, height: 4, borderRadius: 2, background: '#D1D1D6', margin: '0 auto 16px' }} />
              <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, letterSpacing: -0.2 }}>Cancelar jugadores invitados</div>
              <div style={{ fontSize: 13, color: SUB, marginTop: 4, marginBottom: 10 }}>Sin reembolso — estos jugadores no realizaron pago</div>
            </div>
            <div className="no-sb" style={{ overflowY: 'auto', flex: 1 }}>
              {invitedPlayers.map(p => {
                const isChecked = checked.has(p.user_id);
                const hue = p.avatar_hue ?? ([...(p.full_name || '·')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360);
                const initials = (p.full_name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
                return (
                  <button key={p.user_id} onClick={() => toggle(p.user_id)}
                    style={{ width: '100%', padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${HAIR}`, fontFamily: 'inherit', textAlign: 'left', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                    <span style={checkboxStyle(isChecked)}>{isChecked && checkMark}</span>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: `hsl(${hue} 35% 92%)`, color: `hsl(${hue} 45% 35%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{initials}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 600, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.full_name || 'Jugador'}</div>
                      {p.user_code && <div style={{ fontSize: 12, color: BLUE, marginTop: 1 }}>@{p.user_code}</div>}
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ padding: '14px 16px calc(20px + env(safe-area-inset-bottom))', flexShrink: 0 }}>
              <button
                onClick={confirm}
                disabled={!checked.size || step === 'processing'}
                style={{ width: '100%', height: 48, borderRadius: 14, background: checked.size ? DANGER : '#F2F2F4', color: checked.size ? '#fff' : SUB, border: 'none', cursor: checked.size ? 'pointer' : 'default', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', transition: 'background .15s, color .15s', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                {step === 'processing' ? 'Cancelando…' : `Cancelar ${checked.size > 0 ? `(${checked.size})` : ''}`}
              </button>
            </div>
          </>
        )}
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
  const isSimple = !isGuest && !titularAlreadyCanceled && guestList.length === 0;
  const isGuestSimple = isGuest && guestList.length === 0;
  const effectiveTitularChecked = isSimple || titularChecked;
  const effectiveSelfChecked = isGuestSimple || selfChecked;
  const totalRefund = isGuest
    ? checkedGuests.size * guestRefund
    : (effectiveTitularChecked ? titularRefund : 0) + checkedGuests.size * guestRefund;
  const canConfirm = isGuest ? (effectiveSelfChecked || checkedGuests.size > 0) : totalRefund > 0;
  const fmt = n => `S/. ${Number(n).toFixed(2)}`;

  useEffect(() => { const t = setTimeout(() => setOpen(true), 20); return () => clearTimeout(t); }, []);

  function dismiss() {
    if (step === 'processing') return;
    setOpen(false);
    setTimeout(onClose, 220);
  }
  const { rootRef, scrollRef, dragY, dragging } = useSheetPull({ onClose: dismiss });

  function confirm() {
    setCapturedRefund(totalRefund);
    setStep('processing');
    setTimeout(async () => {
      if (isGuest) {
        removePlayers(gameId, [...checkedGuests, ...(effectiveSelfChecked ? [guestId] : [])]);
        if (effectiveSelfChecked) {
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
          const { skipped: s1, error: e1 } = await cancelGamePlayer(gameId);
          if (!s1 && e1) console.error('[cancel] guest self failed:', e1);
        }
        if (checkedGuests.size > 0) {
          const { skipped: s2, error: e2 } = await cancelGuestPlayers(gameId, [...checkedGuests]);
          if (!s2 && e2) console.error('[cancel] guest sub-players failed:', e2);
        }
      } else {
        if (checkedGuests.size > 0) removePlayers(gameId, [...checkedGuests]);
        if (effectiveTitularChecked) {
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
          try {
            const { skipped, error } = await cancelGamePlayer(gameId, { skipNotification: checkedGuests.size > 0 });
            if (skipped || error) { if (error) console.error('[cancel] titular failed:', error); }
            else if (checkedGuests.size > 0) await cancelGuestPlayers(gameId, [...checkedGuests], { selfAlsoCanceled: true });
          } catch (e) { console.error('[cancel] chain threw:', e); }
        } else if (checkedGuests.size > 0) {
          const { skipped, error } = await cancelGuestPlayers(gameId, [...checkedGuests]);
          if (!skipped && error) console.error('[cancel] partial guest cancel failed:', error);
        }
      }
      setStep('done');
      setTimeout(() => onDone({ titularCanceled: !isGuest && effectiveTitularChecked }), 1600);
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
    <div className="sheet-overlay" onClick={step !== 'processing' ? dismiss : undefined} style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)', transition: 'background .22s ease', pointerEvents: open ? 'auto' : 'none' }}>
      <div className="sheet-panel" ref={rootRef} onClick={e => e.stopPropagation()} style={{ background: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, width: '100%', boxShadow: '0 -8px 32px rgba(0,0,0,0.12)', transform: open ? `translateY(${dragY}px)` : 'translateY(100%)', transition: dragging ? 'none' : 'transform .28s cubic-bezier(0.32,0.72,0,1)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>

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
          <div ref={scrollRef} className="no-sb" style={{ overflowY: 'auto', overscrollBehavior: 'contain', flex: 1 }}>
            {isGuest ? (
              <>
                {/* Self row: checkable, refund goes to payer */}
                <button onClick={isGuestSimple ? undefined : () => setSelfChecked(v => !v)} style={{ width: '100%', padding: '12px 16px', background: 'transparent', border: 'none', cursor: isGuestSimple ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${HAIR}`, fontFamily: 'inherit', textAlign: 'left', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                  {!isGuestSimple && <span style={checkboxStyle(selfChecked)}>{selfChecked && checkMark}</span>}
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
              ) : isSimple ? (
                <div style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${HAIR}` }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 600, color: BLUE }}>{userName} (Tú)</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, flexShrink: 0 }}>{fmt(titularRefund)}</div>
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

// ── Roster cache (sessionStorage, 15 min TTL, per-user)
const ROSTER_CACHE_TTL = 15 * 60 * 1000;
function _rosterCacheKey(gameId) { return `gd_roster_${gameId}`; }
function readRosterCache(gameId, userId) {
  if (!gameId || !userId) return null;
  try {
    const c = JSON.parse(sessionStorage.getItem(_rosterCacheKey(gameId)));
    if (!c || c.userId !== userId || !c.ts || Date.now() - c.ts > ROSTER_CACHE_TTL) return null;
    return c.rows ?? null;
  } catch { return null; }
}
function writeRosterCache(gameId, userId, rows) {
  if (!gameId || !userId) return;
  try { sessionStorage.setItem(_rosterCacheKey(gameId), JSON.stringify({ rows, userId, ts: Date.now() })); } catch {}
}

// ── Screen
export default function GameDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();

  const rating     = location.state?.rating    ?? null;
  const backPath   = location.state?.backPath  ?? '/games';
  const mapReturn  = location.state?.mapReturn ?? null; // contexto de PickupGames (mapa/venue/sheet) a restaurar al volver

  const { user } = useAuth();

  const [sbGame, setSbGame] = useState(null);
  const _cachedRoster = readRosterCache(id, user?.id);
  const [sbRoster, setSbRoster] = useState(_cachedRoster ?? []);
  const [rosterReady, setRosterReady] = useState(_cachedRoster != null);
  const [spotsVerified, setSpotsVerified] = useState(false);

  const stateGame = location.state?.game ?? null;
  // sbGame (canonical DB fetch) wins for game data; stateGame contributes reservation extras only
  const sel = useMemo(() => {
    const base = sbGame ?? stateGame ?? GAMES.find(gm => gm.id === id) ?? null;
    if (!base || !stateGame) return base;
    return {
      ...base,
      paymentBreakdown:  stateGame.paymentBreakdown  ?? base.paymentBreakdown,
      paidBy:            stateGame.paidBy            ?? base.paidBy,
      paidByCode:        stateGame.paidByCode        ?? base.paidByCode,
      guestSubBreakdown: stateGame.guestSubBreakdown ?? base.guestSubBreakdown,
    };
  }, [sbGame, stateGame, id]);
  const g = useMemo(() => buildGame(sel), [sel]);

  const gameId  = sel?.id ?? id ?? null;
  const guestId = location.state?.game?.guestId ?? null;

  // Derived live from date+time — not from stale navigation state
  const isPastGame  = useMemo(() => isGamePast(g.dateKey, g.time24, g.durationMin), [g.dateKey, g.time24, g.durationMin]);
  const isStarted   = useMemo(() => isGameStarted(g.dateKey, g.time24), [g.dateKey, g.time24]);

  const gameState = useMemo(() => deriveGameState(sbRoster, user?.id), [sbRoster, user?.id]);
  const { isBooked, mySlotCanceled } = gameState;

  const isHost = !!user?.id && !!g.hostUserId && user.id === g.hostUserId;

  const guestCanceledView = location.state?.guestCanceledView ?? false;
  const infoMode  = (location.state?.infoMode ?? false) || isBooked || isHost;
  const isGuest   = !!g.paidBy;

  const confirmedRoster  = useMemo(() => sbRoster.filter(p => p.status === 'confirmed'), [sbRoster]);

  const liveRoster = useMemo(() => {
    function ageFromDate(iso) {
      if (!iso) return null;
      const [y, m, d] = iso.split('-').map(Number);
      const today = new Date();
      let age = today.getFullYear() - y;
      const mo = today.getMonth() + 1 - m;
      if (mo < 0 || (mo === 0 && today.getDate() < d)) age--;
      return age >= 0 ? age : null;
    }
    return confirmedRoster
      .slice()
      .sort((a, b) => (a.joined_at || '').localeCompare(b.joined_at || ''))
      .map(p => {
        const pos = Array.isArray(p.preferred_position)
          ? p.preferred_position.join(' · ')
          : (p.preferred_position || null);
        return {
          user_id:       p.user_id,
          name:          p.full_name || p.user_code || 'Jugador',
          position:      pos,
          age:           p.age ?? null,
          hue:           p.avatar_hue ?? null,
          avatarPath:    p.avatar_path ?? null,
          avatarVersion: p.avatar_updated_at ? new Date(p.avatar_updated_at).getTime() : null,
          checked_in_at: p.checked_in_at ?? null,
        };
      });
  }, [confirmedRoster]);

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
  const [inWaitlist,    setInWaitlist]    = useState(false);
  const [waitlistReady, setWaitlistReady] = useState(false);
  const [showWaitlistAuth, setShowWaitlistAuth] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [modifyOpen, setModifyOpen] = useState(false);
  const [cancelOpen,  setCancelOpen]  = useState(false);
  const [paymentDetailOpen, setPaymentDetailOpen] = useState(false);
  const [hostCancelInvitedOpen, setHostCancelInvitedOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [hostProfile, setHostProfile] = useState(null);

  const gameStart = useMemo(() => gameStartDate(g.dateKey, g.time24), [g.dateKey, g.time24]);
  const gameEnd   = useMemo(() => gameEndDate(g.dateKey, g.time24, g.durationMin), [g.dateKey, g.time24, g.durationMin]);
  // Attendance window: [game_start - 15min, game_end)
  const attendanceOpen = infoMode && !!gameStart && !!gameEnd
    && now >= new Date(gameStart.getTime() - 15 * 60_000)
    && now <  gameEnd;

  // Host action window: [game_start - 60min, game_end)
  const hostWindowOpen = isHost && !!gameStart && !!gameEnd
    && now >= new Date(gameStart.getTime() - 60 * 60_000)
    && now <  gameEnd;

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

  useEffect(() => {
    if (!gameId) return;
    if (!user?.id) { setInWaitlist(false); setWaitlistReady(true); return; }
    let pending = null;
    try { pending = sessionStorage.getItem('pending_waitlist_game'); } catch {}
    getMyWaitlistGameIds(user.id).then(ids => {
      const already = ids.includes(gameId);
      if (!already && pending === gameId) {
        // Inscripción pendiente tras autenticarse: completar automáticamente.
        joinWaitlist(user.id, gameId);
        setInWaitlist(true);
        try { sessionStorage.removeItem(`pg_waitlist_${user.id}`); } catch {}
        try { sessionStorage.setItem('profile_dirty', '1'); } catch {}
      } else {
        setInWaitlist(already);
      }
      if (pending === gameId) { try { sessionStorage.removeItem('pending_waitlist_game'); } catch {} }
      setWaitlistReady(true);
    });
  }, [user?.id, gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!g.hostUserId || !supabase) return;
    supabase
      .from('users_public')
      .select('full_name, user_code, avatar_hue, avatar_path, avatar_updated_at')
      .eq('id', g.hostUserId)
      .maybeSingle()
      .then(({ data }) => { if (data) setHostProfile(data); });
  }, [g.hostUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  function fetchRoster() {
    if (!supabase || !gameId) return;
    supabase
      .from('game_players')
      .select('user_id, payer_id, status, joined_at, checked_in_at, reservation_type, invited_by_user_id')
      .eq('game_id', gameId)
      .then(async ({ data, error }) => {
        if (error) { console.error('[GameDetail] game_players fetch error:', error); return; }
        const players = data ?? [];
        const ids = [...new Set(players.map(p => p.user_id).filter(Boolean))];
        const usersById = {};
        if (ids.length) {
          const { data: us } = await supabase
            .from('users_public')
            .select('id, full_name, user_code, avatar_hue, avatar_path, avatar_updated_at, preferred_position, age')
            .in('id', ids);
          (us || []).forEach(u => { usersById[u.id] = u; });
        }
        const rows = players.map(p => {
          const u = usersById[p.user_id] || {};
          return {
            ...p,
            full_name:          u.full_name          ?? null,
            user_code:          u.user_code          ?? null,
            avatar_hue:         u.avatar_hue         ?? null,
            avatar_path:        u.avatar_path        ?? null,
            avatar_updated_at:  u.avatar_updated_at  ?? null,
            preferred_position: u.preferred_position ?? null,
            age:                u.age                ?? null,
            reservation_type:   p.reservation_type   ?? null,
            invited_by_user_id: p.invited_by_user_id ?? null,
          };
        });
        setSbRoster(rows);
        setRosterReady(true);
        setSpotsVerified(true);
        writeRosterCache(gameId, user?.id, rows);
      });
  }

  const fgTick = useForegroundTick();
  useEffect(() => { fetchRoster(); }, [gameId, fgTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch roster when game transitions to past — ensures players see the final
  // attendance state even if they had GameDetail open before the host marked.
  const wasPastRef = useRef(isPastGame);
  useEffect(() => {
    if (isPastGame && !wasPastRef.current) fetchRoster();
    wasPastRef.current = isPastGame;
  }, [isPastGame]); // eslint-disable-line react-hooks/exhaustive-deps

  async function markAttendance(player) {
    if (!gameStart || !supabase || !player.user_id) return;
    const checkedInAt = new Date().toISOString();
    const { error } = await supabase
      .from('game_players')
      .update({ checked_in_at: checkedInAt })
      .eq('game_id', gameId)
      .eq('user_id', player.user_id)
      .eq('status', 'confirmed');
    if (error) { console.warn('[attendance]', error.message); return; }
    setSbRoster(prev => {
      const updated = prev.map(r => r.user_id === player.user_id ? { ...r, checked_in_at: checkedInAt } : r);
      writeRosterCache(gameId, user?.id, updated);
      return updated;
    });
    // Persist host presence silently on first mark — no-op if already set
    supabase.from('games')
      .update({ host_checked_in_at: checkedInAt })
      .eq('id', gameId)
      .is('host_checked_in_at', null);
  }

  async function resetAttendance(player) {
    if (!supabase || !player.user_id) return;
    const { error } = await supabase
      .from('game_players')
      .update({ checked_in_at: null })
      .eq('game_id', gameId)
      .eq('user_id', player.user_id)
      .eq('status', 'confirmed');
    if (error) { console.warn('[attendance-reset]', error.message); return; }
    setSbRoster(prev => {
      const updated = prev.map(r => r.user_id === player.user_id ? { ...r, checked_in_at: null } : r);
      writeRosterCache(gameId, user?.id, updated);
      return updated;
    });
  }


  // guests that current user paid for — same derivation as guestsInRoster, scoped to me as payer
  const guestOwnGuests = guestsInRoster;

  // players the host invited (reservation_type = 'invited', invited by current host)
  const invitedByHost = useMemo(() =>
    confirmedRoster.filter(p => p.reservation_type === 'invited' && p.invited_by_user_id === user?.id),
    [confirmedRoster, user?.id]
  );

  // user_id of whoever invited the current user (for "Invitado por" profile card)
  const payerUserId = useMemo(() => {
    if (!isGuest || !user?.id) return null;
    return sbRoster.find(p => p.user_id === user.id)?.payer_id ?? null;
  }, [isGuest, sbRoster, user?.id]);

  // live breakdown derived from Supabase — overrides stale/null location.state price
  const liveUnitPrice  = sbGame?.price ?? g.paymentBreakdown?.unitPrice ?? g.priceNumber;
  const liveBreakdown  = liveUnitPrice
    ? { unitPrice: liveUnitPrice, promoDiscount: g.paymentBreakdown?.promoDiscount ?? 0 }
    : g.paymentBreakdown;
  // true when my own slot is canceled (Rule 3: show titular-cancelado, hide paidBy)
  const livePaidBy     = mySlotCanceled ? null : g.paidBy;

  const isCanceledWithGuests = (titularCanceled || guestCanceledView || (mySlotCanceled && guestsInRoster.length > 0))
    && (guestCanceledView ? guestOwnGuests.length : guestsInRoster.length) > 0
    && !isBooked;

  function handleAddGuests() {
    setModifyOpen(false);
    const addGuestPrice = sbGame?.price ?? g.paymentBreakdown?.unitPrice ?? g.priceNumber;
    if (isHost) {
      navigate('/checkout', { state: {
        game: {
          id:           gameId,
          field:        g.field,
          date:         g.date,
          dateKey:      g.dateKey,
          time:         g.time,
          ampm:         g.ampm,
          time24:       g.time24,
          durationMin:  g.durationMin,
          format:       g.format,
          price:        `S/. ${addGuestPrice.toFixed(2)}`,
          priceNumber:  addGuestPrice,
          currency:     'S/.',
          source:       'pichanga',
          type:         g.type,
          invitedMode:  true,
          maxNewGuests: liveOpenSpots,
          hostUserId:   user?.id,
        },
        user: { name: user?.name || 'Usuario', email: user?.email || '' },
      }});
    } else {
      navigate('/checkout', { state: {
        game: {
          id:            gameId,
          field:         g.field,
          date:          g.date,
          dateKey:       g.dateKey,
          time:          g.time,
          ampm:          g.ampm,
          time24:        g.time24,
          durationMin:   g.durationMin,
          format:        g.format,
          price:         `S/. ${addGuestPrice.toFixed(2)}`,
          priceNumber:   addGuestPrice,
          currency:      'S/.',
          source:        'pichanga',
          type:          g.type,
          addGuestsMode: true,
          maxNewGuests:  liveOpenSpots,
          hostUserId:    g.hostUserId,
        },
        user: { name: user?.name || 'Usuario', email: user?.email || '' },
      }});
    }
  }

  function handleCancelDone() {
    try { sessionStorage.setItem('profile_dirty', '1'); } catch {}
    try { sessionStorage.removeItem(`pg_player_rows_${user?.id}`); } catch {}
    try { sessionStorage.removeItem(`pf_player_rows_${user?.id}`); } catch {}
    try { sessionStorage.removeItem(_rosterCacheKey(gameId)); } catch {}
    setCancelOpen(false);
    fetchRoster();
    navigate(backPath, mapReturn ? { state: { mapReturn } } : undefined);
  }

  const activeList = isCanceledWithGuests ? (guestCanceledView ? guestOwnGuests : guestsInRoster) : [];

  function handleWaitlistToggle() {
    if (!user) {
      setShowWaitlistAuth(true);
      return;
    }
    const next = !inWaitlist;
    setInWaitlist(next);
    if (next) joinWaitlist(user.id, gameId);
    else {
      leaveWaitlist(user.id, gameId);
      try {
        const wl = JSON.parse(localStorage.getItem('pichanga_waitlist')) || [];
        if (Array.isArray(wl)) localStorage.setItem('pichanga_waitlist', JSON.stringify(wl.filter(g => g.id !== gameId)));
      } catch {}
    }
    try { sessionStorage.removeItem(`pg_waitlist_${user?.id}`); } catch {}
    try { sessionStorage.setItem('profile_dirty', '1'); } catch {}
  }

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: BLUE, overflow: 'hidden' }}>
        <Header field={g.field} openSpots={openSpots} infoMode={infoMode} live={isStarted && !isPastGame} onBack={() => navigate(backPath, mapReturn ? { state: { mapReturn } } : undefined)}
          showShare={(!isFull || isBooked) && !isPastGame}
          onShare={() => {
            if (!gameId) return;
            shareOrCopy({ url: `${window.location.origin}/game/${gameId}`, title: g.field, text: `${g.date} · ${g.time} ${g.ampm}`, onCopied: () => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); } });
          }} />
        <div className="no-sb" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: '#fff' }}>
          <HeroImage coverPath={g?.venueCoverPath} coverVersion={g?.venueCoverVersion} />

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
              ) : isHost ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 16px', borderRadius: 999, background: ORANGE, fontSize: 13, fontWeight: 700, color: '#1B1B1F', letterSpacing: -0.1 }}>
                  <span>Organizador</span>
                  <span style={{ fontWeight: 600, opacity: 0.75 }}>· {confirmed}/{g.totalSpots}</span>
                  {guestsInRoster.length > 0 && (
                    <>
                      <span style={{ opacity: 0.6 }}>·</span>
                      <span style={{ fontWeight: 600 }}>{guestsInRoster.length} {guestsInRoster.length === 1 ? 'invitado activo' : 'invitados activos'}</span>
                    </>
                  )}
                </span>
              ) : g.paidBy ? (
                <button onClick={() => setSelectedPlayer({ name: g.paidBy, user_id: payerUserId })} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 14px', borderRadius: 999, background: '#F0FFF4', border: 'none', cursor: 'pointer', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
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
            <RatingBlock gameId={sel?.id ?? id ?? 'unknown'} existingRating={rating} gameType={g.type ?? 'match'} hostUserId={g.hostUserId} />
          )}

          <div style={{ padding: '12px 16px 4px' }}>
            <InfoRow
              icon={I.cal()}
              primary={g.date}
              secondary={`${g.time} ${g.ampm} · ${g.duration}`}
              action={(isHost || isBooked || isGuest || guestsInRoster.length > 0) ? <WAChatButton /> : undefined}
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
            {g.hostUserId ? (
              <button
                onClick={() => setSelectedPlayer({ name: hostProfile?.full_name || '', user_id: g.hostUserId, isHost: true })}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                <Avatar name={hostProfile?.full_name || ''} size={44} hue={hostProfile?.avatar_hue ?? null} avatarPath={hostProfile?.avatar_path ?? null} avatarVersion={hostProfile?.avatar_updated_at ? new Date(hostProfile.avatar_updated_at).getTime() : null} />
                <div style={{ fontSize: 'var(--gd-body, 14px)', color: TEXT, lineHeight: 1.4 }}>
                  Este juego está organizado por{' '}
                  <span style={{ fontWeight: 700 }}>{hostProfile?.full_name || '…'}</span>
                </div>
              </button>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar name={g.field || g.organizer.name} size={44} />
                <div style={{ fontSize: 'var(--gd-body, 14px)', color: TEXT, lineHeight: 1.4 }}>
                  Este juego es organizado por <span style={{ fontWeight: 700 }}>{g.field || g.organizer.name}</span>
                </div>
              </div>
            )}
          </Section>

          <Section title="Jugadores">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ color: TEXT, fontSize: 'var(--gd-is, 13.5px)', fontWeight: 600 }}>{confirmed} confirmados</span>
              <span style={{ color: SUB, fontSize: 'var(--gd-is, 13.5px)' }}>
                {openSpots === 0 ? '0 cupos libres' : `${openSpots} ${openSpots === 1 ? 'cupo libre' : 'cupos libres'}`}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {liveRoster.map((p) => {
                const showAtt      = attendanceOpen || isPastGame;
                const isRosterHost = p.user_id === g.hostUserId;
                return (
                  <div key={p.user_id}
                    onClick={() => setSelectedPlayer(p)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 12px', border: `1px solid ${HAIR}`, borderRadius: 14, background: '#fff',
                      cursor: 'pointer',
                    }}>
                    <div style={{ borderRadius: '50%', flexShrink: 0, boxShadow: isRosterHost ? `0 0 0 2px #fff, 0 0 0 3.5px ${ORANGE}` : undefined }}>
                      <Avatar name={p.name} size={36} hue={p.hue} avatarPath={p.avatarPath} avatarVersion={p.avatarVersion} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--gd-player, 14.5px)', fontWeight: 600, color: TEXT, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.name || ''}
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
                        checkedInAt={p.checked_in_at}
                        gameStart={gameStart}
                        isPast={isPastGame}
                        canMark={attendanceOpen && !p.checked_in_at && isHost}
                        onMark={() => markAttendance(p)}
                        canReset={attendanceOpen && !!p.checked_in_at && isHost}
                        onReset={() => resetAttendance(p)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </Section>

          <div style={{ height: 8 }} />
        </div>
        {rosterReady && waitlistReady && !infoMode && !isStarted && !isHost && (isFull || inWaitlist) && (
          <WaitlistRow inList={inWaitlist} openSpots={openSpots} onToggle={handleWaitlistToggle} />
        )}
        {isHost ? (
          /* ── Host action bar ───────────────────────────── */
          (!isPastGame && !isStarted) && (
            <div style={{ background: '#fff', borderTop: `1px solid ${HAIR}`, padding: '12px 16px' }}>
              <button
                onClick={() => setModifyOpen(true)}
                style={{ width: '100%', height: 46, borderRadius: 14, background: ORANGE, color: '#1B1B1F', border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', letterSpacing: -0.1, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                Gestionar el partido
              </button>
            </div>
          )
        ) : !rosterReady ? (
          /* ── Placeholder — reserves bar height until roster loads ── */
          <div style={{ height: 70, background: '#fff', borderTop: `1px solid ${HAIR}` }} />
        ) : (isBooked || infoMode) ? (
          /* ── Player: payment + gestionar ────────────────── */
          <div style={{ background: '#fff', borderTop: `1px solid ${HAIR}` }}>
            {(isPastGame || isStarted) && infoMode && <PaymentDetail price={g.price} breakdown={liveBreakdown} paidBy={livePaidBy} userName={user?.name || 'Usuario'} titularCanceled={titularCanceled || mySlotCanceled} activeGuestCount={isGuest ? guestOwnGuests.length : guestsInRoster.length} guestSubBreakdown={isGuest ? g.guestSubBreakdown : null} />}
            {(isBooked || guestsInRoster.length > 0) && !isStarted && (
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
          /* ── Non-booked player: CTA / canceled-guests ────── */
          <>
            {isCanceledWithGuests && (() => (
              <div style={{ background: '#fff', borderTop: `1px solid ${HAIR}` }}>
                {!isStarted && (
                  <div style={{ padding: '12px 16px 0' }}>
                    <button
                      onClick={() => setModifyOpen(true)}
                      style={{ width: '100%', padding: '8px 16px', background: 'transparent', border: `1.5px solid ${BLUE}`, borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: BLUE, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                      Gestionar mi reserva
                    </button>
                  </div>
                )}
              </div>
            ))()}
            {!isStarted && <CTA
              price={g.price}
              disabled={isFull || !spotsVerified}
              hideTopBorder={isFull || isCanceledWithGuests}
              onPress={() => {
                const checkoutGame = {
                  id:          g.id,
                  field:       g.field,
                  date:        g.date,
                  dateKey:     g.dateKey,
                  time:        g.time,
                  ampm:        g.ampm,
                  time24:      g.time24,
                  durationMin: g.durationMin,
                  format:      g.format,
                  price:       g.price,
                  priceNumber: g.priceNumber,
                  currency:    g.currency,
                  source:      'pichanga',
                  type:        g.type,
                  openSpots:   liveOpenSpots,
                  wasInWaitlist: inWaitlist,
                  backPath:    id ? `/game/${id}` : '/games',
                  gameDetailBackPath: backPath,
                  hostUserId:  g.hostUserId,
                };
                navigate('/checkout', { state: { game: checkoutGame } });
              }}
            />}
          </>
        )}
        <TabBar />
      {selectedPlayer && <PlayerModal player={selectedPlayer} isHost={selectedPlayer.isHost ?? false} onClose={() => setSelectedPlayer(null)} />}
      {showWaitlistAuth && (
        <div
          onClick={() => setShowWaitlistAuth(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 32px' }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 340, padding: '24px 22px 18px', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: TEXT, letterSpacing: -0.2, marginBottom: 8 }}>Lista de espera</div>
            <div style={{ fontSize: 14.5, color: SUB, lineHeight: 1.5, marginBottom: 20 }}>Ingresa para recibir notificaciones.</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setShowWaitlistAuth(false)}
                style={{ flex: 1, height: 46, borderRadius: 14, border: `1px solid ${HAIR}`, background: '#fff', color: TEXT, fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                Cancelar
              </button>
              <button
                onClick={() => {
                  setShowWaitlistAuth(false);
                  try { sessionStorage.setItem('pending_waitlist_game', gameId); } catch {}
                  navigate('/checkout', { state: { waitlistMode: true, backPath: id ? `/game/${id}` : '/games' } });
                }}
                style={{ flex: 1, height: 46, borderRadius: 14, border: 'none', background: BLUE, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                Ingresar
              </button>
            </div>
          </div>
        </div>
      )}
      {modifyOpen && (
        <ModifySheet
          canAddGuests={liveOpenSpots > 0}
          openSpots={liveOpenSpots}
          onClose={() => setModifyOpen(false)}
          onAddGuests={handleAddGuests}
          onCancel={() => { setModifyOpen(false); isHost ? setHostCancelInvitedOpen(true) : setCancelOpen(true); }}
          onPaymentDetail={() => { setModifyOpen(false); setPaymentDetailOpen(true); }}
          isHost={isHost}
          canAddPlayers={hostWindowOpen}
          invitedCount={invitedByHost.length}
        />
      )}
      {hostCancelInvitedOpen && (
        <HostCancelInvitedSheet
          gameId={gameId}
          invitedPlayers={invitedByHost}
          unitPrice={liveUnitPrice}
          onClose={() => setHostCancelInvitedOpen(false)}
          onDone={() => { setHostCancelInvitedOpen(false); fetchRoster(); }}
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
