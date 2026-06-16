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
