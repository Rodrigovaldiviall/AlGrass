// ── ConfirmExitDialog — confirmación de "salir del flujo" (bottom-sheet AlGrass) ──
// Reutiliza el MISMO patrón visual que ConfirmDeleteModal (Settings): scrim oscuro +
// panel blanco que sube desde abajo, esquinas superiores redondeadas, safe-area inferior.
// Solo navegación: NO borra datos, NO toca sessionStorage/draft, NO ejecuta RPC.
// Cancelar → onCancel (cierra, no navega). Salir → onConfirm (el padre navega).
import { useState, useEffect } from 'react';
import { TEXT, SUB, HAIR, DANGER } from '../constants';

export default function ConfirmExitDialog({
  title = '¿Salir del campeonato?',
  message = 'Perderás los cambios que no hayas guardado.',
  cancelLabel = 'Cancelar',
  confirmLabel = 'Salir',
  onCancel,
  onConfirm,
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOpen(true), 20); return () => clearTimeout(t); }, []);
  const cancel  = () => { setOpen(false); setTimeout(() => onCancel?.(),  220); };
  const confirm = () => { setOpen(false); setTimeout(() => onConfirm?.(), 220); };

  return (
    <div
      onClick={cancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)',
        transition: 'background .22s ease',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff',
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          padding: '24px 20px calc(20px + env(safe-area-inset-bottom))',
          display: 'flex', flexDirection: 'column', gap: 16,
          boxShadow: '0 -8px 32px rgba(0,0,0,0.12)',
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform .28s cubic-bezier(0.32,0.72,0,1)',
        }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: TEXT, letterSpacing: -0.3 }}>{title}</div>
          <div style={{ fontSize: 14, color: SUB, marginTop: 8, lineHeight: 1.5 }}>{message}</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={cancel}
            style={{
              flex: 1, height: 52, borderRadius: 16, border: `1.5px solid ${HAIR}`,
              background: '#fff', color: TEXT, fontFamily: 'inherit', fontSize: 16, fontWeight: 700,
              cursor: 'pointer', WebkitTapHighlightColor: 'transparent', outline: 'none',
            }}>
            {cancelLabel}
          </button>
          <button
            onClick={confirm}
            style={{
              flex: 1, height: 52, borderRadius: 16, border: 'none',
              background: DANGER, color: '#fff', fontFamily: 'inherit', fontSize: 16, fontWeight: 800,
              cursor: 'pointer', WebkitTapHighlightColor: 'transparent', outline: 'none',
            }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
