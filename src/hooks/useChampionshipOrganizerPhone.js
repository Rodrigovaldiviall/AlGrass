import { useState, useEffect } from 'react';
import { resolveChampionshipOrganizerPhone } from '../services/organizerContact';

// Teléfono (dígitos) del organizador de un CHAMPIONSHIP, resuelto por RPC owner-gated, o null.
// Igual patrón que useOrganizerPhone (se re-resuelve al cambiar de campeonato; sin caché persistente).
// `enabled` evita el request cuando el actor NO es owner (el botón solo se muestra al owner). Con enabled
// false → phone null → CTA deshabilitado y CERO consultas para jugadores/otros.
export function useChampionshipOrganizerPhone(championshipId, enabled = true) {
  const [phone, setPhone] = useState(null);
  useEffect(() => {
    let alive = true;
    setPhone(null);
    if (!enabled || !championshipId) return;
    resolveChampionshipOrganizerPhone(championshipId).then((p) => { if (alive) setPhone(p); });
    return () => { alive = false; };
  }, [championshipId, enabled]);
  return phone;
}
