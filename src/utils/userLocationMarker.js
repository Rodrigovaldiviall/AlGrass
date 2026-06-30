import L from 'leaflet';

// Marcador de ubicación del usuario: punto azul + halo de precisión.
// Mismo marcador que usa el mapa de Partidos/Canchas (MapView). Única implementación.
export function drawUserLocation(map, lat, lng, accuracy = 0) {
  const ll = [lat, lng];
  const halo = L.circle(ll, { radius: accuracy, color: '#1E78FF', weight: 1, fillColor: '#1E78FF', fillOpacity: 0.12 }).addTo(map);
  const dot  = L.circleMarker(ll, { radius: 7, color: '#fff', weight: 3, fillColor: '#1E78FF', fillOpacity: 1 }).addTo(map);
  return { halo, dot };
}
