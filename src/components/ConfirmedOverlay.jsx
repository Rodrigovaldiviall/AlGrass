import { useState, useEffect } from 'react';
import { TEXT, SUB, ORANGE } from '../constants';

export default function ConfirmedOverlay({ game, onOK }) {
  const [open, setOpen] = useState(false);
  const fmt = n => `S/. ${Number(n || 0).toFixed(2)}`;

  useEffect(() => { const t = setTimeout(() => setOpen(true), 30); return () => clearTimeout(t); }, []);

  function handleOK() { setOpen(false); setTimeout(onOK, 240); }

  return (
    <div className="sheet-overlay" style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)',
      transition: 'background .22s ease',
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
    }}>
      <div className="sheet-panel" style={{
        background: '#fff',
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        padding: '28px 24px calc(32px + env(safe-area-inset-bottom))',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
        boxShadow: '0 -8px 32px rgba(0,0,0,0.12)',
        transform: open ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform .28s cubic-bezier(0.32,0.72,0,1)',
      }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#E8F7EE', border: '2px solid #BFE6CC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="32" height="32" viewBox="0 0 36 36" fill="none">
            <path d="M8 18l7 7 13-13" stroke="#2BA15A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: TEXT, letterSpacing: -0.4 }}>¡Reserva confirmada!</div>
          {game?.field && (
            <div style={{ fontSize: 15, color: SUB, marginTop: 6 }}>
              {game.field}{game.date ? ` · ${game.date}` : ''}
            </div>
          )}
          {game?.amount != null && (
            <div style={{ fontSize: 15, color: SUB, marginTop: 2 }}>{fmt(game.amount)}</div>
          )}
        </div>
        <button onClick={handleOK} style={{
          height: 54, width: '100%', borderRadius: 18, background: ORANGE, color: '#1B1B1F',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 16, fontWeight: 700,
          boxShadow: '0 6px 18px rgba(245,165,36,0.40)',
          WebkitTapHighlightColor: 'transparent', outline: 'none',
        }}>
          OK
        </button>
      </div>
    </div>
  );
}
