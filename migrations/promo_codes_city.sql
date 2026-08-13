-- ============================================================================
-- Promociones · segmentación por ciudad — promo_codes.city
-- ============================================================================
-- Añade la ciudad objetivo de una promo. Se valida contra la ciudad DEL EVENTO/
-- VENUE/RENTAL (venues.city), nunca contra el usuario.
--   NULL      = válida para TODAS las ciudades.
--   'Lima'    = válida solo para juegos/rentals de Lima.
--   'Arequipa'= válida solo para juegos/rentals de Arequipa.
--
-- SIN CHECK de valores: el proyecto no tiene un catálogo formal de ciudades en DB,
-- y no queremos alterar una constraint cada vez que abra una ciudad nueva. La
-- comparación real (case/acentos/espacios) vive en validatePromoCode (App).
--
-- No modifica promotions_v1.sql (ya aplicada). No crea tablas (promo_cities queda
-- descartada). Re-ejecutable: add column if not exists.
-- ============================================================================

alter table public.promo_codes
  add column if not exists city text;
