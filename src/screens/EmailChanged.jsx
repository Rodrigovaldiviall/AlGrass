import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BLUE, TEXT, SUB, GREEN, DANGER } from '../constants';

// ── Pantalla de RESULTADO del cambio de correo ───────────────────────────────
// SOLO UI. No confirma el cambio, no llama a Auth ni escribe en public.users:
// eso ya ocurrió en Supabase al pulsar el enlace, y la reconciliación
// auth.users → public.users la hace AuthContext (reconcileEmailFromAuth vía
// INITIAL_SESSION), TOTALMENTE independiente de esta pantalla y de "Continuar".
//
// El veredicto real (éxito/error) se captura en main.jsx ANTES de que el cliente
// Supabase (detectSessionInUrl) consuma y limpie el hash del callback, y queda en
// sessionStorage. Aquí solo se lee y se consume (un solo uso): así una visita
// manual a /email-changed —o un refresco cuando el hash ya se consumió— nunca
// muestra un falso éxito. La pantalla es neutral: no muestra nombre ni correos ni
// la sesión abierta; "Continuar" solo entra al estado normal de AlGrass.
const CALLBACK_KEY = 'email_change_callback';

export default function EmailChanged() {
  const navigate = useNavigate();
  const [ok, setOk] = useState(null); // null = procesando · true = éxito · false = error
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return; // idempotente ante StrictMode / re-render
    ranRef.current = true;
    let verdict = null;
    try {
      verdict = sessionStorage.getItem(CALLBACK_KEY);
      sessionStorage.removeItem(CALLBACK_KEY); // consumir: un solo uso
    } catch { /* sessionStorage no disponible */ }
    setOk(verdict === 'success');
  }, []);

  // "Continuar" NO confirma, NO login/logout, NO escribe nada. Solo termina la
  // pantalla y entra al estado normal: /profile ya resuelve ambos casos (con
  // sesión → Perfil de esa sesión; sin sesión → "Suscríbete o ingresa").
  const onContinue = () => navigate('/profile', { replace: true });
  const onErrorExit = () => navigate('/games', { replace: true });

  return (
    <div className="screen-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', padding: '24px 20px' }}>
      <div style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>

        {ok === null && (
          <>
            <div style={{ width: 44, height: 44, borderRadius: '50%', border: '4px solid #EAEAEE', borderTop: `4px solid ${BLUE}`, animation: 'spin 0.9s linear infinite' }} />
            <div style={{ marginTop: 20, fontSize: 15, fontWeight: 600, color: SUB }}>Confirmando tu correo…</div>
          </>
        )}

        {ok === true && (
          <>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#EAF8EF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="11" fill={GREEN} />
                <path d="M7 12.5l3.2 3.2L17 8.8" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div style={{ marginTop: 22, fontSize: 20, fontWeight: 700, color: TEXT, letterSpacing: -0.3 }}>Correo actualizado</div>
            <div style={{ marginTop: 8, fontSize: 14.5, color: SUB, lineHeight: 1.5 }}>Tu cambio de correo se confirmó correctamente.</div>
            <button
              onClick={onContinue}
              style={{ marginTop: 28, width: '100%', padding: '14px 16px', fontSize: 16, fontWeight: 700, fontFamily: 'inherit', color: '#fff', background: BLUE, border: 'none', borderRadius: 14, cursor: 'pointer', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
              Continuar
            </button>
          </>
        )}

        {ok === false && (
          <>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#FCEBEC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="38" height="38" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="11" stroke={DANGER} strokeWidth="2" />
                <path d="M12 7v6M12 16v.5" stroke={DANGER} strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </div>
            <div style={{ marginTop: 22, fontSize: 20, fontWeight: 700, color: TEXT, letterSpacing: -0.3 }}>No pudimos confirmar el cambio de correo</div>
            <div style={{ marginTop: 8, fontSize: 14.5, color: SUB, lineHeight: 1.5 }}>El enlace no es válido, expiró o ya fue utilizado. Vuelve a solicitar el cambio desde tu perfil.</div>
            <button
              onClick={onErrorExit}
              style={{ marginTop: 28, width: '100%', padding: '14px 16px', fontSize: 16, fontWeight: 700, fontFamily: 'inherit', color: '#fff', background: BLUE, border: 'none', borderRadius: 14, cursor: 'pointer', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
              Ir a AlGrass
            </button>
          </>
        )}
      </div>
    </div>
  );
}
