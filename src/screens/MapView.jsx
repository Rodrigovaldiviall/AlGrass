import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getVenues } from '../services/venueService';
import { RED, ORANGE } from '../constants';
import logo from '../assets/logo.webp';

const AREQUIPA = [-16.409, -71.537];

// Marcador AlGrass: logo + badge circular con el contador de partidos visibles.
// Seleccionado: badge naranja, mayor escala y sombra. Sin seleccionar: badge rojo.
function markerIcon(count, selected, dimmed) {
  const label = count > 99 ? '99+' : count;
  const badgeBg = selected ? ORANGE : RED;
  const dim = dimmed ? 'grayscale(1) ' : '';
  const op = dimmed ? 0.45 : 1;
  const html = `
    <div style="position:relative;width:68px;height:68px;opacity:${op};
      transform:scale(${selected ? 1.18 : 1});transition:transform .12s;
      filter:${dim}drop-shadow(0 ${selected ? 3 : 1}px ${selected ? 6 : 3}px rgba(0,0,0,${selected ? 0.45 : 0.3}));">
      <img src="${logo}" alt="" style="width:68px;height:68px;object-fit:contain;display:block;" />
      <div style="position:absolute;top:4px;right:6px;min-width:18px;height:18px;padding:0 4px;
        border-radius:9px;background:${badgeBg};color:#fff;border:2px solid #fff;box-sizing:border-box;
        font:700 11px/1 -apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;">${label}</div>
    </div>`;
  return L.divIcon({ html, className: '', iconSize: [68, 68], iconAnchor: [34, 34] });
}

export default function MapView({ city, games = [], selectedVenueId = null, sheetExpanded = false, selectedDistricts = [], onSelectVenue, onClearSelection }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map()); // venueId -> L.marker
  const onSelectRef = useRef(onSelectVenue);
  const onClearRef = useRef(onClearSelection);
  const [venues, setVenues] = useState([]);

  // Mantener las callbacks frescas sin re-registrar handlers.
  useEffect(() => { onSelectRef.current = onSelectVenue; onClearRef.current = onClearSelection; });

  // Init mapa (una vez), centrado en Arequipa. Tap en zona vacía → limpiar selección.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current).setView(AREQUIPA, 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19,
    }).addTo(map);
    map.on('click', () => onClearRef.current?.());
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Venues geolocalizados de la ciudad actual.
  useEffect(() => {
    if (!city) { setVenues([]); return; }
    let cancelled = false;
    getVenues(city).then(v => { if (!cancelled) setVenues(v); });
    return () => { cancelled = true; };
  }, [city]);

  // Markers: cuenta de partidos visibles por venue + selección.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const counts = new Map();
    for (const g of games) {
      if (!g.venueId) continue;
      counts.set(g.venueId, (counts.get(g.venueId) ?? 0) + 1);
    }

    markersRef.current.forEach(m => m.remove());
    markersRef.current.clear();

    for (const v of venues) {
      if (v.lat == null || v.lng == null) continue;
      const count = counts.get(v.id) ?? 0;
      const dimmed = selectedDistricts.length > 0 && !selectedDistricts.includes(v.district);
      const marker = L.marker([v.lat, v.lng], {
        icon: markerIcon(count, v.id === selectedVenueId, dimmed),
      }).addTo(map);
      marker.on('click', () => onSelectRef.current?.(v));
      markersRef.current.set(v.id, marker);
    }
  }, [venues, games, selectedVenueId, selectedDistricts]);

  // Al cambiar de ciudad (cambian los venues): recentrar sobre los venues visibles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts = venues
      .filter(v => v.lat != null && v.lng != null)
      .map(v => [v.lat, v.lng]);
    if (pts.length === 0) return;
    if (pts.length === 1) { map.setView(pts[0], 15); return; }
    map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
  }, [venues]);

  // Al seleccionar un venue con el sheet en 40%: subir el pin lo justo para que no quede
  // tapado por el sheet. Solo paneo vertical (sin zoom, sin recentrar). No actúa en 100%.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedVenueId || sheetExpanded) return;
    const v = venues.find(x => x.id === selectedVenueId);
    if (!v || v.lat == null || v.lng == null) return;
    const size = map.getSize();
    const pt = map.latLngToContainerPoint([v.lat, v.lng]);
    const margin = 45;                       // holgura entre el pin y el borde superior del sheet
    const targetY = size.y * 0.6 - margin;   // el sheet ocupa el 40% inferior
    if (pt.y > targetY) map.panBy([0, pt.y - targetY], { animate: true });
  }, [selectedVenueId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} style={{ flex: 1, width: '100%', minHeight: 0, isolation: 'isolate' }} />;
}
