-- ============================================================================
-- V6 — Mantenimiento automático de reserved_slots_used (derivado por COUNT)
-- ============================================================================
-- reserved_slots_used SIEMPRE es un valor derivado:
--   COUNT(game_players WHERE game_slot_reservation_id = R1
--         AND status = 'confirmed' AND counts_reserved_slot = true)
--
-- Diseño (decisión congelada):
--   · La LÓGICA del conteo vive en UNA única función reutilizable:
--       rebuild_reserved_slots_used(p_game_slot_reservation_id)
--     Recomputa por COUNT (nunca ++ / --); es idempotente y autosanable.
--   · Un TRIGGER sobre game_players SOLO INVOCA esa función cuando un cambio
--     puede afectar el conteo (INSERT, DELETE, o UPDATE de gsr_id/status/counts).
--     El trigger NO contiene la lógica del COUNT.
--
-- No modifica createGamePlayer, reserve_slots, get_slot_reservation, cancelaciones
-- ni ninguna otra responsabilidad. Solo añade la mantención del contador.
-- Sin recursión: el trigger es sobre game_players y escribe game_slot_reservations.
-- ============================================================================

-- ── Función reutilizable: recomputa reserved_slots_used por COUNT ─────────────
create or replace function public.rebuild_reserved_slots_used(p_game_slot_reservation_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.game_slot_reservations gsr
     set reserved_slots_used = (
       select count(*)::integer
         from public.game_players gp
        where gp.game_slot_reservation_id = p_game_slot_reservation_id
          and gp.status = 'confirmed'
          and gp.counts_reserved_slot = true
     )
   where gsr.id = p_game_slot_reservation_id;
$$;

-- ── Función del trigger: SOLO invoca; sin lógica de conteo ────────────────────
create or replace function public.trg_rebuild_reserved_slots_used()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.rebuild_reserved_slots_used(old.game_slot_reservation_id);
    return old;
  end if;

  -- UPDATE que NO puede afectar el conteo → no se recomputa.
  if tg_op = 'UPDATE'
     and new.game_slot_reservation_id is not distinct from old.game_slot_reservation_id
     and new.status                   is not distinct from old.status
     and new.counts_reserved_slot     is not distinct from old.counts_reserved_slot then
    return new;
  end if;

  -- INSERT o UPDATE relevante: recomputar el grupo destino.
  perform public.rebuild_reserved_slots_used(new.game_slot_reservation_id);

  -- Si en un UPDATE la fila cambió de grupo (pertenencia), recomputar también el origen.
  if tg_op = 'UPDATE'
     and old.game_slot_reservation_id is distinct from new.game_slot_reservation_id then
    perform public.rebuild_reserved_slots_used(old.game_slot_reservation_id);
  end if;

  return new;
end;
$$;

-- ── Trigger sobre game_players ───────────────────────────────────────────────
drop trigger if exists trg_game_players_reserved_slots_used on public.game_players;

create trigger trg_game_players_reserved_slots_used
  after insert or update or delete on public.game_players
  for each row execute function public.trg_rebuild_reserved_slots_used();
