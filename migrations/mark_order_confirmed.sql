-- ============================================================================
-- Orders · Fase 1 · Etapa 4.5 — mark_order_confirmed (transición PENDING → CONFIRMED)
-- ============================================================================
-- ÚNICA fuente de verdad de la transición pending → confirmed. Simétrica a
-- fail_order/expire_orders: un CAS sobre `status`. La invoca EXCLUSIVAMENTE la
-- Edge Function confirm_order, y SOLO DESPUÉS de que materializeReservation
-- completó con éxito (Regla 2: CONFIRMED implica materialización terminada).
--
-- Idempotente por la máquina de estados: si otra llamada ya confirmó, devuelve la
-- Order tal cual. Si la Order quedó en otro terminal (p.ej. expire ganó la carrera),
-- lanza excepción y confirm_order la propaga (queda como huella sobre un EXPIRED;
-- carrera aceptada en la fase SIMULADA — el lease llega con Culqi, ver expire_order.sql).
--
-- NO valida payer: confirm_order corre con service-role y YA verificó
-- caller == payer antes de llamar aquí. Por eso no usa auth.uid().
--
-- confirm_order es el ÚNICO escritor de 'confirmed' y no escribe ningún otro estado.
-- ============================================================================

create or replace function public.mark_order_confirmed(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  -- CAS pending → confirmed (una sola transición).
  update public.orders
     set status      = 'confirmed',
         resolved_at = now(),
         updated_at  = now()
   where id = p_order_id
     and status = 'pending'
  returning * into v_order;
  if found then return v_order; end if;

  -- Ya no estaba 'pending'. Idempotente si ya está 'confirmed'; si es otro
  -- terminal (failed/expired), no es confirmable → error explícito.
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'confirmed' then
    raise exception 'ORDER_NOT_CONFIRMABLE: %', v_order.status;
  end if;
  return v_order;   -- ya 'confirmed' (idempotente): se devuelve tal cual
end;
$$;

grant execute on function public.mark_order_confirmed(uuid) to authenticated, service_role;
