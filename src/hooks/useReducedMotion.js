import { useState, useEffect } from 'react';

// Respeta prefers-reduced-motion (idéntico al que usa GameDetail para MorphSheet). Extraído para compartir.
export function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setR(mq.matches);
    const on = e => setR(e.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return r;
}
