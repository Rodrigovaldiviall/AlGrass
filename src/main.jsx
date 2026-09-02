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
  if (window.location.pathname === '/email-changed') {
    const raw = (window.location.hash || window.location.search || '').replace(/^[#?]/, '');
    const p = new URLSearchParams(raw);
    const verdict = (p.get('error') || p.get('error_description'))
      ? 'error'
      : (p.get('type') === 'email_change' || p.get('access_token')) ? 'success' : 'invalid';
    sessionStorage.setItem('email_change_callback', verdict);
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
