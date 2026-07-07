-- ============================================================================
-- FASE 3 — Retención DURA de cupos. Reutiliza el guard de capacidad EXISTENTE.
-- ============================================================================
-- NO crea trigger ni función nuevos: modifica public.enforce_capacity() (usada
-- por el trigger enforce_game_capacity) para incorporar `held`. Se conserva TODO
-- lo demás: firma, SECURITY DEFINER, search_path, BEFORE INSERT/UPDATE, el
-- FOR UPDATE sobre games, el conteo de confirmados y el mismo RAISE 'GAME_FULL'.
--
-- Único cambio: el término de capacidad ahora es  v_count + v_held  en vez de
-- v_count. held = SUM(reserved_slots_remaining) de grupos ACTIVOS, EXCLUYENDO el
-- propio grupo del jugador (id IS DISTINCT FROM NEW.game_slot_reservation_id):
--   - Público (game_slot_reservation_id NULL) → compite contra el held de TODOS.
--   - Miembro de un grupo → compite contra el held de los DEMÁS grupos.
-- Sin reservas activas → held = 0 → comportamiento IDÉNTICO al actual.
--
-- ── BACKUP de la definición de producción (para revertir) ────────────────────
-- CREATE OR REPLACE FUNCTION public.enforce_capacity()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path TO 'public'
-- AS $function$
-- DECLARE
--   v_spots INTEGER;
--   v_count INTEGER;
-- BEGIN
--   IF NEW.status IS DISTINCT FROM 'confirmed' THEN
--     RETURN NEW;
--   END IF;
--
--   SELECT COALESCE(total_spots, 0)
--   INTO v_spots
--   FROM games
--   WHERE id = NEW.game_id
--   FOR UPDATE;
--
--   SELECT COUNT(*)
--   INTO v_count
--   FROM game_players
--   WHERE game_id = NEW.game_id
--     AND status = 'confirmed'
--     AND id IS DISTINCT FROM NEW.id;
--
--   IF v_count >= v_spots THEN
--     RAISE EXCEPTION 'GAME_FULL game_id=% current=% capacity=%',
--       NEW.game_id, v_count, v_spots;
--   END IF;
--
--   RETURN NEW;
-- END;
-- $function$;
-- ============================================================================

-- Limpieza defensiva: elimina el guard paralelo de una iteración previa, si se
-- llegó a crear. No afecta al guard de producción (enforce_game_capacity).
drop trigger if exists trg_game_players_reservation_capacity on public.game_players;
drop function if exists public.enforce_reservation_capacity();

-- ── Función de producción, con held incorporado ──────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_spots INTEGER;
  v_count INTEGER;
  v_held  INTEGER;
BEGIN
  IF NEW.status IS DISTINCT FROM 'confirmed' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(total_spots, 0)
  INTO v_spots
  FROM games
  WHERE id = NEW.game_id
  FOR UPDATE;

  SELECT COUNT(*)
  INTO v_count
  FROM game_players
  WHERE game_id = NEW.game_id
    AND status = 'confirmed'
    AND id IS DISTINCT FROM NEW.id;

  -- held: capacidad garantizada aún NO usada por grupos que RETIENEN cupos
  -- (SOLO status='active'; released/expired/canceled no retienen), excluyendo el
  -- propio grupo del jugador. Con game_slot_reservation_id NULL (público),
  -- "id IS DISTINCT FROM NULL" es TRUE para todos → held de todos los grupos activos.
  SELECT COALESCE(SUM(reserved_slots_remaining), 0)
  INTO v_held
  FROM game_slot_reservations
  WHERE game_id = NEW.game_id
    AND status = 'active'
    AND id IS DISTINCT FROM NEW.game_slot_reservation_id;

  IF v_count + v_held >= v_spots THEN
    RAISE EXCEPTION 'GAME_FULL game_id=% current=% capacity=%',
      NEW.game_id, v_count, v_spots;
  END IF;

  RETURN NEW;
END;
$function$;
