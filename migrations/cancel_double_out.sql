-- ============================================================================
-- cancel_double_out — cancelación DEFINITIVA atómica de un par Doble salida
-- ============================================================================
-- Orquestadora que Admin llama SIEMPRE. Para un game SIN pareja delega tal cual en
-- cancel_match/cancel_rental (comportamiento actual intacto). Para un PAR:
--
--   1) Lock A+B por id (mismo orden determinista que el gate y claim_rental).
--   2) Reciprocidad de alternative_game_id.
--   3) Guard de Orders PENDING vivas sobre AMBOS → PAYMENT_IN_PROGRESS + rollback
--      (prioridad del PENDING; se comprueba ANTES, aparte del compromiso durable).
--   4) Compromiso DURABLE autoritativo por miembro (NO solo status='reserved'):
--      game_players confirmed · R1 activa (reserved_slots_total>0) · booked_by (rental)
--      · status='reserved'. Si AMBOS comprometidos → DOUBLE_OUT_BOTH_COMMITTED + rollback
--      (fail seguro, sin refunds, sin perder dinero).
--   5) Cancelar el gemelo VACÍO PRIMERO con UPDATE directo (sin economía): blocked/
--      published → canceled NO dispara reopen (exige old.status='reserved'). Esto impide
--      que el reserved→canceled del miembro comprometido RESUCITE al gemelo.
--   6) Cancelar el miembro COMPROMETIDO con la economía REAL existente (cancel_match/
--      cancel_rental: game_players, R1, refunds, ledger, notificaciones). NO se duplica.
--      Su reserved→canceled dispara reopen → lee el gemelo YA canceled → no-op.
--   7) Post-estado: ambos canceled, ambos blocked_from_status=null, ninguno reabrible.
--
-- NO toca: create_order/PENDING, Paso 1/2/3, R1, la semántica paused/draft/blocked, ni
-- el reopen/block. Reutiliza cancel_match/cancel_rental sin modificarlos.
-- ============================================================================

create or replace function public.cancel_double_out(
  p_game_id              uuid,
  p_cancel_reason        text,
  p_cancel_reason_detail text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor       uuid := auth.uid();
  v_a           public.games%rowtype;   -- game entrante (re-leído bajo lock)
  v_b           public.games%rowtype;   -- gemelo
  v_committed_a boolean;
  v_committed_b boolean;
  v_m_id        uuid;    -- miembro COMPROMETIDO (economía real)
  v_m_type      text;
  v_e_id        uuid;    -- gemelo VACÍO (cancelación directa)
  v_result      jsonb;
begin
  -- 1) Auth + autorización + parámetros (mismo patrón que cancel_match).
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.user_roles
     where user_id = v_actor and role in ('algrass_admin', 'algrass_staff')
  ) then raise exception 'NOT_AUTHORIZED'; end if;
  if p_game_id is null then raise exception 'INVALID_GAME_ID'; end if;
  if p_cancel_reason is null or btrim(p_cancel_reason) = '' then raise exception 'CANCEL_REASON_REQUIRED'; end if;

  -- 2) Cargar A (sin lock) para decidir singleton vs par.
  select * into v_a from public.games where id = p_game_id;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;
  if v_a.status = 'canceled' then raise exception 'ALREADY_CANCELED'; end if;

  -- 3) SINGLETON → delega tal cual (comportamiento actual intacto).
  if v_a.alternative_game_id is null then
    if v_a.type = 'rental'
      then return public.cancel_rental(p_game_id, p_cancel_reason, p_cancel_reason_detail);
      else return public.cancel_match (p_game_id, p_cancel_reason, p_cancel_reason_detail);
    end if;
  end if;

  -- 4) PAR · Lock A+B por id (orden determinista compatible con gate/claim_rental).
  perform 1 from public.games
    where id in (v_a.id, v_a.alternative_game_id) order by id for update;
  -- Re-leer bajo lock.
  select * into v_a from public.games where id = p_game_id;
  select * into v_b from public.games where id = v_a.alternative_game_id;
  if not found then raise exception 'DOUBLE_OUT_LINK_BROKEN'; end if;

  -- 5) Reciprocidad + idempotencia bajo lock.
  if v_b.alternative_game_id is distinct from v_a.id then raise exception 'DOUBLE_OUT_LINK_BROKEN'; end if;
  if v_a.status = 'canceled' then raise exception 'ALREADY_CANCELED'; end if;

  -- 6) Guard de Orders PENDING vivas sobre AMBOS (prioridad del PENDING; aparte).
  if exists (
    select 1 from public.orders o
     where o.resource_id in (v_a.id, v_b.id)
       and o.status = 'pending'
       and o.pending_expires_at > now()
  ) then raise exception 'PAYMENT_IN_PROGRESS'; end if;

  -- 7) Compromiso DURABLE autoritativo por miembro (NO solo status='reserved').
  v_committed_a :=
       v_a.status = 'reserved'
    or exists (select 1 from public.game_players gp where gp.game_id = v_a.id and gp.status = 'confirmed')
    or exists (select 1 from public.game_slot_reservations r where r.game_id = v_a.id and r.reserved_slots_total > 0)
    or (v_a.type = 'rental' and v_a.booked_by_user_id is not null);
  v_committed_b :=
       v_b.status = 'reserved'
    or exists (select 1 from public.game_players gp where gp.game_id = v_b.id and gp.status = 'confirmed')
    or exists (select 1 from public.game_slot_reservations r where r.game_id = v_b.id and r.reserved_slots_total > 0)
    or (v_b.type = 'rental' and v_b.booked_by_user_id is not null);

  -- 8) Invariante: nunca compromiso real en AMBOS. Fail seguro (sin refunds).
  if v_committed_a and v_committed_b then raise exception 'DOUBLE_OUT_BOTH_COMMITTED'; end if;

  -- 9) Elegir comprometido (M) y vacío (E).
  if    v_committed_a then v_m_id := v_a.id; v_m_type := v_a.type; v_e_id := v_b.id;
  elsif v_committed_b then v_m_id := v_b.id; v_m_type := v_b.type; v_e_id := v_a.id;
  else  v_m_id := null;   -- ninguno comprometido (ambos published)
  end if;

  if v_m_id is not null then
    -- 10) Gemelo VACÍO PRIMERO (directo, sin 2ª economía). blocked/published→canceled
    --     NO dispara reopen → el reserved→canceled del comprometido no lo resucita.
    update public.games
       set status = 'canceled', blocked_from_status = null,
           cancel_reason = p_cancel_reason, cancel_reason_detail = p_cancel_reason_detail,
           cancelled_by_user_id = v_actor, cancelled_at = now()
     where id = v_e_id and status <> 'canceled';

    -- 11) Miembro COMPROMETIDO con la economía real existente (sin duplicar).
    if v_m_type = 'rental'
      then v_result := public.cancel_rental(v_m_id, p_cancel_reason, p_cancel_reason_detail);
      else v_result := public.cancel_match (v_m_id, p_cancel_reason, p_cancel_reason_detail);
    end if;
  else
    -- Ninguno comprometido: ambos published → cancelar ambos directo (sin economía).
    update public.games
       set status = 'canceled', blocked_from_status = null,
           cancel_reason = p_cancel_reason, cancel_reason_detail = p_cancel_reason_detail,
           cancelled_by_user_id = v_actor, cancelled_at = now()
     where id in (v_a.id, v_b.id) and status <> 'canceled';
    v_result := jsonb_build_object('ok', true, 'both_empty', true);
  end if;

  return coalesce(v_result, jsonb_build_object('ok', true));
end;
$$;

revoke all on function public.cancel_double_out(uuid, text, text) from public, anon;
grant execute on function public.cancel_double_out(uuid, text, text) to authenticated;
