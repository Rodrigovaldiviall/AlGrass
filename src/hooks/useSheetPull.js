import { useRef, useState, useCallback } from 'react';

// Pull-to-close continuo (tipo Airbnb / Apple Maps) para bottom sheets.
// - rootRef es un CALLBACK REF: React lo llama con el nodo real al montar el panel (y null al desmontar),
//   así los listeners se adjuntan SIEMPRE que el panel exista, sin depender de effects/deps/re-renders.
// - scrollRef → body scrolleable. El componente renderiza translateY(dragY) y desactiva la transición con dragging.
// - Handoff: scrollTop>0 → scroll nativo; en scrollTop<=0 y tirando hacia abajo, el panel sigue el dedo 1:1.
// - Al soltar: dy>threshold → onClose; si no → vuelve a 0.
export function useSheetPull({ onClose, threshold = 100 }) {
  const scrollRef = useRef(null);
  const nodeRef   = useRef(null);
  const st = useRef({ active: false, startY: 0, dy: 0 });
  const [dragY, setDragY]       = useState(0);
  const [dragging, setDragging] = useState(false);

  // Últimos onClose/threshold accesibles desde handlers estables.
  const cb = useRef({ onClose, threshold });
  cb.current = { onClose, threshold };

  // Handlers creados una sola vez → identidad estable para add/removeEventListener.
  const h = useRef(null);
  if (!h.current) {
    const onStart = (e) => {
      const t = e.touches[0];
      st.current = { active: false, startY: t.clientY, dy: 0 };
    };
    const onMove = (e) => {
      const t  = e.touches[0];
      const s  = st.current;
      const sc = scrollRef.current;
      const dyRaw = t.clientY - s.startY;
      if (!s.active) {
        // Solo se activa al tirar hacia abajo estando arriba del todo del contenido.
        if (dyRaw > 0 && (!sc || sc.scrollTop <= 0)) {
          s.active = true; s.startY = t.clientY; s.dy = 0; // rebaselinar → sin salto
          setDragging(true);
        } else {
          return; // scroll nativo
        }
      }
      const dy = t.clientY - s.startY;
      if (dy < 0) {                 // se pasó POR ENCIMA del origen sin soltar → devolver el control al scroll
        s.active = false; s.dy = 0;
        setDragging(false); setDragY(0);
        return;
      }
      // dy >= 0 (incluye el frame de activación dy===0): seguir el dedo y bloquear scroll nativo.
      s.dy = dy;
      e.preventDefault();
      setDragY(dy);                 // seguimiento 1:1
    };
    const onEnd = () => {
      const s = st.current;
      if (!s.active) return;
      s.active = false;
      setDragging(false);
      if (s.dy > cb.current.threshold) { cb.current.onClose(); setDragY(0); } // cerrar (continuidad dragY→100%) + reset
      else setDragY(0);                                                       // volver a abierta
      s.dy = 0;
    };
    h.current = { onStart, onMove, onEnd };
  }

  // Callback ref: adjunta/limpia listeners exactamente cuando el panel aparece/desaparece.
  const rootRef = useCallback((node) => {
    const prev = nodeRef.current;
    if (prev) {
      prev.removeEventListener('touchstart',  h.current.onStart);
      prev.removeEventListener('touchmove',   h.current.onMove);
      prev.removeEventListener('touchend',    h.current.onEnd);
      prev.removeEventListener('touchcancel', h.current.onEnd);
    }
    nodeRef.current = node;
    if (node) {
      node.addEventListener('touchstart',  h.current.onStart, { passive: true });
      node.addEventListener('touchmove',   h.current.onMove,  { passive: false });
      node.addEventListener('touchend',    h.current.onEnd,   { passive: true });
      node.addEventListener('touchcancel', h.current.onEnd,   { passive: true });
    }
  }, []);

  return { rootRef, scrollRef, dragY, dragging };
}
