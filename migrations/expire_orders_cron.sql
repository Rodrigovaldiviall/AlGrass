-- ============================================================================
-- Orders · Cron de expiración automática de HOLDs vencidos (pg_cron)
-- ============================================================================
-- Conecta a pg_cron la función YA EXISTENTE public.expire_orders() (ver
-- expire_order.sql), que marca EXPIRED toda Order 'pending' cuyo pending_expires_at
-- ya venció (terminal_reason='timeout', resolved_at=now()). Sin este wiring, una
-- Order abandonada tras create_order quedaba 'pending' indefinidamente, bloqueando
-- el cupo y contaminando los guards de capacidad/double-out.
--
-- NO modifica expire_orders(), orders, confirm_order, reservations, wallet ni games.
-- SOLO agenda el barrido. Mismo patrón EXACTO que expire-slot-reservations y los
-- crones de holds de campeonato (expire-championship-transfer-holds / -gateway-holds).
--
-- REQUISITO PREVIO: extensión pg_cron habilitada en Supabase
--   Dashboard → Database → Extensions → activar "pg_cron".
-- (En Supabase los jobs viven en la base 'postgres' y corren con el rol postgres,
--  que puede invocar la función SECURITY DEFINER public.expire_orders().)
--
-- Idempotente: el unschedule previo evita duplicar el job al re-ejecutar el archivo.
-- ============================================================================

-- Evita duplicar el job si ya estaba programado (ignora el error si no existía).
do $$
begin
  perform cron.unschedule('expire-orders');
exception when others then
  null;
end $$;

select cron.schedule(
  'expire-orders',
  '* * * * *',                                  -- cada minuto
  $$ select public.expire_orders(); $$
);
