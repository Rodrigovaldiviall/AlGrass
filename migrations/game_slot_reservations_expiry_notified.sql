-- ============================================================================
-- V6 · game_slot_reservations.expiry_notified_at — marca de "popup mostrado"
-- ============================================================================
-- ÚNICA responsabilidad: evitar volver a mostrar el popup de expiración automática.
-- Análogo a rating.popup_shown_at. NO tiene ninguna otra lógica de negocio.
--
-- NULL  = expiración aún no notificada al capitán (candidata a mostrar el popup).
-- fecha = ya se mostró una vez (nunca se vuelve a mostrar).
--
-- Se pobla exclusivamente vía mark_slot_reservation_notified(...) tras cerrar el
-- overlay. No se toca en reserve_slots, el cron, ni ninguna otra pieza.
-- ============================================================================

alter table public.game_slot_reservations
  add column if not exists expiry_notified_at timestamptz;
