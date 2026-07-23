-- ============================================================================
-- V6 · release_slot_reservation(p_reservation_id uuid, p_reason text)
-- ============================================================================
-- PUNTO ÚNICO de escritura de la liberación de una R1. Concentra TODA la lógica
-- de liberación para que manual (reserve_slots total=0) y automática (cron) usen
-- exactamente el mismo código. La ÚNICA diferencia entre ambos es p_reason.
--
-- Efecto (idéntico a la liberación manual histórica):
--   · status               = 'inactive'
--   · last_released_slots   = reserved_slots_total ANTES de liberar
--   · reserved_slots_total  = 0
--   · reserved_slots_used   = 0
--   · released_reason       = p_reason
--   · released_at           = now()
--   · game_players del grupo → counts_reserved_slot = false
--
-- SECURITY DEFINER e INTERNA: sin grant a authenticated/anon. Solo la invocan
-- funciones DEFINER de confianza (reserve_slots, expire_slot_reservations), por lo
-- que ningún cliente puede liberar una R1 ajena llamándola directamente.
--
-- No valida rol, sesión ni capacidad: liberar SIEMPRE reduce el hold, nunca falla;
-- las precondiciones (quién puede liberar / cuándo) viven en los llamadores.
--
-- IDEMPOTENTE: solo libera si la R1 está actualmente status='active'. Si ya está
-- inactive (o el id no existe) NO modifica ningún campo (ni released_at, ni
-- released_reason, ni last_released_slots) y tampoco toca game_players.
-- ============================================================================

create or replace function public.release_slot_reservation(p_reservation_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Solo se libera una R1 ACTIVA. En un único UPDATE: last_released_slots toma el
  -- valor VIEJO de reserved_slots_total (todos los RHS se evalúan sobre la fila
  -- previa) y reserved_slots_total pasa a 0.
  update public.game_slot_reservations
     set status               = 'inactive',
         last_released_slots  = reserved_slots_total,
         reserved_slots_total = 0,
         reserved_slots_used  = 0,
         released_reason      = p_reason,
         released_at          = now(),
         updated_at           = now()
   where id = p_reservation_id
     and status = 'active';

  -- Si no había una R1 ACTIVA con ese id, no se liberó nada → idempotente: no se
  -- toca game_players ni ningún otro campo.
  if not found then
    return;
  end if;

  -- Los game_players del grupo dejan de consumir cupos reservados. SOLO ese flag:
  -- no se tocan game_slot_reservation_id, status, reservation_id, invited_by ni
  -- referred_by_user_id (idéntico a la liberación manual histórica).
  update public.game_players
     set counts_reserved_slot = false
   where game_slot_reservation_id = p_reservation_id
     and counts_reserved_slot = true;
end;
$$;

revoke all on function public.release_slot_reservation(uuid, text) from public;
revoke all on function public.release_slot_reservation(uuid, text) from anon;
revoke all on function public.release_slot_reservation(uuid, text) from authenticated;
