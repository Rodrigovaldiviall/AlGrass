-- ============================================================================
-- Orders · Fase 1 · Etapa 3 — reservations.order_id (PROVENIENCIA)
-- ============================================================================
-- Añade una etiqueta de PROVENIENCIA/trazabilidad/correlación a `reservations`:
-- "¿qué Order produjo este asiento?". Migración ADITIVA.
--
-- REGLAS DE ESTA COLUMNA (cerradas por decisión de arquitectura):
--   · Es SOLO proveniencia. NO es un mecanismo de idempotencia.
--   · El DOMINIO NUNCA la lee para decidir estado (ni reservations, ni wallet,
--     ni game_players, ni refunds, ni cancelaciones).
--   · La idempotencia de confirm_order vive EXCLUSIVAMENTE en la Order (status).
--   · SIN UNIQUE (una Order podría no mapear 1:1 a una sola fila; y forzar
--     unicidad aquí acoplaría el ledger al modelo de Order).
--   · SIN FK a orders (proveniencia desacoplada; la integridad la garantiza la
--     RPC que la escribe). reservations no necesita que la Order exista para
--     funcionar.
--
-- La escribe la materialización (confirm_order → createReservation con order_id)
-- en la Etapa 4. Para el camino interno (100% crédito, sin Order) queda NULL.
-- ============================================================================

alter table public.reservations
  add column if not exists order_id uuid;   -- proveniencia; NULL en el camino interno

-- Índice para consultas de correlación/auditoría (Order → sus asientos).
-- Parcial (solo filas con proveniencia) para no pesar sobre el ledger interno.
create index if not exists reservations_order_id_idx
  on public.reservations (order_id) where order_id is not null;

comment on column public.reservations.order_id is
  'Proveniencia: Order que materializó este asiento. Solo trazabilidad/correlación; '
  'NO es idempotencia y el dominio NUNCA lo lee para decidir estado. NULL en el camino interno.';
