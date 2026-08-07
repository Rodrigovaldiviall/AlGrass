-- ============================================================================
-- Orders · Fase 1 · Etapa 3 — fail_order (transición PENDING → FAILED)
-- ============================================================================
-- Marca una Order como FAILED (pago rechazado / materialización irrecuperable /
-- futura cancelación administrativa). Libera el HOLD (al salir de 'pending' deja
-- de contar en capacidad). CERO huella de dominio: no materializa nada.
--
-- Idempotente por la GUARDA DE ESTADO de la propia Order (CAS sobre status):
-- solo transiciona desde 'pending'; una segunda llamada ve un estado terminal y
-- devuelve la Order tal cual (no re-falla, no toca un CONFIRMED, etc.).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- NOTA DE ARQUITECTURA (YAGNI) — mecanismos DIFERIDOS:
--   lease · spend_applied · apply_order_spend · reconciliación · dedup de webhooks
-- NO se implementan aquí y NO forman parte del contrato de la Order (4 estados:
-- pending/confirmed/failed/expired). Son detalles INTERNOS de confirm_order y se
-- incorporarán ÚNICAMENTE cuando exista un proveedor de pago ASÍNCRONO con
-- webhooks (Culqi u otro). Mientras el pago sea SIMULADO y SÍNCRONO (invocado por
-- el cliente), la idempotencia se apoya en la guarda de estado de la Order, con la
-- MISMA robustez que el checkout actual. NO "faltan": están deliberadamente aplazados.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER: la escritura de `orders` va por RPC (no hay policy de UPDATE
-- para el cliente). Valida que el actor sea el payer de la Order.
-- ============================================================================

create or replace function public.fail_order(p_order_id uuid, p_reason text default 'payment_rejected')
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  -- CAS pending → failed (una sola transición). Solo el propio payer.
  update public.orders
     set status          = 'failed',
         terminal_reason = coalesce(p_reason, 'payment_rejected'),
         resolved_at     = now(),
         updated_at      = now()
   where id = p_order_id
     and payer_user_id = v_actor
     and status = 'pending'
  returning * into v_order;
  if found then return v_order; end if;

  -- No estaba 'pending' (ya terminal) o no pertenece al actor → idempotente:
  -- devolver el estado actual; si no existe/ajena → error.
  select * into v_order
    from public.orders
   where id = p_order_id and payer_user_id = v_actor;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  return v_order;   -- ya terminal (idempotente): se devuelve tal cual
end;
$$;

grant execute on function public.fail_order(uuid, text) to authenticated;
