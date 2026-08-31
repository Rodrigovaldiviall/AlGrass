// ── Edge Function confirm_order — frontera del adapter de pago (hoy SIMULADO) ───
// Materializa una Order PENDING tras un pago externo aprobado. REUTILIZA
// LITERALMENTE materializeReservation (la ÚNICA orquestación del dominio, idéntica
// al camino interno) con un ctx service-role. No hay segunda orquestación aquí:
// confirm_order solo carga la Order, valida, deserializa el snapshot congelado y
// delega; luego marca CONFIRMED.
//
// INVARIANTE: confirm_order es el ÚNICO escritor de 'confirmed' y NO escribe ningún
// otro estado. Todo camino que no sea éxito deja la Order intacta (PENDING o su
// terminal previo). fail_order/expire_orders son dueños de los demás terminales.
//
// Idempotencia: EXCLUSIVAMENTE por la máquina de estados de la Order (status). Sin
// lease, sin spend_applied, sin reconciliación (diferidos a Culqi asíncrono).

import { createClient } from '@supabase/supabase-js';
// Reutilización literal: sin duplicar la orquestación. El grafo compartido corre en
// Deno gracias a ctx.db inyectado (nadie lee el singleton browser) y a lib/supabase
// tolerante a import.meta.env ausente.
import { materializeReservation } from '../../../src/services/materializeReservation.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// SIMULADO: validación de forma/presencia del comprobante. Con Culqi, este seam
// pasa a verificar el cargo real contra el gateway / firma de webhook.
function isValidSimulatedProof(p: any): boolean {
  return !!p && typeof p === 'object' && p.provider === 'simulated' && typeof p.reference === 'string';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    // 1) Input: orderId obligatorio. paymentProof es obligatorio SOLO en pasarela
    //    (se valida abajo según el modo del Order, ya cargado).
    const { orderId, paymentProof } = await req.json().catch(() => ({}));
    if (!orderId) return json({ error: 'INVALID_INPUT' }, 400);

    // Cliente service-role = ctx.db. Variables inyectadas por la plataforma.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    // Identidad del llamador: quien confirma debe ser el payer de la Order.
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: userRes } = await admin.auth.getUser(token);
    const callerId = userRes?.user?.id ?? null;
    if (!callerId) return json({ error: 'AUTH_REQUIRED' }, 401);

    // 2) Cargar Order.
    const { data: order, error: loadErr } = await admin
      .from('orders').select('*').eq('id', orderId).maybeSingle();
    if (loadErr) return json({ error: 'LOAD_FAILED' }, 500);
    if (!order) return json({ error: 'ORDER_NOT_FOUND' }, 404);
    if (order.payer_user_id !== callerId) return json({ error: 'FORBIDDEN' }, 403);

    // 3) Validar estado (idempotencia SOLO por status).
    if (order.status === 'confirmed') return json({ ok: true, alreadyConfirmed: true }, 200);
    if (order.status === 'failed' || order.status === 'expired')
      return json({ error: 'ORDER_TERMINAL', status: order.status }, 409);
    // status === 'pending' → continuar.

    // 4) Validación según el MODO del Order (la materialización posterior es IDÉNTICA):
    //    · Crédito (payment_provider='credit'): sin comprobante externo; se valida
    //      SALDO suficiente ANTES de materializar (materializeReservation debita).
    //    · Externo (pasarela): comprobante simulado, EXACTAMENTE como hasta ahora.
    //    Inválido/insuficiente → Order queda PENDING (no materializa); el TTL la reclama.
    const isCredit = order.payment_provider === 'credit';
    if (isCredit) {
      const creditApplied = Number(order.financial_snapshot?.creditApplied ?? 0);
      const { data: wallet } = await admin
        .from('wallet_summary').select('credit_balance')
        .eq('user_id', order.payer_user_id).maybeSingle();
      if (Number(wallet?.credit_balance ?? 0) < creditApplied) {
        return json({ error: 'INSUFFICIENT_CREDIT' }, 402);
      }
    } else {
      if (!paymentProof) return json({ error: 'INVALID_INPUT' }, 400);
      if (!isValidSimulatedProof(paymentProof)) return json({ error: 'INVALID_PAYMENT_PROOF' }, 400);
    }

    // 5) ctx service-role. orderId habilita la proveniencia (reservations.order_id)
    //    sin que el dominio lo lea.
    const ctx = { db: admin, actor: order.payer_user_id, orderId: order.id };

    // 6) Snapshot: DESERIALIZACIÓN 1:1 del snapshot congelado en create_order.
    //    NO se recomputa nada aquí (eso sería una segunda orquestación).
    const snapshot = order.financial_snapshot;

    // 7) ÚNICA orquestación del dominio (idéntica al camino interno).
    const result = await materializeReservation(ctx, snapshot);

    // 8) Mapear resultado.
    // ── RAMAS TEMPORALES: GAME_FULL / RENTAL_TAKEN ─────────────────────────────
    // NO son un resultado esperado del diseño FINAL de confirm_order. Existen
    // ÚNICAMENTE mientras coexisten el camino externo (con HOLD) y el camino interno
    // (100% crédito, SIN HOLD): el trigger de capacidad de game_players es CIEGO a
    // los HOLDs, así que un pago interno puede tomar el cupo/alquiler durante la
    // ventana del pago externo. Cuando la Etapa 5 haga el camino interno HOLD-AWARE,
    // estas dos ramas DEBEN desaparecer (o degradarse a error inesperado). Que nadie,
    // dentro de un año, lea GAME_FULL como un resultado normal de confirm_order.
    // En ambos casos la Order queda PENDING y el error se PROPAGA (Regla 2): puede
    // haber huella parcial (createReservation corrió), así que NUNCA se llama fail_order.
    if (result?.code === 'GAME_FULL') return json({ error: 'GAME_FULL' }, 409);
    if (result?.code === 'RENTAL_TAKEN') return json({ error: 'RENTAL_TAKEN' }, 409);
    // ───────────────────────────────────────────────────────────────────────────
    // Error inesperado / skipped → Order PENDING, se propaga (Regla 2). Sin fail_order.
    if (result?.error || result?.skipped || !result?.ok) {
      return json({ error: 'MATERIALIZATION_FAILED' }, 500);
    }

    // 9) Marcar CONFIRMED (CAS pending → confirmed). Único escritor de 'confirmed'.
    //    Si el CAS pierde ante una confirmación concurrente, mark_order_confirmed es
    //    idempotente y devuelve la Order ya 'confirmed'.
    const { error: markErr } = await admin.rpc('mark_order_confirmed', { p_order_id: order.id });
    if (markErr) return json({ error: 'CONFIRM_FAILED' }, 500); // materializó pero no marcó → reintento idempotente

    // 10) Éxito. El checkout navega con su `game` local; no necesita reservationId.
    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: 'UNEXPECTED', detail: String((e as Error)?.message ?? e) }, 500);
  }
});
