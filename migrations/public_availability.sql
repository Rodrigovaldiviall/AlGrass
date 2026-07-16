-- ============================================================================
-- V6 — public_availability(p_game_id) : FUENTE ÚNICA de la disponibilidad pública
-- ============================================================================
-- Disponibilidad pública = total_spots − confirmados − held, con:
--   total_spots = coalesce(games.total_spots, fields.total_spots)
--   confirmados = COUNT(game_players WHERE status = 'confirmed')
--   held        = SUM(reserved_slots_remaining) de grupos ACTIVE
--
-- Reutiliza DIRECTAMENTE reserved_slots_remaining (columna GENERATED STORED, ya
-- mantenida por el trigger de reserved_slots_used). NO recalcula total − used:
-- remaining es la fuente de verdad y evita una tercera copia de esa fórmula.
--
-- Es la MISMA fórmula que hoy calcula get_slot_reservation.pool (que pasa a
-- llamar a este helper) y equivalente a la de enforce_capacity para un jugador
-- público. NO toca enforce_capacity, reserve_slots, triggers ni reglas de negocio.
--
-- SECURITY DEFINER: game_slot_reservations tiene RLS select-own; para sumar el
-- held de TODOS los grupos activos (no solo los propios) hay que saltar la RLS,
-- igual que get_slot_reservation.
-- ============================================================================

create or replace function public.public_availability(p_game_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    coalesce((
      select coalesce(g.total_spots, f.total_spots)
        from public.games g
        left join public.fields f on f.id = g.field_id
       where g.id = p_game_id
    ), 0)
    - (
      select count(*)::integer
        from public.game_players gp
       where gp.game_id = p_game_id
         and gp.status = 'confirmed'
    )
    - coalesce((
      select sum(gsr.reserved_slots_remaining)::integer
        from public.game_slot_reservations gsr
       where gsr.game_id = p_game_id
         and gsr.status = 'active'
    ), 0),
    0
  );
$$;

grant execute on function public.public_availability(uuid) to authenticated, anon;
