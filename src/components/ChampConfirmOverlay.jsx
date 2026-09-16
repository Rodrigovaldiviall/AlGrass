import { useState, useEffect } from 'react';
import { TEXT, SUB, ORANGE, GREEN } from '../constants';

// Overlay CENTRADO de confirmación para Campeonatos (publicar / pago / solicitud). Aparece SOBRE
// la pantalla destino (Profile o ChampionshipView), no sobre la pantalla donde se ejecutó la acción.
// Mismo lenguaje visual que las confirmaciones existentes: check verde + título + copy + CTA.
export default function ChampConfirmOverlay({ title, subtitle = '', lines = [], onContinue }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOpen(true), 30); return () => clearTimeout(t); }, []);
  function handle() { setOpen(false); setTimeout(onContinue, 220); }
  return (
    <div className="sheet-overlay" style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)', transition: 'background .2s ease',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px',
      pointerEvents: open ? 'auto' : 'none',
    }}>
      <div className="sheet-panel" style={{
        width: '100%', maxWidth: 360, background: '#fff', borderRadius: 24,
        padding: '28px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
        boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
        transform: open ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.98)', opacity: open ? 1 : 0,
        transition: 'transform .24s cubic-bezier(0.32,0.72,0,1), opacity .24s ease',
      }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#D7F0DD', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke={GREEN} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: TEXT, letterSpacing: -0.4 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginTop: 2 }}>{subtitle}</div>}
        {lines.map((l, i) => <div key={i} style={{ fontSize: 14.5, color: SUB, lineHeight: 1.5, marginTop: 10 }}>{l}</div>)}
        <button onClick={handle} className="pressable" style={{ marginTop: 26, width: '100%', height: 52, borderRadius: 16, background: ORANGE, color: '#1B1B1F', border: 'none', cursor: 'pointer', fontSize: 16, fontWeight: 800, fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Continuar</button>
      </div>
    </div>
  );
}
