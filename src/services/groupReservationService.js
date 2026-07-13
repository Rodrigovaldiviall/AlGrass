import { supabase } from '../lib/supabase';

// ============================================================================
// carriedGroup(actor, gameId)
// ============================================================================
// Grupo (game_slot_reservation_id) que el ACTOR propaga a los jugadores que
// inscribe (invitados / pagados). Es la fuente de "herencia" del algoritmo
// congelado. SOLO LECTURA: no escribe nada, no toca reserved_slots_used.
//
// El `actor` es siempre el usuario autenticado que produce la inscripción
// (pagador / invitador), coherente con la tabla funcional congelada.
//
// Algoritmo funcional (orden estricto):
//   1) LIDERAZGO — la reserva que el actor lidera actualmente para ese partido,
//      independiente del estado (ACTIVE/RELEASED/EXPIRED/CANCELED). Si lidera
//      alguna → su id.  (Por las reglas del modelo —una sola reutilizable, R3
//      solo nace cuando la anterior deja de serlo— esa reserva coincide hoy con
//      la creada más recientemente; eso es CONSECUENCIA del modelo, no la regla.)
//   2) PERTENENCIA — si no lidera, el game_slot_reservation_id de su fila
//      CONFIRMED en el partido (puede ser null → público).
//   3) null.
//
// Suposición (ya acordada): el actor tiene una sola fila `confirmed` por partido.
//
// NO conectado todavía. Punto de conexión futuro: handlePaid, para resolver el
// gameSlotReservationId de cada invitado ANTES de llamar a createGamePlayer.
// ============================================================================
export async function carriedGroup(actor, gameId) {
  if (!supabase || !actor || !gameId) return null;

  // 1) Liderazgo: la reserva que el actor lidera actualmente (cualquier estado).
  const { data: led } = await supabase
    .from('game_slot_reservations')
    .select('id')
    .eq('game_id', gameId)
    .eq('reserved_by_user_id', actor)
    .order('created_at', { ascending: false })
    .limit(1);
  if (led?.[0]?.id) return led[0].id;

  // 2) Pertenencia: game_slot_reservation_id de la fila confirmed del actor.
  const { data: membership } = await supabase
    .from('game_players')
    .select('game_slot_reservation_id')
    .eq('game_id', gameId)
    .eq('user_id', actor)
    .eq('status', 'confirmed')
    .limit(1);

  // 3) null si no lidera ni tiene fila confirmed (o su fila no pertenece a grupo).
  return membership?.[0]?.game_slot_reservation_id ?? null;
}

// ============================================================================
// getSlotReservation(gameId) — SOLO LECTURA (Fase 1)
// ============================================================================
// Snapshot para la UX "Reserva de cupos": reserva reutilizable del usuario (si
// existe) + pool público. Todos los números vienen del backend (RPC DEFINER);
// React no recalcula nada. Si no hay reserva → estado vacío (0).
export async function getSlotReservation(gameId) {
  if (!supabase || !gameId) return null;
  const { data, error } = await supabase.rpc('get_slot_reservation', { p_game_id: gameId });
  if (error) { console.error('[getSlotReservation]', error); return null; }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { hasReservation: false, reservationId: null, status: null, total: 0, used: 0, remaining: 0, pool: 0 };
  return {
    hasReservation: !!row.has_reservation,
    reservationId:  row.reservation_id ?? null,
    status:         row.status ?? null,
    total:          row.reserved_slots_total ?? 0,
    used:           row.reserved_slots_used ?? 0,
    remaining:      row.reserved_slots_remaining ?? 0,
    pool:           row.pool ?? 0,
  };
}
