import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHeadset } from '@fortawesome/free-solid-svg-icons';
import { BLUE, GREEN, TEXT, SUB } from '../constants';
import { SupportMenu } from '../components/SupportMenu';

// Pantalla de mantenimiento full-screen. Sin Sidebar, BottomNav, login ni navegación
// de la App. Único acceso permitido: SOPORTE, reutilizando EXACTAMENTE el mismo
// SupportMenu de Perfil (misma fuente de contacto y misma acción de WhatsApp).
// Cubre desktop / mobile / PWA (fixed inset 0 + safe-area).
export default function MaintenanceScreen({ message = '' }) {
  const [supportOpen, setSupportOpen] = useState(false);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100001, background: '#fff',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 'calc(24px + env(safe-area-inset-top)) 24px calc(24px + env(safe-area-inset-bottom))',
      textAlign: 'center',
    }}>
      {/* Soporte — mismo trigger (headset) + SupportMenu que Perfil. No es navegación de App. */}
      <div style={{ position: 'absolute', top: 'calc(12px + env(safe-area-inset-top))', right: 16 }}>
        <div style={{ position: 'relative' }}>
          <button onClick={() => setSupportOpen(v => !v)} aria-label="Soporte" style={{
            width: 36, height: 36, background: 'transparent', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            WebkitTapHighlightColor: 'transparent', outline: 'none', padding: 0,
          }}>
            <FontAwesomeIcon icon={faHeadset} style={{ fontSize: 20, color: TEXT }} />
          </button>
          {supportOpen && <SupportMenu onClose={() => setSupportOpen(false)} />}
        </div>
      </div>

      <div style={{ width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1 }}>
          <span style={{ color: BLUE }}>Al</span><span style={{ color: GREEN }}>Grass</span>
        </div>

        <div style={{ marginTop: 32, fontSize: 21, fontWeight: 700, color: TEXT, letterSpacing: -0.3 }}>
          Estamos haciendo unos ajustes
        </div>

        {message && (
          <div style={{ marginTop: 14, fontSize: 15, color: SUB, lineHeight: 1.5, whiteSpace: 'pre-line' }}>
            {message}
          </div>
        )}

        <div style={{ marginTop: 20, fontSize: 14.5, color: SUB, lineHeight: 1.55 }}>
          Tus partidos siguen según lo programado.
          <br />
          El mantenimiento de la aplicación no cancela ni modifica tus reservas.
        </div>

        <div style={{ marginTop: 18, fontSize: 15, color: SUB, letterSpacing: -0.1 }}>
          Volveremos en breve.
        </div>
      </div>
    </div>
  );
}
