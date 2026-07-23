-- ============================================================================
-- V6 · Cron de expiración automática de reservas de cupos (pg_cron)
-- ============================================================================
-- REQUISITO PREVIO: habilitar la extensión pg_cron en Supabase
--   Dashboard → Database → Extensions → activar "pg_cron".
-- (En Supabase, los jobs de pg_cron viven en la base 'postgres' y se ejecutan con
--  el rol postgres, que puede invocar la función SECURITY DEFINER.)
--
-- Programa el barrido CADA HORA en punto. Idempotente: si el job ya existe con ese
-- nombre, unschedule previo evita duplicados al re-ejecutar este archivo.
-- ============================================================================

-- Evita duplicar el job si ya estaba programado (ignora el error si no existía).
do $$
begin
  perform cron.unschedule('expire-slot-reservations');
exception when others then
  null;
end $$;

select cron.schedule(
  'expire-slot-reservations',
  '0 * * * *',                                  -- minuto 0 de cada hora
  $$ select public.expire_slot_reservations(); $$
);
