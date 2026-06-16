-- Modelo geográfico para el MVP de mapa.
-- Añade lat/lng/district a venues. Idempotente y no destructivo
-- (columnas nullable → no toca datos existentes).

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS lat      double precision,
  ADD COLUMN IF NOT EXISTS lng      double precision,
  ADD COLUMN IF NOT EXISTS district text;

-- Índice para el filtro por ciudad + distrito del mapa (opcional pero recomendado).
CREATE INDEX IF NOT EXISTS venues_city_district_idx
  ON public.venues (city, district);
