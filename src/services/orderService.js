// ── orderService — thin wrapper de TRANSPORTE del flujo externo (Order) ────────
// Capa delgadísima sobre las RPC/Edge Functions del flujo externo. Su ÚNICA
// responsabilidad es ocultar el transporte (nombres de RPC, prefijos p_, contrato
// HTTP de la Edge Function) para que ConfirmReservation.jsx no lo conozca.
//
// NO contiene: lógica de negocio · validaciones propias · transformación de
// respuestas · mapeo de errores · orquestación · conocimiento del checkout, de
// PaymentSheet o de Culqi. Devuelve el { data, error } CRUDO de Supabase.
//
// La ÚNICA orquestación del dominio sigue viviendo en confirm_order (server) y en
// el camino interno, ambos sobre materializeReservation. Aquí solo se DISPARAN
// llamadas de transporte; nada se secuencia.
//
// Compatibilidad con Culqi: las firmas no cambian. create_order ya acepta
// paymentProvider; un rechazo Culqi sigue llamando failOrder('payment_rejected');
// y si confirm_order necesita más campos (paymentBinding, provider, eventId…), el
// body se amplía AQUÍ, no en el checkout.

import { supabase } from '../lib/supabase';

// create_order(RPC): crea el HOLD/Order (PENDING). Mapea camelCase → p_*.
export function createOrder({
  idempotencyKey, resourceType, resourceId, claimComposition,
  amountTotal, currency, financialSnapshot, pendingExpiresAt, paymentProvider,
}) {
  return supabase.rpc('create_order', {
    p_idempotency_key:   idempotencyKey,
    p_resource_type:     resourceType,
    p_resource_id:       resourceId,
    p_claim_composition: claimComposition,
    p_amount_total:      amountTotal,
    p_currency:          currency,
    p_financial_snapshot: financialSnapshot,
    p_pending_expires_at: pendingExpiresAt,
    p_payment_provider:  paymentProvider,
  });
}

// fail_order(RPC): transición terminal PENDING → FAILED (cero huella de dominio).
export function failOrder({ orderId, reason }) {
  return supabase.rpc('fail_order', {
    p_order_id: orderId,
    p_reason:   reason,
  });
}

// confirm_order(Edge Function): dispara la materialización server-side. El checkout
// NO conoce el contrato HTTP; el body se construye aquí y se amplía aquí.
export function confirmOrder({ orderId, paymentProof }) {
  return supabase.functions.invoke('confirm_order', {
    body: { orderId, paymentProof },
  });
}

// getOrderStatus(RPC/REST): lectura SOLO del estado de la Order propia. La RLS
// (orders_select_own = payer_user_id = auth.uid()) la acota a las Orders del payer.
// Sin escritura, sin lógica: devuelve el { data, error } CRUDO de Supabase.
export function getOrderStatus({ orderId }) {
  return supabase
    .from('orders')
    .select('status')
    .eq('id', orderId)
    .maybeSingle();
}
