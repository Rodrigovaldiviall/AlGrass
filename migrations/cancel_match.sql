-- ============================================================================
-- cancel_match(p_game_id, p_cancel_reason, p_cancel_reason_detail)
-- Cancelación ADMINISTRATIVA de un partido (match). Operación única y atómica.
-- ============================================================================
-- SECURITY DEFINER e implementada como UNA sola función plpgsql = UNA transacción:
-- cualquier `raise` en cualquier bloque revierte TODO (todo-o-nada). Nunca persiste
-- una cancelación parcial.
--
-- Se construye BLOQUE POR BLOQUE según el blueprint congelado:
--   1) validaciones iniciales   ← ESTE COMMIT (único bloque implementado)
--   2) lock del partido
--   3) guard de Orders PENDING
--   4) carga de datos
--   5) liberación de R1
--   6) cancelación de game_players
--   7) ledger refund
--   8) wallet refunds
--   9) actualización del partido
--   10) notificaciones
--   11) return
--
-- `cancelled_by = auth.uid()` (el admin; no es parámetro, no se puede falsificar).
-- Ejecutable desde el cliente (Web Admin): la autorización se valida DENTRO.
-- ============================================================================

create or replace function public.cancel_match(
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
  v_actor uuid := auth.uid();
  v_game  public.games%rowtype;   -- fila del partido BLOQUEADA (bloque 2); se reutiliza, games no se re-lee
  v_r1_ids            uuid[];     -- ids de R1 activas (bloque 4) → consumido por el bloque 5
  v_waitlist_user_ids uuid[];     -- user_id en waitlist 'waiting' (bloque 4) → audiencia del bloque 10
  v_r1_id             uuid;       -- iterador de v_r1_ids (bloque 5)
  v_pay               record;     -- iterador (payer_id, total) del bloque 8
begin
  -- ── BLOQUE 1 · Validaciones iniciales ──────────────────────────────────────
  -- Objetivo: autenticar y autorizar al ejecutor y validar parámetros ANTES de
  -- tocar nada. Solo lee user_roles; no escribe.

  -- 1a) Sesión.
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- 1b) Autorización: solo back-office (algrass_admin | algrass_staff).
  --     Mismo patrón que reserve_slots (exists sobre user_roles). venue_owner queda
  --     diferido (fuera de alcance de esta operación).
  if not exists (
    select 1
      from public.user_roles
     where user_id = v_actor
       and role in ('algrass_admin', 'algrass_staff')
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- 1c) Parámetros.
  if p_game_id is null then
    raise exception 'INVALID_GAME_ID';
  end if;
  if p_cancel_reason is null or btrim(p_cancel_reason) = '' then
    raise exception 'CANCEL_REASON_REQUIRED';
  end if;

  -- ── BLOQUE 2 · Lock autoritativo del partido ───────────────────────────────
  -- Objetivo: serializar contra create_order/reserve_slots (que también bloquean
  -- games FOR UPDATE) y fijar el estado autoritativo. El lock se mantiene hasta el
  -- fin de la transacción (fin del RPC). Se captura la fila COMPLETA en v_game;
  -- games NO se vuelve a leer en bloques posteriores.
  select * into v_game
    from public.games g
   where g.id = p_game_id
   for update of g;

  if not found then
    raise exception 'GAME_NOT_FOUND';
  end if;

  -- Validaciones autoritativas SOBRE la fila bloqueada.
  if v_game.type is distinct from 'match' then
    raise exception 'NOT_A_MATCH';       -- los rentals van por cancel_rental (fuera de alcance)
  end if;
  if v_game.status = 'canceled' then
    raise exception 'ALREADY_CANCELED';  -- estado terminal; idempotente
  end if;

  -- ── BLOQUE 3 · Guard de Orders PENDING vigentes ────────────────────────────
  -- Objetivo: impedir cancelar mientras exista un pago externo REALMENTE en curso.
  -- Bajo el lock del bloque 2; NO se re-consulta ni bloquea games. Solo LEE orders.
  -- Vigente = status 'pending' con HOLD no vencido (pending_expires_at > now()); un
  -- pending vencido no barrido es un abandono, no un pago en curso. Mismo patrón que
  -- create_order.sql; EXISTS (no COUNT) aprovecha el índice parcial
  -- orders_resource_pending_idx. NO escribe orders ni ninguna otra tabla.
  if exists (
    select 1
      from public.orders o
     where o.resource_id = p_game_id
       and o.status = 'pending'
       and o.pending_expires_at > now()
  ) then
    raise exception 'PAYMENT_IN_PROGRESS';
  end if;

  -- ── BLOQUE 4 · Carga de datos auxiliares (bajo el lock) ─────────────────────
  -- Objetivo: precargar en variables lo que necesitan los bloques de escritura,
  -- para no re-consultar la BD después. Solo LEE. games NO se re-consulta (se usa
  -- v_game del bloque 2). game_players NO se precarga aquí: su conjunto autoritativo
  -- proviene EXCLUSIVAMENTE del RETURNING del UPDATE del bloque 6 (evita doble
  -- lectura y una ventana TOCTOU frente a un confirm_order en vuelo).

  -- A) R1 activas del partido (solo ids) → bloque 5 (release_slot_reservation).
  select coalesce(array_agg(gsr.id), '{}'::uuid[])
    into v_r1_ids
    from public.game_slot_reservations gsr
   where gsr.game_id = p_game_id
     and gsr.status = 'active';

  -- B) Usuarios en waitlist 'waiting' del partido (solo user_id) → audiencia del bloque 10.
  select coalesce(array_agg(gw.user_id), '{}'::uuid[])
    into v_waitlist_user_ids
    from public.game_waitlist gw
   where gw.game_id = p_game_id
     and gw.status = 'waiting';

  -- ── BLOQUE 5 · Liberación de R1 (vía primitiva) ────────────────────────────
  -- Objetivo: terminar todas las R1 activas del partido reutilizando EXACTAMENTE
  -- release_slot_reservation. La primitiva ya pone la R1 inactive, resetea totales,
  -- fija released_reason/at y baja counts_reserved_slot de sus game_players
  -- (disparando trg_game_players_reserved_slots_used). Es idempotente (solo 'active').
  -- Motivo 'admin': valor permitido por el CHECK de released_reason. No se escribe
  -- game_slot_reservations ni game_players directamente. Array vacío → no-op.
  foreach v_r1_id in array v_r1_ids loop
    perform public.release_slot_reservation(v_r1_id, 'admin');
  end loop;

  -- ── BLOQUE 6 · Cancelación de game_players (fuente autoritativa) ────────────
  -- Objetivo: cancelar TODOS los confirmados del partido en UN solo UPDATE y
  -- capturar su conjunto vía RETURNING. Ese conjunto es la ÚNICA fuente de verdad de
  -- los bloques 7 (ledger), 8 (wallet) y 10 (notificaciones): game_players NO se
  -- vuelve a leer. El filtro status='confirmed' es el MISMO claim atómico de
  -- cancelGamePlayer (evita doble-cancelación/doble-refund). El UPDATE dispara
  -- trg_game_players_reserved_slots_used por fila (mantenimiento automático de
  -- reserved_slots_used; no se toca a mano). No se genera ningún refund aún.
  --
  -- El RETURNING se materializa en una tabla TEMP (ON COMMIT DROP) para que los
  -- bloques 7/8/10 puedan agrupar (por payer / por invited_by) de forma set-based.
  create temp table _cancelled_players (
    id                 uuid,
    user_id            uuid,
    payer_id           uuid,
    amount             numeric,
    reservation_type   text,
    invited_by_user_id uuid
  ) on commit drop;

  with upd as (
    update public.game_players
       set status               = 'canceled',
           canceled_at          = now(),
           counts_reserved_slot = false
     where game_id = p_game_id
       and status = 'confirmed'
    returning id, user_id, payer_id, amount, reservation_type, invited_by_user_id
  )
  insert into _cancelled_players (id, user_id, payer_id, amount, reservation_type, invited_by_user_id)
  select id, user_id, payer_id, amount, reservation_type, invited_by_user_id
    from upd;

  -- ── BLOQUE 7 · Construcción del ledger refund (append-only) ─────────────────
  -- Objetivo: emitir las filas refund en reservations SOLO desde _cancelled_players
  -- (bloque 6) + v_game (precio). NO re-lee game_players. Solo INSERT (append-only):
  -- no toca spend previos, ni wallet, ni games/orders/notifications. Dos categorías,
  -- auditadas como compatibles con el único lector (Profile, membership por game_id).

  -- 7a) PAGADOS (reservation_type='normal', amount>0): UNA fila por payer.
  --     user_id=payer; subtotal=Σ amount; players_count=nº slots; guest_total=porción
  --     de invitados pagados (user_id<>payer, como cancelGuestPlayers); unit_price
  --     representativo (analítico, sin consumidor).
  insert into public.reservations
    (game_id, user_id, canceled_by, status, unit_price, subtotal_amount,
     players_count, guest_total, canceled_at)
  select
    p_game_id,
    cp.payer_id,
    v_actor,
    'refund',
    min(cp.amount),
    sum(cp.amount),
    count(*),
    sum(case when cp.user_id is distinct from cp.payer_id then cp.amount else 0 end),
    now()
  from _cancelled_players cp
  where cp.reservation_type = 'normal'
    and cp.amount > 0
  group by cp.payer_id;

  -- 7b) INVITADOS (reservation_type='invited'): fila ANALÍTICA por invited_by. Sin
  --     wallet (neto 0). Bruto = v_game.price_per_person × nº slots; total_amount=0;
  --     bruto en subtotal_amount/guest_total/promo_discount (forma de cancelInvitedPlayers).
  insert into public.reservations
    (game_id, user_id, canceled_by, status, unit_price, promo_discount,
     subtotal_amount, total_amount, players_count, guest_total, canceled_at,
     reservation_type, invited_by_user_id)
  select
    p_game_id,
    cp.invited_by_user_id,
    v_actor,
    'refund',
    coalesce(v_game.price_per_person, 0),
    coalesce(v_game.price_per_person, 0) * count(*),
    coalesce(v_game.price_per_person, 0) * count(*),
    0,
    count(*),
    coalesce(v_game.price_per_person, 0) * count(*),
    now(),
    'invited',
    cp.invited_by_user_id
  from _cancelled_players cp
  where cp.reservation_type = 'invited'
  group by cp.invited_by_user_id;

  -- ── BLOQUE 8 · Wallet refunds (vía primitiva) ──────────────────────────────
  -- Objetivo: acreditar a cada payer el total de sus slots PAGADOS reutilizando
  -- EXCLUSIVAMENTE apply_wallet_refund (misma primitiva que el flujo actual). Lee
  -- solo _cancelled_players. NO toca wallet_summary a mano, ni reservations, ni
  -- games/notifications/orders. La agregación es IDÉNTICA a la del bloque 7a (mismo
  -- WHERE + GROUP BY), así que el crédito coincide con el subtotal del ledger.
  -- Una llamada por payer. Los invitados (neto 0) no entran (solo 'normal' AND
  -- amount>0), por eso no generan wallet. El HAVING garantiza total>0 (nunca 0).
  for v_pay in
    select cp.payer_id as payer_id, sum(cp.amount) as total
      from _cancelled_players cp
     where cp.reservation_type = 'normal'
       and cp.amount > 0
     group by cp.payer_id
    having sum(cp.amount) > 0
  loop
    perform public.apply_wallet_refund(v_pay.payer_id, v_pay.total);
  end loop;

  -- ── BLOQUE 9 · Actualización del partido (estado terminal) ─────────────────
  -- Objetivo: marcar el partido como cancelado con metadatos de auditoría. Un solo
  -- UPDATE sobre la fila YA bloqueada en el bloque 2 (id = p_game_id); games NO se
  -- re-consulta. NUNCA setMatchPublishedIfEmpty: el partido queda TERMINAL, no
  -- vuelve a 'published'. No toca ninguna otra tabla.
  -- (Requiere las columnas cancel_reason/cancel_reason_detail/cancelled_by_user_id/
  --  cancelled_at en games — migración previa del Bloque 0.)
  update public.games
     set status               = 'canceled',
         cancel_reason        = p_cancel_reason,
         cancel_reason_detail = p_cancel_reason_detail,
         cancelled_by_user_id = v_actor,
         cancelled_at         = now()
   where id = p_game_id;

  -- ── BLOQUE 10 · Notificaciones "Partido cancelado" ─────────────────────────
  -- Objetivo: UNA notificación por usuario para toda la audiencia congelada
  -- (jugadores ∪ payers ∪ waitlist), sin duplicados. Template nuevo PARTIDO_CANCELADO;
  -- NO se reutiliza notifyWaitlistUsers (semántica inversa) ni plantillas de
  -- cancelación individual. Texto audience-safe: NO afirma reembolso (válido también
  -- para usuarios de waitlist que nunca pagaron). Solo INSERT en notifications.
  -- La dedup la hace UNION (no UNION ALL): cada user_id aparece una sola vez.
  insert into public.notifications
    (recipient_user_id, source_type, delivery_type, category, template_key,
     custom_text, game_id, created_by, sent_at)
  select
    aud.user_id,
    'venue', 'automatic', 'reservation', 'PARTIDO_CANCELADO',
    'El partido fue cancelado.',
    p_game_id, v_actor, now()
  from (
    select user_id  from _cancelled_players
    union
    select payer_id from _cancelled_players
    union
    select unnest(v_waitlist_user_ids)
  ) as aud(user_id)
  where aud.user_id is not null;

  -- ── BLOQUE 11 · Return (resumen de observabilidad) ─────────────────────────
  -- Objetivo: cerrar el RPC devolviendo un resumen. Sin escrituras nuevas: los
  -- contadores salen de _cancelled_players (temp del bloque 6) y de v_r1_ids/
  -- v_waitlist_user_ids (arrays del bloque 4). El COMMIT implícito ocurre SOLO al
  -- ejecutarse este RETURN sin excepciones; cualquier raise previo revierte TODO
  -- (todo-o-nada). Aquí se elimina el raise temporal CANCEL_MATCH_NOT_IMPLEMENTED.
  return jsonb_build_object(
    'game_id',           p_game_id,
    'cancelled_players', (select count(*) from _cancelled_players),
    'refunded_payers',   (select count(distinct cp.payer_id)
                            from _cancelled_players cp
                           where cp.reservation_type = 'normal' and cp.amount > 0),
    'total_refunded',    (select coalesce(sum(cp.amount), 0)
                            from _cancelled_players cp
                           where cp.reservation_type = 'normal' and cp.amount > 0),
    'released_r1',       cardinality(v_r1_ids),
    'notified',          (select count(*) from (
                            select user_id  from _cancelled_players
                            union
                            select payer_id from _cancelled_players
                            union
                            select unnest(v_waitlist_user_ids)
                          ) aud(user_id)
                          where aud.user_id is not null)
  );
end;
$$;

grant execute on function public.cancel_match(uuid, text, text) to authenticated;
