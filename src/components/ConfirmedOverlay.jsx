import { useState, useEffect } from 'react';
import { TEXT, SUB, ORANGE, HAIR, SOFT } from '../constants';
import { shareOrCopy } from '../utils/share';

export default function ConfirmedOverlay({ game, onOK, shareLink = '', reservedSlots = 0, releaseHours = 48 }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const fmt = n => `S/. ${Number(n || 0).toFixed(2)}`;

  useEffect(() => { const t = setTimeout(() => setOpen(true), 30); return () => clearTimeout(t); }, []);

  function handleOK() { setOpen(false); setTimeout(onOK, 240); }
  // Mismo patrón de compartir que ReserveSlotsSheet / "Gestionar mi reserva".
  function flashCopied() { setCopied(true); setTimeout(() => setCopied(false), 1500); }
  function copyLink() { navigator.clipboard?.writeText(shareLink).then(flashCopied).catch(() => {}); }
  function shareLinkAction() { shareOrCopy({ url: shareLink, title: 'AlGrass', onCopied: flashCopied }); }

  return (
    <div className="sheet-overlay" style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)',
      transition: 'background .22s ease',
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      pointerEvents: open ? 'auto' : 'none',
    }}>
      <div className="sheet-panel" style={{
        background: '#fff',
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        padding: '28px 24px calc(32px + env(safe-area-inset-bottom))',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
        boxShadow: '0 -8px 32px rgba(0,0,0,0.12)',
        transform: open ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform .28s cubic-bezier(0.32,0.72,0,1)',
        position: 'relative',
      }}>
        {shareLink && (
          <button onClick={shareLinkAction} aria-label="Compartir" style={{ position: 'absolute', top: 16, right: 16, width: 30, height: 30, borderRadius: '50%', background: SOFT, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M12 3v11M12 3L8 7M12 3l4 4" stroke={TEXT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M6 11v8a1 1 0 001 1h10a1 1 0 001-1v-8" stroke={TEXT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#E8F7EE', border: '2px solid #BFE6CC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="32" height="32" viewBox="0 0 36 36" fill="none">
            <path d="M8 18l7 7 13-13" stroke="#2BA15A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div style={{ textAlign: 'center' }}>
          {reservedSlots > 0 ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 800, color: TEXT, letterSpacing: -0.4 }}>Reserva y {reservedSlots} cupos confirmados</div>
              <div style={{ fontSize: 14, color: SUB, marginTop: 8, lineHeight: 1.5 }}>Estos cupos estarán reservados únicamente para tus invitados. Recuerda compartirles el enlace del partido.</div>
              <div style={{ fontSize: 13, color: SUB, marginTop: 10, lineHeight: 1.5 }}>Los cupos libres se liberarán automáticamente {releaseHours} horas antes del partido.</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 22, fontWeight: 800, color: TEXT, letterSpacing: -0.4 }}>¡Reserva confirmada!</div>
              {game?.field && (
                <div style={{ fontSize: 15, color: SUB, marginTop: 6 }}>
                  {game.field}{game.date ? ` · ${game.date}` : ''}
                </div>
              )}
              {game?.amount != null && (
                <div style={{ fontSize: 15, color: SUB, marginTop: 2 }}>{fmt(game.amount)}</div>
              )}
            </>
          )}
        </div>
        {shareLink && (
          <div onClick={copyLink} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: SOFT, border: `1px solid ${HAIR}`, borderRadius: 12, padding: '11px 14px', cursor: 'pointer', boxSizing: 'border-box' }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {shareLink}
            </span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
              <rect x="9" y="9" width="11" height="11" rx="2" stroke={SUB} strokeWidth="1.7"/>
              <path d="M6 15H5a2 2 0 01-2-2V5a2 2 0 012-2h8a2 2 0 012 2v1" stroke={SUB} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        )}
        <button onClick={handleOK} style={{
          height: 54, width: '100%', borderRadius: 18, background: ORANGE, color: '#1B1B1F',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 16, fontWeight: 700,
          boxShadow: '0 6px 18px rgba(245,165,36,0.40)',
          WebkitTapHighlightColor: 'transparent', outline: 'none',
        }}>
          OK
        </button>
      </div>
      {copied && (
        <div style={{ position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '8px 18px', borderRadius: 20, fontSize: 14, fontWeight: 500, zIndex: 9999, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          ¡Link copiado!
        </div>
      )}
    </div>
  );
}
