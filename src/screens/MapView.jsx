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
      transform:scale(${selected ? 1.32 : 1});transition:transform .12s;
      filter:${dim}drop-shadow(0 ${selected ? 3 : 1}px ${selected ? 6 : 3}px rgba(0,0,0,${selected ? 0.45 : 0.3}));">
      <img src="${logo}" alt="" style="width:68px;height:68px;object-fit:contain;display:block;" />
      <div style="position:absolute;top:4px;right:6px;min-width:18px;height:18px;padding:0 4px;
        border-radius:9px;background:${badgeBg};color:#fff;border:2px solid #fff;box-sizing:border-box;
        font:700 11px/1 -apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;">${label}</div>
    </div>`;
  return L.divIcon({ html, className: '', iconSize: [68, 68], iconAnchor: [34, 34] });
}

export default function MapView({ city, games = [], selectedVenueId = null, sheetExpanded = false, selectedDistricts = [], initialCenter = null, initialZoom = null, onSelectVenue, onClearSelection, onViewChange }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map()); // venueId -> L.marker
  const onSelectRef = useRef(onSelectVenue);
  const onClearRef = useRef(onClearSelection);
  const onViewRef = useRef(onViewChange);
  const [venues, setVenues] = useState([]);
  const userDotRef = useRef(null);   // L.circleMarker (punto azul)
  const userHaloRef = useRef(null);  // L.circle (precisión)
  const [geoMsg, setGeoMsg] = useState(null); // mensaje transitorio (permiso/fuera de ciudad)

  // Restauración de cámara: solo si center/zoom son válidos (números finitos).
  const validRestore = Array.isArray(initialCenter) && initialCenter.length === 2
    && Number.isFinite(initialCenter[0]) && Number.isFinite(initialCenter[1]) && Number.isFinite(initialZoom);
  const restoredRef = useRef(validRestore); // salta el primer fitBounds tras restaurar

  // Mantener las callbacks frescas sin re-registrar handlers.
  useEffect(() => { onSelectRef.current = onSelectVenue; onClearRef.current = onClearSelection; onViewRef.current = onViewChange; });

  // Init mapa (una vez). Centro restaurado si es válido; si no, Arequipa. Tap en zona vacía → limpiar selección.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: false })
      .setView(validRestore ? initialCenter : AREQUIPA, validRestore ? initialZoom : 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19,
    }).addTo(map);
    map.on('click', () => onClearRef.current?.());
    map.on('moveend', () => { const c = map.getCenter(); onViewRef.current?.([c.lat, c.lng], map.getZoom()); });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (pts.length === 0) return;                                     // sin venues: no toques la cámara ni gastes el guard
    if (restoredRef.current) { restoredRef.current = false; return; } // cámara restaurada (con venues ya cargados): saltar fitBounds una vez
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
  }, [selectedVenueId, venues]); // eslint-disable-line react-hooks/exhaustive-deps -- venues: reaplica la compensación cuando cargan tras una restauración

  // Auto-ocultar el mensaje transitorio.
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
          userHaloRef.current = L.circle(ll, { radius: accuracy, color: '#1E78FF', weight: 1, fillColor: '#1E78FF', fillOpacity: 0.12 }).addTo(map);
          userDotRef.current = L.circleMarker(ll, { radius: 7, color: '#fff', weight: 3, fillColor: '#1E78FF', fillOpacity: 1 }).addTo(map);
        } else {
          userHaloRef.current.setLatLng(ll).setRadius(accuracy);
          userDotRef.current.setLatLng(ll);
        }
        // La ciudad es la referencia: solo recentrar si la ubicación cae dentro del área de la ciudad.
        const pts = venues.filter(v => v.lat != null && v.lng != null).map(v => [v.lat, v.lng]);
        const inside = pts.length === 0 || L.latLngBounds(pts).pad(0.25).contains(L.latLng(latitude, longitude));
        if (inside) map.setView(ll, Math.max(map.getZoom(), 15));
        else setGeoMsg(`Tu ubicación está fuera de ${city}`);
      },
      (err) => {
        setGeoMsg(err.code === 1 ? 'Activa los permisos de ubicación' : 'No pudimos obtener tu ubicación');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  }

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', isolation: 'isolate' }}>
      <div ref={containerRef} style={{ flex: 1, width: '100%', minHeight: 0 }} />
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
    </div>
  );
}
