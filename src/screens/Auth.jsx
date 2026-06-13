import { useState, useEffect } from 'react';
import { haptic } from '../utils/haptic';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { BLUE, TEXT, SUB, HAIR, ORANGE, SOFT } from '../constants';
import I from '../icons';
import ConfirmReservation from './ConfirmReservation';
import { deriveGameState } from '../utils/deriveGameState';

// ── Shared primitives ──────────────────────────────────────────────────────

function EyeIcon({ visible }) {
  return visible
    ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" stroke="#8E8E93" strokeWidth="1.8"/><circle cx="12" cy="12" r="3" stroke="#8E8E93" strokeWidth="1.8"/><line x1="3" y1="3" x2="21" y2="21" stroke="#8E8E93" strokeWidth="1.8" strokeLinecap="round"/></svg>
    : <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" stroke="#8E8E93" strokeWidth="1.8"/><circle cx="12" cy="12" r="3" stroke="#8E8E93" strokeWidth="1.8"/></svg>;
}

function Field({ value, onChange, placeholder, type = 'text', autoComplete }) {
  const [focused, setFocused] = useState(false);
  const [showPw,  setShowPw]  = useState(false);
  const isPw = type === 'password';
  const inputEl = (
    <input
      type={isPw ? (showPw ? 'text' : 'password') : type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete={autoComplete}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        width: '100%', height: 44, padding: isPw ? '0 44px 0 16px' : '0 16px',
        borderRadius: 14,
        border: `1px solid ${focused ? BLUE : HAIR}`,
        background: '#fff',
        fontSize: 15, fontFamily: 'inherit', color: TEXT,
        outline: 'none',
        transition: 'border-color .15s ease, box-shadow .15s ease',
        boxShadow: focused ? `0 0 0 3px rgba(0,123,255,0.12)` : 'none',
        WebkitAppearance: 'none',
        boxSizing: 'border-box',
      }}
    />
  );
  if (!isPw) return inputEl;
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {inputEl}
      <button
        type="button"
        onClick={() => setShowPw(p => !p)}
        style={{
          position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', cursor: 'pointer', padding: 2,
          display: 'flex', alignItems: 'center', lineHeight: 0,
        }}
      >
        <EyeIcon visible={showPw} />
      </button>
    </div>
  );
}

function OrangeButton({ onPress, disabled, children }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onClick={disabled ? undefined : onPress}
      disabled={!!disabled}
      onPointerDown={() => !disabled && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        width: '100%', height: 48, borderRadius: 18,
        background: disabled ? '#E8E8EC' : ORANGE,
        color: disabled ? '#9A9AA0' : '#1B1B1F',
        border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 16, fontWeight: 700, letterSpacing: -0.1, fontFamily: 'inherit',
        boxShadow: disabled ? 'none' : (pressed ? '0 1px 4px rgba(0,0,0,0.08)' : '0 6px 18px rgba(245,165,36,0.40)'),
        transform: !disabled && pressed ? 'scale(0.985)' : 'scale(1)',
        transition: 'transform .12s ease, box-shadow .15s ease, background .15s ease',
        WebkitTapHighlightColor: 'transparent', outline: 'none',
      }}>
      {children}
    </button>
  );
}

function Checkbox({ checked, onChange }) {
  return (
    <button
      onClick={e => { e.preventDefault(); onChange(); }}
      role="checkbox"
      aria-checked={checked}
      style={{
        width: 22, height: 22, marginTop: 1, padding: 0, flexShrink: 0,
        borderRadius: 6,
        border: `1.6px solid ${checked ? ORANGE : '#C7C7CC'}`,
        background: checked ? ORANGE : '#fff',
        cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background .15s ease, border-color .15s ease',
        WebkitTapHighlightColor: 'transparent', outline: 'none',
      }}>
      {checked && (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2.5 7.2l3 3L11.5 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  );
}

function SocialButton({ label, icon, onClick, loading, variant = 'light' }) {
  const [pressed, setPressed] = useState(false);
  const isFacebook = variant === 'facebook';
  return (
    <button
      onClick={loading ? undefined : onClick}
      disabled={!!loading}
      onPointerDown={() => !loading && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        width: '100%', height: 44, borderRadius: 14,
        background: isFacebook ? '#1877F2' : '#fff',
        border: isFacebook ? 'none' : `1px solid #DADCE0`,
        cursor: loading ? 'default' : 'pointer',
        fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
        color: isFacebook ? '#fff' : TEXT,
        letterSpacing: -0.1,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        transform: !loading && pressed ? 'scale(0.99)' : 'scale(1)',
        transition: 'transform .12s ease',
        WebkitTapHighlightColor: 'transparent', outline: 'none',
        opacity: loading ? 0.7 : 1,
      }}>
      {loading
        ? <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ animation: 'spin .8s linear infinite' }}>
            <circle cx="9" cy="9" r="7" stroke={isFacebook ? '#fff' : HAIR} strokeWidth="2"/>
            <path d="M9 2a7 7 0 0 1 7 7" stroke={isFacebook ? '#fff' : BLUE} strokeWidth="2" strokeLinecap="round"/>
          </svg>
        : icon}
      <span>{loading ? 'Conectando…' : label}</span>
    </button>
  );
}

const PROFILE_KEY   = 'pichanga_profile';
const USERCODES_KEY = 'pichanga_usercodes';
const USERS_KEY     = 'pichanga_users';
function getUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY)) || {}; }
  catch { return {}; }
}
function userExists(email) {
  return !!getUsers()[email.toLowerCase().trim()];
}
function getUserName(email) {
  return getUsers()[email.toLowerCase().trim()]?.name || '';
}
function registerUser(email, name) {
  const users = getUsers();
  users[email.toLowerCase().trim()] = { name };
  try { localStorage.setItem(USERS_KEY, JSON.stringify(users)); } catch {}
}

function normalizeForCode(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z]/g, '').toLowerCase();
}

function generateUserCode(fullName) {
  const parts  = (fullName || '').trim().split(/\s+/);
  const first  = normalizeForCode(parts[0] || '');
  const second = normalizeForCode(parts[1] || '').slice(0, 3);
  let existing = {};
  try { existing = JSON.parse(localStorage.getItem(USERCODES_KEY)) || {}; } catch {}
  for (let i = 0; i < 20; i++) {
    const digits = String(Math.floor(Math.random() * 900) + 100);
    const code = first + second + digits;
    if (!existing[code]) {
      existing[code] = true;
      try { localStorage.setItem(USERCODES_KEY, JSON.stringify(existing)); } catch {}
      return code;
    }
  }
  return first + second + String(Math.floor(Math.random() * 900) + 100);
}

const MOCK_CODE = '112233';

function maskEmail(e) {
  const at = e.indexOf('@');
  if (at < 1) return e;
  return e[0] + '****' + e.slice(at);
}
function maskPhone(p) {
  const d = (p || '').replace(/\D/g, '');
  return d.length >= 3 ? `*** *** ${d.slice(-3)}` : p;
}
function fmtTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function getUserPhone() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null')?.phone || ''; } catch { return ''; }
}

const TERMS_TEXT = `Algrass es una plataforma de reservas deportivas que conecta jugadores con organizadores de partidos y campos de fútbol. Al suscribirte aceptas usar la plataforma de forma responsable y confirmas ser mayor de 18 años. Las reservas están sujetas a disponibilidad y los pagos son procesados de forma segura. Algrass no se responsabiliza por lesiones ocurridas durante los partidos. Los organizadores son responsables de las condiciones de sus instalaciones. Nos reservamos el derecho de suspender cuentas que incumplan estas normas.`;

const PRIVACY_TEXT = `Recopilamos únicamente los datos necesarios para gestionar tu cuenta y reservas: nombre, email, y datos de contacto. No compartimos tu información personal con terceros salvo los organizadores de los partidos que reserves. Tus datos de pago son procesados por proveedores seguros certificados y nunca los almacenamos directamente. Puedes solicitar la eliminación de tu cuenta y datos en cualquier momento contactándonos. Cumplimos con la Ley de Protección de Datos Personales del Perú (Ley 29733).`;

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
            style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: '#F2F2F7', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
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

// ── AuthGate ──────────────────────────────────────────────────────────────

export function AuthGate() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const { user } = useAuth();
  const game = state?.game;
  const waitlistMode = state?.waitlistMode ?? false;

  // Post-login: revalidar que el usuario no tenga ya relación con el partido
  // (host / inscrito / invitado / cancelado-con-invitados). Reutiliza
  // deriveGameState.isVisible. Solo aplica al "Únete" puro (no add-guests/waitlist/rental).
  const [relStatus, setRelStatus] = useState('checking'); // checking | allowed | blocked
  useEffect(() => {
    if (!user?.id) return; // sin login → se muestra la UI de login
    if (!game?.id || waitlistMode || game.invitedMode || game.addGuestsMode || game.type === 'rental') { setRelStatus('allowed'); return; }
    setRelStatus('checking');
    if (game.hostUserId === user.id) { setRelStatus('blocked'); return; }
    let cancelled = false;
    supabase.from('game_players')
      .select('user_id, payer_id, status')
      .eq('game_id', game.id)
      .or(`user_id.eq.${user.id},payer_id.eq.${user.id}`)
      .then(({ data }) => {
        if (cancelled) return;
        setRelStatus(deriveGameState(data ?? [], user.id).isVisible ? 'blocked' : 'allowed');
      });
    return () => { cancelled = true; };
  }, [user?.id, game?.id, game?.hostUserId, game?.type, game?.invitedMode, game?.addGuestsMode, waitlistMode]);

  if (!game && !waitlistMode && !state?.gateCleared) return <Navigate to="/games" replace />;

  if (user && waitlistMode) return <Navigate to={state?.backPath || '/games'} replace />;

  if (user && !state?.gateCleared) {
    return <Navigate to="/checkout" state={{ ...state, user, gateCleared: true }} replace />;
  }
  if (user) {
    if (relStatus === 'checking') return (
      <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#fff', gap: 14 }}>
        <div style={{ width: 28, height: 28, border: `3px solid ${SOFT}`, borderTopColor: BLUE, borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
        <div style={{ fontSize: 14, color: SUB, fontWeight: 500 }}>Verificando tu reserva...</div>
      </div>
    );
    if (relStatus === 'blocked') {
      return <Navigate to={`/game/${game.id}`} state={{ game, infoMode: true, backPath: game.gameDetailBackPath ?? '/games' }} replace />;
    }
    return <ConfirmReservation />;
  }

  const navTitle = waitlistMode ? 'Lista de espera' : 'Confirmar reserva';
  const bodyMsg  = waitlistMode
    ? 'Debes tener una cuenta para ponerte en lista de espera'
    : 'Debes tener una cuenta para hacer una reserva';

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: BLUE, overflow: 'hidden' }}>
      <div style={{
        background: BLUE,
        paddingTop: 'calc(env(safe-area-inset-top) + 14px)',
        paddingBottom: 14, paddingLeft: 16, paddingRight: 16,
      }}>
        <div style={{ height: 44, display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
          <button
            onClick={() => { navigate(-1); }}
            style={{ width: 36, height: 36, marginLeft: -8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent' }}>
            {I.back('#fff')}
          </button>
          <div style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
            <span style={{ color: '#fff', fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>
              {navTitle}
            </span>
          </div>
        </div>
      </div>

      <div className="no-sb" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: '#fff' }}>
        {game && (
          <div style={{ padding: '20px 16px 0' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: TEXT, letterSpacing: -0.4, lineHeight: 1.15 }}>
              {game.field}
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {I.cal(TEXT)}
              </div>
              <div style={{ flex: 1, paddingTop: 2 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: TEXT, lineHeight: 1.3 }}>{game.date}</div>
                <div style={{ marginTop: 4, fontSize: 13.5, color: SUB, lineHeight: 1.4 }}>{game.time} · {game.duration}</div>
                <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: SUB }}>
                  {I.twoPeople(SUB)}
                  <span>{game.format || (game.chips?.find(c => c.kind === 'format')?.label) || ''}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div style={{ padding: '48px 32px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 18 }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
              <circle cx="18" cy="18" r="14" stroke={TEXT} strokeWidth="1.6" fill="#fff"/>
              <path d="M18 7l5 4-2 6h-6l-2-6 5-4z" fill={TEXT}/>
              <path d="M18 17l-5 7m5-7l5 7m-5-7v8" stroke={TEXT} strokeWidth="1.4" strokeLinecap="round"/>
              <path d="M9 13l4 4M27 13l-4 4M11 26l4-2M25 26l-4-2" stroke={TEXT} strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: TEXT, lineHeight: 1.35, letterSpacing: -0.2, maxWidth: 280 }}>
            {bodyMsg}
          </div>
          <button
            onClick={() => navigate('/auth', { state })}
            style={{
              padding: '4px 6px', marginTop: -4,
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 17, fontWeight: 700,
              color: ORANGE, letterSpacing: -0.1, lineHeight: 1.3,
              WebkitTapHighlightColor: 'transparent', outline: 'none',
            }}>
            Suscríbete o ingresa a tu cuenta
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AuthScreen ────────────────────────────────────────────────────────────

const GOOGLE_ICON = (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.94v2.33A9 9 0 0 0 9 18z"/>
    <path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.94A9 9 0 0 0 0 9c0 1.45.35 2.83.94 4.05l3.03-2.33z"/>
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0a9 9 0 0 0-8.06 4.95l3.03 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
  </svg>
);

const FACEBOOK_ICON = (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#fff" d="M18 9a9 9 0 1 0-10.4 8.9v-6.3H5.3V9h2.3V7c0-2.3 1.4-3.6 3.5-3.6 1 0 2 .2 2 .2v2.3h-1.2c-1.2 0-1.5.7-1.5 1.5V9h2.6l-.4 2.6h-2.2v6.3A9 9 0 0 0 18 9z"/>
  </svg>
);

export default function AuthScreen() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const { user, login } = useAuth();
  const game = state?.game;

  // 'signup' | 'login'
  const [step, setStep]             = useState(() => {
    try {
      if (sessionStorage.getItem('auth_prefer_login') === '1') {
        sessionStorage.removeItem('auth_prefer_login');
        return 'login';
      }
    } catch {}
    return 'signup';
  });
  const [email, setEmail]           = useState('');
  const [pass, setPass]             = useState('');
  const [name, setName]             = useState('');
  const [accept, setAccept]         = useState(false);
  const [socialLoading, setSocialLoading] = useState(null);
  const [socialError, setSocialError]     = useState('');
  const [legalModal, setLegalModal]       = useState(null);
  const [authError,   setAuthError]       = useState('');
  const [authLoading, setAuthLoading]     = useState(false);

  // forgot-password flow: null | 'options' | 'code' | 'newpass'
  const [forgotStep,   setForgotStep]   = useState(null);
  const [forgotMethod, setForgotMethod] = useState(null); // 'email' | 'phone'
  const [verifyCode,   setVerifyCode]   = useState('');
  const [verifyError,  setVerifyError]  = useState('');
  const [timeLeft,     setTimeLeft]     = useState(300);
  const [timerOn,      setTimerOn]      = useState(false);
  const [newPass,      setNewPass]      = useState('');

  useEffect(() => {
    if (!timerOn) return;
    if (timeLeft <= 0) { setTimerOn(false); return; }
    const id = setInterval(() => setTimeLeft(t => t - 1), 1000);
    return () => clearInterval(id);
  }, [timerOn, timeLeft]);

  const emailValid  = /\S+@\S+\.\S+/.test(email);
  const loginReady  = emailValid && pass.length >= 6;
  const signupReady = name.trim() && emailValid && pass.length >= 6 && accept;

  // Redirect guard
  if (user) {
    try {
      const existing = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
      if (!existing) {
        const userCode = generateUserCode(user.name);
        localStorage.setItem(PROFILE_KEY, JSON.stringify({ userCode, gender: 'Hombre', position: '' }));
      } else if (!existing.userCode) {
        existing.userCode = generateUserCode(user.name);
        localStorage.setItem(PROFILE_KEY, JSON.stringify(existing));
      }
    } catch {}
    if (game) return <Navigate to="/checkout" state={{ game, user }} replace />;
    if (state?.backPath) return <Navigate to={state.backPath} replace />;
    return <Navigate to="/profile" replace />;
  }

  async function socialLogin(provider) {
    haptic();
    if (!supabase) {
      setSocialError('Añade VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env para activar login social.');
      return;
    }
    setSocialLoading(provider);
    setSocialError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin + '/auth' },
    });
    if (error) { setSocialError(error.message); setSocialLoading(null); }
  }


  async function submit() {
    haptic();
    setAuthError('');

    if (!supabase) {
      if (step === 'login') {
        if (!loginReady) return;
        login({ name: getUserName(email) || email.split('@')[0], email, provider: 'email' });
      } else {
        if (!signupReady) return;
        registerUser(email, name.trim());
        login({ name: name.trim(), email, provider: 'email' });
      }
      return;
    }

    setAuthLoading(true);
    if (step === 'login') {
      if (!loginReady) { setAuthLoading(false); return; }
      const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
      setAuthLoading(false);
      if (error) { setAuthError('Revisa tu correo y contraseña e inténtalo nuevamente.'); return; }
      // onAuthStateChange fires → login() → redirect
    } else {
      if (!signupReady) { setAuthLoading(false); return; }
      const { data, error } = await supabase.auth.signUp({
        email,
        password: pass,
        options: { data: { full_name: name.trim() } },
      });
      setAuthLoading(false);
      if (error) {
        if (error.message?.toLowerCase().includes('already registered') || error.code === 'user_already_exists') {
          setStep('login');
          setAuthError('Ya tienes una cuenta. Ingresa tu contraseña.');
          return;
        }
        setAuthError(error.message);
        return;
      }
      registerUser(email, name.trim());
      if (!data.session) {
        setAuthError('Revisa tu correo para confirmar tu cuenta antes de ingresar.');
        return;
      }
      // onAuthStateChange fires → login() → redirect
    }
  }

  function sendCode(method) {
    setForgotMethod(method);
    setVerifyCode('');
    setVerifyError('');
    setTimeLeft(300);
    setTimerOn(true);
    setForgotStep('code');
  }
  function checkCode() {
    if (verifyCode === MOCK_CODE) { setTimerOn(false); setForgotStep('newpass'); }
    else setVerifyError('Código incorrecto. Inténtalo de nuevo.');
  }
  function saveNewPass() {
    if (newPass.length < 6) return;
    login({ name: getUserName(email) || email.split('@')[0], email, provider: 'email' });
  }

  const phone = getUserPhone();

  const subtitle = forgotStep === 'options' ? 'Selecciona cómo recibir tu código'
                 : forgotStep === 'code'    ? 'Ingresa el código de verificación'
                 : forgotStep === 'newpass' ? 'Crea tu nueva contraseña'
                 : step === 'login'         ? 'Ingresa a tu cuenta'
                 :                           'Crea tu cuenta para reservar';

  return (
    <div className="screen-shell" style={{ display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
      <div style={{ paddingTop: 'calc(env(safe-area-inset-top) + 14px)', paddingBottom: 4, paddingLeft: 16, paddingRight: 16, background: '#fff' }}>
        <div style={{ height: 36, display: 'flex', alignItems: 'center' }}>
          <button
            onClick={() => {
              if (forgotStep === 'options')  { setForgotStep(null); }
              else if (forgotStep === 'code')    { setTimerOn(false); setForgotStep('options'); }
              else if (forgotStep === 'newpass') { /* no back after verification */ }
              else { navigate(-1); }
            }}
            style={{ padding: '6px 4px 6px 0', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 600, color: TEXT, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            {(forgotStep && forgotStep !== 'newpass') ? '← Atrás' : 'Cancelar'}
          </button>
        </div>
      </div>

      <div className="no-sb" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ padding: '4px 16px 8px', textAlign: 'center' }}>
          <span style={{ fontSize: 32, fontWeight: 800, color: TEXT, letterSpacing: -1 }}>
            Al<span style={{ color: BLUE }}>Grass</span>
          </span>
          <div style={{ marginTop: 16, fontSize: 20, fontWeight: 700, color: TEXT, letterSpacing: -0.3 }}>Suscribirme o Ingresar</div>
          <div style={{ marginTop: 2, fontSize: 13, color: SUB, letterSpacing: -0.1 }}>{subtitle}</div>
        </div>

        {/* ── Social + form — ocultos durante forgot flow ── */}
        {!forgotStep && (<>
          <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SocialButton label="Continuar con Google" icon={GOOGLE_ICON} variant="light" loading={socialLoading === 'google'} onClick={() => socialLogin('google')} />
            <SocialButton label="Continuar con Facebook" icon={FACEBOOK_ICON} variant="facebook" loading={socialLoading === 'facebook'} onClick={() => socialLogin('facebook')} />
            {socialError && <div style={{ fontSize: 12.5, color: '#C0392B', paddingLeft: 2, lineHeight: 1.4 }}>{socialError}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 4px 0' }}>
              <div style={{ flex: 1, height: 1, background: HAIR }} />
              <span style={{ fontSize: 12, color: SUB, letterSpacing: 0.4, textTransform: 'uppercase' }}>o con email</span>
              <div style={{ flex: 1, height: 1, background: HAIR }} />
            </div>
          </div>

          <div style={{ padding: '6px 20px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {step === 'signup' && (
              <Field value={name} onChange={setName} placeholder="Nombre completo" autoComplete="name" />
            )}
            <Field value={email} onChange={v => { setEmail(v); setAuthError(''); }} placeholder="Correo electrónico" type="email" autoComplete="email" />
            <Field value={pass} onChange={v => { setPass(v); setAuthError(''); }} placeholder="Contraseña" type="password" autoComplete={step === 'login' ? 'current-password' : 'new-password'} />
            {pass.length > 0 && pass.length < 6 && (
              <div style={{ fontSize: 12, color: SUB, marginTop: -4, paddingLeft: 4 }}>Mínimo 6 caracteres</div>
            )}
            {step === 'signup' && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '4px 4px 2px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                <Checkbox checked={accept} onChange={() => setAccept(v => !v)} />
                <span style={{ flex: 1, fontSize: 13, color: TEXT, lineHeight: 1.45 }}>
                  Declaro que soy mayor de <span style={{ color: ORANGE, fontWeight: 600 }}>18 años</span> y acepto los{' '}
                  <button onClick={e => { e.preventDefault(); e.stopPropagation(); setLegalModal('terms'); }} style={{ padding: 0, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 600, color: ORANGE, WebkitTapHighlightColor: 'transparent', outline: 'none', lineHeight: 'inherit' }}>términos de servicio</button>{' '}y{' '}
                  <button onClick={e => { e.preventDefault(); e.stopPropagation(); setLegalModal('privacy'); }} style={{ padding: 0, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 600, color: ORANGE, WebkitTapHighlightColor: 'transparent', outline: 'none', lineHeight: 'inherit' }}>privacidad</button>.
                </span>
              </label>
            )}
            {step === 'login' && (
              <button onClick={() => setForgotStep('options')} style={{ alignSelf: 'flex-end', marginTop: -2, padding: '4px 2px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, color: BLUE, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                ¿Olvidaste tu contraseña?
              </button>
            )}
          </div>

          <div style={{ padding: '10px 20px 16px' }}>
            {authError && (
              <div style={{ fontSize: 13, color: '#C0392B', marginBottom: 10, paddingLeft: 4, lineHeight: 1.4 }}>{authError}</div>
            )}
            <OrangeButton onPress={submit} disabled={(step === 'login' ? !loginReady : !signupReady) || authLoading}>
              {authLoading ? 'Cargando…' : step === 'login' ? 'Ingresar' : 'Crear cuenta'}
            </OrangeButton>
            <div style={{ marginTop: 16, textAlign: 'center', fontSize: 16 }}>
              <button
                onClick={() => { setStep(step === 'signup' ? 'login' : 'signup'); setAuthError(''); setPass(''); }}
                style={{ padding: 0, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', color: SUB, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                {step === 'signup' ? '¿Ya tienes cuenta? ' : '¿No tienes cuenta? '}
                <span style={{ color: '#D4750A', fontWeight: 700, fontSize: 18, textDecoration: 'underline', textUnderlineOffset: '3px' }}>
                  {step === 'signup' ? 'Inicia sesión' : 'Crear cuenta'}
                </span>
              </button>
            </div>
          </div>
        </>)}

        {/* ── Forgot password flow ── */}
        {forgotStep === 'options' && (
          <div style={{ padding: '8px 20px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* opción email — siempre */}
            <button onClick={() => sendCode('email')} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 16, border: `1px solid ${HAIR}`, background: '#fff', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="2" y="4" width="20" height="16" rx="3" stroke={TEXT} strokeWidth="1.7"/><path d="M2 8l10 7 10-7" stroke={TEXT} strokeWidth="1.7" strokeLinecap="round"/></svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>Correo electrónico</div>
                <div style={{ fontSize: 12.5, color: SUB, marginTop: 2 }}>{maskEmail(email)}</div>
              </div>
              <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M1 1l6 6-6 6" stroke={SUB} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>

            {/* opción celular — solo si tiene teléfono */}
            {phone && (
              <button onClick={() => sendCode('phone')} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 16, border: `1px solid ${HAIR}`, background: '#fff', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="18" height="22" viewBox="0 0 18 22" fill="none"><rect x="2" y="1" width="14" height="20" rx="3" stroke={TEXT} strokeWidth="1.7"/><circle cx="9" cy="18" r="1" fill={TEXT}/></svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>Número de celular</div>
                  <div style={{ fontSize: 12.5, color: SUB, marginTop: 2 }}>{maskPhone(phone)}</div>
                </div>
                <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M1 1l6 6-6 6" stroke={SUB} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            )}
          </div>
        )}

        {forgotStep === 'code' && (
          <div style={{ padding: '8px 20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13.5, color: SUB, lineHeight: 1.5 }}>
              Código enviado a{' '}
              <span style={{ color: TEXT, fontWeight: 600 }}>
                {forgotMethod === 'phone' ? maskPhone(phone) : maskEmail(email)}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Field value={verifyCode} onChange={v => { setVerifyCode(v); setVerifyError(''); }} placeholder="Código de 6 dígitos" autoComplete="one-time-code" />
              <div style={{ flexShrink: 0, minWidth: 52, textAlign: 'right', fontSize: 15, fontWeight: 700, color: timeLeft > 0 ? BLUE : '#C0392B' }}>
                {timeLeft > 0 ? fmtTime(timeLeft) : 'Expirado'}
              </div>
            </div>

            {verifyError && (
              <div style={{ fontSize: 12.5, color: '#C0392B', paddingLeft: 2 }}>{verifyError}</div>
            )}

            {timeLeft === 0 && (
              <button onClick={() => sendCode(forgotMethod)} style={{ alignSelf: 'flex-start', padding: '4px 2px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, color: BLUE, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                Reenviar código
              </button>
            )}

            <OrangeButton onPress={checkCode} disabled={verifyCode.length < 6 || timeLeft === 0}>
              Verificar
            </OrangeButton>
          </div>
        )}

        {forgotStep === 'newpass' && (
          <div style={{ padding: '8px 20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 14, background: '#F0FFF4', border: '1px solid #A8E6BF' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#2E7D32" strokeWidth="1.7"/><path d="M7 12l4 4 6-7" stroke="#2E7D32" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span style={{ fontSize: 13.5, color: '#2E7D32', fontWeight: 500 }}>Identidad verificada correctamente</span>
            </div>

            <Field value={newPass} onChange={setNewPass} placeholder="Nueva contraseña" type="password" autoComplete="new-password" />
            {newPass.length > 0 && newPass.length < 6 && (
              <div style={{ fontSize: 12, color: SUB, marginTop: -8, paddingLeft: 4 }}>Mínimo 6 caracteres</div>
            )}

            <OrangeButton onPress={saveNewPass} disabled={newPass.length < 6}>
              Guardar contraseña
            </OrangeButton>
          </div>
        )}
      </div>

      <LegalModal type={legalModal} onClose={() => setLegalModal(null)} />
    </div>
  );
}
