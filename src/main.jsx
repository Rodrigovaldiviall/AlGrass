import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Habilita el estado :active (feedback de pulsación .pressable) en iOS Safari,
// que de otro modo no lo aplica a elementos sin listener táctil propio.
document.addEventListener('touchstart', () => {}, { passive: true });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
