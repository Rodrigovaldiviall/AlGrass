import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { BLUE, TEXT, SUB, HAIR, ORANGE, SOFT, GREEN, RED, DANGER, WHATSAPP_NUMBER, WHATSAPP_DISPLAY, SUPPORT_EMAIL } from '../constants';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faWhatsapp } from '@fortawesome/free-brands-svg-icons';
import { faHeadset, faCoins } from '@fortawesome/free-solid-svg-icons';
import TabBar from '../components/TabBar';
import { useAuth } from '../context/AuthContext';
import { useStaff } from '../context/StaffContext';
import { supabase } from '../lib/supabase';
import { abbreviateName, ensureUserCode, formatDateLabel } from '../utils/format';
import { GAMES } from '../data/games';
import { deriveGameState, isGamePast, isGameStarted, gameStartDate } from '../utils/deriveGameState';
import { GameMetaLine } from '../components/GameMetaLine';
import ConfirmedOverlay from '../components/ConfirmedOverlay';
import { saveRating } from '../services/ratingService';

const USER = {
  name: 'Rodrigo',
  location: 'Lima, Perú',
  email: 'rodrigo@gmail.com',
  gamesPlayed: 10,
  gender: 'Hombre',
  district: null,
  avatarHue: 210,
};



const POSITIONS = ['DEL', 'MED', 'DEF', 'ARQ'];

const DEFAULT_COUNTRIES = [
  'Perú', 'Venezuela', 'Colombia', 'Ecuador', 'Argentina', 'Bolivia',
  'Brasil', 'Chile', 'México', 'Uruguay', 'Paraguay', 'España',
];

const DEFAULT_CITIES = [
  'Arequipa', 'Lima', 'Cusco', 'Trujillo', 'Piura', 'Chiclayo',
  'Iquitos', 'Huancayo', 'Tacna', 'Puno', 'Cajamarca', 'Ica',
];

const CITIES = [
  'Arequipa',
  'Abancay', 'Ayacucho', 'Bagua', 'Barranca', 'Cajamarca', 'Callao',
  'Chimbote', 'Chiclayo', 'Chincha Alta', 'Cusco', 'Huancayo', 'Huánuco',
  'Huaraz', 'Ica', 'Ilo', 'Iquitos', 'Jaén', 'Juliaca', 'Lima',
  'Moquegua', 'Moyobamba', 'Pasco', 'Piura', 'Pucallpa', 'Puerto Maldonado',
  'Puno', 'Sicuani', 'Sullana', 'Tacna', 'Tarapoto', 'Tingo María',
  'Trujillo', 'Tumbes', 'Yurimaguas',
];

const COUNTRIES = [
  'Perú',
  'Afganistán', 'Albania', 'Alemania', 'Algeria', 'Andorra', 'Angola',
  'Arabia Saudita', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaiyán',
  'Bangladés', 'Bélgica', 'Belice', 'Bolivia', 'Bosnia y Herzegovina', 'Brasil', 'Bulgaria',
  'Camerún', 'Canadá', 'Chile', 'China', 'Chipre', 'Colombia', 'Congo', 'Corea del Norte',
  'Corea del Sur', 'Costa Rica', 'Croacia', 'Cuba',
  'Dinamarca',
  'Ecuador', 'Egipto', 'El Salvador', 'Emiratos Árabes Unidos', 'España', 'Estados Unidos', 'Etiopía',
  'Filipinas', 'Finlandia', 'Francia',
  'Ghana', 'Grecia', 'Guatemala', 'Guinea',
  'Haití', 'Honduras', 'Hungría',
  'India', 'Indonesia', 'Irak', 'Irán', 'Irlanda', 'Israel', 'Italia',
  'Jamaica', 'Japón', 'Jordania',
  'Kazajistán', 'Kenia',
  'Líbano', 'Libia',
  'Malasia', 'Marruecos', 'México', 'Mozambique',
  'Nepal', 'Nicaragua', 'Nigeria', 'Noruega', 'Nueva Zelanda',
  'Países Bajos', 'Pakistán', 'Panamá', 'Paraguay', 'Polonia', 'Portugal',
  'Qatar',
  'República Checa', 'República Dominicana', 'Rumanía', 'Rusia',
  'Senegal', 'Serbia', 'Somalia', 'Sri Lanka', 'Sudáfrica', 'Suecia', 'Suiza',
  'Tailandia', 'Tanzania', 'Túnez', 'Turquía',
  'Ucrania', 'Uganda', 'Uruguay',
  'Venezuela', 'Vietnam',
  'Yemen', 'Zimbabue',
];

const PREFIX_DATA = [
  { code: '+51',  digits: '51',  label: 'Perú',          exact: 9 },
  { code: '+54',  digits: '54',  label: 'Argentina' },
  { code: '+591', digits: '591', label: 'Bolivia' },
  { code: '+55',  digits: '55',  label: 'Brasil' },
  { code: '+56',  digits: '56',  label: 'Chile' },
  { code: '+86',  digits: '86',  label: 'China' },
  { code: '+57',  digits: '57',  label: 'Colombia' },
  { code: '+593', digits: '593', label: 'Ecuador' },
  { code: '+34',  digits: '34',  label: 'España' },
  { code: '+1',   digits: '1',   label: 'Estados Unidos' },
  { code: '+595', digits: '595', label: 'Paraguay' },
  { code: '+598', digits: '598', label: 'Uruguay' },
  { code: '+58',  digits: '58',  label: 'Venezuela' },
];

function detectPrefix(input) {
  const d = input.replace(/[^\d]/g, '');
  for (const len of [3, 2, 1]) {
    const found = PREFIX_DATA.find(p => p.digits === d.slice(0, len));
    if (found) return found;
  }
  return null;
}

const MONTH_LABELS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const PROFILE_KEY  = 'pichanga_profile';
const STORAGE_KEY  = 'pichanga_reservations';
const WAITLIST_KEY_P = 'pichanga_waitlist';
const CREDIT_KEY   = 'pichanga_credit';

function waitlistGameToRow(gameId) {
  const g = GAMES.find(gm => gm.id === gameId);
  if (!g) return null;
  return { id: g.id, dateKey: g.dateKey, time24: g.time24 ?? null, date: formatDateLabel(g.dateKey), time: g.time, ampm: g.ampm, field: g.field, format: g.format || '7v7', status: 'waitlist', type: 'game', price: g.price != null ? `S/. ${Number(g.price).toFixed(2)}` : null, openSpots: g.openSpots ?? 0 };
}
const RATINGS_KEY  = 'pichanga_ratings';
const SHOWN_KEY    = 'pichanga_shown_confirmations';
const SKIPPED_KEY  = 'pichanga_skipped_ratings';
const ROSTER_KEY   = 'pichanga_game_rosters';
const PLAYED_KEY   = 'pichanga_played_games';

function savePlayedGame(gameId) {
  try {
    const rosters = JSON.parse(localStorage.getItem(ROSTER_KEY) || '{}');
    const roster = rosters[gameId];
    if (!roster?.players?.length) return;
    const existing = JSON.parse(localStorage.getItem(PLAYED_KEY) || '[]');
    if (existing.some(g => g.gameId === gameId)) return;
    const updated = [...existing, { gameId, gameTs: Date.now(), players: roster.players }];
    localStorage.setItem(PLAYED_KEY, JSON.stringify(updated));
  } catch {}
}

function deriveGuestGames(reservations) {
  try {
    const rosters = JSON.parse(localStorage.getItem(ROSTER_KEY) || '{}');
    const profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
    const myCode  = (profile.userCode || '').trim().toUpperCase();
    if (!myCode) return [];

    const allStored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const rows = [];
    for (const [gameId, roster] of Object.entries(rosters)) {
      if (!roster?.players?.length) continue;
      const myEntry    = roster.players.find(p => (p.code || '').trim().toUpperCase() === myCode);
      const mySubGuests = roster.players.filter(p => (p.addedByCode || '').trim().toUpperCase() === myCode);
      if (!myEntry) {
        // Invited user's slot was cancelled but their own sub-guests are still active
        if (mySubGuests.length > 0 && roster.guestSubBreakdowns?.[myCode]) {
          const payerGame = allStored.find(g => g.id === gameId) || roster.gameDetails;
          if (payerGame) {
            const sub = roster.guestSubBreakdowns[myCode];
            rows.push({
              id: `${gameId}_gc_${myCode}`, gameId,
              dateKey: payerGame.dateKey ?? null,
              time24:  payerGame.time24  ?? null,
              date: payerGame.date, time: payerGame.time, ampm: payerGame.ampm,
              field: payerGame.field, format: payerGame.format, type: payerGame.type || 'game',
              price: `S/. ${(mySubGuests.length * (sub.unitPrice || 0)).toFixed(2)}`,
              status: 'guest-canceled-with-sub-guests',
              activeGuestCount: mySubGuests.length,
              guestSubBreakdown: sub,
            });
          }
        }
        continue;
      }
      const payerGame = allStored.find(g => g.id === gameId) || roster.gameDetails;
      if (!payerGame) continue;
      rows.push({
        id:        `${gameId}_g_${myEntry.id}`,
        gameId,
        dateKey:   payerGame.dateKey ?? null,
        time24:    payerGame.time24  ?? null,
        date:      payerGame.date,
        time:      payerGame.time,
        ampm:      payerGame.ampm,
        field:     payerGame.field,
        format:    payerGame.format,
        type:      payerGame.type || 'game',
        price:     null,
        status:    'guest',
        guestId:   myEntry.id,
        guestName: myEntry.name,
        paidBy:     roster.payerName || 'Usuario',
        paidByCode: roster.payerCode  || null,
        paidAt:     roster.reservedAt,
        guestSubBreakdown: roster.guestSubBreakdowns?.[myCode] || null,
        activeGuestCount: mySubGuests.length > 0 ? mySubGuests.length : null,
      });
    }
    return rows;
  } catch { return []; }
}


function deriveCanceledWithGuestsGames() {
  try {
    const rosters = JSON.parse(localStorage.getItem(ROSTER_KEY) || '{}');
    const profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
    const myCode  = (profile.userCode || '').trim().toUpperCase();
    const rows = [];
    for (const [gameId, roster] of Object.entries(rosters)) {
      if (!roster?.titularCanceled || !roster.players?.length) continue;
      if (myCode && (roster.titularCode || '').trim().toUpperCase() !== myCode) continue;
      const g = GAMES.find(gm => gm.id === gameId);
      if (!g) continue;
      const breakdown = roster.paymentBreakdown ?? null;
      const activeGuestCount = roster.players.length;
      const livePrice = breakdown
        ? `S/. ${(activeGuestCount * (breakdown.unitPrice || 0)).toFixed(2)}`
        : null;
      rows.push({
        id: gameId,
        dateKey: g.dateKey,
        time24: g.time24 ?? null,
        date: formatDateLabel(g.dateKey),
        time: g.time,
        ampm: g.ampm,
        field: g.field,
        format: g.format || '7v7',
        status: 'canceled-with-guests',
        type: 'game',
        price: livePrice,
        paymentBreakdown: breakdown,
        activeGuestCount,
      });
    }
    return rows;
  } catch { return []; }
}

function calcAge(day, month, year) {
  if (!day || !month || !year) return null;
  const today = new Date();
  const born  = new Date(year, month - 1, day);
  let age = today.getFullYear() - born.getFullYear();
  const m = today.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < born.getDate())) age--;
  return age >= 0 ? age : null;
}

function isPast(g)    { return isGamePast(g.dateKey, g.time24, g.durationMin); }
function isStarted(g) { return isGameStarted(g.dateKey, g.time24); }

function parseGameTime(t) {
  if (!t) return { time: '', ampm: 'AM' };
  const [hStr, mStr] = t.split(':');
  const h24 = parseInt(hStr, 10);
  const m   = (mStr || '00').padStart(2, '0');
  return { time: `${h24 % 12 || 12}:${m}`, ampm: h24 >= 12 ? 'PM' : 'AM' };
}

function sbReservationToRow(r) {
  const g = r.games;
  const { time, ampm } = parseGameTime(g?.time);
  return {
    id:      r.game_id,
    dateKey:     g?.date_key    ?? null,
    time24:      g?.time        ?? null,
    durationMin: g?.duration_min ?? g?.fields?.duration_min ?? null,
    date:        formatDateLabel(g?.date_key),
    time,
    ampm,
    field:      g?.fields?.venues?.name  || '',
    format:     g?.format ?? g?.fields?.format ?? '7v7',
    totalSpots: g?.total_spots ?? g?.fields?.total_spots ?? 0,
    womenOnly:  g?.game_amenities?.women_only ?? false,
    covered:    g?.fields?.field_amenities?.covered ?? false,
    parking:    g?.fields?.venues?.venue_amenities?.parking ?? false,
    hostUserId: g?.host_user_id ?? null,
    status: 'reserved',
    type:   r.source === 'campo' ? 'campo' : 'game',
    price:  r.total_amount != null ? `S/. ${Number(r.total_amount).toFixed(2)}` : null,
    paymentBreakdown: r.unit_price != null ? {
      unitPrice:     r.unit_price,
      promoDiscount: r.promo_discount  || 0,
      creditApplied: r.credit_applied  || 0,
      discount:      (r.promo_discount || 0) + (r.credit_applied || 0),
      guestsCount:   0,
      guestsTotal:   0,
      total:         r.total_amount    || 0,
    } : null,
    activeGuestCount: 0,
  };
}

function sbHostedGameToRow(g) {
  const { time, ampm } = parseGameTime(g?.time);
  const field      = g?.fields;
  const venue      = field?.venues;
  const totalSpots = g?.total_spots ?? field?.total_spots ?? 0;
  const openSpots  = Math.max(0, totalSpots - (g?.current_players ?? 0));
  return {
    id:          g.id,
    dateKey:     g.date_key    ?? null,
    time24:      g.time        ?? null,
    durationMin: g.duration_min ?? field?.duration_min ?? null,
    date:        formatDateLabel(g.date_key),
    time,
    ampm,
    field:       venue?.name || '',
    format:      g.format ?? field?.format ?? '7v7',
    totalSpots,
    openSpots,
    womenOnly:   g.game_amenities?.women_only ?? false,
    covered:     field?.field_amenities?.covered ?? false,
    parking:     venue?.venue_amenities?.parking ?? false,
    hostUserId:  g.host_user_id ?? null,
    status:      'reserved',
    type:        'game',
    price:       null,
    activeGuestCount: 0,
  };
}

function confirmedGameToRow(cg) {
  const parts = (cg.time || '').split(' ');
  const gameId = cg.id ?? null;
  let activeGuestCount = 0;
  if (gameId) {
    try {
      const rosters = JSON.parse(localStorage.getItem(ROSTER_KEY) || '{}');
      activeGuestCount = rosters[gameId]?.players?.length ?? 0;
    } catch {}
  }
  return {
    id: gameId ?? ('c-' + Date.now()),
    dateKey:     cg.dateKey  ?? null,
    time24:      cg.time24   ?? null,
    durationMin: cg.durationMin ?? null,
    date: cg.date || '',
    time: parts[0] || cg.time || '',
    ampm: cg.ampm || parts[1] || '',
    field: cg.field || 'Cancha',
    format: cg.format || '7v7',
    status: 'reserved',
    type: cg.source === 'campo' ? 'campo' : 'game',
    price: cg.amount != null ? `S/. ${Number(cg.amount).toFixed(2)}` : (cg.price || null),
    paymentBreakdown: cg.unitPrice != null ? {
      unitPrice:    cg.unitPrice,
      promoDiscount: cg.promoDiscount ?? 0,
      creditApplied: cg.creditApplied ?? 0,
      discount:     cg.discount     ?? 0,
      guestsCount:  cg.guestsCount  ?? 0,
      guestsTotal:  cg.guestsTotal  ?? 0,
      total:        cg.amount       ?? 0,
    } : null,
    activeGuestCount,
  };
}

function computeLivePrice(game) {
  const bd = game.paymentBreakdown;
  if (!bd || !game.id) return game.price;
  try {
    const rosters = JSON.parse(localStorage.getItem(ROSTER_KEY) || '{}');
    const roster = rosters[game.id];
    const titularCanceled = roster?.titularCanceled ?? false;
    const activeGuestCount = roster?.players?.length ?? 0;
    const activeGuestsTotal = activeGuestCount * (bd.unitPrice || 0);
    const total = titularCanceled
      ? activeGuestsTotal
      : Math.max(0, (bd.unitPrice || 0) - (bd.promoDiscount || 0) + activeGuestsTotal);
    return `S/. ${total.toFixed(2)}`;
  } catch { return game.price; }
}

function sortByDt(arr, desc) {
  return [...arr].sort((a, b) => {
    const da = gameStartDate(a.dateKey, a.time24), db = gameStartDate(b.dateKey, b.time24);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return desc ? db - da : da - db;
  });
}

// ── Icons ──────────────────────────────────────────────────────────────────

const SwapIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M3 5h12M3 5l3-3M3 5l3 3M15 13H3M15 13l-3-3M15 13l-3 3" stroke="#1B1B1F" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const GearIcon = ({ color = SUB }) => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
    <circle cx="11" cy="11" r="3" stroke={color} strokeWidth="1.6"/>
    <path d="M11 2.5v1.8M11 17.7v1.8M2.5 11h1.8M17.7 11h1.8M4.9 4.9l1.3 1.3M15.8 15.8l1.3 1.3M4.9 17.1l1.3-1.3M15.8 6.2l1.3-1.3" stroke={color} strokeWidth="1.6" strokeLinecap="round"/>
  </svg>
);

const HeadsetIcon = () => <FontAwesomeIcon icon={faHeadset} style={{ fontSize: 20, color: TEXT }} />;

const EmailIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <rect x="2" y="4" width="20" height="16" rx="3" stroke={SUB} strokeWidth="1.6"/>
    <path d="M2 7l10 7 10-7" stroke={SUB} strokeWidth="1.6" strokeLinejoin="round"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M3 7l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const PeopleIcon = () => (
  <svg width="16" height="14" viewBox="0 0 18 14" fill="none">
    <circle cx="6" cy="4" r="2.4" stroke={SUB} strokeWidth="1.5"/>
    <path d="M1.5 13c0-2.3 2-4 4.5-4s4.5 1.7 4.5 4" stroke={SUB} strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="13" cy="5" r="2" stroke={SUB} strokeWidth="1.5"/>
    <path d="M11 13c0-1.9 1.6-3.3 3.5-3.3S18 11.1 18 13" stroke={SUB} strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const ChevIcon = () => (
  <svg width="8" height="13" viewBox="0 0 8 13" fill="none">
    <path d="M1 1l6 5.5L1 12" stroke="#C7C7CC" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const LockIcon = ({ locked }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="3" y="7" width="10" height="8" rx="2" stroke={locked ? SUB : BLUE} strokeWidth="1.5"/>
    <path d={locked ? 'M5 7V5a3 3 0 0 1 6 0v2' : 'M5 7V5a3 3 0 0 1 6 0'} stroke={locked ? SUB : BLUE} strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const CameraIcon = () => (
  <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
    <path d="M7.5 3l-1.5 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3L12.5 3h-5z" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/>
    <circle cx="10" cy="10" r="2.5" stroke="#fff" strokeWidth="1.6"/>
  </svg>
);

// ── SupportMenu ────────────────────────────────────────────────────────────

function SupportMenu({ onClose }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div style={{
        position: 'absolute', top: 46, right: 0, zIndex: 41,
        background: '#fff', borderRadius: 18,
        boxShadow: '0 8px 32px rgba(0,0,0,0.16)', border: `1px solid ${HAIR}`,
        minWidth: 252, padding: '6px 0', overflow: 'hidden',
      }}>
        <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noreferrer" onClick={onClose}
          style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', textDecoration: 'none' }}>
          <FontAwesomeIcon icon={faWhatsapp} style={{ fontSize: 24, color: '#25D366', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, lineHeight: 1.2 }}>WhatsApp</div>
            <div style={{ fontSize: 12.5, color: SUB, marginTop: 2 }}>{WHATSAPP_DISPLAY}</div>
          </div>
        </a>
        <div style={{ height: 1, background: HAIR, margin: '0 16px' }} />
        <a href={`mailto:${SUPPORT_EMAIL}`} onClick={onClose}
          style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', textDecoration: 'none' }}>
          <EmailIcon />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, lineHeight: 1.2 }}>Email</div>
            <div style={{ fontSize: 12.5, color: SUB, marginTop: 2 }}>{SUPPORT_EMAIL}</div>
          </div>
        </a>
      </div>
    </>
  );
}

// ── Avatar ─────────────────────────────────────────────────────────────────

function Avatar({ name, hue = 210, size = 80, photoUrl = null }) {
  if (photoUrl) {
    return (
      <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
        <img src={photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }
  const initials = (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(160deg, hsl(${hue} 65% 62%), hsl(${(hue + 30) % 360} 60% 48%))`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 800, fontSize: size * 0.32, flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

// ── StatItem ───────────────────────────────────────────────────────────────

function StatItem({ value, label }) {
  const empty = value == null || value === '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: empty ? '#C7C7CC' : TEXT, letterSpacing: -0.3, lineHeight: 1 }}>
        {empty ? '—' : String(value)}
      </div>
      <div style={{ fontSize: 11, color: SUB, marginTop: 2, letterSpacing: -0.1 }}>{label}</div>
    </div>
  );
}

// ── ProfileCard ────────────────────────────────────────────────────────────

function ProfileCard({ user, gamesPlayedCount, onEdit, isProfileComplete = false, isHostOrStaff = false, hasActivity = false }) {
  const displayName = user.name || '';
  const posDisplay  = Array.isArray(user.positions) && user.positions.length > 0
    ? user.positions.join(' · ')
    : (user.position || null);
  const age = calcAge(user.birthDay, user.birthMonth, user.birthYear);

  return (
    <div style={{
      margin: '0 16px', background: '#fff', borderRadius: 20,
      boxShadow: '0 2px 14px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)',
      padding: 16, position: 'relative',
    }}>
      {onEdit && (
        <button onClick={onEdit} style={{
          position: 'absolute', top: 12, right: 12,
          width: 30, height: 30, borderRadius: '50%',
          background: SOFT, border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          WebkitTapHighlightColor: 'transparent', outline: 'none', padding: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M11 2l3 3-9 9H2v-3L11 2z" stroke={SUB} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Left col — 2/5 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '0 0 40%' }}>
          <div style={{ position: 'relative', marginBottom: 8, width: 84, height: 84, borderRadius: '50%', boxShadow: isHostOrStaff ? `0 0 0 2.5px #fff, 0 0 0 5px ${ORANGE}` : undefined }}>
            <Avatar name={user.name} hue={user.avatarHue} size={84} photoUrl={user.photoDataUrl} />
            {isProfileComplete ? (
              <div style={{
                position: 'absolute', bottom: 2, right: 2,
                width: 22, height: 22, borderRadius: '50%',
                background: ORANGE, border: '2px solid #fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="#fff">
                  <path d="M6 1l1.3 3.3H11l-2.8 2 1.1 3.3L6 7.7l-3.3 1.6 1.1-3.3L1 4.3h3.7z"/>
                </svg>
              </div>
            ) : hasActivity ? (
              <div style={{
                position: 'absolute', bottom: 2, right: 2,
                width: 22, height: 22, borderRadius: '50%',
                background: GREEN, border: '2px solid #fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <CheckIcon />
              </div>
            ) : null}
          </div>
          <div style={{
            fontSize: 16, fontWeight: 800, color: TEXT, letterSpacing: -0.3,
            textAlign: 'center', lineHeight: 1.2,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {displayName}
          </div>
          <div style={{ fontSize: 12, color: BLUE, fontWeight: 600, marginTop: 3, textAlign: 'center' }}>
            {user.userCode ? `@${user.userCode}` : ''}
          </div>
          <div style={{ fontSize: 11.5, color: SUB, marginTop: 3, textAlign: 'center', lineHeight: 1.3 }}>
            {user.city || 'Arequipa'}
          </div>
        </div>

        {/* Right col — 3/5 */}
        <div style={{ flex: '0 0 60%', display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
          <StatItem value={gamesPlayedCount} label="Partidos jugados" />
          <div style={{ height: 1, background: HAIR }} />
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
            <StatItem value={user.gender} label="Sexo" />
            <div style={{ marginLeft: 32 }}><StatItem value={age} label="Edad" /></div>
          </div>
          <div style={{ height: 1, background: HAIR }} />
          <StatItem value={posDisplay} label="Posición de juego" />
        </div>
      </div>
    </div>
  );
}

// ── Edit modal helpers (must be outside EditProfileModal to keep stable identity) ──

function FieldRow({ label, children }) {
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ fontSize: 11, color: SUB, marginBottom: 3, letterSpacing: 0.1 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>
    </div>
  );
}

function smoothScrollTo(el, target, ms = 250) {
  const from = el.scrollTop;
  const dist = target - from;
  if (!dist) return;
  const t0 = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - t0) / ms);
    el.scrollTop = from + dist * (1 - Math.pow(1 - p, 3));
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function NationalityPicker({ value, onChange }) {
  const [open,    setOpen]    = useState(false);
  const [search,  setSearch]  = useState('');
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const searchRef = useRef(null);
  const btnRef    = useRef(null);
  const listRef   = useRef(null);
  const drag = useRef({ active: false, moved: false, startY: 0, startScroll: 0, velY: 0, lastY: 0, lastT: 0 });

  const ITEM_H  = 37;
  const VISIBLE = 10;

  const filtered = search
    ? COUNTRIES.filter(c => c.toLowerCase().includes(search.toLowerCase()))
    : DEFAULT_COUNTRIES;

  function select(c) { onChange(c); setOpen(false); setSearch(''); }

  function handleOpen(e) {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r     = btnRef.current.getBoundingClientRect();
      const listH = Math.min(VISIBLE, filtered.length || 1) * ITEM_H;
      const dropH = 37 + listH + 2;
      const below = window.innerHeight - r.bottom - 8;
      const top   = below >= dropH ? r.bottom + 4 : Math.max(8, r.top - dropH - 4);
      setDropPos({ top, left: r.left, width: r.width });
    }
    setOpen(v => !v);
    setTimeout(() => {
      searchRef.current?.focus();
      if (listRef.current && !search) {
        const idx = filtered.indexOf(value);
        if (idx >= 0) listRef.current.scrollTop = idx * ITEM_H;
      }
    }, 60);
  }

  function onPD(e) {
    if (e.button > 0) return;
    const el = listRef.current;
    if (!el) return;
    drag.current = { active: true, moved: false, startY: e.clientY, startScroll: el.scrollTop, velY: 0, lastY: e.clientY, lastT: Date.now() };
    try { el.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  }

  function onPM(e) {
    const d = drag.current;
    if (!d.active) return;
    const el = listRef.current;
    if (!el) return;
    const dy = d.startY - e.clientY;
    if (Math.abs(dy) > 3) d.moved = true;
    el.scrollTop = d.startScroll + dy;
    const now = Date.now();
    if (now - d.lastT > 0) d.velY = (d.lastY - e.clientY) / (now - d.lastT);
    d.lastY = e.clientY;
    d.lastT = now;
  }

  function onPU(e) {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    const el = listRef.current;
    if (!el) return;
    if (!d.moved) {
      const rect = el.getBoundingClientRect();
      const idx  = Math.floor((e.clientY - rect.top + el.scrollTop) / ITEM_H);
      if (idx >= 0 && idx < filtered.length) select(filtered[idx]);
      return;
    }
    const vel      = d.velY;
    const clamped  = Math.max(-2, Math.min(2, vel));
    const momentum = (clamped * Math.abs(clamped)) / (2 * 0.003);
    const maxScroll = el.scrollHeight - el.clientHeight;
    const snapped  = Math.round(Math.max(0, Math.min(el.scrollTop + momentum, maxScroll)) / ITEM_H) * ITEM_H;
    smoothScrollTo(el, snapped);
  }

  function onWheel(e) {
    const el = listRef.current;
    if (!el) return;
    const step = e.deltaY > 0 ? ITEM_H : -ITEM_H;
    const maxScroll = el.scrollHeight - el.clientHeight;
    smoothScrollTo(el, Math.round(Math.max(0, Math.min(el.scrollTop + step, maxScroll)) / ITEM_H) * ITEM_H, 180);
  }

  const listH = Math.min(VISIBLE, filtered.length || 1) * ITEM_H;

  const selBtn = {
    width: '100%', height: 34, borderRadius: 8,
    border: `1px solid ${HAIR}`, padding: '0 24px 0 8px',
    textAlign: 'left', background: `${SOFT} url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23999' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 8px center`,
    fontSize: 13.5, color: TEXT, fontFamily: 'inherit',
    cursor: 'pointer', outline: 'none', boxSizing: 'border-box',
    WebkitTapHighlightColor: 'transparent',
  };

  return (
    <div style={{ flex: 1 }}>
      <button ref={btnRef} style={{ ...selBtn, color: value ? TEXT : SUB }} onClick={handleOpen}>
        {value || 'Seleccionar'}
      </button>
      {open && createPortal(
        <>
          <div onClick={() => { setOpen(false); setSearch(''); }} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
          <div style={{
            position: 'fixed', top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999,
            background: '#fff', borderRadius: 10, border: `1px solid ${HAIR}`,
            boxShadow: '0 4px 18px rgba(0,0,0,0.14)', overflow: 'hidden',
          }}>
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar país…"
              style={{
                display: 'block', width: '100%', boxSizing: 'border-box',
                padding: '8px 10px', border: 'none', borderBottom: `1px solid ${HAIR}`,
                fontSize: 13.5, color: TEXT, fontFamily: 'inherit',
                background: SOFT, outline: 'none',
              }}
            />
            <div
              ref={listRef}
              className="no-sb"
              onPointerDown={onPD}
              onPointerMove={onPM}
              onPointerUp={onPU}
              onPointerCancel={onPU}
              onWheel={onWheel}
              style={{
                height: listH,
                overflowY: 'hidden',
                cursor: 'grab',
                userSelect: 'none',
                touchAction: 'none',
              }}
            >
              {filtered.length === 0 ? (
                <div style={{ height: ITEM_H, display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 13, color: SUB }}>Sin resultados</div>
              ) : filtered.map(c => (
                <div key={c} style={{
                  height: ITEM_H, display: 'flex', alignItems: 'center',
                  padding: '0 12px', fontSize: 13.5, boxSizing: 'border-box',
                  color: c === value ? BLUE : TEXT,
                  fontWeight: c === value ? 600 : 400,
                  background: c === value ? `${BLUE}10` : 'transparent',
                }}>
                  {c}
                </div>
              ))}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

function CityPicker({ value, onChange }) {
  const [open,    setOpen]    = useState(false);
  const [search,  setSearch]  = useState('');
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const searchRef = useRef(null);
  const btnRef    = useRef(null);
  const listRef   = useRef(null);
  const drag = useRef({ active: false, moved: false, startY: 0, startScroll: 0, velY: 0, lastY: 0, lastT: 0 });

  const ITEM_H  = 37;
  const VISIBLE = 10;

  const filtered = search
    ? CITIES.filter(c => c.toLowerCase().includes(search.toLowerCase()))
    : DEFAULT_CITIES;

  function select(c) { onChange(c); setOpen(false); setSearch(''); }

  function handleOpen(e) {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r     = btnRef.current.getBoundingClientRect();
      const listH = Math.min(VISIBLE, filtered.length || 1) * ITEM_H;
      const dropH = 37 + listH + 2;
      const below = window.innerHeight - r.bottom - 8;
      const top   = below >= dropH ? r.bottom + 4 : Math.max(8, r.top - dropH - 4);
      setDropPos({ top, left: r.left, width: r.width });
    }
    setOpen(v => !v);
    setTimeout(() => {
      searchRef.current?.focus();
      if (listRef.current && !search) {
        const idx = filtered.indexOf(value);
        if (idx >= 0) listRef.current.scrollTop = idx * ITEM_H;
      }
    }, 60);
  }

  function onPD(e) {
    if (e.button > 0) return;
    const el = listRef.current;
    if (!el) return;
    drag.current = { active: true, moved: false, startY: e.clientY, startScroll: el.scrollTop, velY: 0, lastY: e.clientY, lastT: Date.now() };
    try { el.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  }

  function onPM(e) {
    const d = drag.current;
    if (!d.active) return;
    const el = listRef.current;
    if (!el) return;
    const dy = d.startY - e.clientY;
    if (Math.abs(dy) > 3) d.moved = true;
    el.scrollTop = d.startScroll + dy;
    const now = Date.now();
    if (now - d.lastT > 0) d.velY = (d.lastY - e.clientY) / (now - d.lastT);
    d.lastY = e.clientY;
    d.lastT = now;
  }

  function onPU(e) {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    const el = listRef.current;
    if (!el) return;
    if (!d.moved) {
      const rect = el.getBoundingClientRect();
      const idx  = Math.floor((e.clientY - rect.top + el.scrollTop) / ITEM_H);
      if (idx >= 0 && idx < filtered.length) select(filtered[idx]);
      return;
    }
    const vel       = d.velY;
    const clamped   = Math.max(-2, Math.min(2, vel));
    const momentum  = (clamped * Math.abs(clamped)) / (2 * 0.003);
    const maxScroll = el.scrollHeight - el.clientHeight;
    const snapped   = Math.round(Math.max(0, Math.min(el.scrollTop + momentum, maxScroll)) / ITEM_H) * ITEM_H;
    smoothScrollTo(el, snapped);
  }

  function onWheel(e) {
    const el = listRef.current;
    if (!el) return;
    const step = e.deltaY > 0 ? ITEM_H : -ITEM_H;
    const maxScroll = el.scrollHeight - el.clientHeight;
    smoothScrollTo(el, Math.round(Math.max(0, Math.min(el.scrollTop + step, maxScroll)) / ITEM_H) * ITEM_H, 180);
  }

  const listH = Math.min(VISIBLE, filtered.length || 1) * ITEM_H;

  const selBtn = {
    width: '100%', height: 34, borderRadius: 8,
    border: `1px solid ${HAIR}`, padding: '0 24px 0 8px',
    textAlign: 'left', background: `${SOFT} url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23999' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 8px center`,
    fontSize: 13.5, color: TEXT, fontFamily: 'inherit',
    cursor: 'pointer', outline: 'none', boxSizing: 'border-box',
    WebkitTapHighlightColor: 'transparent',
  };

  return (
    <div style={{ flex: 1 }}>
      <button ref={btnRef} style={{ ...selBtn, color: value ? TEXT : SUB }} onClick={handleOpen}>
        {value || 'Seleccionar'}
      </button>
      {open && createPortal(
        <>
          <div onClick={() => { setOpen(false); setSearch(''); }} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
          <div style={{
            position: 'fixed', top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999,
            background: '#fff', borderRadius: 10, border: `1px solid ${HAIR}`,
            boxShadow: '0 4px 18px rgba(0,0,0,0.14)', overflow: 'hidden',
          }}>
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar ciudad…"
              style={{
                display: 'block', width: '100%', boxSizing: 'border-box',
                padding: '8px 10px', border: 'none', borderBottom: `1px solid ${HAIR}`,
                fontSize: 13.5, color: TEXT, fontFamily: 'inherit',
                background: SOFT, outline: 'none',
              }}
            />
            <div
              ref={listRef}
              className="no-sb"
              onPointerDown={onPD}
              onPointerMove={onPM}
              onPointerUp={onPU}
              onPointerCancel={onPU}
              onWheel={onWheel}
              style={{
                height: listH,
                overflowY: 'hidden',
                cursor: 'grab',
                userSelect: 'none',
                touchAction: 'none',
              }}
            >
              {filtered.length === 0 ? (
                <div style={{ height: ITEM_H, display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 13, color: SUB }}>Sin resultados</div>
              ) : filtered.map(c => (
                <div key={c} style={{
                  height: ITEM_H, display: 'flex', alignItems: 'center',
                  padding: '0 12px', fontSize: 13.5, boxSizing: 'border-box',
                  color: c === value ? BLUE : TEXT,
                  fontWeight: c === value ? 600 : 400,
                  background: c === value ? `${BLUE}10` : 'transparent',
                }}>
                  {c}
                </div>
              ))}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

const _SEED_PW = { 'rodrigo@gm.com': 'Palopalo' };
function getStoredPassword(email) {
  try {
    const users = JSON.parse(localStorage.getItem('pichanga_users') || '{}');
    const key = (email || '').toLowerCase().trim();
    return users[key]?.password ?? _SEED_PW[key] ?? null;
  } catch { return null; }
}

function translateAuthError(msg) {
  if (!msg) return 'Error desconocido.';
  const wait = msg.match(/after (\d+) seconds?/i);
  if (wait) return 'Inténtalo nuevamente en unos minutos.';
  if (/rate.?limit|too many|429/i.test(msg)) return 'Demasiados intentos. Espera unos minutos antes de continuar.';
  if (/invalid.?email/i.test(msg)) return 'El email ingresado no es válido.';
  if (/already.{0,20}registered|already.{0,10}used/i.test(msg)) return 'Ya existe una cuenta registrada con este correo.';
  if (/email.?change.*pending/i.test(msg)) return 'Ya hay un cambio de email pendiente de confirmación.';
  return msg;
}

// ── EditProfileModal ───────────────────────────────────────────────────────

function EditProfileModal({ profileData, onSave, onClose, userName, userEmail, userProvider = 'email' }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOpen(true), 20); return () => clearTimeout(t); }, []);

  const [fullName,  setFullName]  = useState(profileData.fullName || userName || '');
  const [emailVal,  setEmailVal]  = useState(profileData.email || userEmail || '');
  const [emailLocked, setEmailLocked] = useState(true);
  const [password,  setPassword]  = useState(profileData.password || '');
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwError,   setPwError]   = useState('');
  const [pwLocked,  setPwLocked]  = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [gender,    setGender]    = useState(profileData.gender || 'Hombre');
  const [positions, setPositions] = useState(() => {
    if (Array.isArray(profileData.positions) && profileData.positions.length) return profileData.positions;
    if (profileData.position) return [profileData.position];
    return [];
  });
  const [birthDay,    setBirthDay]    = useState(profileData.birthDay    || null);
  const [birthMonth,  setBirthMonth]  = useState(profileData.birthMonth  || null);
  const [birthYear,   setBirthYear]   = useState(profileData.birthYear   || 2000);
  const [prefixInput, setPrefixInput] = useState(
    (profileData.phonePrefix || '+51').replace(/^\+/, '')
  );
  const [phone,       setPhone]       = useState(profileData.phone || '');
  const [nationality, setNationality] = useState(profileData.nationality || null);
  const [city,        setCity]        = useState(profileData.city || 'Arequipa');
  const [occupation,  setOccupation]  = useState(profileData.occupation || '');
  const [photoDataUrl, setPhotoDataUrl] = useState(profileData.photoDataUrl || null);
  const fileRef      = useRef(null);
  const scrollRef    = useRef(null);
  const [activeField,  setActiveField]  = useState(null); // null | 'email' | 'password'
  const [confirmField, setConfirmField] = useState(null);
  const emailSnapshot    = useRef(profileData.email || userEmail || ''); // confirmed email — never mutated
  const pwSnapshot       = useRef(profileData.password || '');
  const [pendingEmailChange, setPendingEmailChange] = useState(null);
  const [emailChangeError,  setEmailChangeError]  = useState(null);

  useEffect(() => {
    if (!pwLocked && scrollRef.current) {
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 50);
    }
  }, [pwLocked]);
  const isSocial      = userProvider === 'google' || userProvider === 'facebook';

  const _today    = new Date();
  const MAX_YEAR  = _today.getFullYear() - 18;
  const MAX_MONTH = _today.getMonth() + 1;
  const MAX_DAY   = _today.getDate();

  const detectedPrefix = detectPrefix(prefixInput);
  const isPeru = detectedPrefix?.code === '+51';

  function dismiss() { setOpen(false); setTimeout(onClose, 220); }

  function unlockField(field) {
    if (field === 'email') { setEmailVal(emailSnapshot.current); setEmailLocked(false); setPendingEmailChange(null); setEmailChangeError(null); }
    else { pwSnapshot.current = password; setPwCurrent(''); setPassword(''); setPwError(''); setPwLocked(false); }
    setActiveField(field);
  }

  function doLockField(field) {
    if (field === 'email') setEmailLocked(true);
    else { setPwLocked(true); setPwCurrent(''); setPwConfirm(''); setPwError(''); setShowPw(false); }
    setActiveField(null);
    setConfirmField(null);
  }

  function requestLock(field) {
    if (field === 'email') {
      const changed = emailVal.trim() !== emailSnapshot.current.trim();
      if (changed) setConfirmField('email');
      else         doLockField('email');
    } else {
      if (pwCurrent === '' && password === '') { setPassword(pwSnapshot.current); doLockField('password'); return; }
      const stored = getStoredPassword(userEmail);
      if (stored !== null && pwCurrent !== stored) { setPwError('Contraseña actual incorrecta'); return; }
      if (password.length < 6) { setPwError('Mínimo 6 caracteres'); return; }
      setPwError('');
      setConfirmField('password');
    }
  }

  function cancelChange(field) {
    if (field === 'email') setEmailVal(emailSnapshot.current);
    else { setPassword(pwSnapshot.current); setPwCurrent(''); }
    doLockField(field);
  }

  async function applyChange() {
    if (confirmField === 'email') {
      const newEmail = emailVal.trim();
      doLockField('email');
      setEmailVal(emailSnapshot.current); // revert synchronously — before any await
      if (supabase) {
        const { error } = await supabase.auth.updateUser({ email: newEmail });
        if (!error) { setPendingEmailChange(newEmail); setEmailChangeError(null); }
        else setEmailChangeError(error.message);
      }
    } else {
      doLockField(confirmField);
    }
  }

  function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setPhotoDataUrl(ev.target.result);
    reader.readAsDataURL(file);
  }

  function handleFullName(v) {
    if (v.trim().split(/\s+/).filter(Boolean).length <= 6 || v.length < fullName.length) setFullName(v);
  }

  function togglePosition(pos) {
    setPositions(prev => prev.includes(pos) ? prev.filter(p => p !== pos) : [...prev, pos]);
  }

  function handlePrefixInput(v) {
    const digits = v.replace(/[^\d]/g, '').slice(0, 4);
    setPrefixInput(digits);
  }

  function handlePhone(v) {
    const digits = v.replace(/\D/g, '');
    setPhone(isPeru ? digits.slice(0, 9) : digits.slice(0, 15));
  }

  function handleYearChange(y) {
    setBirthYear(y);
    let m = birthMonth;
    if (y === MAX_YEAR && m && m > MAX_MONTH) {
      m = MAX_MONTH;
      setBirthMonth(MAX_MONTH);
    }
    if (m) {
      const maxD = Math.min(
        new Date(y, m, 0).getDate(),
        (y === MAX_YEAR && m === MAX_MONTH) ? MAX_DAY : 31,
      );
      if (birthDay && birthDay > maxD) setBirthDay(maxD);
    }
  }

  function handleMonthChange(m) {
    setBirthMonth(m);
    const maxD = Math.min(
      new Date(birthYear, m, 0).getDate(),
      (birthYear === MAX_YEAR && m === MAX_MONTH) ? MAX_DAY : 31,
    );
    if (birthDay && birthDay > maxD) setBirthDay(maxD);
  }

  function save() {
    if (activeField === 'email' || activeField === 'password') return;
    let finalPassword = password;
    if (!pwLocked) {
      if (pwCurrent === '' && password === '') {
        finalPassword = pwSnapshot.current;
      } else {
        if (password.length < 6) { setPwError('Mínimo 6 caracteres'); return; }
      }
    }
    setActiveField(null);
    setConfirmField(null);
    const parts = fullName.trim().split(' ').filter(Boolean);
    onSave({
      ...profileData,
      fullName:   fullName.trim(),
      firstName:  parts[0] || '',
      lastName:   parts.slice(1).join(' '),
      email:      emailVal.trim(),
      password:   finalPassword,
      gender,
      positions,
      position:   positions[0] || '',
      birthDay:   Number(birthDay),
      birthMonth: Number(birthMonth),
      birthYear:  Number(birthYear),
      phonePrefix: detectedPrefix?.code || ('+' + prefixInput),
      phone:      phone.trim(),
      nationality,
      city:       city.trim() || 'Arequipa',
      occupation: occupation.trim(),
      photoDataUrl,
    });
    setOpen(false);
    setTimeout(onClose, 220);
  }

  const iStyle = (locked = false) => ({
    flex: 1, height: 34, borderRadius: 8,
    border: `1px solid ${locked ? 'transparent' : HAIR}`,
    padding: '0 8px', fontSize: 13.5,
    color: locked ? SUB : TEXT,
    fontFamily: 'inherit',
    background: locked ? 'transparent' : SOFT,
    outline: 'none', boxSizing: 'border-box',
  });

  const selStyle = {
    flex: 1, height: 34, borderRadius: 8,
    border: `1px solid ${HAIR}`, padding: '0 24px 0 8px',
    fontSize: 13.5, color: TEXT, fontFamily: 'inherit',
    background: `${SOFT} url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23999' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 8px center`,
    outline: 'none', boxSizing: 'border-box',
    appearance: 'none', WebkitAppearance: 'none',
  };

  const effectiveMaxDay = Math.min(
    birthMonth ? new Date(birthYear, birthMonth, 0).getDate() : 31,
    (birthYear === MAX_YEAR && birthMonth === MAX_MONTH) ? MAX_DAY : 31,
  );
  const availableDays   = Array.from({ length: effectiveMaxDay }, (_, i) => i + 1);
  const availableMonths = MONTH_LABELS;
  const years           = Array.from({ length: MAX_YEAR - 1939 }, (_, i) => MAX_YEAR - i);

  const previewName = fullName.trim().split(/\s+/).slice(0, 2).join(' ') || 'Tu nombre';

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) dismiss(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: open ? 'rgba(0,0,0,0.52)' : 'rgba(0,0,0,0)',
        transition: 'background .22s ease',
        overflowY: 'auto', overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          margin: '20px auto calc(24px + env(safe-area-inset-bottom))',
          width: 'calc(100% - 32px)', maxWidth: 420,
          background: '#fff', borderRadius: 24,
          boxShadow: '0 8px 40px rgba(0,0,0,0.22)',
          opacity: open ? 1 : 0,
          transition: 'opacity .2s ease',
          position: 'relative', boxSizing: 'border-box',
          maxHeight: 'calc(100dvh - 44px)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '16px 18px 14px', flexShrink: 0, position: 'relative' }}>
          <button onClick={dismiss} style={{
            position: 'absolute', top: 14, right: 14,
            width: 28, height: 28, borderRadius: '50%',
            background: SOFT, border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            WebkitTapHighlightColor: 'transparent', outline: 'none', padding: 0,
          }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1L1 9" stroke={TEXT} strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingRight: 32 }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <Avatar name={previewName} hue={USER.avatarHue} size={56} photoUrl={photoDataUrl} />
              <button onClick={() => fileRef.current?.click()} style={{
                position: 'absolute', bottom: 0, right: 0,
                width: 22, height: 22, borderRadius: '50%',
                background: BLUE, border: '2px solid #fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent', outline: 'none', padding: 0,
              }}>
                <CameraIcon />
              </button>
              <input ref={fileRef} type="file" accept="image/*" onChange={handlePhoto} style={{ display: 'none' }} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: TEXT, letterSpacing: -0.3 }}>{previewName}</div>
              {profileData.userCode && (
                <div style={{ fontSize: 12, color: BLUE, fontWeight: 600, marginTop: 2 }}>{`@${profileData.userCode}`}</div>
              )}
            </div>
          </div>
        </div>

        <div style={{ height: 1, background: HAIR, flexShrink: 0 }} />

        <div ref={scrollRef} className="no-sb" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '12px 18px 16px' }}>

        {isSocial ? (
          <FieldRow label="Email">
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 14, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emailVal}</span>
              <span style={{ fontSize: 11.5, color: SUB }}>
                Cuenta vinculada con {userProvider === 'google' ? 'Google' : 'Facebook'}
              </span>
            </div>
          </FieldRow>
        ) : (
          <div style={!emailLocked ? { position: 'relative', zIndex: 201, background: '#fff', borderRadius: 8, padding: '2px 0 4px', boxShadow: '0 0 0 10px #fff' } : {}}>
          <FieldRow label="Email">
            <input
              value={emailVal}
              onChange={e => setEmailVal(e.target.value)}
              readOnly={emailLocked}
              placeholder="tu@email.com"
              style={iStyle(emailLocked)}
            />
            <button onClick={() => emailLocked ? unlockField('email') : requestLock('email')} style={{
              flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
              padding: 4, display: 'flex', alignItems: 'center',
            }}>
              <LockIcon locked={emailLocked} />
            </button>
          </FieldRow>
          </div>
        )}

        {pendingEmailChange && (
          <div style={{ margin: '-4px 0 8px', padding: '9px 12px', borderRadius: 10, background: '#EEF3FF', border: '1px solid #C7D7FF', fontSize: 13, color: '#1B3A9E', lineHeight: 1.45 }}>
            ✉️ Enviamos un correo a <strong>{pendingEmailChange}</strong> para confirmar el cambio.
          </div>
        )}
        {emailChangeError && (
          <div style={{ margin: '-4px 0 8px', padding: '9px 12px', borderRadius: 10, background: '#FFF0F0', border: '1px solid #FFCDD2', fontSize: 13, color: '#B71C1C', lineHeight: 1.45 }}>
            {translateAuthError(emailChangeError)}
          </div>
        )}

        {!isSocial && !emailLocked && !confirmField && (
          <div
            onClick={() => requestLock('email')}
            style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.3)' }}
          />
        )}

        {!isSocial && !pwLocked && !confirmField && (
          <div
            onClick={() => requestLock('password')}
            style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.3)' }}
          />
        )}

        <FieldRow label="Nombres y Apellidos">
          <input
            value={fullName}
            onChange={e => handleFullName(e.target.value)}
            placeholder="Nombre completo"
            style={iStyle()}
          />
        </FieldRow>

        <FieldRow label="Sexo">
          <select value={gender} onChange={e => setGender(e.target.value)} style={{ ...selStyle, flex: '0 0 110px' }}>
            <option>Hombre</option>
            <option>Mujer</option>
            <option>Otro</option>
          </select>
        </FieldRow>

        <FieldRow label="Posición de juego">
          <div style={{ display: 'flex', gap: 4 }}>
            {POSITIONS.map(pos => {
              const sel = positions.includes(pos);
              return (
                <button key={pos} onClick={() => togglePosition(pos)} style={{
                  height: 32, padding: '0 8px', borderRadius: 999,
                  border: `1.5px solid ${sel ? BLUE : HAIR}`,
                  background: sel ? `${BLUE}18` : '#fff',
                  color: sel ? BLUE : TEXT,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent', outline: 'none',
                  transition: 'border-color .12s, background .12s, color .12s',
                }}>
                  {pos}
                </button>
              );
            })}
          </div>
        </FieldRow>

        <FieldRow label="Fecha de nacimiento">
          <select value={birthDay ?? ''} onChange={e => { const v = Number(e.target.value); if (v) setBirthDay(v); }} style={{ ...selStyle, flex: '0 0 58px' }}>
            {birthDay == null && <option value="" disabled>—</option>}
            {availableDays.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={birthMonth ?? ''} onChange={e => { const v = Number(e.target.value); if (v) handleMonthChange(v); }} style={{ ...selStyle, flex: '0 0 114px' }}>
            {birthMonth == null && <option value="" disabled>—</option>}
            {availableMonths.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={birthYear} onChange={e => handleYearChange(Number(e.target.value))} style={{ ...selStyle, flex: '0 0 82px' }}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </FieldRow>

        <FieldRow label="Número de celular">
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: '0 0 56px', display: 'flex', alignItems: 'center', height: 34, borderRadius: 8, border: `1px solid ${HAIR}`, background: SOFT, overflow: 'hidden' }}>
                <span style={{ paddingLeft: 8, fontSize: 13.5, color: SUB, userSelect: 'none' }}>+</span>
                <input
                  value={prefixInput}
                  onChange={e => handlePrefixInput(e.target.value)}
                  inputMode="numeric"
                  placeholder="51"
                  style={{ flex: 1, height: '100%', border: 'none', background: 'transparent', outline: 'none', fontSize: 13.5, color: TEXT, fontFamily: 'inherit', padding: '0 4px', minWidth: 0 }}
                />
              </div>
              <input
                value={phone}
                onChange={e => handlePhone(e.target.value)}
                placeholder={isPeru ? '9 dígitos' : 'Número'}
                inputMode="numeric"
                style={{ ...iStyle(), flex: '0 0 140px', minWidth: 0 }}
              />
            </div>
            {detectedPrefix && (
              <div style={{ fontSize: 10, color: BLUE, fontWeight: 600, paddingLeft: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {detectedPrefix.label}
              </div>
            )}
          </div>
        </FieldRow>

        <FieldRow label="Nacionalidad">
          <NationalityPicker value={nationality} onChange={setNationality} />
        </FieldRow>


<FieldRow label="Ocupación">
          <input value={occupation} onChange={e => setOccupation(e.target.value)} placeholder="Ej: Estudiante, Ingeniero…" style={iStyle()} />
        </FieldRow>

        {!isSocial && (
          <div style={!pwLocked ? { position: 'relative', zIndex: 201, background: '#fff', borderRadius: 8, padding: '2px 0 4px', boxShadow: '0 0 0 10px #fff' } : {}}>
          <FieldRow label={pwLocked ? 'Contraseña' : 'Contraseña actual'}>
            <input
              type={pwLocked ? 'text' : (showPw ? 'text' : 'password')}
              autoComplete="current-password"
              value={pwLocked ? '••••••••' : pwCurrent}
              onChange={e => { if (!pwLocked) { setPwCurrent(e.target.value); setPwError(''); } }}
              readOnly={pwLocked}
              placeholder="••••••••"
              style={iStyle(pwLocked)}
            />
            {!pwLocked && (
              <button onClick={() => setShowPw(p => !p)} style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}>
                {showPw
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" stroke="#8E8E93" strokeWidth="1.8"/><circle cx="12" cy="12" r="3" stroke="#8E8E93" strokeWidth="1.8"/><line x1="3" y1="3" x2="21" y2="21" stroke="#8E8E93" strokeWidth="1.8" strokeLinecap="round"/></svg>
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" stroke="#8E8E93" strokeWidth="1.8"/><circle cx="12" cy="12" r="3" stroke="#8E8E93" strokeWidth="1.8"/></svg>
                }
              </button>
            )}
            <button onClick={() => pwLocked ? unlockField('password') : requestLock('password')} style={{
              flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
              padding: 4, display: 'flex', alignItems: 'center',
            }}>
              <LockIcon locked={pwLocked} />
            </button>
          </FieldRow>
          {!pwLocked && pwCurrent.length > 0 && pwCurrent.length < 6 && (
            <div style={{ fontSize: 11.5, color: DANGER, marginTop: -5, marginBottom: 9, paddingLeft: 2 }}>
              Mínimo 6 caracteres
            </div>
          )}
          {!pwLocked && (
            <>
              {pwError && (
                <div style={{ fontSize: 11.5, color: DANGER, marginTop: -5, marginBottom: 9, paddingLeft: 2 }}>
                  {pwError}
                </div>
              )}
              <FieldRow label="Nueva contraseña">
                <input
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setPwError(''); }}
                  placeholder="••••••••"
                  style={iStyle(false)}
                />
                <div style={{ width: 52, flexShrink: 0 }} />
              </FieldRow>
              {password.length > 0 && password.length < 6 && (
                <div style={{ fontSize: 11.5, color: DANGER, marginTop: -5, marginBottom: 9, paddingLeft: 2 }}>
                  Mínimo 6 caracteres
                </div>
              )}
            </>
          )}
          </div>
        )}

        </div>

<div style={{ padding: '12px 18px', borderTop: `1px solid ${HAIR}`, flexShrink: 0, position: 'relative', zIndex: 6 }}>
        <button onClick={save} style={{
          width: '100%', height: 50, borderRadius: 16,
          background: ORANGE, color: '#1B1B1F',
          border: 'none', cursor: 'pointer',
          fontSize: 15, fontWeight: 700, letterSpacing: -0.1, fontFamily: 'inherit',
          boxShadow: '0 4px 14px rgba(245,165,36,0.38)',
          WebkitTapHighlightColor: 'transparent', outline: 'none',
        }}>
          Guardar cambios
        </button>
        </div>

        {confirmField && (
          <>
            <div style={{ position: 'absolute', inset: 0, borderRadius: 24, background: 'rgba(0,0,0,0.5)', zIndex: 7 }} />
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              background: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
              padding: '20px 18px 20px', zIndex: 8,
            }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 4, lineHeight: 1.35 }}>
                {confirmField === 'email' ? '¿Estás seguro que quieres cambiar tu email?' : '¿Estás seguro que quieres conservar el cambio?'}
              </div>
              <div style={{ marginBottom: 10 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => cancelChange(confirmField)} style={{
                  flex: 1, height: 46, borderRadius: 14,
                  border: `1px solid ${HAIR}`, background: SOFT,
                  color: TEXT, fontSize: 14, fontWeight: 600,
                  fontFamily: 'inherit', cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent', outline: 'none',
                }}>
                  Cancelar
                </button>
                <button onClick={applyChange} style={{
                  flex: 1, height: 46, borderRadius: 14,
                  border: 'none', background: BLUE,
                  color: '#fff', fontSize: 14, fontWeight: 700,
                  fontFamily: 'inherit', cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent', outline: 'none',
                }}>
                  Confirmar
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── GameRow ────────────────────────────────────────────────────────────────

function GameRow({ game, onPress, muted = false, userId = null }) {
  const [pressed, setPressed] = useState(false);
  const isCampo = game.type === 'campo';
  const isHost = !!userId && !!game.hostUserId && game.hostUserId === userId;
  return (
    <div
      onClick={onPress}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 16px',
        background: pressed ? SOFT : '#fff',
        transform: pressed ? 'scale(0.985)' : 'scale(1)',
        transition: 'transform .12s ease, background .12s ease',
        cursor: 'pointer',
        opacity: muted ? 0.55 : 1,
      }}>
      <div style={{ width: 44, flexShrink: 0, textAlign: 'right' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, lineHeight: 1.1 }}>{game.time}</div>
        <div style={{ fontSize: 11, color: SUB, fontWeight: 500, lineHeight: 1.1 }}>{game.ampm}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, letterSpacing: -0.1 }}>{game.field}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, color: SUB, fontSize: 12.5 }}>
          {isCampo
            ? <span style={{ fontWeight: 500 }}>Cancha completa</span>
            : <GameMetaLine format={game.format} totalSpots={game.totalSpots} womenOnly={game.womenOnly} parking={game.parking} covered={game.covered} />}
        </div>
      </div>
      {(() => {
        const PM = 76;
        const pillBase = { height: 26, minWidth: PM, padding: '0 10px', borderRadius: 999, fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
        if (isHost) return (
          <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', minWidth: PM, padding: '5px 8px', borderRadius: 999, background: ORANGE, flexShrink: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#1B1B1F', lineHeight: 1.2 }}>Organiza</span>
            {game.totalSpots > 0 && game.openSpots != null && (
              <span style={{ fontSize: 10.5, fontWeight: 600, color: '#1B1B1F', opacity: 0.75, lineHeight: 1.2 }}>{game.totalSpots - game.openSpots}/{game.totalSpots}</span>
            )}
          </div>
        );
        if (game.status === 'waitlist') return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
            {(game.openSpots ?? 0) <= 0
              ? <div style={{ ...pillBase, border: `1.2px solid ${RED}`, color: RED, fontWeight: 500 }}>Completo</div>
              : <div style={{ ...pillBase, background: '#F0FAF3', border: `1.2px solid ${GREEN}`, color: GREEN }}>{game.openSpots} {game.openSpots === 1 ? 'cupo' : 'cupos'}</div>
            }
            <div style={{ fontSize: 11, fontWeight: 700, color: BLUE, letterSpacing: 0.2, alignSelf: 'flex-end', marginRight: 10 }}>En lista</div>
          </div>
        );
        if (muted) return (
          <div style={{ ...pillBase, background: 'transparent', color: SUB, fontWeight: 600, border: 'none' }}>Finalizado</div>
        );
        if (game.status === 'canceled-with-guests' || game.status === 'guest-canceled-with-sub-guests') return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
            <div style={{ ...pillBase, height: 22, fontSize: 11, fontWeight: 700, background: '#FFF0F0', border: `1.2px solid ${RED}40`, color: RED }}>Cancelado</div>
            <div style={{ fontSize: 10.5, color: SUB, whiteSpace: 'nowrap' }}>
              {game.activeGuestCount} {game.activeGuestCount === 1 ? 'invitado activo' : 'invitados activos'}
            </div>
          </div>
        );
        if (game.status === 'guest') return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
            <div style={{ ...pillBase, background: '#EDF5FF', border: `1.2px solid ${BLUE}40`, color: BLUE }}>Invitado</div>
            <div style={{ fontSize: 10.5, color: SUB, whiteSpace: 'nowrap' }}>
              {game.activeGuestCount > 0
                ? `${game.activeGuestCount} ${game.activeGuestCount === 1 ? 'invitado activo' : 'invitados activos'}`
                : `por ${abbreviateName(game.paidBy)}`}
            </div>
          </div>
        );
        if (game.status === 'reserved') return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
            <div style={{ ...pillBase, background: BLUE, color: '#fff' }}>
              {game.type === 'campo' ? 'Reservado' : 'Inscrito'}
            </div>
            {game.type !== 'campo' && game.activeGuestCount > 0 && (
              <div style={{ fontSize: 10.5, color: SUB, whiteSpace: 'nowrap' }}>
                {game.activeGuestCount} {game.activeGuestCount === 1 ? 'invitado activo' : 'invitados activos'}
              </div>
            )}
          </div>
        );
        return null;
      })()}
      <ChevIcon />
    </div>
  );
}

function SectionHeader({ title, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '20px 16px 10px' }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: TEXT, letterSpacing: -0.3 }}>{title}</div>
      {count != null && <div style={{ fontSize: 13, color: SUB, fontWeight: 500 }}>{count}</div>}
    </div>
  );
}

// ── RatingModal ────────────────────────────────────────────────────────────

function StarIcon({ filled, size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" fill="none">
      <path d="M15 3l3.09 7.26L26 11.27l-5.5 5.36 1.3 7.57L15 20.5l-6.8 3.7 1.3-7.57L4 11.27l7.91-1.01L15 3z"
        fill={filled ? '#F5A524' : 'none'}
        stroke={filled ? '#F5A524' : '#C7C7CC'}
        strokeWidth="1.6" strokeLinejoin="round"
      />
    </svg>
  );
}

function RatingModal({ game, onRate, onSkip }) {
  const [open, setOpen]       = useState(false);
  const [stars, setStars]     = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState('');

  useEffect(() => { const t = setTimeout(() => setOpen(true), 50); return () => clearTimeout(t); }, []);

  function submit() { setOpen(false); setTimeout(() => onRate({ stars, comment: comment.trim() || null }), 240); }
  function skip()   { setOpen(false); setTimeout(onSkip, 240); }

  const active = hovered || stars;

  return (
    <div className="sheet-overlay" style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)',
      transition: 'background .22s ease',
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
    }}>
      <div className="sheet-panel" style={{
        background: '#fff',
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        padding: '28px 24px calc(28px + env(safe-area-inset-bottom))',
        display: 'flex', flexDirection: 'column', gap: 18,
        boxShadow: '0 -8px 32px rgba(0,0,0,0.12)',
        transform: open ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform .28s cubic-bezier(0.32,0.72,0,1)',
        position: 'relative',
      }}>
        <button onClick={skip} style={{
          position: 'absolute', top: 16, right: 16,
          width: 32, height: 32, borderRadius: '50%',
          background: SOFT, border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          WebkitTapHighlightColor: 'transparent', outline: 'none', padding: 0,
        }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1 1l10 10M11 1L1 11" stroke={TEXT} strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>

        <div style={{ textAlign: 'center', paddingRight: 24 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: TEXT, letterSpacing: -0.4 }}>¿Cómo estuvo tu partido?</div>
          {game?.field && (
            <div style={{ fontSize: 14, color: SUB, marginTop: 6, lineHeight: 1.4 }}>
              {game.field}{game.date ? ` · ${game.date}` : ''}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n}
              onPointerEnter={() => setHovered(n)}
              onPointerLeave={() => setHovered(0)}
              onClick={() => setStars(n)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                WebkitTapHighlightColor: 'transparent', outline: 'none',
                transform: active >= n ? 'scale(1.15)' : 'scale(1)',
                transition: 'transform .1s ease',
              }}>
              <StarIcon filled={active >= n} />
            </button>
          ))}
        </div>

        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Cuéntanos más. (Opcional)"
          rows={3}
          style={{
            width: '100%', boxSizing: 'border-box',
            border: `1px solid ${HAIR}`, borderRadius: 14,
            padding: '12px 14px', resize: 'none',
            fontSize: 14, color: TEXT, fontFamily: 'inherit', lineHeight: 1.5,
            outline: 'none', background: SOFT,
          }}
        />

        {stars > 0 && (
          <button onClick={submit} style={{
            width: '100%', height: 54, borderRadius: 18,
            background: ORANGE, color: '#1B1B1F',
            border: 'none', cursor: 'pointer',
            fontSize: 16, fontWeight: 700, letterSpacing: -0.1, fontFamily: 'inherit',
            boxShadow: '0 6px 18px rgba(245,165,36,0.40)',
            WebkitTapHighlightColor: 'transparent', outline: 'none',
          }}>
            Enviar calificación
          </button>
        )}

        <button onClick={skip} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 15, fontWeight: 600,
          color: SUB, letterSpacing: -0.1,
          WebkitTapHighlightColor: 'transparent', outline: 'none',
          padding: '2px 0',
        }}>
          Ahora no
        </button>
      </div>
    </div>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────

export default function Profile() {
  const navigate = useNavigate();
  const { user, login } = useAuth();
  const { isVenueStaff, isVenueManager, isGameHost } = useStaff();
  const { state } = useLocation();
  const profileScrollRef = useRef(null);
  const initPfScrollRef = useRef(undefined);
  if (initPfScrollRef.current === undefined) {
    try {
      if (sessionStorage.getItem('pf_back') === '1') {
        sessionStorage.removeItem('pf_back');
        const sc = sessionStorage.getItem('pf_scroll');
        initPfScrollRef.current = sc != null ? Number(sc) : null;
      } else {
        initPfScrollRef.current = null;
      }
    } catch { initPfScrollRef.current = null; }
  }
  const [supportOpen,    setSupportOpen]    = useState(false);
  const [editOpen,       setEditOpen]       = useState(() => state?.openEdit === true);
  useEffect(() => {
    if (state?.openEdit === true) {
      navigate('/profile', { replace: true, state: { ...state, openEdit: false } });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const profileScrollPosRef = useRef(0);

  useEffect(() => {
    const el = profileScrollRef.current;
    if (!el || initPfScrollRef.current == null) return;
    const target = initPfScrollRef.current;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollTo({ top: target, behavior: 'instant' });
      });
    });
  }, []); // eslint-disable-line

  useEffect(() => {
    return () => {
      try { sessionStorage.setItem('pf_scroll', String(profileScrollPosRef.current)); } catch {}
    };
  }, []); // eslint-disable-line

  useEffect(() => {
    function onTabScrollTop(e) {
      if (e.detail === 'perfil') profileScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
    window.addEventListener('tab-scroll-top', onTabScrollTop);
    return () => window.removeEventListener('tab-scroll-top', onTabScrollTop);
  }, []);

  const [confirmedGame,  setConfirmedGame]  = useState(() => {
    const cg = state?.confirmedGame ?? null;
    if (!cg) return null;
    try {
      const shown = JSON.parse(localStorage.getItem(SHOWN_KEY)) || {};
      if (cg.id && shown[cg.id]) return null;
    } catch {}
    return cg;
  });
  const [profileData,    setProfileData]    = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(PROFILE_KEY)) || {};
      // Discard stored data if it belongs to a different user — prevents cross-account leakage
      if (stored.userId && stored.userId !== user?.id) return {};
      return stored;
    } catch { return {}; }
  });
  const [extraGames, setExtraGames] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
  });
  const [creditBalance, setCreditBalance] = useState(() => {
    try { const c = JSON.parse(localStorage.getItem(CREDIT_KEY)); return (c?.balance || 0) > 0 ? c.balance : 0; } catch { return 0; }
  });
  const [waitlistEntries, setWaitlistEntries] = useState(() => {
    try {
      const wl = JSON.parse(localStorage.getItem(WAITLIST_KEY_P)) || {};
      return Object.keys(wl).map(waitlistGameToRow).filter(Boolean);
    } catch { return []; }
  });
  const [ratings,        setRatings]        = useState(() => {
    try { return JSON.parse(localStorage.getItem(RATINGS_KEY)) || {}; } catch { return {}; }
  });
  const [skippedRatings, setSkippedRatings] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SKIPPED_KEY)) || {}; } catch { return {}; }
  });

  const [sbProfile, setSbProfile] = useState(null);
  const [myPlayerRows,      setMyPlayerRows]      = useState([]);
  const [myPlayerRowsReady, setMyPlayerRowsReady] = useState(false);
  const [sbGamesReady,      setSbGamesReady]      = useState(false);
  const [hostedRows,        setHostedRows]        = useState([]);
  const [hostedReady,       setHostedReady]       = useState(false);
  const [hostedConfirmed,   setHostedConfirmed]   = useState({});
  const [payerNames,        setPayerNames]        = useState({});

  useEffect(() => {
    if (!supabase) { setMyPlayerRowsReady(true); setSbGamesReady(true); setHostedReady(true); return; }
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user?.id) { setMyPlayerRowsReady(true); setSbGamesReady(true); setHostedReady(true); return; }
      const uid = session.user.id;

      supabase
        .from('users')
        .select('full_name, email, role, organizer_status, birth_date, sex, preferred_position, phone, nationality, occupation, user_code')
        .eq('id', uid)
        .single()
        .then(async ({ data, error }) => {
          if (error) { console.warn('[Profile] public.users:', error.message); return; }
          if (data) {
            let userCode = data.user_code || null;
            if (!userCode && data.full_name) {
              userCode = await ensureUserCode(supabase, uid, data.full_name);
            }
            setSbProfile({ ...data, user_code: userCode });
            setProfileData(prev => {
              const patch = {};
              if (data.full_name)          { patch.fullName = data.full_name; patch.firstName = data.full_name.split(' ')[0] || ''; patch.lastName = data.full_name.split(' ').slice(1).join(' '); }
              if (data.birth_date)         { const [y, m, d] = data.birth_date.split('-').map(Number); patch.birthYear = y; patch.birthMonth = m; patch.birthDay = d; }
              if (data.sex)                { patch.gender = data.sex; }
              if (data.preferred_position?.length) { patch.positions = data.preferred_position; patch.position = data.preferred_position[0]; }
              if (data.phone)              { patch.phone = data.phone; }
              if (data.nationality)        { patch.nationality = data.nationality; }
              if (data.occupation)         { patch.occupation = data.occupation; }
              if (userCode)                { patch.userCode = userCode; }
              return { ...prev, ...patch };
            });
            // Propagate to localStorage so legacy reads (ConfirmReservation, CancelSheet) are correct
            if (userCode) {
              try {
                const stored = JSON.parse(localStorage.getItem('pichanga_profile') || '{}');
                stored.userId   = uid;
                stored.userCode = userCode;
                localStorage.setItem('pichanga_profile', JSON.stringify(stored));
              } catch {}
            }
          }
        });

      supabase
        .from('wallet_summary')
        .select('credit_balance')
        .eq('user_id', uid)
        .maybeSingle()
        .then(({ data }) => { if (data?.credit_balance != null) setCreditBalance(data.credit_balance); });

      supabase
        .from('reservations')
        .select(`
          game_id, source, unit_price, promo_discount, credit_applied, total_amount,
          games:game_id ( date_key, time, format, total_spots, duration_min, host_user_id, game_amenities:amenities, fields:field_id ( format, total_spots, duration_min, field_amenities:amenities, venues:venue_id ( name, venue_amenities:amenities ) ) )
        `)
        .eq('user_id', uid)
        .eq('status', 'spend')
        .then(({ data, error }) => {
          if (error) { console.warn('[Profile] reservations:', error.message); }
          else if (data) {
            const rows = data.map(sbReservationToRow);
            setExtraGames(rows);
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); } catch {}
          }
          setSbGamesReady(true);
        });

      // todos mis rows como jugador o como payer — fuente única de verdad
      supabase
        .from('game_players')
        .select(`
          game_id, user_id, payer_id, status, amount,
          games:game_id ( date_key, time, format, total_spots, duration_min, host_user_id, game_amenities:amenities, fields:field_id ( format, total_spots, duration_min, field_amenities:amenities, venues:venue_id ( name, venue_amenities:amenities ) ) )
        `)
        .or(`user_id.eq.${uid},payer_id.eq.${uid}`)
        .then(async ({ data, error }) => {
          if (error) { console.warn('[Profile] player rows:', error.message); setMyPlayerRowsReady(true); return; }
          const rows = data ?? [];
          setMyPlayerRows(rows);
          setMyPlayerRowsReady(true);
          const payerIds = [...new Set(rows.filter(r => r.user_id === uid && r.payer_id !== uid).map(r => r.payer_id))];
          if (payerIds.length > 0) {
            const { data: pd } = await supabase.from('users').select('id, full_name, user_code').in('id', payerIds);
            const map = {};
            (pd || []).forEach(u => { map[u.id] = { name: u.full_name || '', code: u.user_code || '' }; });
            setPayerNames(map);
          }
        });

      // hosted games — host is outside game_players; query games directly
      supabase
        .from('games')
        .select(`
          id, date_key, time, format, total_spots, current_players, duration_min, status, host_user_id,
          game_amenities:amenities,
          fields:field_id ( format, total_spots, duration_min, field_amenities:amenities, venues:venue_id ( name, venue_amenities:amenities ) )
        `)
        .eq('host_user_id', uid)
        .in('status', ['published', 'active'])
        .then(async ({ data, error }) => {
          if (error) { console.warn('[Profile] hosted games:', error.message); }
          else if (data?.length) {
            setHostedRows(data);
            const ids = data.map(g => g.id);
            const { data: cpRows } = await supabase
              .from('game_players')
              .select('game_id')
              .in('game_id', ids)
              .eq('status', 'confirmed');
            const map = {};
            (cpRows ?? []).forEach(r => { map[r.game_id] = (map[r.game_id] ?? 0) + 1; });
            setHostedConfirmed(map);
          }
          setHostedReady(true);
        });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [pastExpanded, setPastExpanded]         = useState(false);
  const [upcomingExpanded, setUpcomingExpanded] = useState(false);

  const profileGameStateMap = useMemo(() => {
    if (!user?.id) return new Map();
    const byGame = {};
    myPlayerRows.forEach(r => { (byGame[r.game_id] ??= []).push(r); });
    const map = new Map();
    Object.entries(byGame).forEach(([gameId, rows]) => {
      map.set(gameId, deriveGameState(rows, user.id));
    });
    return map;
  }, [myPlayerRows, user?.id]);

  const guestGames = useMemo(() => {
    if (!user?.id) return [];
    return myPlayerRows
      .filter(r => r.user_id === user.id && r.payer_id !== user.id && r.status === 'confirmed')
      .map(r => {
        const g = r.games;
        const { time, ampm } = parseGameTime(g?.time);
        const state = profileGameStateMap.get(r.game_id);
        const payer = payerNames[r.payer_id];
        return {
          id:               `${r.game_id}_g_${r.user_id}`,
          gameId:           r.game_id,
          dateKey:          g?.date_key    ?? null,
          time24:           g?.time        ?? null,
          durationMin:      g?.duration_min ?? g?.fields?.duration_min ?? null,
          date:             formatDateLabel(g?.date_key),
          time,
          ampm,
          field:      g?.fields?.venues?.name || '',
          format:     g?.format ?? g?.fields?.format ?? '7v7',
          totalSpots: g?.total_spots ?? g?.fields?.total_spots ?? 0,
          womenOnly:  g?.game_amenities?.women_only ?? false,
          covered:    g?.fields?.field_amenities?.covered ?? false,
          parking:    g?.fields?.venues?.venue_amenities?.parking ?? false,
          hostUserId:       g?.host_user_id ?? null,
          type:             'game',
          price:            null,
          status:           'guest',
          guestId:          r.user_id,
          paidBy:           payer?.name || 'Usuario',
          paidByCode:       payer?.code || null,
          activeGuestCount: state?.activeGuestCount ?? 0,
        };
      });
  }, [myPlayerRows, user?.id, payerNames, profileGameStateMap]);

  const canceledGames = useMemo(() => deriveCanceledWithGuestsGames(), [extraGames]);

  const hostedGameRows = useMemo(
    () => hostedRows.map(g => {
      const row = sbHostedGameToRow(g);
      const liveConfirmed = hostedConfirmed[g.id] ?? null;
      if (liveConfirmed !== null) {
        row.openSpots = Math.max(0, row.totalSpots - liveConfirmed);
      }
      return row;
    }),
    [hostedRows, hostedConfirmed]
  );

  // status priority: lower = wins dedup
  const STATUS_PRIORITY = { reserved: 0, guest: 1, 'canceled-with-guests': 2, 'guest-canceled-with-sub-guests': 3, waitlist: 4 };

  const allGames = (() => {
    const raw = [
      ...extraGames.map(g => {
        if (g.status === 'reserved' && g.type !== 'campo' && myPlayerRowsReady) {
          const state = profileGameStateMap.get(g.id);
          if (state && !state.isVisible) return null;
          if (state?.relationship === 'canceled-with-guests') {
            return { ...g, status: 'canceled-with-guests', activeGuestCount: state.activeGuestCount };
          }
          if (state?.relationship === 'guest') return null; // guestGames handles this
        }
        let row = g.paymentBreakdown ? { ...g, price: computeLivePrice(g) } : g;
        if (row.status === 'reserved' && row.type !== 'campo' && row.id) {
          const state = profileGameStateMap.get(row.id);
          row = { ...row, activeGuestCount: state?.activeGuestCount ?? 0 };
        }
        return row;
      }).filter(Boolean),
      ...waitlistEntries,
      ...guestGames,
      ...canceledGames,
      ...hostedGameRows, // fallback: makes hosted games visible when not in reservations/game_players
    ];
    // one card per game — keep highest-priority status row
    const seen = new Map();
    for (const g of raw) {
      const key = g.gameId || g.id;
      if (!key) continue;
      const prev = seen.get(key);
      if (!prev || (STATUS_PRIORITY[g.status] ?? 99) < (STATUS_PRIORITY[prev.status] ?? 99)) {
        seen.set(key, g);
      }
    }
    return [...seen.values()];
  })();
  const dataReady = myPlayerRowsReady && sbGamesReady && hostedReady;
  // Only classify games that have valid temporal data and whose player status is settled
  const temporalGames = dataReady ? allGames.filter(g => g.dateKey && g.time24) : [];
  const upcoming      = sortByDt(temporalGames.filter(g => !isPast(g) && !(g.status === 'waitlist' && isStarted(g))), false);
  const past          = sortByDt(temporalGames.filter(g =>  isPast(g) && g.status !== 'waitlist'), true);
  const pastGameCount = past.length;
  // hasActivity: any confirmed inscription regardless of past/upcoming
  const hasActivity = extraGames.length > 0
    || myPlayerRows.some(r => r.user_id === user?.id && r.status === 'confirmed')
    || isGameHost;
  const visiblePast     = pastExpanded     ? past     : past.slice(0, 4);
  const visibleUpcoming = upcomingExpanded ? upcoming : upcoming.slice(0, 10);

  const gameToRate = (dataReady && user)
    ? past.find(g => !ratings[g.id] && !skippedRatings[g.id]) ?? null
    : null;

  async function handleSave(updated) {
    const stamped = user?.id ? { ...updated, userId: user.id } : updated;
    setProfileData(stamped);
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(stamped)); } catch {}
    if (!supabase) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return;
      const patch = {
        full_name:          updated.fullName          || null,
        sex:                updated.gender            || null,
        preferred_position: updated.positions?.length ? updated.positions : null,
        phone:              updated.phone             || null,
        nationality:        updated.nationality       || null,
        occupation:         updated.occupation        || null,
      };
      if (updated.birthYear && updated.birthMonth && updated.birthDay) {
        patch.birth_date = `${updated.birthYear}-${String(updated.birthMonth).padStart(2, '0')}-${String(updated.birthDay).padStart(2, '0')}`;
      }
      const { error } = await supabase.from('users').update(patch).eq('id', session.user.id);
      if (error) console.warn('[Profile] update users:', error.message);
      else {
        setSbProfile(prev => ({ ...prev, full_name: patch.full_name }));
        if (patch.full_name && user) login({ ...user, name: patch.full_name });
      }

    } catch (e) { console.warn('[Profile] handleSave:', e); }
  }

  function handleOK() {
    if (confirmedGame) {
      try {
        const shown = JSON.parse(localStorage.getItem(SHOWN_KEY)) || {};
        if (confirmedGame.id) shown[confirmedGame.id] = true;
        localStorage.setItem(SHOWN_KEY, JSON.stringify(shown));
      } catch {}
      const newGame = confirmedGameToRow(confirmedGame);
      setExtraGames(prev => {
        const filtered = prev.filter(r => r.id !== newGame.id);
        const next = [...filtered, newGame];
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
      if (confirmedGame.id) {
        try {
          const wl = JSON.parse(localStorage.getItem(WAITLIST_KEY_P)) || {};
          if (wl[confirmedGame.id]) {
            delete wl[confirmedGame.id];
            localStorage.setItem(WAITLIST_KEY_P, JSON.stringify(wl));
            setWaitlistEntries(prev => prev.filter(g => g.id !== confirmedGame.id));
          }
        } catch {}
        try {
          const rosters = JSON.parse(localStorage.getItem(ROSTER_KEY) || '{}');
          if (rosters[confirmedGame.id]?.titularCanceled) {
            const r = { ...rosters[confirmedGame.id] };
            delete r.titularCanceled;
            delete r.titularCode;
            rosters[confirmedGame.id] = r;
            localStorage.setItem(ROSTER_KEY, JSON.stringify(rosters));
          }
        } catch {}
      }
    }
    setConfirmedGame(null);
  }

  function openGameDetail(g) {
    const past = isPast(g);
    const isWaitlist              = g.status === 'waitlist';
    const isGuest                 = g.status === 'guest';
    const isCanceledWithGuests    = g.status === 'canceled-with-guests';
    const isGuestCanceledWithSub  = g.status === 'guest-canceled-with-sub-guests';
    const navId      = g.gameId ?? g.id;
    const baseState  = { infoMode: isGuest || (!isWaitlist && !isCanceledWithGuests && !isGuestCanceledWithSub), isPast: past, rating: ratings[navId] ?? null, backPath: '/profile' };
    sessionStorage.setItem('pf_back', '1');
    if (g.type === 'campo') {
      navigate(`/field/${navId}`, { state: { ...baseState, field: { id: navId, dateKey: g.dateKey ?? null, time24: g.time24 ?? null, field: g.field, date: g.date, time: g.time, ampm: g.ampm, format: g.format || '7v7', price: g.price || '', address: '', paymentBreakdown: g.paymentBreakdown ?? null, paidBy: isGuest ? (g.paidBy ?? null) : null, paidByCode: isGuest ? (g.paidByCode ?? null) : null } } });
    } else {
      // Only pass reservation-specific extras — GameDetail fetches canonical game data via getGameById
      navigate(`/game/${navId}`, { state: { ...baseState, guestCanceledView: isGuestCanceledWithSub, game: { id: navId, dateKey: g.dateKey ?? null, time24: g.time24 ?? null, durationMin: g.durationMin ?? null, field: g.field, date: g.date, time: g.time, ampm: g.ampm, format: g.format || '7v7', paymentBreakdown: g.paymentBreakdown ?? null, paidBy: isGuest ? (g.paidBy ?? null) : null, paidByCode: isGuest ? (g.paidByCode ?? null) : null, guestId: isGuest ? (g.guestId ?? null) : null, guestSubBreakdown: (isGuest || isGuestCanceledWithSub) ? (g.guestSubBreakdown ?? null) : null, guestCanceledView: isGuestCanceledWithSub } } });
    }
  }

  function handleRate({ stars, comment }) {
    if (!gameToRate) return;
    const cleanComment = comment?.trim() || null;
    const updated = {
      ...ratings,
      [gameToRate.id]: { stars, comment: cleanComment, ratedAt: new Date().toISOString(), field: gameToRate.field, date: gameToRate.date },
    };
    setRatings(updated);
    try { localStorage.setItem(RATINGS_KEY, JSON.stringify(updated)); } catch {}
    savePlayedGame(gameToRate.id);
    if (user?.id) saveRating({ gameId: gameToRate.gameId ?? gameToRate.id, raterId: user.id, stars, comment: cleanComment });
  }

  const displayName = sbProfile?.full_name || profileData.fullName || user?.name || USER.name;
  const cardUser = {
    ...USER,
    name:        displayName,
    email:       sbProfile?.email || user?.email || USER.email,
    userCode:    profileData.userCode    ?? null,
    gender:      profileData.gender      ?? 'Hombre',
    position:    profileData.position    ?? '',
    positions:   profileData.positions   ?? [],
    birthDay:    profileData.birthDay    ?? null,
    birthMonth:  profileData.birthMonth  ?? null,
    birthYear:   profileData.birthYear   ?? null,
    city:        profileData.city        ?? null,
    phone:       profileData.phone       ?? null,
    nationality: profileData.nationality ?? null,
    occupation:  profileData.occupation  ?? null,
    photoDataUrl: profileData.photoDataUrl ?? null,
  };

  const hasPosition  = (cardUser.positions?.length > 0) || !!cardUser.position;
  const hasBirthDate = !!(cardUser.birthYear && cardUser.birthMonth && cardUser.birthDay);

  const isOrganizerProfile = isVenueStaff || isVenueManager;
  // Complete profile: position + birth date + phone + nationality + occupation
  const isProfileComplete = hasPosition && hasBirthDate && !!cardUser.phone && !!cardUser.nationality && !!cardUser.occupation;

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden', position: 'relative' }}>
      {/* Floating top bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        paddingTop: 'calc(env(safe-area-inset-top) + 6px)',
        paddingLeft: 12, paddingRight: 12,
        zIndex: 10, pointerEvents: 'none',
      }}>
        <div style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, pointerEvents: 'auto' }}>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setSupportOpen(v => !v)} style={{
              width: 36, height: 36, background: 'transparent', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              WebkitTapHighlightColor: 'transparent', outline: 'none', padding: 0,
            }}>
              <HeadsetIcon />
            </button>
            {supportOpen && <SupportMenu onClose={() => setSupportOpen(false)} />}
          </div>
          <button
            onClick={() => navigate('/settings')}
            style={{
              width: 36, height: 36, marginRight: -4, background: 'transparent', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              WebkitTapHighlightColor: 'transparent', outline: 'none', padding: 0,
            }}>
            <GearIcon />
          </button>
        </div>
      </div>

      {user ? (
        <div ref={profileScrollRef} onScroll={e => { profileScrollPosRef.current = e.currentTarget.scrollTop; }} className="no-sb" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehaviorY: 'contain', paddingBottom: 8 }}>
          <div style={{ minHeight: 'calc(100% + 1px)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: 'calc(env(safe-area-inset-top) + 58px)' }} />

          <ProfileCard user={cardUser} gamesPlayedCount={pastGameCount} onEdit={() => setEditOpen(true)} isProfileComplete={isProfileComplete} isHostOrStaff={isVenueStaff || isVenueManager || isGameHost} hasActivity={hasActivity} />

{!isProfileComplete && (
            <div style={{ padding: '16px 16px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: SUB, lineHeight: 1.5, letterSpacing: -0.1 }}>
                {isOrganizerProfile
                  ? <>Completa tu perfil para<br />poder organizar partidos.</>
                  : <>Completa tu perfil para obtener<br />mejores recomendaciones</>}
              </div>
              <button
                onClick={() => setEditOpen(true)}
                style={{
                  marginTop: 6, padding: '4px 8px',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontSize: 14, fontWeight: 700, color: ORANGE, letterSpacing: -0.1,
                  fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none',
                }}>
                Edita tu perfil
              </button>
            </div>
          )}

          {creditBalance > 0 && (
            <div style={{ margin: '4px 16px 0', padding: '14px 16px', borderRadius: 14, background: '#fff', border: `1px solid ${HAIR}`, boxShadow: '0 1px 6px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 42, height: 42, borderRadius: 21, background: '#F0FBF4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <FontAwesomeIcon icon={faCoins} style={{ fontSize: 18, color: GREEN }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: SUB, marginBottom: 1 }}>Crédito disponible</div>
                <div style={{ fontSize: 12, color: SUB, opacity: 0.75 }}>Se aplica en tu próxima reserva</div>
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: TEXT, letterSpacing: -0.5, flexShrink: 0 }}>S/. {Number(creditBalance).toFixed(2)}</div>
            </div>
          )}

          <SectionHeader title="Próximos eventos" count={upcoming.length} />
          {upcoming.length === 0 ? (
            <div style={{ padding: '4px 16px 8px', fontSize: 14, color: SUB }}>No tienes ningún partido</div>
          ) : (
            <>
              {(() => {
                const byDate = {};
                visibleUpcoming.forEach(g => { const k = g.date || ''; (byDate[k] = byDate[k] || []).push(g); });
                return Object.entries(byDate).map(([date, games]) => (
                  <div key={date || '_'}>
                    {date && date !== 'Próximo partido' && (
                      <div style={{ padding: '4px 16px 8px', fontSize: 13.5, fontWeight: 500, color: SUB }}>{date}</div>
                    )}
                    {games.map(g => <GameRow key={g.id} game={g} onPress={() => openGameDetail(g)} userId={user?.id} />)}
                  </div>
                ));
              })()}
              {!upcomingExpanded && upcoming.length > 10 && (
                <button onClick={() => setUpcomingExpanded(true)} style={{
                  display: 'block', width: '100%', padding: '10px 16px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 14, fontWeight: 600, color: '#3F5FE0',
                  textAlign: 'center', fontFamily: 'inherit',
                  WebkitTapHighlightColor: 'transparent', outline: 'none',
                }}>
                  Ver más
                </button>
              )}
            </>
          )}

          <SectionHeader title="Eventos pasados" count={past.length} />
          {past.length === 0 ? (
            <div style={{ padding: '4px 16px 8px', fontSize: 14, color: SUB }}>No tienes ningún partido</div>
          ) : (
            <>
              {(() => {
                const byDate = {};
                visiblePast.forEach(g => { const k = g.date || ''; (byDate[k] = byDate[k] || []).push(g); });
                return Object.entries(byDate).map(([date, games]) => (
                  <div key={date || '_'}>
                    {date && date !== 'Próximo partido' && (
                      <div style={{ padding: '4px 16px 8px', fontSize: 13.5, fontWeight: 500, color: SUB }}>{date}</div>
                    )}
                    {games.map(g => <GameRow key={g.id} game={g} onPress={() => openGameDetail(g)} muted userId={user?.id} />)}
                  </div>
                ));
              })()}
              {!pastExpanded && past.length > 4 && (
                <button onClick={() => setPastExpanded(true)} style={{
                  display: 'block', width: '100%', padding: '10px 16px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 14, fontWeight: 600, color: '#3F5FE0',
                  textAlign: 'center', fontFamily: 'inherit',
                  WebkitTapHighlightColor: 'transparent', outline: 'none',
                }}>
                  Mostrar más
                </button>
              )}
            </>
          )}

          <div style={{ height: 8 }} />
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '0 32px', textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
              <circle cx="18" cy="18" r="14" stroke={TEXT} strokeWidth="1.6" fill="#fff"/>
              <path d="M18 7l5 4-2 6h-6l-2-6 5-4z" fill={TEXT}/>
              <path d="M18 17l-5 7m5-7l5 7m-5-7v8" stroke={TEXT} strokeWidth="1.4" strokeLinecap="round"/>
              <path d="M9 13l4 4M27 13l-4 4M11 26l4-2M25 26l-4-2" stroke={TEXT} strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: TEXT, lineHeight: 1.35, letterSpacing: -0.2, maxWidth: 280 }}>
            Debes tener una cuenta para ver tu perfil
          </div>
          <button onClick={() => navigate('/auth')} style={{
            padding: '4px 6px', marginTop: -4,
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 17, fontWeight: 700,
            color: ORANGE, letterSpacing: -0.1, lineHeight: 1.3,
            WebkitTapHighlightColor: 'transparent', outline: 'none',
          }}>
            Suscríbete o ingresa a tu cuenta
          </button>
        </div>
      )}

      <TabBar activeTab="perfil" />

      {confirmedGame && <ConfirmedOverlay game={confirmedGame} onOK={handleOK} />}
      {!confirmedGame && gameToRate && (
        <RatingModal game={gameToRate} onRate={handleRate} onSkip={() => {
          const updated = { ...skippedRatings, [gameToRate.id]: true };
          setSkippedRatings(updated);
          try { localStorage.setItem(SKIPPED_KEY, JSON.stringify(updated)); } catch {}
          savePlayedGame(gameToRate.id);
        }} />
      )}
      {editOpen && (
        <EditProfileModal
          profileData={profileData}
          userName={user?.name || USER.name}
          userEmail={user?.email || ''}
          userProvider={user?.provider || 'email'}
          onSave={handleSave}
          onClose={() => setEditOpen(false)}
        />
      )}
    </div>
  );
}
