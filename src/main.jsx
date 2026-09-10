import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import PrivateAccessGate from './components/PrivateAccessGate.jsx'
import MaintenanceGate from './components/MaintenanceGate.jsx'

// Habilita el estado :active (feedback de pulsación .pressable) en iOS Safari,
// que de otro modo no lo aplica a elementos sin listener táctil propio.
document.addEventListener('touchstart', () => {}, { passive: true });

// Veredicto del callback de cambio de correo, capturado ANTES de que el cliente
// Supabase (detectSessionInUrl) consuma y limpie el hash de la URL en su init.
// Solo INSPECCIONA la URL (no toca Auth ni sesión) y deja el resultado en
// sessionStorage para que la pantalla /email-changed distinga éxito real de
// enlace inválido/expirado/usado y de una visita manual (sin falso éxito).
try {
  const _path = window.location.pathname;
  const _raw = (window.location.hash || window.location.search || '').replace(/^[#?]/, '');
  const _p = new URLSearchParams(_raw);
  // Discriminador EXCLUSIVO del callback de cambio de correo: type=email_change (NO afecta a
  // OAuth ni recovery, que no llevan ese type). El callback puede aterrizar en /email-changed
  // (si el redirect se honra) o en la raíz '/' (fallback al Site URL); en AMBOS casos debe
  // terminar en EmailChanged.jsx.
  if (_path === '/email-changed' || _p.get('type') === 'email_change') {
    const verdict = (_p.get('error') || _p.get('error_description'))
      ? 'error'
      : (_p.get('type') === 'email_change' || _p.get('access_token')) ? 'success' : 'invalid';
    sessionStorage.setItem('email_change_callback', verdict);
    // Si aterrizó fuera de /email-changed, encaminarlo ANTES de montar React (sin reload ni
    // timeout) para que RootRedirect nunca lo mande a /games. Se conserva query+hash para que
    // el cliente Supabase establezca la sesión exactamente igual que hoy.
    if (_path !== '/email-changed') {
      window.history.replaceState(null, '', '/email-changed' + window.location.search + window.location.hash);
    }
  }
} catch { /* URL/sessionStorage no disponible */ }

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MaintenanceGate>
      <PrivateAccessGate>
        <App />
      </PrivateAccessGate>
    </MaintenanceGate>
  </StrictMode>,
)
