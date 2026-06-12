import { useState, useEffect } from 'react';

// Devuelve un contador que se incrementa cada vez que la app vuelve a primer
// plano (evento global 'app-foreground' emitido en App.jsx). Añádelo a las deps
// de un efecto de carga para re-ejecutar ese fetch en sitio (cache-first, sin
// remount, sin skeleton). No invalida cachés: solo re-dispara la carga normal.
export function useForegroundTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onForeground = () => setTick((t) => t + 1);
    window.addEventListener('app-foreground', onForeground);
    return () => window.removeEventListener('app-foreground', onForeground);
  }, []);
  return tick;
}
