import { useState, useEffect } from 'react';
import { fetchAppTimings } from '../services/organizerContact';

// Lee { freeInvitesLeadMin, attendanceLeadMin } de app_settings (id=1). Cada uno es un
// número o null. null = cargando / error → la acción dependiente (invitar gratis / marcar
// asistencia) queda CERRADA: NO hay default operativo 60/15 en la App. Se re-lee al montar,
// así que un cambio en Admin se refleja al reabrir la pantalla.
export function useAppTimings() {
  const [timings, setTimings] = useState({ freeInvitesLeadMin: null, attendanceLeadMin: null });
  useEffect(() => {
    let alive = true;
    fetchAppTimings().then((t) => { if (alive && t) setTimings(t); });
    return () => { alive = false; };
  }, []);
  return timings;
}
