import { useRef, useState, useCallback, useEffect } from 'react';

// BottomSheet con 3 snap points sobre un eje continuo (tipo Apple Maps / Airbnb).
// Geometría: la sheet mide height:100% y se mueve con translateY(offset px).
//   snapsFrac = [0, 0.6, 1]  →  100%=0 · 40%=0.6·H · 0%(cerrado)=H
// - rootRef: CALLBACK REF → adjunta listeners y mide H cuando el panel existe; slide-in al montar.
// - scrollRef: lista scrolleable. Handoff:
//     · gesto que nace en el header → arrastra siempre.
//     · gesto que nace en la lista → toma el gesto solo con scrollTop<=0 (abajo) o si no está en 100% (arriba).
// - Al soltar: snap al más cercano usando offset + proyección de velocidad (permite 100%→0 en un gesto).
export function useSheetSnap({ index, snapsFrac = [0, 0.6, 1], onSettle }) {
  const scrollRef = useRef(null);
  const nodeRef   = useRef(null);
  const hRef      = useRef(0);
  const offRef    = useRef(null);
  const [offset, setOffset]     = useState(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef({ active: false, startY: 0, base: 0, lastY: 0, vel: 0, inScroll: false });
  const cfg = useRef({ index, snapsFrac, onSettle });
  cfg.current = { index, snapsFrac, onSettle };

  const apply  = (px) => { offRef.current = px; setOffset(px); };
  const snapPx = (i) => {
    const f = cfg.current.snapsFrac;
    return f[Math.max(0, Math.min(f.length - 1, i))] * hRef.current;
  };
  const measure = () => {
    const node = nodeRef.current;
    if (node) hRef.current = node.clientHeight || node.getBoundingClientRect().height;
  };

  // Sincronizar a snap cuando el padre cambia el index y no estamos arrastrando.
  useEffect(() => {
    if (!dragging && hRef.current) apply(snapPx(index));
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handlers estables.
  const h = useRef(null);
  if (!h.current) {
    const onStart = (e) => {
      const t  = e.touches[0];
      const sc = scrollRef.current;
      drag.current = {
        active: false, startY: t.clientY, base: snapPx(cfg.current.index),
        lastY: t.clientY, vel: 0,
        inScroll: !!(sc && sc.contains(e.target)),
      };
    };
    const onMove = (e) => {
      const t = e.touches[0];
      const d = drag.current;
      const sc = scrollRef.current;
      const dyRaw = t.clientY - d.startY;
      if (!d.active) {
        let take;
        if (!d.inScroll) {
          take = Math.abs(dyRaw) > 2;                 // header/grabber → arrastra siempre
        } else {
          const atTop   = !sc || sc.scrollTop <= 0;
          const notFull = d.base > 1;                 // no está en 100%
          take = (dyRaw > 0 && atTop) || (dyRaw < 0 && notFull);
        }
        if (take) { d.active = true; d.startY = t.clientY; setDragging(true); }
        else return;                                  // scroll nativo
      }
      const H = hRef.current;
      const next = Math.max(0, Math.min(H, d.base + (t.clientY - d.startY)));
      d.vel = t.clientY - d.lastY; d.lastY = t.clientY;
      e.preventDefault();
      apply(next);                                    // seguimiento 1:1
    };
    const onEnd = () => {
      const d = drag.current;
      if (!d.active) return;
      d.active = false; setDragging(false);
      const H = hRef.current;
      const projected = Math.max(0, Math.min(H, offRef.current + d.vel * 8)); // sesgo por velocidad
      let best = 0, bestDist = Infinity;
      cfg.current.snapsFrac.forEach((f, i) => {
        const dist = Math.abs(f * H - projected);
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      apply(snapPx(best));
      cfg.current.onSettle(best);
    };
    h.current = { onStart, onMove, onEnd };
  }

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
      measure();
      offRef.current = hRef.current; setOffset(hRef.current);          // arranca cerrado
      requestAnimationFrame(() => { measure(); apply(snapPx(cfg.current.index)); }); // anima al snap (slide-in)
    }
  }, []);

  // Recalcular H en resize (orientación / teclado / safe-area).
  useEffect(() => {
    const onResize = () => { measure(); if (!drag.current.active) apply(snapPx(cfg.current.index)); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return { rootRef, scrollRef, offset, dragging };
}
