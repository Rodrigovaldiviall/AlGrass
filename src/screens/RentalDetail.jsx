import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { BLUE, TEXT, SUB, HAIR, ORANGE, SOFT, GREEN, WHATSAPP_NUMBER } from '../constants';
import I from '../icons';
import TabBar from '../components/TabBar';
import { supabase } from '../lib/supabase';
import { getVenueCoverUrl } from '../utils/venue';
import { getAvatarUrl } from '../utils/avatar';
import { isGamePast } from '../utils/deriveGameState';
import RatingBlock from '../components/RatingBlock';
import { getGameById } from '../services/gameService';
import { cancelRental } from '../services/reservationService';
import { useAuth } from '../context/AuthContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faWhatsapp } from '@fortawesome/free-brands-svg-icons';
import { faCommentSms } from '@fortawesome/free-solid-svg-icons';

const DANGER = '#FF3B30';

const _DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const _MON = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function formatDateEs(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${_DOW[d.getDay()]} ${d.getDate()} ${_MON[d.getMonth()]} ${d.getFullYear()}`;
}

function formatDuration(min) {
  if (!min || min <= 0) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m ? `${h}h ${m}min` : `${h}h`;
}

// ── Header
function Header({ title, onBack }) {
  return (
    <div style={{ background: BLUE, paddingTop: 'calc(env(safe-area-inset-top) + 14px)', paddingBottom: 14, paddingLeft: 16, paddingRight: 16 }}>
      <div style={{ height: 44, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={onBack}
          style={{ width: 36, height: 36, marginLeft: -8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, WebkitTapHighlightColor: 'transparent' }}>
          {I.back('#fff')}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        </div>
      </div>
    </div>
  );
}

// ── Hero image
function HeroImage({ coverPath, coverVersion }) {
  const src = coverPath ? getVenueCoverUrl(supabase, coverPath, coverVersion) : null;
  if (src) {
    return (
      <div style={{ width: '100%', aspectRatio: '16/6.3', overflow: 'hidden', flexShrink: 0 }}>
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
    );
  }
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
      <div style={{ width: 42, height: 42, borderRadius: 12, background: SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: TEXT, lineHeight: 1.3 }}>{primary}</div>
        {secondary && <div style={{ fontSize: 13, color: SUB, marginTop: 2, lineHeight: 1.35 }}>{secondary}</div>}
      </div>
      {action}
    </div>
  );
}

// ── WA chat button
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
function Chip({ label, icon }) {
  return (
    <div style={{ flex: '0 0 auto', height: 32, padding: '0 12px', borderRadius: 999, border: `1px solid ${HAIR}`, background: '#fff', display: 'inline-flex', alignItems: 'center', gap: 6, color: TEXT, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>
      {icon ? icon(TEXT) : null}
      <span>{label}</span>
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
    <div style={{ width: size, height: size, borderRadius: '50%', background: `hsl(${derivedHue} 35% 92%)`, color: `hsl(${derivedHue} 45% 35%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: size * 0.38, flexShrink: 0 }}>
      {initials || '?'}
    </div>
  );
}

// ── Section
function Section({ title, children }) {
  return (
    <div style={{ padding: '18px 16px', borderTop: `1px solid ${HAIR}` }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, letterSpacing: -0.1, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

// ── CTA
function CTA({ price, onPress }) {
  const [pressed, setPressed] = useState(false);
  return (
    <div style={{ padding: '12px 16px 12px', background: '#fff', borderTop: `1px solid ${HAIR}` }}>
      <button
        onClick={onPress}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
        style={{
          width: '100%', height: 54, borderRadius: 18,
          background: ORANGE, color: '#1B1B1F',
          border: 'none', cursor: 'pointer',
          fontSize: 16, fontWeight: 700, letterSpacing: -0.1, fontFamily: 'inherit',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          boxShadow: pressed ? '0 1px 4px rgba(0,0,0,0.08)' : '0 6px 18px rgba(245,165,36,0.40)',
          transform: pressed ? 'scale(0.985)' : 'scale(1)',
          transition: 'transform .12s ease, box-shadow .15s ease',
          WebkitTapHighlightColor: 'transparent', outline: 'none',
        }}>
        {I.joinIcon('#1B1B1F')}
        <span>Reservar cancha por {price}</span>
      </button>
    </div>
  );
}

// ── Cancel sheet
function CancelSheet({ userName, refundAmount, onClose, onConfirm, onDone }) {
  const [open, setOpen]               = useState(false);
  const [step, setStep]               = useState('select');
  const [capturedRefund, setCaptured] = useState(0);
  const fmt = n => `S/. ${Number(n).toFixed(2)}`;

  useEffect(() => { const t = setTimeout(() => setOpen(true), 20); return () => clearTimeout(t); }, []);

  function dismiss() {
    if (step === 'processing') return;
    setOpen(false);
    setTimeout(onClose, 220);
  }

  async function confirm() {
    setCaptured(refundAmount);
    setStep('processing');
    const result = await onConfirm();
    if (result?.error) { setStep('select'); return; }
    setStep('done');
    setTimeout(onDone, 1600);
  }

  return (
    <div className="sheet-overlay"
      onClick={dismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)',
        transition: 'background .22s ease',
      }}>
      <div className="sheet-panel"
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22,
          width: '100%', boxShadow: '0 -8px 32px rgba(0,0,0,0.12)',
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform .28s cubic-bezier(0.32,0.72,0,1)',
          maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        }}>

        {step === 'select' && (<>
          <div style={{ padding: '20px 16px 0', flexShrink: 0 }}>
            <div style={{ width: 42, height: 4, borderRadius: 2, background: '#D1D1D6', margin: '0 auto 16px' }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, letterSpacing: -0.2 }}>Cancelar reserva</div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 12px', borderRadius: 10, background: '#F0FFF4', marginBottom: 14, marginTop: 10 }}>
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="7.5" cy="7.5" r="6.5" stroke={GREEN} strokeWidth="1.4"/><path d="M7.5 5v4M7.5 10.5v.5" stroke={GREEN} strokeWidth="1.5" strokeLinecap="round"/></svg>
              <span style={{ fontSize: 12.5, color: GREEN, fontWeight: 500, lineHeight: 1.45 }}>Las cancelaciones generan un crédito aplicable a tu próxima reserva.</span>
            </div>
          </div>
          <div className="no-sb" style={{ overflowY: 'auto', flex: 1 }}>
            <div style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${HAIR}` }}>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 14.5, fontWeight: 600, color: BLUE }}>{userName} (Tú)</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, flexShrink: 0 }}>{fmt(refundAmount)}</div>
            </div>
          </div>
          <div style={{ padding: '12px 16px calc(12px + env(safe-area-inset-bottom))', borderTop: `1px solid ${HAIR}`, flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 14, color: SUB }}>Total a cancelar</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>{fmt(refundAmount)}</span>
            </div>
            <button
              onClick={confirm}
              style={{ width: '100%', height: 50, borderRadius: 14, background: DANGER, color: '#fff', border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
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
            {capturedRefund > 0 && (
              <div style={{ fontSize: 14, color: SUB, textAlign: 'center', lineHeight: 1.45 }}>
                Se generó un crédito de <strong style={{ color: GREEN }}>{fmt(capturedRefund)}</strong> en tu perfil.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Manage sheet (action sheet)
function ManageSheet({ onClose, onViewPayment, onCancel }) {
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
    <div className="sheet-overlay" onClick={dismiss} style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)', transition: 'background .22s ease', pointerEvents: open ? 'auto' : 'none' }}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ background: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, width: '100%', padding: '20px 16px calc(20px + env(safe-area-inset-bottom))', boxShadow: '0 -8px 32px rgba(0,0,0,0.12)', transform: open ? 'translateY(0)' : 'translateY(100%)', transition: 'transform .28s cubic-bezier(0.32,0.72,0,1)' }}>
        <div style={{ width: 42, height: 4, borderRadius: 2, background: '#D1D1D6', margin: '0 auto 20px' }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginBottom: 16, textAlign: 'center', letterSpacing: -0.2 }}>Gestionar la reserva</div>
        <button onClick={onViewPayment} style={rowStyle}>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: TEXT }}>Ver detalles del pago</span>
          </div>
          {chevron()}
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

// ── Payment sheet
function PaymentSheet({ onClose, userName, reservation }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOpen(true), 20); return () => clearTimeout(t); }, []);
  function dismiss() { setOpen(false); setTimeout(onClose, 220); }
  const fmt = n => `S/. ${Number(n).toFixed(2)}`;
  const amount = reservation?.amount ?? 0;
  const reservedAt = reservation?.reservedAt ? new Date(reservation.reservedAt) : null;
  const paidOn = reservedAt ? `${reservedAt.getDate()} ${['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][reservedAt.getMonth()]} ${reservedAt.getFullYear()}` : null;
  const row = (label, value, bold) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: bold ? 700 : 500, color: TEXT }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
  return (
    <div className="sheet-overlay" onClick={dismiss} style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)', transition: 'background .22s ease', pointerEvents: open ? 'auto' : 'none' }}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ background: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, width: '100%', padding: '20px 16px calc(24px + env(safe-area-inset-bottom))', boxShadow: '0 -8px 32px rgba(0,0,0,0.12)', transform: open ? 'translateY(0)' : 'translateY(100%)', transition: 'transform .28s cubic-bezier(0.32,0.72,0,1)' }}>
        <div style={{ width: 42, height: 4, borderRadius: 2, background: '#D1D1D6', margin: '0 auto 20px' }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginBottom: 16, textAlign: 'center', letterSpacing: -0.2 }}>Detalles del pago</div>
        <div style={{ padding: '12px 14px 14px', background: '#fff', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {row(`${userName} (Titular)`, fmt(amount))}
          {paidOn && <div style={{ fontSize: 12, color: SUB, marginTop: -4 }}>Pagado el {paidOn}</div>}
          <div style={{ borderTop: `1px solid ${HAIR}`, paddingTop: 8 }}>
            {row('Total', fmt(amount), true)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Rental status cache (sessionStorage, 5 min TTL, per-game)
const _RD_TTL = 5 * 60 * 1000;
function _readRDCache(gameId) {
  try {
    const d = JSON.parse(sessionStorage.getItem(`rd_status_${gameId}`));
    if (!d || Date.now() - d.ts > _RD_TTL) return null;
    return d;
  } catch { return null; }
}

// ── Screen
export default function RentalDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id }   = useParams();
  const { user } = useAuth();

  const _rd0 = _readRDCache(id);
  const [game, setGame]               = useState(() => {
    const base = location.state?.field ?? null;
    if (base && _rd0) return { ...base, bookedByUserId: _rd0.bookedByUserId };
    return base;
  });
  const [loading, setLoading]         = useState(!location.state?.field);
  const [statusReady, setStatusReady] = useState(!!_rd0);
  const [statusVerified, setStatusVerified] = useState(false);
  const [myReservation, setMyRes]     = useState(_rd0?.myReservation ?? null);
  const [cancelOpen, setCancelOpen]   = useState(false);
  const [manageOpen, setManageOpen]   = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [hostProfile, setHostProfile] = useState(null);

  // Always fetch fresh: game status (full fetch) + reservation net state — all in parallel.
  useEffect(() => {
    if (!id) return;
    Promise.all([
      getGameById(id),
      user?.id
        ? supabase.from('reservations').select('id, subtotal_amount, total_amount, reserved_at')
            .eq('game_id', id).eq('user_id', user.id).eq('status', 'spend')
            .order('reserved_at', { ascending: false }).limit(1)
        : null,
    ]).then(([freshGame, spendsRes]) => {
      if (freshGame) setGame(prev => prev
        ? { ...prev, status: freshGame.status, reserved: freshGame.status === 'reserved', bookedByUserId: freshGame.bookedByUserId ?? null }
        : freshGame
      );
      setLoading(false);
      const spends = spendsRes?.data;
      // Keep most-recent spend for amount display in PaymentSheet/CancelSheet only.
      // Active booking state is determined by game.bookedByUserId, not by spend/refund history.
      if (spends?.length) {
        setMyRes({ amount: spends[0].subtotal_amount ?? spends[0].total_amount ?? 0, reservedAt: spends[0].reserved_at ?? null });
      } else {
        setMyRes(null);
      }
      setStatusReady(true);
      setStatusVerified(true);
      try {
        sessionStorage.setItem(`rd_status_${id}`, JSON.stringify({
          bookedByUserId: freshGame?.bookedByUserId ?? null,
          myReservation:  spends?.length
            ? { amount: spends[0].subtotal_amount ?? spends[0].total_amount ?? 0, reservedAt: spends[0].reserved_at ?? null }
            : null,
          ts: Date.now(),
        }));
      } catch {}
    });
  }, [id, user?.id]); // eslint-disable-line

  useEffect(() => {
    const hostId = game?.hostUserId;
    if (!hostId || !supabase) return;
    supabase
      .from('users')
      .select('full_name, user_code, avatar_hue, avatar_path, avatar_updated_at')
      .eq('id', hostId)
      .maybeSingle()
      .then(({ data }) => { if (data) setHostProfile(data); });
  }, [game?.hostUserId]); // eslint-disable-line

  if (loading) {
    return <div className="screen-shell" style={{ background: '#F2F2F4' }} />;
  }

  if (!game) {
    return (
      <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: '#F2F2F4' }}>
        <Header title="Cancha" onBack={() => navigate(location.state?.backPath ?? '/fields')} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: SUB, fontSize: 15 }}>
          Cancha no encontrada
        </div>
        <TabBar />
      </div>
    );
  }

  const isHost       = !!user?.id && !!game.hostUserId && user.id === game.hostUserId;
  const isReserved   = game.reserved ?? (game.status === 'reserved');
  const userBooked   = statusReady && game?.bookedByUserId === user?.id;

  const userName = (() => { try { return JSON.parse(localStorage.getItem('pichanga_profile') || '{}').name || user?.email || 'Tú'; } catch { return user?.email || 'Tú'; } })();

  async function handleCancel() {
    const result = await cancelRental(game.id);
    if (!result?.error && !result?.skipped) {
      try {
        const res = JSON.parse(localStorage.getItem('pichanga_reservations') || '[]');
        localStorage.setItem('pichanga_reservations', JSON.stringify(res.filter(r => r.id !== game.id)));
      } catch {}
      setMyRes(null);
    }
    return result;
  }
  const title        = game.fieldName || game.field || 'Cancha';
  const date         = formatDateEs(game.dateKey);
  const timeStr      = game.time && game.ampm ? `${game.time} ${game.ampm}` : '';
  const duration     = formatDuration(game.durationMin);
  const timeRow      = [timeStr, duration].filter(Boolean).join(' · ');
  const priceNum     = game.priceTotalNum ?? 0;
  const priceDisplay = priceNum > 0 ? `S/.${priceNum.toFixed(2)}` : null;
  const isPastRental = isGamePast(game.dateKey, game.time24, game.durationMin);
  const existingRating = location.state?.rating ?? (() => {
    try { return JSON.parse(localStorage.getItem('pichanga_ratings') || '{}')[game.id] ?? null; } catch { return null; }
  })();

  const chips = [
    game.format  && { label: game.format,      icon: I.twoPeople },
    game.covered && { label: 'Techado',        icon: I.roof      },
    game.filmed  && { label: 'Filmado',         icon: I.camera    },
    game.parking && { label: 'Estacionamiento', icon: null        },
    game.showers && { label: 'Duchas',          icon: null        },
  ].filter(Boolean);

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: BLUE, overflow: 'hidden' }}>
      <Header title={title} onBack={() => navigate(location.state?.backPath ?? '/fields')} />

      <div className="no-sb" style={{ flex: 1, overflowY: 'auto', background: '#fff' }}>
        <HeroImage coverPath={game.venueCoverPath} coverVersion={game.venueCoverVersion} />

        {statusReady && (
          <div style={{ padding: '7px 16px 0', display: 'flex', justifyContent: 'center' }}>
            {userBooked && isPastRental ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '5px 14px', borderRadius: 999, background: '#F0FFF4', fontSize: 13, fontWeight: 600, color: GREEN }}>Finalizado</span>
            ) : userBooked ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '5px 14px', borderRadius: 999, background: '#F0FFF4', fontSize: 13, fontWeight: 600, color: GREEN }}>Reservado</span>
            ) : isHost ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '5px 14px', borderRadius: 999, background: ORANGE, fontSize: 13, fontWeight: 700, color: '#1B1B1F' }}>Organizador</span>
            ) : isReserved ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '5px 14px', borderRadius: 999, background: SOFT, fontSize: 13, fontWeight: 600, color: SUB }}>No disponible</span>
            ) : null}
          </div>
        )}

        {statusReady && isPastRental && userBooked && (
          <RatingBlock gameId={game.id} existingRating={existingRating} gameType="rental" hostUserId={game.hostUserId} />
        )}

        <div style={{ padding: '12px 16px 4px' }}>
          {date && (
            <InfoRow
              icon={I.cal()}
              primary={date}
              secondary={timeRow || undefined}
              action={(isHost || userBooked) ? <WAChatButton /> : undefined}
            />
          )}
          <InfoRow
            icon={I.fieldIcon()}
            primary={title}
            secondary={game.address || undefined}
          />
        </div>

        {chips.length > 0 && (
          <div style={{ padding: '8px 16px 18px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {chips.map((c, i) => <Chip key={i} label={c.label} icon={c.icon} />)}
          </div>
        )}

        <Section title="Descripción">
          <p style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.5, color: TEXT }}>
            {game.description || 'Alquiler exclusivo del campo para tu partido privado. Disfruta del espacio completo con tu grupo sin restricciones de tiempo adicionales.'}
          </p>
        </Section>

        <Section title="Recomendaciones">
          <p style={{ margin: '0 0 6px', fontSize: 14, lineHeight: 1.5, color: TEXT }}>
            {game.recommendations || 'Llega 10 minutos antes del horario reservado. Trae tu propio balón y equipo. El campo debe quedar limpio al finalizar.'}
          </p>
        </Section>

        <Section title="Organizador">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar
              name={hostProfile?.full_name || game.field || ''}
              size={44}
              hue={hostProfile?.avatar_hue ?? null}
              avatarPath={hostProfile?.avatar_path ?? null}
              avatarVersion={hostProfile?.avatar_updated_at ? new Date(hostProfile.avatar_updated_at).getTime() : null}
            />
            <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.4 }}>
              Esta cancha está organizada por{' '}
              <span style={{ fontWeight: 700 }}>{hostProfile?.full_name || game.field || '…'}</span>
            </div>
          </div>
        </Section>

        <div style={{ height: 8 }} />
      </div>

      {statusReady && !isHost && isPastRental && userBooked ? (
        <div style={{ background: '#fff', borderTop: `1px solid ${HAIR}`, padding: '12px 16px' }}>
          <button
            onClick={() => setPaymentOpen(true)}
            style={{ width: '100%', padding: '8px 16px', background: 'transparent', border: `1.5px solid ${BLUE}`, borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 600, color: BLUE, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            Ver pago
          </button>
        </div>
      ) : statusReady && !isHost && userBooked ? (
        <div style={{ background: '#fff', borderTop: `1px solid ${HAIR}`, padding: '12px 16px' }}>
          <button
            onClick={() => setManageOpen(true)}
            style={{ width: '100%', padding: '8px 16px', background: 'transparent', border: `1.5px solid ${BLUE}`, borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 600, color: BLUE, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            Gestionar mi reserva
          </button>
        </div>
      ) : statusReady && statusVerified && !isHost && priceDisplay && !isReserved ? (
        <CTA
          price={priceDisplay}
          onPress={() => navigate('/checkout', { state: {
            game: {
              id:          game.id,
              type:        'rental',
              source:      'rental',
              field:       title,
              date,
              dateKey:     game.dateKey  ?? null,
              time:        timeStr,
              time24:      game.time24   ?? null,
              ampm:        game.ampm     ?? null,
              duration:    duration || '',
              format:      game.format || '',
              price:       priceDisplay,
              priceNumber: priceNum,
              currency:    'S/.',
              backPath:    `/rental/${game.id}`,
            },
          }})}
        />
      ) : null}

      {manageOpen && (
        <ManageSheet
          onClose={() => setManageOpen(false)}
          onViewPayment={() => { setManageOpen(false); setTimeout(() => setPaymentOpen(true), 250); }}
          onCancel={() => { setManageOpen(false); setTimeout(() => setCancelOpen(true), 250); }}
        />
      )}

      {paymentOpen && (
        <PaymentSheet
          onClose={() => setPaymentOpen(false)}
          userName={userName}
          reservation={myReservation}
        />
      )}

      {cancelOpen && (
        <CancelSheet
          userName={userName}
          refundAmount={myReservation?.amount ?? 0}
          onClose={() => setCancelOpen(false)}
          onConfirm={handleCancel}
          onDone={() => navigate('/profile')}
        />
      )}

      <TabBar />
    </div>
  );
}
