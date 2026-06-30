import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { SUB } from '../constants';
import MapLocateControl from './MapLocateControl';
import logo from '../assets/logo.webp';

// Mapa simple para el detalle del venue: SOLO marcador del venue + ubicación GPS del usuario.
// Sin otros venues, sin filtros, sin controles (+/-), sin selectores. Reutiliza Leaflet.
function venueIcon() {
  const html = `<div style="width:54px;height:54px;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.3));">
    <img src="${logo}" alt="" style="width:54px;height:54px;object-fit:contain;display:block;" /></div>`;
  return L.divIcon({ html, className: '', iconSize: [54, 54], iconAnchor: [27, 27] });
}

export default function VenueMiniMap({ lat, lng, cityLabel = '' }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    if (lat == null || lng == null) return;

    const map = L.map(containerRef.current, {
      zoomControl: false, attributionControl: false,
    }).setView([lat, lng], 15);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);

    L.marker([lat, lng], { icon: venueIcon() }).addTo(map);
    mapRef.current = map;

    return () => { map.remove(); mapRef.current = null; };
  }, [lat, lng]);

  if (lat == null || lng == null) {
    return (
      <div style={{ width: '100%', height: 200, borderRadius: 14, background: '#F2F2F4', display: 'flex', alignItems: 'center', justifyContent: 'center', color: SUB, fontSize: 13 }}>
        Ubicación no disponible
      </div>
    );
  }
  return (
    <div style={{ position: 'relative', width: '100%', height: 200, borderRadius: 14, overflow: 'hidden', isolation: 'isolate' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {/* Mismo botón/lógica de ubicación que Partidos/Canchas (no auto; solo al pulsar). */}
      <MapLocateControl mapRef={mapRef} venues={[{ lat, lng }]} cityLabel={cityLabel} />
    </div>
  );
}
