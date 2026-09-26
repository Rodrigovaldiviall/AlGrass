import { supabase } from '../lib/supabase';

// Fuente única de venues por ciudad (mapa + distritos + futuras canchas).
// Incluye venues SIN coordenadas (geografía real). MapView ya protege lat/lng nulos.
export async function getVenues(city) {
  if (!supabase || !city) return [];
  const { data, error } = await supabase
    .from('venues')
    .select('id, name, city, district, lat, lng')
    .eq('city', city);
  if (error) { console.warn('[venues] fetch error:', error); return []; }
  return data ?? [];
}

// Venue PERMANENTE por id (foto/ubicación/amenities). Lectura directa de la tabla `venues` — NO depende del
// inventario/rentals activos, así el detalle sigue funcionando aunque los games ya estén completed/vencidos.
// RLS: la app ya lee venues (getVenues). Devuelve null si no existe (fallback en el caller).
export async function getVenueById(venueId) {
  if (!supabase || !venueId) return null;
  const { data, error } = await supabase
    .from('venues')
    .select('id, name, district, address, city, lat, lng, cover_image_path, cover_updated_at, amenities')
    .eq('id', venueId)
    .maybeSingle();
  if (error) { console.warn('[venues] getVenueById error:', error); return null; }
  return data ?? null;
}
