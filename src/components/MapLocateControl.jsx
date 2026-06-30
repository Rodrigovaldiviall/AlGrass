import { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import { drawUserLocation } from '../utils/userLocationMarker';

// Botón "📍 Mi ubicación" + toast + lógica de geolocalización. Extraído de MapView para
// reutilizar EXACTAMENTE el mismo comportamiento (permiso, marcador azul, mensaje).
// Se monta sobre un contenedor `position:relative`. `mapRef` es el ref del mapa Leaflet.
export default function MapLocateControl({ mapRef, venues = [], cityLabel = '' }) {
  const [geoMsg, setGeoMsg] = useState(null);
  const userDotRef = useRef(null);
  const userHaloRef = useRef(null);

  useEffect(() => {
    if (!geoMsg) return;
    const t = setTimeout(() => setGeoMsg(null), 2800);
    return () => clearTimeout(t);
  }, [geoMsg]);

  // 📍 Geolocalización nativa. Capa informativa: no toca ciudad/filtros/distritos/venue.
  function locateUser() {
    const map = mapRef.current;
    if (!map) return;
    if (!navigator.geolocation) { setGeoMsg('Tu navegador no soporta ubicación'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const ll = [latitude, longitude];
        // Punto azul + halo de precisión (crear o actualizar).
        if (!userDotRef.current) {
          const { halo, dot } = drawUserLocation(map, latitude, longitude, accuracy);
          userHaloRef.current = halo;
          userDotRef.current = dot;
        } else {
          userHaloRef.current.setLatLng(ll).setRadius(accuracy);
          userDotRef.current.setLatLng(ll);
        }
        // La ciudad es la referencia: solo recentrar si la ubicación cae dentro del área de la ciudad.
        // Con < 2 venues no hay área que delimitar → centrar siempre en el usuario.
        const pts = venues.filter(v => v.lat != null && v.lng != null).map(v => [v.lat, v.lng]);
        const inside = pts.length < 2 || L.latLngBounds(pts).pad(0.25).contains(L.latLng(latitude, longitude));
        if (inside) map.setView(ll, Math.max(map.getZoom(), 15));
        else setGeoMsg(`Tu ubicación está fuera de ${cityLabel}`);
      },
      (err) => {
        setGeoMsg(err.code === 1 ? 'Activa los permisos de ubicación' : 'No pudimos obtener tu ubicación');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  }

  return (
    <>
      <button onClick={locateUser} aria-label="Mi ubicación" style={{
        position: 'absolute', top: 12, right: 12, zIndex: 600,
        width: 40, height: 40, borderRadius: 999, border: 'none',
        background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.22)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', outline: 'none',
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="4" stroke="#1B1B1F" strokeWidth="2"/>
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="#1B1B1F" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </button>
      {geoMsg && (
        <div style={{
          position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 600,
          maxWidth: '78%', padding: '8px 14px', borderRadius: 999,
          background: 'rgba(27,27,31,0.92)', color: '#fff', fontSize: 12.5, fontWeight: 600,
          textAlign: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', pointerEvents: 'none',
        }}>{geoMsg}</div>
      )}
    </>
  );
}
