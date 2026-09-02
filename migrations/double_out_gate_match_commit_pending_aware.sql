-- ============================================================================
-- Doble salida · Paso 3 (definitivo) — GATE ATÓMICO del primer compromiso Match
-- ============================================================================
-- Basada EXACTAMENTE en el draft double_out_gate_match_commit.sql. Mantiene toda su
-- lógica y AÑADE una única defensa: si A sigue 'published' y el gemelo Rental tiene
-- un Order PENDING VIVO, se rechaza con ALTERNATIVE_TAKEN. Así se preserva la regla
-- "el primer PENDING de CUALQUIER lado gana temporalmente la carrera" también en el
-- punto de commit (mismo criterio de PENDING vivo que create_order:
-- status='pending' AND pending_expires_at > now()).
--
-- Efecto: en el flujo Match-confirm normal es inocuo (B nunca tiene PENDING mientras
-- A tiene el suyo, por el 7b de create_order); solo impide que una inserción de
-- game_player SIN Order (p.ej. Admin algrass_add_free_player) le robe la carrera a un
-- PENDING Rental vivo. La lectura de orders es CONSISTENTE porque ocurre bajo el lock
-- A+B (create_order lockea A+B antes de insertar un PENDING → serializan).
--
-- Posterior a: double_out_phase1.sql, double_out_block_on_reserved.sql (Paso 1),
-- double_out_reopen_on_release.sql (Paso 2). Reemplaza al draft no aplicado
-- double_out_gate_match_commit.sql (trg_step3=false).
--
-- Elimina el estado inconsistente "Match blocked + game_player confirmed": hoy
-- createGamePlayer INSERTA en una tx y setMatchReserved ocurre en OTRA. Este trigger
-- BEFORE hace que, en la MISMA transacción del INSERT/UPDATE que deja un game_player
-- 'confirmed': si A es perdedor → RAISE (rollback del insert, sin huérfano); si es el
-- primer compromiso de un Match published con pareja → A published→reserved (dispara
-- Paso 1, que sella el gemelo B a 'blocked').
--
-- ALCANCE: SOLO este gate. NO toca create_order/PENDING, Paso 1/2, claim Rental,
-- materializeReservation, confirm_order, R1, capacidad, credit/invited/addGuests ni
-- Admin. createGamePlayer no se modifica; setMatchReserved queda redundante (no-op).
--
-- ⚠️ CONCURRENCIA (pendiente de auditoría APARTE, no en este paso): el commit Rental
-- (createReservation: update B→reserved → dispara Paso 1 → lockea A) lockea B→A,
-- mientras este gate lockea A→B (order by id). Dos compromisos Match↔Rental
-- EXACTAMENTE simultáneos con A.id<B.id pueden resolverse por DEADLOCK (Postgres
-- aborta uno; correctitud intacta). El PENDING guard ya aplicado impide que ambos
-- lados tengan PENDING a la vez, así que el residuo es Admin-Match-add vs
-- Rental-confirm (raro, auto-resuelto). La serialización limpia (claim Rental
-- pre-lockeando A+B por id) se tratará DESPUÉS.
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
  -- Reactivación/idempotencia: si ya estaba 'confirmed', no es compromiso nuevo
  -- (cubre las UPDATE de adopción de R1, que mantienen status='confirmed').
  if tg_op = 'UPDATE' and old.status = 'confirmed' then
    return new;
  end if;

  -- Game del player.
  select * into v_game from public.games where id = new.game_id;
  if not found then
    return new;  -- sin game (no debería ocurrir); no interferir.
  end if;

  -- Defensa secundaria (commit tardío) · FAST-PATH: game ya CANCELADO antes de que corra
  -- el gate (cancelación completada). 'canceled' es terminal → la lectura sin lock basta;
  -- además es el ÚNICO punto que ataja un DOBLE SALIDA ya cancelado (que si no retornaría
  -- NEW en '<> published' antes de tomar lock). La CARRERA published→cancel→commit se
  -- cierra con las re-validaciones BAJO LOCK de más abajo (singleton y par). No altera
  -- paused/draft/blocked/reserved/published.
  if v_game.status = 'canceled' then
    raise exception 'GAME_CANCELED';
  end if;

  -- ── FAST PATHS ───────────────────────────────────────────────────────────
  if v_game.alternative_game_id is null then
    -- Re-validación conservadora BAJO lock (misma garantía que create_order): A pudo
    -- emparejarse (create_double_out) entre el SELECT sin lock de arriba y aquí. Se
    -- lockea y re-lee SOLO A — NUNCA el gemelo, para no romper el orden determinista
    -- A+B del primer compromiso (mantendríamos A y pediríamos B, invirtiendo el orden).
    select * into v_game from public.games where id = new.game_id for update;
    -- Re-validación autoritativa BAJO lock (reusa la FUENTE ÚNICA assert_game_reservable):
    -- published/reserved pasan; draft/paused/canceled/completed/expired/iniciado → rechazo.
    -- Cierra la carrera published/reserved→no-reservable durante confirm. Un singleton nunca
    -- está 'blocked', así que no hay conflicto con ALTERNATIVE_TAKEN.
    perform public.assert_game_reservable(new.game_id, v_game.type);
    if v_game.alternative_game_id is null then
      return new;                         -- sigue singleton: comportamiento actual intacto.
    end if;
    -- Apareció un gemelo bajo el lock → NO continuar como singleton. Abortar conservador
    -- (rollback del INSERT/UPDATE, sin huérfano); el reintento leerá la pareja desde el
    -- inicio y la adjudicará por el camino de primer compromiso.
    raise exception 'ALTERNATIVE_TAKEN';
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

  -- Re-validación autoritativa BAJO lock A+B (reusa la FUENTE ÚNICA). Cierra la carrera
  -- published→(draft/paused/canceled/completed/expired/iniciado) durante confirm. 'blocked'
  -- va ANTES para conservar su error específico ALTERNATIVE_TAKEN; 'reserved' pasa el assert
  -- (es reservable) pero queda validado contra iniciado/tipo; solo 'published' continúa a la
  -- adjudicación.
  if v_game.status = 'blocked' then
    raise exception 'ALTERNATIVE_TAKEN';  -- el gemelo ganó entre medias.
  end if;
  perform public.assert_game_reservable(new.game_id, v_game.type);
  if v_game.status = 'reserved' then
    return new;                           -- otro insert del propio A ya lo adjudicó.
  end if;

  -- El gemelo ya comprometido físicamente → nunca doble compromiso.
  if v_twin.status in ('reserved', 'blocked')
     or v_twin.booked_by_user_id is not null then
    raise exception 'ALTERNATIVE_TAKEN';
  end if;

  -- DEFENSA AÑADIDA (Paso 3): el gemelo tiene un Order PENDING VIVO → ese lado ya
  -- ganó TEMPORALMENTE la carrera. A no puede adjudicarse el compromiso todavía.
  -- Bajo el lock A+B (consistente con create_order, que lockea A+B antes de insertar
  -- su PENDING). Inocuo en Match-confirm (B no puede tener PENDING mientras A tiene el
  -- suyo, por el 7b); relevante solo para inserciones sin Order (p.ej. Admin).
  if exists (
    select 1 from public.orders o
     where o.resource_id = v_twin.id
       and o.status = 'pending'
       and o.pending_expires_at > now()
  ) then
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
