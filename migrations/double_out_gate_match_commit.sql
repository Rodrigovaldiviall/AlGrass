-- ============================================================================
-- Doble salida · Fase 2 · Paso 3 — GATE ATÓMICO del primer compromiso Match
-- ============================================================================
-- Posterior a: double_out_phase1.sql, double_out_block_on_reserved.sql (Paso 1),
-- double_out_reopen_on_release.sql (Paso 2).
--
-- Elimina definitivamente el estado "Match blocked + game_player confirmed",
-- causado porque hoy createGamePlayer INSERTA primero y setMatchReserved ocurre
-- después en OTRA transacción.
--
-- Este trigger BEFORE sobre game_players hace que, en la MISMA transacción del
-- INSERT/UPDATE que deja un game_player en 'confirmed':
--   · si es el PRIMER compromiso de un Match con pareja → A published→reserved
--     (esto dispara trg_block_double_out_twin, que sella el gemelo B a 'blocked'),
--   · si el gemelo ya ganó → RAISE 'ALTERNATIVE_TAKEN' (no queda player huérfano).
-- INSERT game_player + A→reserved + B→blocked forman una sola transacción; si
-- algo falla, rollback completo y NO queda game_player confirmed.
--
-- ALCANCE: SOLO este gate. NO toca create_order/PENDING, ni el claim Rental, ni
-- materializeReservation, ni confirm_order, ni mensajes App, ni refunds.
-- createGamePlayer no se modifica; setMatchReserved queda redundante (no-op).
--
-- ⚠️ CONCURRENCIA (ver nota al pie): con Rental TODAVÍA sin modificar, dos
-- compromisos Match↔Rental EXACTAMENTE simultáneos pueden resolverse por DEADLOCK
-- (Postgres aborta uno). La correctitud se mantiene (nunca doble compromiso ni
-- huérfano), pero la resolución limpia por orden determinista llega cuando el
-- claim Rental pre-lockee A+B por id (paso siguiente, NO incluido aquí).
-- ============================================================================

create or replace function public.gate_match_double_out_commit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_twin public.games%rowtype;
begin
  -- Solo actúa sobre el COMPROMISO real (fila que queda 'confirmed').
  if new.status is distinct from 'confirmed' then
    return new;
  end if;
  -- Reactivación/idempotencia: si ya estaba 'confirmed', no es compromiso nuevo.
  if tg_op = 'UPDATE' and old.status = 'confirmed' then
    return new;
  end if;

  -- Game del player.
  select * into v_game from public.games where id = new.game_id;
  if not found then
    return new;  -- sin game (no debería ocurrir); no interferir.
  end if;

  -- ── FAST PATHS (antes de cualquier lock) ─────────────────────────────────
  if v_game.alternative_game_id is null then
    return new;                           -- singleton: comportamiento actual intacto.
  end if;
  if v_game.status = 'reserved' then
    return new;                           -- jugadores 2/3/4… del Match ya ganador.
  end if;
  if v_game.status = 'blocked' then
    raise exception 'ALTERNATIVE_TAKEN';  -- perdedor: nunca un confirmed dentro.
  end if;
  if v_game.status <> 'published' then
    return new;                           -- draft/paused/canceled/… no es el 1er compromiso Doble salida.
  end if;

  -- ── PRIMER COMPROMISO: A published + con pareja ──────────────────────────
  -- Lock determinista A+B por id (dentro de la tx del INSERT/UPDATE).
  perform 1 from public.games
   where id in (new.game_id, v_game.alternative_game_id)
   order by id
   for update;

  -- Re-leer estados DESPUÉS del lock (pudieron cambiar antes de obtenerlo).
  select * into v_game from public.games where id = new.game_id;
  select * into v_twin from public.games where id = v_game.alternative_game_id;

  -- Relación bidireccional válida.
  if not found or v_twin.alternative_game_id is distinct from new.game_id then
    raise exception 'DOUBLE_OUT_LINK_BROKEN';
  end if;

  -- Re-evaluar A tras el lock.
  if v_game.status = 'reserved' then
    return new;                           -- otro insert del propio A ya lo adjudicó.
  end if;
  if v_game.status = 'blocked' then
    raise exception 'ALTERNATIVE_TAKEN';  -- el gemelo ganó entre medias.
  end if;
  if v_game.status <> 'published' then
    return new;
  end if;

  -- El gemelo ya comprometido → nunca doble compromiso.
  if v_twin.status in ('reserved', 'blocked')
     or v_twin.booked_by_user_id is not null then
    raise exception 'ALTERNATIVE_TAKEN';
  end if;

  -- Adjudicación atómica: A published→reserved. Dispara trg_block_double_out_twin
  -- (Paso 1), que sella B a 'blocked' guardando blocked_from_status. Después, al
  -- retornar NEW, el INSERT/UPDATE del game_player se materializa en la misma tx.
  update public.games
     set status = 'reserved'
   where id = new.game_id and status = 'published';

  return new;
end;
$$;

-- BEFORE INSERT OR UPDATE: cubre el insert nuevo y la reactivación canceled→confirmed.
-- La lógica interna filtra por new.status='confirmed' (y salta si ya lo era).
create or replace trigger trg_gate_match_double_out_commit
  before insert or update on public.game_players
  for each row
  execute function public.gate_match_double_out_commit();
