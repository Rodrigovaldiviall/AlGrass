-- ============================================================================
-- V6 · mark_slot_reservation_notified(p_reservation_id uuid)
-- ============================================================================
-- Marca una R1 auto-expirada como "popup ya mostrado" (expiry_notified_at = now()).
-- Análogo a markPopupShown() de Rating: guard atómico is null → nunca re-muestra y
-- es idempotente. SECURITY DEFINER acotado a la R1 PROPIA del actor (auth.uid()),
-- así ningún usuario puede marcar la de otro. game_slot_reservations no es escribible
-- por el cliente directamente, por eso esta RPC es el único punto de escritura.
--
-- Solo toca expiry_notified_at; no cambia estado, cupos, released_reason ni nada más.
-- ============================================================================

create or replace function public.mark_slot_reservation_notified(p_reservation_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.game_slot_reservations
     set expiry_notified_at = now()
   where id = p_reservation_id
     and reserved_by_user_id = auth.uid()
     and released_reason = 'automatic'
     and expiry_notified_at is null;
$$;

grant execute on function public.mark_slot_reservation_notified(uuid) to authenticated;
