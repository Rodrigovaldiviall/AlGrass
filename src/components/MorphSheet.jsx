import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useSheetPull } from '../hooks/useSheetPull';
import { useReducedMotion } from '../hooks/useReducedMotion';

// Bottom sheet que MORFEA su altura entre vistas internas (menú → detalle → cancelar), con drag-to-dismiss
// (useSheetPull), backdrop con fade y handle. Extraído del inline de GameDetail (mismo comportamiento) para
// reutilizarlo en ChampionshipView. `children` puede ser nodo o función (scrollRef) => nodo; `view` controla el
// fade/altura; `busy` bloquea cierre (backdrop/drag) durante operaciones en curso. Depende de los keyframes
// globales `gdFade` y `.gd-morph-content` (src/index.css).
export default function MorphSheet({ view, busy = false, onClose, children }) {
  const [open, setOpen]  = useState(false);
  const contentRef       = useRef(null);
  const [h, setH]        = useState(null);   // altura objetivo (px); null = auto (1er frame)
  const reduced          = useReducedMotion();
  const dismiss = () => { if (busy) return; setOpen(false); setTimeout(onClose, 220); };
  const { rootRef, scrollRef, dragY, dragging } = useSheetPull({ onClose: dismiss });
  useEffect(() => { const t = setTimeout(() => setOpen(true), 20); return () => clearTimeout(t); }, []);
  // Mide la altura natural del contenido (handle + vista activa) y la mantiene sincronizada ante cualquier
  // cambio (cambio de vista, paso de cancelación, lista larga).
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setH(el.scrollHeight);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [view]);
  const heightTr = reduced ? '' : 'height .30s cubic-bezier(0.32,0.72,0,1)';
  const slideTr  = 'transform .28s cubic-bezier(0.32,0.72,0,1)';
  return (
    <div onClick={dismiss} style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: open ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0)', transition: 'background .22s ease', pointerEvents: open ? 'auto' : 'none' }}>
      <div ref={rootRef} onClick={e => e.stopPropagation()} style={{ background: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, width: '100%', boxShadow: '0 -8px 32px rgba(0,0,0,0.12)', overflow: 'hidden', transform: open ? `translateY(${dragY}px)` : 'translateY(100%)', height: h != null ? h : 'auto', transition: dragging ? 'none' : [slideTr, heightTr].filter(Boolean).join(', ') }}>
        <div ref={contentRef}>
          <div style={{ width: 42, height: 4, borderRadius: 2, background: '#D1D1D6', margin: '10px auto 6px' }} />
          <div key={view} className="gd-morph-content" style={{ animation: reduced ? 'none' : 'gdFade .2s ease' }}>
            {typeof children === 'function' ? children(scrollRef) : children}
          </div>
        </div>
      </div>
    </div>
  );
}
