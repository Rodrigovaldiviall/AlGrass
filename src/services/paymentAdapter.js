// ── paymentAdapter — frontera del GATEWAY de pago (hoy SIMULADO) ───────────────
// Única API estable que el checkout conocerá para cobrar. Encapsula EXCLUSIVAMENTE
// el gateway: recibe un intent de cobro ya final y devuelve el veredicto + un
// comprobante OPACO. Nada más.
//
// NO contiene: lógica de negocio (no calcula montos ni aplica promo/crédito) ·
// conocimiento de Orders (nunca ve orderId) · conocimiento del checkout/PaymentSheet ·
// conocimiento de materializeReservation. No secuencia nada: la única orquestación
// del dominio sigue intacta.
//
// Culqi mañana = swap de la IMPLEMENTACIÓN interna de charge() (Math.random →
// Culqi.js), sin cambiar la firma: el intent sumará `token` y paymentProof se
// rellenará con el cargo real. El checkout no cambia.

// charge(intent): intenta el cobro. Async siempre (Culqi es I/O de red), aunque el
// sim resuelva de inmediato. Rechazo = valor normal (approved:false), no excepción;
// las excepciones quedan para fallos de transporte/gateway (hoy el sim no produce).
export async function charge({ amount, currency, paymentMethod }) {
  // Comportamiento actual EXACTO: aprobación simulada con Math.random() < 0.8.
  const approved = Math.random() < 0.8;
  return {
    approved,
    // Comprobante opaco del gateway; el checkout lo reenvía tal cual a confirm_order.
    paymentProof: approved
      ? { provider: 'simulated', reference: crypto.randomUUID(), capturedAt: new Date().toISOString() }
      : null,
  };
}
