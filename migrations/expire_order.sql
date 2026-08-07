-- ============================================================================
-- Orders · Fase 1 · Etapa 3 — expire_orders (barrido TTL: PENDING → EXPIRED)
-- ============================================================================
-- Libera los HOLDs ABANDONADOS: marca EXPIRED toda Order 'pending' cuyo
-- pending_expires_at ya venció. Sin esto, un abandono tras create_order
-- bloquearía el cupo para siempre. CERO huella de dominio.
--
-- Idempotente y autolimitado: solo toca 'pending' vencidas (CAS sobre status).
-- Reejecutable sin efecto adicional. Se invoca como los barridos existentes
-- (p.ej. expire_waitlists): cualquier sesión autenticada puede dispararlo, o un
-- pg_cron; solo expira lo objetivamente elegible, así que es seguro.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- NOTA DE ARQUITECTURA (YAGNI) — mecanismos DIFERIDOS:
--   lease · spend_applied · apply_order_spend · reconciliación · dedup de webhooks
-- NO forman parte del contrato de la Order; son detalles INTERNOS de confirm_order
-- que se añadirán ÚNICAMENTE cuando exista un proveedor de pago ASÍNCRONO (Culqi).
--   · En particular, el LEASE evitará expirar una Order que se esté materializando
--     en un flujo asíncrono. Mientras el pago sea SIMULADO y SÍNCRONO, esto no
--     ocurre: confirm_order es inmediato y el TTL es >> su latencia, así que un
--     'pending' vencido es siempre un abandono real. Además, si expire y confirm
--     compitieran, el CAS sobre status deja ganar a UNO solo.
--   · La RECONCILIACIÓN (no expirar una Order PAGADA-pero-no-confirmada) llegará
--     con Culqi vía payment_binding. Hoy no hay pago externo que reconciliar.
-- NO "faltan": están deliberadamente aplazados.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER: escribe `orders` (sin policy de UPDATE para el cliente).
-- ============================================================================

create or replace function public.expire_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.orders
     set status          = 'expired',
         terminal_reason = 'timeout',
         resolved_at     = now(),
         updated_at      = now()
   where status = 'pending'
     and pending_expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;   -- nº de HOLDs liberados
end;
$$;

grant execute on function public.expire_orders() to authenticated;
