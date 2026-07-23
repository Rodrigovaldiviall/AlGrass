-- ============================================================================
-- V6 · get_pending_slot_expiry() — R1 pendiente de notificar su expiración
-- ============================================================================
-- El BACKEND determina qué evento está pendiente (mismo principio que Rating): el
-- front solo renderiza. Devuelve como MUCHO una R1 (la más antigua sin notificar),
-- ya filtrada por:
--   · reserved_by_user_id = auth.uid()   (la propia)
--   · released_reason = 'automatic'      (expiró por el cron)
--   · expiry_notified_at IS NULL         (popup no mostrado aún)
--   · partido AÚN NO iniciado            (game_start > now(), America/Lima)
--
-- SECURITY DEFINER: se salta la RLS de game_slot_reservations pero se acota
-- explícitamente a auth.uid(). SOLO LECTURA. Con auth.uid() null → 0 filas.
-- ============================================================================

create or replace function public.get_pending_slot_expiry()
returns table (reservation_id uuid, game_id uuid)
language sql
security definer
set search_path = public
as $$
  select gsr.id, gsr.game_id
    from public.game_slot_reservations gsr
    join public.games g on g.id = gsr.game_id
   where gsr.reserved_by_user_id = auth.uid()
     and gsr.released_reason    = 'automatic'
     and gsr.expiry_notified_at is null
     and (g.date_key + g.time) at time zone 'America/Lima' > now()   -- aún no comenzó
   order by gsr.released_at asc nulls last
   limit 1;
$$;

grant execute on function public.get_pending_slot_expiry() to authenticated;
