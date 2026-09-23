// ── championshipService — wrapper de TRANSPORTE del flujo de Campeonato (hold de Transferencia) ──
// Capa delgada sobre las RPC SECURITY DEFINER de Fase 2 (championships_phase2_transfer_hold.sql).
// Su ÚNICA responsabilidad es ocultar el transporte (nombres de RPC, prefijos p_*) para que la UI
// no lo conozca. NO contiene lógica de negocio: el dominio (crear hold, resolver order, cancelar,
// double-out, cron) vive 100% en el backend. Devuelve el { data, error } CRUDO de Supabase.
//
// El frontend NUNCA escribe games/orders/championship_reservation_games ni cambia championship.status
// directamente: TODA mutación pasa por estas RPCs (§19). El cliente solo consume RPC + SELECT (RLS).
//
// owner_user_id NO se envía: el backend usa auth.uid() en todas las RPCs.

import { supabase } from '../lib/supabase';

// create_championship_transfer_hold(RPC): crea el hold multicancha (championship='transfer_hold',
// order='pending', games published→reserved+championship_id). ATÓMICO: los N games o ninguno.
//   gameIds        → uuid[] REALES de games (type='rental', published, libres). NO índices visuales.
//   idempotencyKey → estable POR INTENTO de checkout (doble click / retry devuelven el MISMO hold).
//   config         → jsonb snapshot (formato, equipos, fecha, sede, horario, precio…), forward-compat.
// Errores esperados (error.message): 'AVAILABILITY_CHANGED' (alguna cancha ya no está libre),
//   'AUTH_REQUIRED', 'NO_GAMES'. En AVAILABILITY_CHANGED el hold NO se creó.
export function createTransferHold({ gameIds, idempotencyKey, config }) {
  return supabase.rpc('create_championship_transfer_hold', {
    p_game_ids:        gameIds,
    p_idempotency_key: idempotencyKey,
    p_config:          config ?? {},
  });
}

// ── Championship GATEWAY (pending LÓGICO multicancha; pago por PASARELA) ──────────────────────
// create_championship_gateway_order(RPC): al pulsar PAGAR, ANTES del cobro externo. Adquiere el pending
// lógico (championship='gateway_hold', order='pending', N CRG). Los games SIGUEN published (no se reservan
// hasta confirmar el pago). Idempotente por (payer, idempotencyKey). Errores: 'AVAILABILITY_CHANGED' /
// 'NO_CAPACITY' (carrera: rental/match/otro gateway/transfer pending o físico). En error NO se creó nada.
export function createGatewayOrder({ gameIds, idempotencyKey, config }) {
  return supabase.rpc('create_championship_gateway_order', {
    p_game_ids:        gameIds,
    p_idempotency_key: idempotencyKey,
    p_config:          config ?? {},
  });
}

// confirm_championship_gateway_payment(RPC): el cobro externo (mock) aprobó → materializa ALL-OR-NONE
// (games published→reserved+championship_id, order→confirmed, championship→pending_publish, 1 spend).
// Idempotente. Errores: 'AVAILABILITY_CHANGED' (algún game se tomó antes de confirmar), 'ORDER_EXPIRED',
// 'INVALID_STATE', 'NOT_OWNER'. SOLO aquí los games pasan a reserved.
export function confirmGatewayPayment({ championshipId }) {
  return supabase.rpc('confirm_championship_gateway_payment', { p_championship_id: championshipId });
}

// fail_championship_gateway(RPC): el cobro externo falló/rechazó → cancela el pending (order→failed,
// borra CRG, championship→canceled). Games siguen published; SIN spend/refund/wallet. Idempotente.
export function failGateway({ championshipId, reason = null }) {
  return supabase.rpc('fail_championship_gateway', { p_championship_id: championshipId, p_reason: reason });
}

// quote_championship(RPC): precio REAL informativo (autoridad server-side). Devuelve el breakdown jsonb
// (court/referee/fee/extras/amount_total). NO crea nada. El cliente envía games.id + group_id + extras{code,quantity};
// nunca tarifas/service_court_hours/amount_total. Errores: CHAMPIONSHIP_*_UNAVAILABLE, BOOKING_LEAD_NOT_MET, EXTRA_*.
export function quoteChampionship({ gameIds, groupId, extras }) {
  return supabase.rpc('quote_championship', {
    p_game_ids: gameIds,
    p_group_id: groupId,
    p_extras:   extras ?? [],
  });
}

// get_championship_config(RPC): config por ciudad para pintar la UX (extras activos + precios unitarios,
// booking_lead_rules, availability_formats, registration_close_days). SOLO lectura. NO es autoridad de precio.
export function getChampionshipConfig({ city }) {
  return supabase.rpc('get_championship_config', { p_city: city });
}

// confirm_championship_transfer(RPC): usuario confirmó la transferencia + adjuntó comprobante.
// ATÓMICO: order pending→validation (sin TTL) + championship transfer_hold→payment_validation.
// Los games SIGUEN reserved (no se liberan). NO spend. Espera validación de AlGrass.
//   voucherRef → referencia al comprobante en Storage. HOY mock: se envía null (Fase 2 lo dejó nullable).
//   TODO STORAGE: al conectar Storage real, enviar aquí el ref del objeto subido por el owner.
// Idempotente: si ya está en payment_validation, devuelve el championship tal cual.
// Errores: 'HOLD_EXPIRED' (el cron ganó la carrera / venció), 'NOT_OWNER', 'INVALID_STATE'.
export function confirmTransfer({ championshipId, voucherRef = null }) {
  return supabase.rpc('confirm_championship_transfer', {
    p_championship_id: championshipId,
    p_voucher_ref:     voucherRef,
  });
}

// release_championship_transfer_hold(RPC): liberación VOLUNTARIA del propio hold (X / "Salir y
// cancelar reserva" / cambiar de método). order pending→failed (user_canceled), championship→canceled,
// games reserved→published (double-out reabre por trigger). Solo funciona en 'transfer_hold'.
// Idempotente (canceled → no-op). Errores: 'NOT_OWNER', 'INVALID_STATE', 'CHAMPIONSHIP_NOT_FOUND'.
export function releaseTransferHold({ championshipId }) {
  return supabase.rpc('release_championship_transfer_hold', {
    p_championship_id: championshipId,
  });
}

// ── Origen REAL de games.id para el hold (fase "backend hold primero", sin reconstruir el grid) ──
// Selecciona canchas rentales REALES libres (type='rental', published, sin booker, sin campeonato) y
// devuelve el MEJOR bloque coherente = el grupo (mismo venue, misma fecha) con MÁS canchas, hasta `count`.
// Así las Pruebas A–F operan sobre IDs reales que comparten sede/fecha (mejor para double-out / doble reserva).
// NO inventa IDs, NO usa índices visuales: son games.id reales de Supabase. Devuelve { ids, error }.
export async function fetchFreeRentalBlock({ count = 4 } = {}) {
  const { data, error } = await supabase
    .from('games')
    .select('id, date_key, time, field_id, fields:field_id ( venue_id )')
    .eq('type', 'rental')
    .eq('status', 'published')
    .is('booked_by_user_id', null)
    .is('championship_id', null)
    .order('date_key', { ascending: true })
    .order('time', { ascending: true })
    .limit(300);
  if (error) return { ids: [], error };
  // Agrupar por (venue, fecha) y quedarnos con el grupo más grande (bloque más realista).
  const groups = new Map();
  for (const g of data || []) {
    const key = `${g.fields?.venue_id ?? 'novenue'}__${g.date_key}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }
  let best = [];
  for (const arr of groups.values()) if (arr.length > best.length) best = arr;
  return { ids: best.slice(0, Math.max(1, count)).map(g => g.id), error: null };
}

// Listado REAL de los campeonatos del usuario (fuente de verdad del listado en Profile; 0..N).
// RLS championships_select acota al owner. Trae solo lo necesario para pintar la tarjeta + abrir el
// campeonato (format_config lleva summary/organizeState del snapshot). Ordena por fecha de evento.
// Superficie del OWNER (RPC SECURITY DEFINER owner-scoped por auth.uid()). Ya NO es .from().select():
// se retiró el SELECT directo sobre championships para que ninguna columna sensible (registration_key,
// pagos) sea alcanzable por un cliente. El parámetro userId se ignora (el server usa auth.uid()).
export function listMyChampionships() {
  return supabase.rpc('list_my_championships');
}

// Listado PÚBLICO de campeonatos publicados (fuente de verdad del listado en /championships, 0..N).
// RLS championships_select ya permite a cualquier authenticated leer los estados publicados; NO hace
// falta policy/RPC nueva. NO filtra por owner (distinto de listMyChampionships). venue/formato se
// derivan de format_config (venue_id NO tiene FK → sin join). Ordena por fecha de evento.
export function listPublicChampionships() {
  // Superficie PÚBLICA (RPC SECURITY DEFINER): columnas seguras, SIN registration_key, apta para anon.
  return supabase.rpc('list_public_championships');
}

// get_championship_public(RPC): detalle público seguro (anon+authenticated). Devuelve owner_user_id y
// has_registration_key, NUNCA la clave. Se usa como fuente del detalle en ChampionshipView (real).
export function getChampionshipPublic({ championshipId }) {
  return supabase.rpc('get_championship_public', { p_championship_id: championshipId });
}

// verify_championship_access(RPC): valida la clave EN SERVIDOR → true/false. Owner bypass. Anon permitido.
export function verifyChampionshipAccess({ championshipId, registrationKey }) {
  return supabase.rpc('verify_championship_access', { p_championship_id: championshipId, p_registration_key: registrationKey });
}

// get_championship_registration_key(RPC): la clave real SOLO para el owner (mostrar/editar). No-owner → error.
export function getChampionshipRegistrationKey({ championshipId }) {
  return supabase.rpc('get_championship_registration_key', { p_championship_id: championshipId });
}

// Lectura mínima del campeonato propio (RLS championships_select acota al owner). Se usa para
// representar en Profile el campeonato real recién creado ("Validando pago") y su persistencia tras
// refresh. SIN escritura, SIN lógica: devuelve el { data, error } CRUDO de Supabase.
// update_championship_privacy(RPC): el OWNER persiste clave + resultados públicos (Fase 5).
// registration_key vacío/espacios → NULL en DB (nunca clave de ejemplo). Solo estados gestionables por
// el owner (pending_publish / registration_open / registration_closed). Errores: 'AUTH_REQUIRED',
// 'NOT_OWNER', 'INVALID_STATE', 'CHAMPIONSHIP_NOT_FOUND'. Devuelve la fila championships actualizada.
export function updateChampionshipPrivacy({ championshipId, registrationKey, resultsPublic }) {
  return supabase.rpc('update_championship_privacy', {
    p_championship_id:  championshipId,
    p_registration_key: registrationKey,
    p_results_public:   resultsPublic,
  });
}

// update_championship_cover(RPC): el OWNER persiste nombre + cover_theme + (opcional) cover_image_path.
// cover_theme = HEX crudo. setCoverImage=false → NO toca la foto (guardar nombre/color). setCoverImage=true
// → aplica coverImagePath (path nuevo, o null para volver a solo color). El path se valida owner-scoped en
// backend. Editable salvo terminales. Errores: AUTH_REQUIRED/NOT_OWNER/INVALID_STATE/INVALID_INPUT/NOT_FOUND.
export function updateChampionshipCover({ championshipId, name, coverTheme, coverImagePath = null, setCoverImage = false }) {
  return supabase.rpc('update_championship_cover', {
    p_championship_id:  championshipId,
    p_name:             name,
    p_cover_theme:      coverTheme,
    p_cover_image_path: coverImagePath,
    p_set_cover_image:  setCoverImage,
  });
}

// publish_championship(RPC): el OWNER publica (pending_publish → registration_open + published_at).
// Exige registration_key real. NO toca payment/order. Idempotente (ya publicado → no-op).
// Errores: 'AUTH_REQUIRED', 'NOT_OWNER', 'INVALID_STATE', 'NO_REGISTRATION_KEY', 'CHAMPIONSHIP_NOT_FOUND'.
export function publishChampionshipRpc({ championshipId }) {
  return supabase.rpc('publish_championship', { p_championship_id: championshipId });
}

