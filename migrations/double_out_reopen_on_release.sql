-- ============================================================================
-- Doble salida · Fase 2 · Paso 2 — reabrir el gemelo cuando el ganador se libera
-- ============================================================================
-- Posterior a double_out_phase1.sql y double_out_block_on_reserved.sql.
--
-- Simétrico al Paso 1: cuando el game ganador A DEJA de estar reservado y libera
-- físicamente el horario futuro, su gemelo B (que A había sellado a 'blocked')
-- se RESTAURA a su estado manual previo (blocked_from_status), en la MISMA
-- transacción del cambio de estado de A.
--
-- Transiciones que reabren (A pierde el slot FUTURO):
--   reserved → published   (Match: último jugador cancelado · Rental: self-cancel)
--   reserved → canceled    (Admin: cancel_match / cancel_rental; slot queda libre)
-- NO reabren (slot ya pasado/consumido): reserved → completed / expired.
--
-- Restauración: B.status = B.blocked_from_status; B.blocked_from_status = NULL.
-- SOLO si B sigue 'blocked' y blocked_from_status es published/paused/draft.
--
-- A diferencia del Paso 1, aquí NUNCA se hace RAISE: una operación de liberación
-- (cancelación) no debe abortar por un gemelo inconsistente. Vínculo roto o B no
-- 'blocked' → no-op silencioso (seguro; no pisa otra pareja ni un estado nuevo).
--
-- No toca: create_order, PENDING, pagos, crédito/free, R1, game_players,
-- reservations, overlap_group, ni rompe la pareja (alternative_game_id intacto).
-- ============================================================================

create or replace function public.reopen_double_out_twin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_twin public.games%rowtype;
begin
  -- Gemelo (lock de fila para consistencia dentro de la tx).
  select * into v_twin
    from public.games
   where id = new.alternative_game_id
   for update;

  -- Vínculo roto o gemelo inexistente → NO-OP (no abortar una liberación; no
  -- tocar una fila que ya no es la pareja de A).
  if not found or v_twin.alternative_game_id is distinct from new.id then
    return null;
  end if;

  -- Restaurar SOLO si B sigue sellado por A ('blocked') Y su estado previo es uno
  -- de los válidos ('published'/'paused'/'draft'). NO se asume 'published': si
  -- blocked_from_status es NULL o cualquier valor inesperado → NO-OP (no publicar
  -- automáticamente nada). Si B ya no está blocked → tampoco se toca (idempotente).
  if v_twin.status = 'blocked'
     and v_twin.blocked_from_status in ('published', 'paused', 'draft') then
    update public.games
       set status              = v_twin.blocked_from_status,
           blocked_from_status = null
     where id = v_twin.id;
  end if;

  return null;  -- AFTER trigger: el valor de retorno se ignora.
end;
$$;

-- AFTER UPDATE OF status: solo cuando el UPDATE toca status, y el WHEN restringe a
-- la liberación de un game con pareja (reserved → published|canceled).
-- Sin recursión: la restauración lleva a B a published/paused/draft (nunca a
-- 'reserved'), así que NO cumple el WHEN de este trigger ni el del Paso 1.
create or replace trigger trg_reopen_double_out_twin
  after update of status on public.games
  for each row
  when (
    old.status = 'reserved'
    and new.status in ('published', 'canceled')
    and new.alternative_game_id is not null
  )
  execute function public.reopen_double_out_twin();
