import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { BLUE, GREEN, TEXT, SUB, HAIR, ORANGE } from '../constants';

// Acceso interno SOLO para iniciar sesión (personal autorizado). No hay registro,
// recuperación de contraseña ni OTP. NO es un bypass: autenticarse aquí solo crea la
// sesión Supabase; la autorización real (getSession + user_roles) la decide MaintenanceGate.
// Reutiliza el sistema de auth existente (mismos métodos Supabase que AuthScreen), sin
// duplicar el componente ni montar router/AuthProvider extra.
const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
);

export default function MaintenanceAuthScreen() {
  const [email, setEmail]     = useState('');
  const [pass, setPass]       = useState('');
  const [loading, setLoading] = useState(false);
  const [gLoading, setGLoading] = useState(false);
  const [error, setError]     = useState('');

  const ready = !!email && !!pass && !loading && !gLoading;

  async function google() {
    if (!supabase || gLoading) return;
    setGLoading(true); setError('');
    // Mismo mecanismo que AuthScreen: persistir resume + redirectTo /auth. Tras el redirect,
    // el MaintenanceGate exterior re-evalúa sesión + roles en /auth y decide.
    try { sessionStorage.setItem('oauth_resume', JSON.stringify({})); } catch { /* no-op */ }
    const { error: e } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/auth' },
    });
    if (e) { try { sessionStorage.removeItem('oauth_resume'); } catch { /* no-op */ } setError('No se pudo iniciar sesión con Google.'); setGLoading(false); }
  }

  async function submit(e) {
    e?.preventDefault();
    if (!ready || !supabase) return;
    setLoading(true); setError('');
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pass });
    setLoading(false);
    if (err) { setError('Revisa tu correo y contraseña e inténtalo nuevamente.'); return; }
    // No navega: onAuthStateChange en MaintenanceGate re-evalúa sesión + roles y decide
    // (Admin/Staff → children; cualquier otro → MaintenanceScreen).
  }

  const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '14px 16px', fontSize: 16, fontFamily: 'inherit', color: TEXT, background: '#fff', border: `1px solid ${HAIR}`, borderRadius: 14, outline: 'none', WebkitTapHighlightColor: 'transparent' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100001, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'calc(24px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom))' }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -1, lineHeight: 1 }}>
          <span style={{ color: BLUE }}>Al</span><span style={{ color: GREEN }}>Grass</span>
        </div>
        <div style={{ marginTop: 20, fontSize: 17, fontWeight: 700, color: TEXT, letterSpacing: -0.2 }}>Acceso para personal autorizado</div>

        <button type="button" onClick={google} disabled={gLoading} style={{ marginTop: 24, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '13px 16px', fontSize: 15.5, fontWeight: 600, fontFamily: 'inherit', color: TEXT, background: '#fff', border: `1px solid ${HAIR}`, borderRadius: 14, cursor: gLoading ? 'default' : 'pointer', opacity: gLoading ? 0.6 : 1, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
          <GoogleG />
          {gLoading ? 'Conectando…' : 'Continuar con Google'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', margin: '18px 0 4px' }}>
          <div style={{ flex: 1, height: 1, background: HAIR }} />
          <span style={{ fontSize: 12.5, color: SUB }}>o</span>
          <div style={{ flex: 1, height: 1, background: HAIR }} />
        </div>

        <input type="email" inputMode="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setError(false); }} placeholder="Correo" style={{ ...inputStyle, marginTop: 12 }} />
        <input type="password" autoComplete="current-password" value={pass} onChange={e => { setPass(e.target.value); setError(false); }} placeholder="Contraseña" style={{ ...inputStyle, marginTop: 10 }} />

        {error && <div style={{ alignSelf: 'flex-start', marginTop: 8, fontSize: 13, color: '#C0392B', paddingLeft: 2 }}>{error}</div>}

        <button type="submit" disabled={!ready} style={{ marginTop: 16, width: '100%', padding: '14px 16px', fontSize: 16, fontWeight: 700, fontFamily: 'inherit', color: '#fff', background: ORANGE, border: 'none', borderRadius: 14, cursor: ready ? 'pointer' : 'default', opacity: ready ? 1 : 0.6, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
          {loading ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
}
