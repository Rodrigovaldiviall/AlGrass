-- ============================================================================
-- cancel_rental(p_game_id, p_cancel_reason, p_cancel_reason_detail)
-- Cancelación ADMINISTRATIVA de un rental (cancha). Operación única y atómica.
-- ============================================================================
-- Equivalente SIMPLIFICADO de cancel_match(): misma filosofía (SECURITY DEFINER,
-- una sola función plpgsql = una transacción, todo-o-nada), pero un rental no tiene
-- game_players, game_waitlist ni R1: solo el usuario que reservó (booked_by_user_id)
-- y su fila de spend en reservations.
--
-- Reúso máximo de la arquitectura existente:
--   · refund ledger  → forma EXACTA de cancelRental() (source='rental',
--                       refund_of_reservation_id apuntando al spend).
--   · wallet         → apply_wallet_refund() (misma primitiva que cancel_match).
--   · update games   → estado terminal: NUNCA vuelve a 'published' (queda
--                       status='canceled'). booked_by_user_id SE LIMPIA (=null)
--                       deliberadamente, replicando exactamente el flujo actual de
--                       cancelación normal de rentals (el usuario deja de ver la
--                       reserva; el Back Office no muestra reservante). La conservación
--                       del histórico mediante snapshot queda FUERA de alcance en esta
--                       versión y se implementará más adelante.
--   · notificación   → mismo patrón template_key + custom_text (backend construye el
--                       texto), pero template PROPIO 'RESERVA_CANCELADA'.
--
-- Requiere las columnas cancel_reason/cancel_reason_detail/cancelled_by_user_id/
-- cancelled_at en games (ya añadidas por games_cancellation_metadata.sql).
-- ============================================================================

create or replace function public.cancel_rental(
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
  v_game        public.games%rowtype;   -- fila del rental BLOQUEADA (bloque 2); se reutiliza
  v_booker      uuid;                    -- booked_by_user_id (reserva vigente; solo para limpiar)
  v_spend_id    uuid;                    -- id del spend a reembolsar (bloque 4)
  v_refund_user uuid;                    -- user_id DUEÑO del spend = destinatario real del refund
  v_refund      numeric := 0;            -- monto del refund (subtotal ?? total del spend)
  v_notify_user uuid;                    -- destinatario de la notificación (spend, o booker si no hay spend)
  v_reason_text text;                    -- custom_text construido por el backend (bloque 8)
  v_notified    integer := 0;            -- 1 si se notificó; 0 si no
begin
  -- ── BLOQUE 1 · Validaciones iniciales ──────────────────────────────────────
  -- Misma filosofía que cancel_match: autenticar + autorizar + validar parámetros
  -- ANTES de tocar nada. Solo lee user_roles.
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
      from public.user_roles
     where user_id = v_actor
       and role in ('algrass_admin', 'algrass_staff')
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_game_id is null then
    raise exception 'INVALID_GAME_ID';
  end if;
  if p_cancel_reason is null or btrim(p_cancel_reason) = '' then
    raise exception 'CANCEL_REASON_REQUIRED';
  end if;
  -- Motivos VÁLIDOS para rentals (contrato congelado). No existe low_attendance. Un
  -- token fuera de este conjunto es un error de integración: falla el RPC, no se
  -- absorbe como "problema operativo".
  if p_cancel_reason not in ('weather', 'venue_unavailable', 'venue_request', 'other') then
    raise exception 'INVALID_CANCEL_REASON';
  end if;

  -- ── BLOQUE 2 · Lock autoritativo del rental ────────────────────────────────
  -- Serializa contra create_order (que también bloquea games FOR UPDATE). Se captura
  -- la fila COMPLETA en v_game; games NO se vuelve a leer.
  select * into v_game
    from public.games g
   where g.id = p_game_id
   for update of g;

  if not found then
    raise exception 'GAME_NOT_FOUND';
  end if;
  if v_game.type is distinct from 'rental' then
    raise exception 'NOT_A_RENTAL';       -- los partidos van por cancel_match
  end if;
  if v_game.status = 'canceled' then
    raise exception 'ALREADY_CANCELED';   -- estado terminal; idempotente
  end if;

  -- ── BLOQUE 3 · Guard de Orders PENDING vigentes ────────────────────────────
  -- Idéntico a cancel_match: no cancelar mientras haya un pago externo REALMENTE en
  -- curso (pending con HOLD no vencido). Solo LEE orders.
  if exists (
    select 1
      from public.orders o
     where o.resource_id = p_game_id
       and o.status = 'pending'
       and o.pending_expires_at > now()
  ) then
    raise exception 'PAYMENT_IN_PROGRESS';
  end if;

  -- ── BLOQUE 4 · Carga spend + booker (bajo el lock) ─────────────────────────
  -- FUENTE DE VERDAD del refund = el spend, NO booked_by_user_id. Se busca el spend
  -- MÁS RECIENTE del GAME (no se filtra por booked_by: éste puede estar desincronizado
  -- en rentals pre-migración) y se captura su user_id DUEÑO → ese es quien recibe el
  -- refund/wallet/notificación. v_booker solo representa la reserva vigente (se limpia
  -- en el bloque 7). Sin spend → v_refund 0 y los bloques 5/6 se omiten.
  v_booker := v_game.booked_by_user_id;
  select r.id, r.user_id, coalesce(r.subtotal_amount, r.total_amount, 0)
    into v_spend_id, v_refund_user, v_refund
    from public.reservations r
   where r.game_id = p_game_id
     and r.status  = 'spend'
   order by r.reserved_at desc
   limit 1;
  if not found then
    v_spend_id    := null;
    v_refund_user := null;
    v_refund      := 0;
  end if;

  -- ── BLOQUE 5 · Refund ledger (append-only, forma EXACTA de cancelRental) ────
  -- Solo si hay spend con monto>0. user_id = DUEÑO del spend (v_refund_user), NO el
  -- booker. canceled_by = admin.
  if v_spend_id is not null and v_refund > 0 then
    insert into public.reservations
      (game_id, user_id, canceled_by, status, unit_price, subtotal_amount,
       players_count, guest_total, source, refund_of_reservation_id, canceled_at)
    values
      (p_game_id, v_refund_user, v_actor, 'refund', v_refund, v_refund,
       1, 0, 'rental', v_spend_id, now());

    -- ── BLOQUE 6 · Wallet refund (primitiva existente) ───────────────────────
    perform public.apply_wallet_refund(v_refund_user, v_refund);
  end if;

  -- ── BLOQUE 7 · Actualización del rental (estado terminal) ──────────────────
  -- NUNCA vuelve a 'published' (queda terminal 'canceled'). Se limpia
  -- booked_by_user_id (igual que la cancelación normal) para que la reserva deje de
  -- estar vigente: el usuario deja de verla en su perfil y el Back Office no muestra
  -- reservante. Un solo UPDATE sobre la fila ya bloqueada.
  update public.games
     set status               = 'canceled',
         booked_by_user_id    = null,
         cancel_reason        = p_cancel_reason,
         cancel_reason_detail = p_cancel_reason_detail,
         cancelled_by_user_id = v_actor,
         cancelled_at         = now()
   where id = p_game_id;

  -- ── BLOQUE 8 · Notificación "Reserva cancelada" ────────────────────────────
  -- Destinatario = DUEÑO del spend (v_refund_user); si por inconsistencia no hubiera
  -- spend, fallback al booker para no dejar la reserva cancelada sin aviso. La línea del
  -- crédito se añade solo si hubo refund real (v_refund>0); si no, el MISMO mensaje sin
  -- esa última línea. Mismo patrón que PARTIDO_CANCELADO pero template PROPIO
  -- 'RESERVA_CANCELADA'; TODA la lógica del texto vive AQUÍ. Motivo → frase: 'weather'
  -- → condiciones climáticas; el resto → problema operativo (los rentals NO usan
  -- low_attendance).
  v_notify_user := coalesce(v_refund_user, v_booker);
  if v_notify_user is not null then
    v_reason_text := 'Lamentamos informarte que la reserva fue cancelada '
      || case p_cancel_reason
           when 'weather'           then 'por condiciones climáticas'
           when 'venue_unavailable' then 'por un problema operativo'
           when 'venue_request'     then 'por un problema operativo'
           when 'other'             then 'por un problema operativo'
         end
      || '.'
      || case when v_refund > 0 then E'\n\nEl crédito fue añadido a tu billetera.' else '' end;

    insert into public.notifications
      (recipient_user_id, source_type, delivery_type, category, template_key,
       custom_text, game_id, created_by, sent_at)
    values
      (v_notify_user, 'venue', 'automatic', 'reservation', 'RESERVA_CANCELADA',
       v_reason_text, p_game_id, v_actor, now());
    v_notified := 1;
  end if;

  -- ── BLOQUE 9 · Return (resumen de observabilidad) ──────────────────────────
  return jsonb_build_object(
    'game_id',        p_game_id,
    'booker_user_id', v_booker,
    'refund_user_id', v_refund_user,
    'refunded',       (v_refund > 0),
    'total_refunded', v_refund,
    'notified',       v_notified
  );
end;
$$;

-- Ejecutable desde el cliente (Web Admin): la autorización se valida DENTRO.
grant execute on function public.cancel_rental(uuid, text, text) to authenticated;
