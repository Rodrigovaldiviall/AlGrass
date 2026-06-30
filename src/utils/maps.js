// URL de Google Maps. Prioriza coordenadas; si no hay, busca por dirección.
export function googleMapsUrl({ lat = null, lng = null, address = '' } = {}) {
  if (lat != null && lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  const text = Array.isArray(address) ? address.filter(Boolean).join(', ') : (address || '');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
}
