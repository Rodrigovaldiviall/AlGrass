-- ============================================================================
-- cancel_guest_players(p_game_id, p_user_ids[]) — cancelación de guests + R1 propia
-- ============================================================================
-- Cancela guests PAGADOS por el llamador y libera la R1 PROPIA de cada jugador
-- realmente cancelado, en UNA sola transacción (todo o nada). Corrige el bug:
-- cuando el payer cancela a un guest que es capitán y dueño de una R1 active, esa
-- R1 quedaba active huérfana reteniendo capacidad.
--
-- Efecto atómico:
--   1) Claim: cancela SOLO los game_players 'confirmed' cuyo payer_id = auth.uid()
--      (autorización server-side: el payer solo puede cancelar a quien él paga; los
--      user_ids ajenos no coinciden). RETURNING → conjunto realmente transicionado
--      (idempotente: una fila ya 'canceled' no vuelve a procesarse).
--   2) Por CADA jugador realmente cancelado libera EXCLUSIVAMENTE su R1 PROPIA:
--      game_slot_reservations.reserved_by_user_id = user_id del cancelado, active.
--      NUNCA por game_players.game_slot_reservation_id (puede ser la R1 de otro cuyo
--      cupo consumió). Reutiliza la primitiva canónica release_slot_reservation
--      (idempotente, solo 'active') → R1 inactive, totales 0, last_released_slots,
--      released_reason/at, y counts_reserved_slot=false de sus miembros (que siguen
--      confirmed). Idéntico al self-cancel; no hay segunda lógica de liberación.
--
-- NO toca refund/wallet/reservations/notificaciones/setMatchPublishedIfEmpty:
-- esos permanecen en JS, alimentados por las filas que devuelve esta función
-- (id, user_id, amount, reservation_id).
--
-- released_reason = 'manual_cancel_participation': valor permitido por el CHECK,
-- semántica "R1 liberada porque se canceló la participación del titular".
--
-- SECURITY DEFINER: corre como su owner, por lo que puede invocar la primitiva
-- interna release_slot_reservation (revocada de authenticated). No se expone la
-- primitiva ni se permite elegir arbitrariamente qué R1 ajena liberar.
-- ============================================================================

create or replace function public.cancel_guest_players(
  p_game_id  uuid,
  p_user_ids uuid[]
)
returns table (id uuid, user_id uuid, amount numeric, reservation_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  r       record;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- 1) Claim atómico: cancelar SOLO los guests 'confirmed' que ESTE payer paga.
  --    Temp table declarada + WITH data-modifying de NIVEL SUPERIOR (patrón válido).
  create temp table _cancelled_guests (
    id             uuid,
    user_id        uuid,
    amount         numeric,
    reservation_id uuid
  ) on commit drop;

  with upd as (
    update public.game_players gp
       set status               = 'canceled',
           canceled_at          = now(),
           counts_reserved_slot = false
     where gp.game_id  = p_game_id
       and gp.user_id  = any (coalesce(p_user_ids, '{}'::uuid[]))
       and gp.payer_id = v_actor
       and gp.status   = 'confirmed'
    returning gp.id, gp.user_id, gp.amount, gp.reservation_id
  )
  insert into _cancelled_guests (id, user_id, amount, reservation_id)
  select upd.id, upd.user_id, upd.amount, upd.reservation_id from upd;

  -- 2) Liberar la R1 PROPIA de cada guest realmente cancelado. Identificación
  --    EXCLUSIVA por reserved_by_user_id = user_id del cancelado. Idempotente.
  for r in
    select gsr.id
      from _cancelled_guests c
      join public.game_slot_reservations gsr
        on gsr.game_id             = p_game_id
       and gsr.reserved_by_user_id = c.user_id
       and gsr.status              = 'active'
  loop
    perform public.release_slot_reservation(r.id, 'manual_cancel_participation');
  end loop;

  -- 3) Devolver las filas realmente canceladas → refund/wallet/notificaciones en JS.
  return query
    select c.id, c.user_id, c.amount, c.reservation_id from _cancelled_guests c;
end;
$$;

-- Ejecutable desde el cliente: la autorización (payer_id = auth.uid()) se valida
-- DENTRO de la función. No se expone la primitiva interna release_slot_reservation.
revoke all on function public.cancel_guest_players(uuid, uuid[]) from public;
revoke all on function public.cancel_guest_players(uuid, uuid[]) from anon;
grant execute on function public.cancel_guest_players(uuid, uuid[]) to authenticated;
