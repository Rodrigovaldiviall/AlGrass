import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { BLUE, TEXT, SUB, ORANGE, GREEN } from '../constants';
import { PRIVATE_MODE, PRIVATE_ACCESS_KEY, hasPrivateAccess } from '../lib/privateAccess';

// ── Acceso privado TEMPORAL (hasta el lanzamiento) ──────────────────────────
// La config (PRIVATE_MODE, clave de desbloqueo) vive en ../lib/privateAccess y la
// comparte App para la homepage pública. Envuelve la app en main.jsx.
// El día del lanzamiento: cambiar PRIVATE_MODE a false y hacer deploy. No borrar nada.

export default function PrivateAccessGate({ children }) {
  // Desbloqueo persistido por origen (algrass.com y admin.algrass.com son independientes).
  const [unlocked, setUnlocked] = useState(hasPrivateAccess);
  const [password, setPassword] = useState('');
  const [error, setError]       = useState(false);
  const [loading, setLoading]   = useState(false);

  // Superficie pública mientras PRIVATE_MODE está activo: la homepage "/" (que
  // muestra el Intro público) y las páginas legales /privacy y /terms — para que
  // Google pueda revisarlas sin clave, incluso entrando directo por URL. El resto
  // de rutas sigue exigiendo clave. El gate vive fuera del router, así que se lee
  // la ruta desde window.location.
  const PUBLIC_PATHS = ['/', '/privacy', '/terms'];
  let pathname = '';
  try { pathname = window.location.pathname; } catch { /* no window */ }

  // Modo público, ya desbloqueado, o ruta legal pública → la app continúa
  // EXACTAMENTE igual que hoy.
  if (!PRIVATE_MODE || unlocked || PUBLIC_PATHS.includes(pathname)) return children;

  async function submit(e) {
    e?.preventDefault();
    if (loading || !password) return;
    setLoading(true);
    setError(false);
    const { data, error: rpcErr } = supabase
      ? await supabase.rpc('check_private_access', { p_password: password })
      : { data: false, error: new Error('no supabase') };
    setLoading(false);
    if (rpcErr || data !== true) { setError(true); return; }
    try { localStorage.setItem(PRIVATE_ACCESS_KEY, 'true'); } catch {}
    setUnlocked(true); // cierra la pantalla; App se monta desde su estado inicial normal
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px' }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div style={{ fontSize: 40, fontWeight: 800, color: TEXT, letterSpacing: -1.2, lineHeight: 1 }}>
          <span style={{ color: BLUE }}>Al</span><span style={{ color: GREEN }}>Grass</span>
        </div>
        <div style={{ marginTop: 12, fontSize: 15, color: SUB, letterSpacing: -0.1 }}>Despreocúpate y juega.</div>
        <div style={{ marginTop: 28, fontSize: 20, fontWeight: 700, color: TEXT, letterSpacing: -0.3 }}>Próximamente.</div>

        <input
          type="password"
          value={password}
          onChange={e => { setPassword(e.target.value); setError(false); }}
          placeholder="Contraseña"
          autoComplete="off"
          autoFocus
          style={{ marginTop: 28, width: '100%', boxSizing: 'border-box', padding: '14px 16px', fontSize: 16, fontFamily: 'inherit', color: TEXT, background: '#fff', border: `1px solid ${error ? '#C0392B' : '#E2E2E6'}`, borderRadius: 14, outline: 'none', WebkitTapHighlightColor: 'transparent' }}
        />
        {error && (
          <div style={{ alignSelf: 'flex-start', marginTop: 8, fontSize: 13, color: '#C0392B', paddingLeft: 2 }}>Contraseña incorrecta.</div>
        )}

        <button
          type="submit"
          disabled={loading || !password}
          style={{ marginTop: 16, width: '100%', padding: '14px 16px', fontSize: 16, fontWeight: 700, fontFamily: 'inherit', color: '#fff', background: ORANGE, border: 'none', borderRadius: 14, cursor: loading || !password ? 'default' : 'pointer', opacity: loading || !password ? 0.6 : 1, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
          {loading ? 'Verificando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
