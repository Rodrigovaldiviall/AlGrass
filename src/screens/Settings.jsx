import { useState, useEffect, useRef } from 'react';
import { haptic } from '../utils/haptic';
import { useNavigate } from 'react-router-dom';
import {
  BLUE, TEXT, SUB, HAIR, ORANGE, SOFT, DANGER,
  WHATSAPP_NUMBER, WHATSAPP_DISPLAY, SUPPORT_EMAIL,
} from '../constants';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faWhatsapp } from '@fortawesome/free-brands-svg-icons';
import pkg from '../../package.json';

const PROFILE_KEY = 'pichanga_profile';
const PRIVACY_KEY = 'pichanga_privacy';
const NOTIF_KEY   = 'pichanga_notif';
const ROLE_KEY    = 'pichanga_role';

async function fetchAvailableCities() {
  const { data } = await supabase.from('venues').select('city').not('city', 'is', null);
  return [...new Set((data ?? []).map(r => r.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
}

const TERMS_TEXT = `Algrass es una plataforma de reservas deportivas que conecta jugadores con organizadores de partidos y campos de fútbol. Al suscribirte aceptas usar la plataforma de forma responsable y confirmas ser mayor de 18 años. Las reservas están sujetas a disponibilidad y los pagos son procesados de forma segura. Algrass no se responsabiliza por lesiones ocurridas durante los partidos. Los organizadores son responsables de las condiciones de sus instalaciones. Nos reservamos el derecho de suspender cuentas que incumplan estas normas.`;

const PRIVACY_TEXT = `Recopilamos únicamente los datos necesarios para gestionar tu cuenta y reservas: nombre, email, y datos de contacto. No compartimos tu información personal con terceros salvo los organizadores de los partidos que reserves. Tus datos de pago son procesados por proveedores seguros certificados y nunca los almacenamos directamente. Puedes solicitar la eliminación de tu cuenta y datos en cualquier momento contactándonos. Cumplimos con la Ley de Protección de Datos Personales del Perú (Ley 29733).`;

const FAQ_GROUPS = [
  {
    key: 'jugador',
    label: 'Jugador',
    items: [
      {
        key: 'j1',
        q: '¿Cómo suscribirte a un partido?',
        a: 'Navega a la sección de Partidos, elige el partido que te interesa y selecciona tu lugar. Completa el pago con Yape o tarjeta para confirmar tu reserva.',
      },
      {
        key: 'j2',
        q: '¿Quién organiza el partido?',
        a: 'Los partidos son organizados por usuarios registrados como organizadores en Algrass. Ellos definen el campo, horario, formato y precio.',
      },
      {
        key: 'j3',
        q: '¿Cómo contactar al organizador?',
        a: 'En la pantalla de detalle del partido encontrarás el botón de contacto con el organizador vía WhatsApp.',
      },
    ],
  },
  {
    key: 'organizador',
    label: 'Organizador',
    items: [
      {
        key: 'o1',
        q: '¿Quieres organizar partidos y/o alquilar campos de fútbol?',
        a: 'Contacta a nuestro equipo de soporte para registrarte como organizador. Podrás crear partidos, gestionar reservas y administrar tus campos desde la plataforma.',
      },
    ],
  },
];

const SOCIAL_LINKS = [
  {
    key: 'instagram',
    label: 'Instagram',
    color: '#E1306C',
    url: 'https://www.instagram.com/algrass',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <rect x="2" y="2" width="20" height="20" rx="5.5" stroke="#fff" strokeWidth="1.8"/>
        <circle cx="12" cy="12" r="4.5" stroke="#fff" strokeWidth="1.8"/>
        <circle cx="17.5" cy="6.5" r="1.2" fill="#fff"/>
      </svg>
    ),
  },
  {
    key: 'facebook',
    label: 'Facebook',
    color: '#1877F2',
    url: 'https://www.facebook.com/algrass',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    color: '#010101',
    url: 'https://www.tiktok.com/@algrass',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    color: '#0A66C2',
    url: 'https://www.linkedin.com/company/algrass',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <rect x="2" y="2" width="20" height="20" rx="4.5" stroke="#fff" strokeWidth="1.8"/>
        <path d="M8 11v5M8 8v.01M12 16v-4a2 2 0 0 1 4 0v4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    ),
  },
];

// ── Primitives ─────────────────────────────────────────────────────────────

function Toggle({ on, onChange }) {
  return (
    <button
      onClick={onChange}
      role="switch"
      aria-checked={on}
      style={{
        width: 44, height: 26, borderRadius: 999, border: 'none',
        background: on ? BLUE : '#E5E5EA',
        cursor: 'pointer', padding: 0, position: 'relative',
        transition: 'background .2s ease',
        WebkitTapHighlightColor: 'transparent', outline: 'none', flexShrink: 0,
      }}>
      <div style={{
        position: 'absolute', top: 2,
        left: on ? 20 : 2,
        width: 22, height: 22, borderRadius: '50%',
        background: '#fff',
        boxShadow: '0 2px 5px rgba(0,0,0,0.22)',
        transition: 'left .2s ease',
      }} />
    </button>
  );
}

function ChevRight() {
  return (
    <svg width="8" height="13" viewBox="0 0 8 13" fill="none">
      <path d="M1 1l6 5.5L1 12" stroke="#C7C7CC" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ChevDown({ open }) {
  return (
    <svg width="12" height="8" viewBox="0 0 12 8" fill="none"
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .2s ease', flexShrink: 0 }}>
      <path d="M1 1l5 5 5-5" stroke={SUB} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function Sep() {
  return <div style={{ height: 1, background: HAIR, marginLeft: 16 }} />;
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {title && (
        <div style={{ fontSize: 11, fontWeight: 600, color: SUB, letterSpacing: 0.5, textTransform: 'uppercase', paddingLeft: 4, marginBottom: 7 }}>
          {title}
        </div>
      )}
      <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, sublabel, value, onPress, right, disabled, danger, accent }) {
  const [pressed, setPressed] = useState(false);
  const isClickable = !disabled && !!onPress;
  const labelColor = danger ? DANGER : (accent || TEXT);
  return (
    <div
      onClick={isClickable ? onPress : undefined}
      onPointerDown={() => isClickable && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: sublabel ? '6px 16px' : '0 16px', minHeight: 36,
        background: pressed ? SOFT : '#fff',
        cursor: isClickable ? 'pointer' : 'default',
        opacity: disabled ? 0.42 : 1,
        transition: 'background .1s ease',
        WebkitTapHighlightColor: 'transparent', boxSizing: 'border-box',
      }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: labelColor, fontWeight: (danger || accent) ? 600 : 400, lineHeight: 1.3 }}>{label}</div>
        {sublabel && <div style={{ fontSize: 11, color: SUB, marginTop: 2, lineHeight: 1.35 }}>{sublabel}</div>}
      </div>
      {value != null && <span style={{ fontSize: 13.5, color: SUB, flexShrink: 0 }}>{value}</span>}
      {right && <div style={{ flexShrink: 0 }}>{right}</div>}
    </div>
  );
}

// ── LegalModal ─────────────────────────────────────────────────────────────

function LegalModal({ type, onClose }) {
  if (!type) return null;
  const isTerms = type === 'terms';
  const title = isTerms ? 'Términos de Servicio' : 'Política de Privacidad';
  const body  = isTerms ? TERMS_TEXT : PRIVACY_TEXT;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px 16px',
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 20,
          width: '100%', maxWidth: 480,
          maxHeight: 'calc(100dvh - 48px)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}>
        <div style={{ padding: '18px 20px 14px', borderBottom: `1px solid ${HAIR}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: TEXT, letterSpacing: -0.2 }}>{title}</span>
          <button
            onClick={onClose}
            style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: SOFT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1l10 10M11 1L1 11" stroke={TEXT} strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className="no-sb" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 20px 28px' }}>
          <p style={{ fontSize: 14.5, color: TEXT, lineHeight: 1.65, margin: 0 }}>{body}</p>
        </div>
      </div>
    </div>
  );
}

// ── DeleteModal ─────────────────────────────────────────────────────────────

function DeleteModal({ onConfirm, onCancel }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOpen(true), 20); return () => clearTimeout(t); }, []);

  function confirm() { setOpen(false); setTimeout(onConfirm, 220); }
  function cancel()  { setOpen(false); setTimeout(onCancel,  220); }

  return (
    <div
      onClick={cancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)',
        transition: 'background .22s ease',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff',
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          padding: '24px 20px calc(32px + env(safe-area-inset-bottom))',
          display: 'flex', flexDirection: 'column', gap: 12,
          boxShadow: '0 -8px 32px rgba(0,0,0,0.12)',
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform .28s cubic-bezier(0.32,0.72,0,1)',
        }}>
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: TEXT, letterSpacing: -0.3 }}>¿Eliminar tu cuenta?</div>
          <div style={{ fontSize: 14, color: SUB, marginTop: 8, lineHeight: 1.5 }}>
            Esta acción eliminará todos tus datos y no se puede deshacer.
          </div>
        </div>
        <button
          onClick={confirm}
          style={{
            height: 52, borderRadius: 16, border: 'none', cursor: 'pointer',
            background: DANGER, color: '#fff',
            fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
            WebkitTapHighlightColor: 'transparent', outline: 'none',
          }}>
          Eliminar cuenta
        </button>
        <button
          onClick={cancel}
          style={{
            height: 52, borderRadius: 16, border: 'none', cursor: 'pointer',
            background: SOFT, color: TEXT,
            fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
            WebkitTapHighlightColor: 'transparent', outline: 'none',
          }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ── RoleButton ─────────────────────────────────────────────────────────────

const YELLOW_ORG = '#F5A623';

function RoleButton({ role, onSwitch }) {
  const [pressed, setPressed] = useState(false);
  const isOrg = role === 'organizador';
  return (
    <button
      onClick={onSwitch}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        height: 34, padding: '0 14px', borderRadius: 999,
        border: 'none', cursor: 'pointer', flexShrink: 0,
        background: isOrg ? YELLOW_ORG : BLUE,
        color: '#fff',
        fontSize: 12.5, fontWeight: 700, letterSpacing: 0.2,
        fontFamily: 'inherit',
        WebkitTapHighlightColor: 'transparent', outline: 'none',
        transform: pressed ? 'scale(0.96)' : 'scale(1)',
        transition: 'transform .12s ease, background .22s ease',
        boxShadow: pressed ? '0 1px 3px rgba(0,0,0,0.10)' : '0 2px 8px rgba(0,0,0,0.13)',
      }}>
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
        <path d="M2 4h8M8 2l2 2-2 2M12 10H4M4 8l-2 2 2 2" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {isOrg ? 'Organizador' : 'Jugador'}
    </button>
  );
}

// ── SecuritySheet ──────────────────────────────────────────────────────────

function SecuritySheet({ onClose, onDeleteRequest }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOpen(true), 20); return () => clearTimeout(t); }, []);

  function close() { setOpen(false); setTimeout(onClose, 260); }
  function handleDelete() { setOpen(false); setTimeout(onDeleteRequest, 260); }

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)',
        transition: 'background .22s ease',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        pointerEvents: open ? 'auto' : 'none',
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: SOFT,
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          padding: '8px 16px calc(28px + env(safe-area-inset-bottom))',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.10)',
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform .28s cubic-bezier(0.32,0.72,0,1)',
        }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: '#D1D1D6', margin: '8px auto 20px' }} />
        <div style={{ fontSize: 11, fontWeight: 600, color: SUB, letterSpacing: 0.5, textTransform: 'uppercase', paddingLeft: 4, marginBottom: 7 }}>
          Seguridad
        </div>
        <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden' }}>
          <Row label="Eliminar mi cuenta" onPress={handleDelete} danger />
        </div>
        <div style={{ height: 12 }} />
        <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden' }}>
          <Row label="Cancelar" onPress={close} />
        </div>
      </div>
    </div>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────

export default function Settings() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();

  const [profileData, setProfileData] = useState(() => {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}; } catch { return {}; }
  });
  const [city, setCity] = useState(() => {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY))?.city || ''; } catch { return ''; }
  });
  const [privacyOn, setPrivacyOn] = useState(() => {
    try { const v = localStorage.getItem(PRIVACY_KEY); return v === null ? true : JSON.parse(v); } catch { return true; }
  });
  const [notifOn, setNotifOn] = useState(() => {
    try { const v = localStorage.getItem(NOTIF_KEY); return v === null ? true : JSON.parse(v); } catch { return true; }
  });
  const [role, setRole] = useState(() => {
    try { return localStorage.getItem(ROLE_KEY) || 'jugador'; } catch { return 'jugador'; }
  });
  const [availableCities, setAvailableCities] = useState([]);
  useEffect(() => { fetchAvailableCities().then(setAvailableCities); }, []);

  const [groupOpen, setGroupOpen] = useState({ jugador: false, organizador: false });
  const [openQuestion, setOpenQuestion] = useState(null);
  const [legalModal, setLegalModal] = useState(null);
  const [showSecurity, setShowSecurity] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const shellRef = useRef(null);

  async function saveCity(raw) {
    haptic();
    const v = raw.trim() || 'Arequipa';
    setCity(v);
    const updated = { ...profileData, city: v };
    setProfileData(updated);
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(updated)); } catch {}
    if (supabase && user?.id) {
      await supabase.from('users').update({ city: v }).eq('id', user.id);
    }
    shellRef.current?.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.014)' }, { transform: 'scale(1)' }],
      { duration: 420, easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)', fill: 'none' },
    );
  }

  function togglePrivacy() {
    const v = !privacyOn;
    setPrivacyOn(v);
    try { localStorage.setItem(PRIVACY_KEY, JSON.stringify(v)); } catch {}
    if (supabase && user?.id) {
      console.log('[privacy] UPDATE profile_private =', !v, 'user =', user.id);
      supabase.from('users').update({ profile_private: !v }).eq('id', user.id)
        .then(({ error }) => console.log('[privacy] update result error =', error));
    } else {
      console.warn('[privacy] skipped — supabase:', !!supabase, 'user?.id:', user?.id);
    }
  }

  function toggleNotif() {
    const v = !notifOn;
    setNotifOn(v);
    try { localStorage.setItem(NOTIF_KEY, JSON.stringify(v)); } catch {}
  }

  function switchRole() {
    const next = role === 'jugador' ? 'organizador' : 'jugador';
    setRole(next);
    try { localStorage.setItem(ROLE_KEY, next); } catch {}
  }

  function toggleGroup(key) {
    setGroupOpen(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleQuestion(key) {
    setOpenQuestion(prev => prev === key ? null : key);
  }

  function deleteAccount() {
    [
      'pichanga_user', 'pichanga_profile', 'pichanga_ratings',
      'pichanga_shown_confirmations', 'pichanga_skipped_ratings',
      'pichanga_usercodes', PRIVACY_KEY, NOTIF_KEY,
    ].forEach(k => localStorage.removeItem(k));
    logout();
    navigate('/auth', { replace: true });
  }

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [loggingOut, setLoggingOut]               = useState(false);

  function doLogout() {
    setShowLogoutConfirm(true);
  }

  function confirmLogout() {
    haptic();
    setShowLogoutConfirm(false);
    setLoggingOut(true);
    setTimeout(() => {
      logout();
      navigate('/auth', { replace: true });
    }, 520);
  }

  return (
    <div ref={shellRef} className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: SOFT, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{
        background: BLUE,
        paddingTop: 'calc(env(safe-area-inset-top) + 14px)',
        paddingBottom: 14, paddingLeft: 20, paddingRight: 20, flexShrink: 0,
      }}>
        <div style={{ height: 44, display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
          <button
            onClick={() => navigate(-1)}
            style={{ width: 36, height: 36, marginLeft: -8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            <svg width="11" height="18" viewBox="0 0 11 18" fill="none">
              <path d="M9.5 1L1 9l8.5 8" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
            <span style={{ color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>Configuración</span>
          </div>
        </div>
      </div>

      {/* Scrollable list */}
      <div className="no-sb" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '20px 16px calc(32px + env(safe-area-inset-bottom))' }}>

        {/* 1. Ciudad */}
        <Section title="Ciudad">
          <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px', minHeight: 38, gap: 12 }}>
            <span style={{ flex: 1, fontSize: 13.5, color: TEXT }}>Ciudad</span>
            <select
              value={city || availableCities[0] || ''}
              onChange={e => saveCity(e.target.value)}
              style={{
                height: 28, borderRadius: 8, border: `1px solid ${HAIR}`,
                padding: '0 28px 0 10px', fontSize: 13.5, color: TEXT,
                fontFamily: 'inherit', background: `${SOFT} url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23999' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 8px center`,
                outline: 'none', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none',
                boxSizing: 'border-box', flexShrink: 0,
              }}>
              {availableCities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </Section>

        {/* 2. Contactar soporte */}
        <Section title="Soporte">
          <a
            href={`https://wa.me/${WHATSAPP_NUMBER}`}
            target="_blank" rel="noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', minHeight: 38, textDecoration: 'none' }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: '#E8F9EF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <FontAwesomeIcon icon={faWhatsapp} style={{ fontSize: 15, color: '#25D366' }} />
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 13.5, color: TEXT }}>WhatsApp</span>
              <span style={{ fontSize: 12.5, color: SUB }}>{WHATSAPP_DISPLAY}</span>
            </div>
            <ChevRight />
          </a>
          <Sep />
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', minHeight: 38, textDecoration: 'none' }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="4" width="20" height="16" rx="3" stroke={SUB} strokeWidth="1.6"/>
                <path d="M2 7l10 7 10-7" stroke={SUB} strokeWidth="1.6" strokeLinejoin="round"/>
              </svg>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 13.5, color: TEXT }}>Email</span>
              <span style={{ fontSize: 12.5, color: SUB }}>{SUPPORT_EMAIL}</span>
            </div>
            <ChevRight />
          </a>
        </Section>

        {/* 3. Rol */}
        <Section title="Rol">
          <div style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', gap: 12, minHeight: 44 }}>
            <span style={{ flex: 1, fontSize: 13.5, color: TEXT, fontWeight: 500 }}>
              {role === 'jugador' ? 'Convertirse en organizador' : 'Volver a jugador'}
            </span>
            <RoleButton role={role} onSwitch={switchRole} />
          </div>
        </Section>

        {/* 4. Cuenta */}
        <Section title="Cuenta">
          <Row
            label="Editar perfil"
            onPress={() => navigate('/profile', { state: { openEdit: true } })}
            right={<ChevRight />}
          />
          <Sep />
          <Row
            label="Privacidad del perfil"
            sublabel="Edad, sexo y posición visibles para otros"
            right={<Toggle on={privacyOn} onChange={togglePrivacy} />}
          />
          <Sep />
          <Row
            label="Seguridad"
            onPress={() => setShowSecurity(true)}
            right={<ChevRight />}
          />
        </Section>

        {/* 6. Preguntas frecuentes */}
        <Section title="Preguntas frecuentes">
          {FAQ_GROUPS.map((group, gi) => (
            <div key={group.key}>
              {gi > 0 && <Sep />}
              <button
                onClick={() => toggleGroup(group.key)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center',
                  padding: '0 16px', minHeight: 38, gap: 12,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent', outline: 'none', fontFamily: 'inherit',
                }}>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: TEXT, textAlign: 'left' }}>{group.label}</span>
                <ChevDown open={groupOpen[group.key]} />
              </button>
              {groupOpen[group.key] && group.items.map(item => (
                <div key={item.key} style={{ borderTop: `1px solid ${HAIR}`, marginLeft: 16 }}>
                  <button
                    onClick={() => toggleQuestion(item.key)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center',
                      padding: '9px 16px 9px 0', gap: 12,
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent', outline: 'none', fontFamily: 'inherit',
                    }}>
                    <span style={{ flex: 1, fontSize: 13.5, color: TEXT, textAlign: 'left', lineHeight: 1.35 }}>{item.q}</span>
                    <ChevDown open={openQuestion === item.key} />
                  </button>
                  {openQuestion === item.key && (
                    <div style={{ paddingBottom: 14, paddingRight: 16, fontSize: 13.5, color: SUB, lineHeight: 1.6 }}>
                      {item.a}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </Section>

        {/* 7+8. Legal */}
        <Section title="Legal">
          <Row label="Términos de servicio" onPress={() => setLegalModal('terms')} right={<ChevRight />} />
          <Sep />
          <Row label="Política de privacidad" onPress={() => setLegalModal('privacy')} right={<ChevRight />} />
        </Section>

        {/* 9. Notificaciones */}
        <Section title="Notificaciones">
          <Row label="Notificaciones push" right={<Toggle on={notifOn} onChange={toggleNotif} />} />
        </Section>

        {/* 10. Log out */}
        <Section>
          <Row label="Cerrar sesión" onPress={doLogout} accent={BLUE} />
        </Section>

        {/* 11. Conectar */}
        <Section title="Conectar">
          <div style={{ display: 'flex', padding: '12px 16px', gap: 10 }}>
            {SOCIAL_LINKS.map(s => (
              <div
                key={s.key}
                title={s.label}
                style={{
                  width: 40, height: 40, borderRadius: 11,
                  background: s.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, opacity: 0.35,
                }}>
                {s.icon}
              </div>
            ))}
          </div>
        </Section>

        {/* 12. Versión */}
        <div style={{ textAlign: 'center', padding: '4px 0 8px', fontSize: 12, color: SUB }}>
          v{pkg.version}
        </div>

      </div>

      {legalModal && <LegalModal type={legalModal} onClose={() => setLegalModal(null)} />}
      {showSecurity && (
        <SecuritySheet
          onClose={() => setShowSecurity(false)}
          onDeleteRequest={() => { setShowSecurity(false); setShowDelete(true); }}
        />
      )}
      {showDelete && <DeleteModal onConfirm={deleteAccount} onCancel={() => setShowDelete(false)} />}
      {loggingOut && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99999,
          background: 'rgba(255,255,255,0.94)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 14,
        }}>
          <div style={{
            width: 34, height: 34, borderRadius: '50%',
            border: `3px solid ${SOFT}`, borderTopColor: BLUE,
            animation: 'spin 0.7s linear infinite',
          }} />
          <div style={{ fontSize: 14, color: SUB, fontWeight: 500 }}>Cerrando sesión...</div>
        </div>
      )}

      {showLogoutConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 32px',
        }}>
          <div style={{
            background: '#fff', borderRadius: 18, width: '100%', maxWidth: 340,
            padding: '24px 20px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: TEXT, textAlign: 'center', lineHeight: 1.35 }}>
              ¿Estás seguro de cerrar sesión?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
              <button
                onClick={confirmLogout}
                style={{
                  width: '100%', padding: '13px 0', borderRadius: 12,
                  background: BLUE, color: '#fff', border: 'none',
                  fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                Cerrar
              </button>
              <button
                onClick={() => setShowLogoutConfirm(false)}
                style={{
                  width: '100%', padding: '13px 0', borderRadius: 12,
                  background: SOFT, color: TEXT, border: 'none',
                  fontSize: 15, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
