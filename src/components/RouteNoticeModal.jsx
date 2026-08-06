import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BLUE, TEXT, SUB } from '../constants';

// Modal informativo pasado por navegación en location.state.gameNotice ({ title, message }).
// Se consume UNA vez y limpia el state de la ruta → no reaparece al navegar ni al refrescar.
// Lo usan las pantallas "home" (PickupGames /games, Fields /fields) tras redirigir desde un
// detalle que ya no debe abrirse (partido/cancha cancelado, expirado o finalizado).
export default function RouteNoticeModal() {
  const navigate = useNavigate();
  const location = useLocation();
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (location.state?.gameNotice) {
      setNotice(location.state.gameNotice);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state?.gameNotice]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!notice) return null;
  return (
    <div onClick={() => setNotice(null)} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 18, width: '100%', maxWidth: 320, padding: '20px 20px 16px', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ fontSize: 16.5, fontWeight: 700, color: TEXT, textAlign: 'center', letterSpacing: -0.2 }}>{notice.title}</div>
        <div style={{ fontSize: 13.5, color: SUB, textAlign: 'center', marginTop: 6, lineHeight: 1.45 }}>{notice.message}</div>
        <button onClick={() => setNotice(null)} style={{ marginTop: 18, width: '100%', height: 44, borderRadius: 12, border: 'none', background: BLUE, color: '#fff', fontSize: 14.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent', outline: 'none' }}>Cerrar</button>
      </div>
    </div>
  );
}
