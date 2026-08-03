import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { BLUE, TEXT, SUB, GREEN } from '../constants';

// ── Cierre del flujo de cambio de correo ────────────────────────────────────
// Se llega SOLO desde el enlace de confirmación de Supabase (emailRedirectTo → /email-changed).
// Aquí —y solo aquí— se cierra el proceso: se sincroniza public.users con el correo YA confirmado
// por Supabase. Abrir la app por rutas normales nunca monta esta pantalla, así que no hay sync oculta.
export default function EmailChanged() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return; // idempotente ante StrictMode / re-render
    ranRef.current = true;
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      // detectSessionInUrl (default) ya procesó el hash del enlace al iniciar el cliente.
      // getUser() consulta al servidor el email autoritativo ya confirmado por Supabase.
      const { data: { user }, error } = await supabase.auth.getUser();
      if (cancelled || error || !user?.id || !user.email) return;
      // Sincronización dentro del propio flujo: public.users.email = correo confirmado, y
      // confirmed_email = ese mismo correo (⇒ confirmed_email == email → desaparece el aviso).
      // Self-update: reutiliza la RLS existente (id = auth.uid()). Idempotente.
      const email = user.email;
      const { error: upErr } = await supabase
        .from('users')
        .update({ email, confirmed_email: email })
        .eq('id', user.id);
      if (upErr) console.warn('[EmailChanged] sync public.users.email:', upErr.message);
    })();
    return () => { cancelled = true; };
  }, []);

  // Destino decidido en el click (robusto ante carreras con detectSessionInUrl):
  // sesión válida → Perfil; sin sesión → Login (y tras iniciar sesión, Perfil).
  const onContinue = async () => {
    if (busy) return;
    setBusy(true);
    let hasSession = false;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      hasSession = !!session?.user;
    } catch {}
    navigate(hasSession ? '/profile' : '/auth', { replace: true });
  };

  return (
    <div className="screen-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', padding: '24px 20px' }}>
      <div style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#EAF8EF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="11" fill={GREEN} />
            <path d="M7 12.5l3.2 3.2L17 8.8" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div style={{ marginTop: 22, fontSize: 20, fontWeight: 700, color: TEXT, letterSpacing: -0.3 }}>Correo electrónico actualizado</div>
        <div style={{ marginTop: 8, fontSize: 14.5, color: SUB, lineHeight: 1.5 }}>Tu dirección de correo se ha actualizado correctamente.</div>
        <button
          onClick={onContinue}
          disabled={busy}
          style={{ marginTop: 28, width: '100%', padding: '14px 16px', fontSize: 16, fontWeight: 700, fontFamily: 'inherit', color: '#fff', background: BLUE, border: 'none', borderRadius: 14, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
          Continuar
        </button>
      </div>
    </div>
  );
}
