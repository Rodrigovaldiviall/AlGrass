import { useState, useEffect } from 'react';
import { resolveOrganizerPhone } from '../services/organizerContact';

// Devuelve el teléfono (dígitos) resuelto del organizador para un game, o null.
// null = cargando / error de config / RPC fallida / host sin teléfono → CTA deshabilitado
// (nunca el placeholder). Se re-resuelve al cambiar de game (así un cambio en Admin se
// refleja al reabrir la pantalla, sin deploy).
export function useOrganizerPhone(game) {
  const [phone, setPhone] = useState(null);
  useEffect(() => {
    let alive = true;
    setPhone(null);   // mientras resuelve → null → CTA deshabilitado (sin placeholder)
    resolveOrganizerPhone(game).then((p) => { if (alive) setPhone(p); });
    return () => { alive = false; };
  }, [game?.id, game?.type]);
  return phone;
}
