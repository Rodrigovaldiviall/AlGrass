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
