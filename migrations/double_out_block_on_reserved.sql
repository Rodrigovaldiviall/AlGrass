-- ============================================================================
-- Doble salida · Fase 2 · Paso 1 — bloquear el gemelo al primer published→reserved
-- ============================================================================
-- Posterior a double_out_phase1.sql (requiere: columnas alternative_game_id /
-- overlap_group / blocked_from_status, y estados 'paused'/'blocked' en
-- games_status_check).
--
-- NO cambia el mecanismo actual de reservas: A sigue pasando published→reserved
-- EXACTAMENTE igual. Solo se AÑADE una consecuencia: si A pertenece a una Doble
-- salida, su gemelo B pasa a 'blocked' (guardando su estado manual previo en
-- blocked_from_status), en la MISMA transacción.
--
-- Se dispara SOLO en la PRIMERA transición published→reserved de un game con
-- pareja (WHEN abajo). Un singleton, o los jugadores 2/3/4… de un Match ya
-- 'reserved', NO ejecutan nada (el WHEN ya no se cumple).
--
-- Este Paso 1 NO resuelve la carrera simultánea Match vs Rental (siguiente paso).
-- No toca: create_order, PENDING, pagos, crédito/free, R1, game_players,
-- reservations, materializeReservation, cancelaciones, reapertura, Admin,
-- overlap_group ni RPCs existentes.
-- ============================================================================

create or replace function public.block_double_out_twin_on_reserve()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_twin public.games%rowtype;
begin
  -- Gemelo (lock de fila para lectura/escritura consistente dentro de la tx).
  select * into v_twin
    from public.games
   where id = new.alternative_game_id
   for update;

  -- Vínculo roto (gemelo inexistente o relación NO bidireccional): fallo
  -- explícito. Preferimos abortar A antes que bloquear una fila incorrecta.
  if not found or v_twin.alternative_game_id is distinct from new.id then
    raise exception 'DOUBLE_OUT_LINK_BROKEN';
  end if;

  -- Estado peligroso: el gemelo ya ganó el inventario físico → nunca permitir
  -- que A quede reserved a la vez (doble reserva del mismo slot). Aborta A.
  if v_twin.status = 'reserved' or v_twin.booked_by_user_id is not null then
    raise exception 'ALTERNATIVE_TAKEN';

  -- Estados "libres/aún ofertables": se sellan a 'blocked' recordando el previo.
  elsif v_twin.status in ('published', 'paused', 'draft') then
    update public.games
       set blocked_from_status = v_twin.status,
           status              = 'blocked'
     where id = v_twin.id;

  -- 'blocked' (ya sellado por una victoria previa de A) y terminales
  -- (canceled/completed/expired) → NO-OP: no se re-escribe blocked_from_status
  -- ni se toca el histórico.
  end if;

  return null;  -- AFTER trigger: el valor de retorno se ignora.
end;
$$;

-- AFTER UPDATE OF status: solo cuando el UPDATE toca la columna status, y el WHEN
-- restringe a la PRIMERA transición published→reserved de un game con pareja.
-- Sin recursión: la escritura sobre el gemelo lo lleva a 'blocked' (no 'reserved'),
-- así que NO vuelve a cumplir el WHEN.
create or replace trigger trg_block_double_out_twin
  after update of status on public.games
  for each row
  when (
    old.status = 'published'
    and new.status = 'reserved'
    and new.alternative_game_id is not null
  )
  execute function public.block_double_out_twin_on_reserve();
