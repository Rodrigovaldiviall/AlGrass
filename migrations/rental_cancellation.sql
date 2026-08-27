-- ============================================================================
-- Cancelación de RENTAL por el usuario — política escalonada 72h/24h
-- ============================================================================
-- Dos piezas claramente separadas:
--
--   A) rental_cancellation_window(p_game_id)  → CONSULTA (preview de UI).
--      SECURITY INVOKER, stable, solo lectura. Devuelve el tramo 100/50/0 y los
--      cortes, pero NO autoriza ni mueve dinero.
--
--   B) cancel_rental_self(p_game_id)          → AUTORIDAD DEFINITIVA.
--      SECURITY DEFINER, atómica (una función plpgsql = una transacción, todo-o-nada).
--      Recalcula el tramo con now() del servidor (NUNCA confía en un pct del cliente),
--      lee el spend histórico autoritativo, aplica el refund escalonado + wallet una
--      sola vez, libera el horario y notifica. Elimina toda decisión económica y todo
--      UPDATE de games del cliente (endurecimiento de seguridad de public.games).
--
-- REGLA DEFINITIVA (R = horas restantes hasta el inicio; comparaciones ESTRICTAS para
-- el tramo mejor, de modo que el límite pertenece al tramo MENOS favorable, igual que
-- match_cancellation_window):
--   R > 72h                → 100 %      (now < inicio − 72h)
--   72h ≥ R > 24h          →  50 %      (inicio − 72h ≤ now < inicio − 24h)
--   R ≤ 24h                →   0 %      (now ≥ inicio − 24h)
--   · exactamente 72:00h → 50 %
--   · exactamente 24:00h →  0 %
--
-- GUARD TEMPORAL: un rental cuyo inicio (game_start_at) ya es <= now() NO puede
-- autocancelarse. Ambas funciones lanzan 'RENTAL_ALREADY_STARTED' (en cancel_rental_self,
-- ANTES de cualquier ledger/wallet/update/notificación).
--
-- FUENTE ECONÓMICA: el monto histórico realmente pagado = coalesce(subtotal_amount,
-- total_amount, 0) del spend MÁS RECIENTE de ese game por el propio usuario (forma
-- EXACTA que ya usaban cancelRental() y cancel_rental()). NO se usa precio actual del
-- game/field, ni promo actual, ni importe de UI. El refund del 50 % se redondea a 2
-- decimales. No se revalida promo, no se recalcula descuento, no se devuelven usos de
-- promo (el ledger es append-only; los usos se cuentan sobre status='spend').
--
-- Perú no tiene DST → 'America/Lima' equivale al offset fijo -05:00 usado por la App.
--
-- NO toca cancel_rental() (cancelación ADMINISTRATIVA, otro flujo, estado terminal
-- 'canceled'). Aquí la semántica de auto-cancelación se conserva: games → 'published'
-- + booked_by_user_id = null (el horario vuelve a estar disponible).
--
-- DEPENDENCIAS (ya existentes en la BD viva, igual que cancel_rental()):
--   · public.apply_wallet_refund(uuid, numeric)  — primitiva de wallet.
--   · plantilla de notificación 'reservation_cancelled_credit_self' (refund>0) y
--     'reservation_cancelled_no_refund' (refund=0, añadida en notificationTemplates.js).
-- ============================================================================

-- ── A) rental_cancellation_window — CONSULTA / preview ──────────────────────
create or replace function public.rental_cancellation_window(p_game_id uuid)
returns table (
  refund_pct     integer,
  game_start_at  timestamptz,
  cutoff_72h     timestamptz,
  cutoff_24h     timestamptz,
  server_now     timestamptz
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_type     text;
  v_date_key date;
  v_time     time;
  v_start    timestamptz;
  v_now      timestamptz := now();
begin
  select g.type, g.date_key, g.time
    into v_type, v_date_key, v_time
    from public.games g
   where g.id = p_game_id;

  if not found then raise exception 'GAME_NOT_FOUND'; end if;
  if v_type is distinct from 'rental' then raise exception 'NOT_A_RENTAL'; end if;
  if v_date_key is null or v_time is null then raise exception 'GAME_START_UNAVAILABLE'; end if;

  v_start := (v_date_key + v_time) at time zone 'America/Lima';

  -- Un rental ya iniciado (o pasado) NO es cancelable: la ventana NO lo presenta como un
  -- veredicto válido (el cliente recibe error y no ofrece cancelación).
  if v_start <= v_now then raise exception 'RENTAL_ALREADY_STARTED'; end if;

  return query
    select
      case
        when v_now < v_start - interval '72 hours' then 100
        when v_now < v_start - interval '24 hours' then 50
        else 0
      end,
      v_start,
      v_start - interval '72 hours',
      v_start - interval '24 hours',
      v_now;
end;
$$;

revoke all on function public.rental_cancellation_window(uuid) from public;
revoke execute on function public.rental_cancellation_window(uuid) from anon;
grant execute on function public.rental_cancellation_window(uuid) to authenticated;


-- ── B) cancel_rental_self — AUTORIDAD DEFINITIVA (atómica) ──────────────────
create or replace function public.cancel_rental_self(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid := auth.uid();
  v_game     public.games%rowtype;
  v_start    timestamptz;
  v_now      timestamptz := now();
  v_pct      integer;
  v_spend_id uuid;
  v_gross    numeric := 0;
  v_refund   numeric := 0;
  v_tpl      text;
begin
  -- 1) Autenticación (nunca se acepta user_id del cliente).
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_game_id is null then raise exception 'INVALID_GAME_ID'; end if;

  -- 2) Lock autoritativo del game (serializa vs create_order y vs auto-cancelaciones
  --    concurrentes: una 2.ª ejecución espera el lock y, tras el commit, verá el estado
  --    ya liberado y será rechazada ANTES de cualquier refund).
  select * into v_game
    from public.games g
   where g.id = p_game_id
   for update of g;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;

  -- 3) Propiedad y estado (NO se confía en RLS dentro de SECURITY DEFINER).
  if v_game.type is distinct from 'rental' then raise exception 'NOT_A_RENTAL'; end if;
  if v_game.status is distinct from 'reserved' then raise exception 'RENTAL_NOT_ACTIVE'; end if; -- ya liberado/cancelado → rechazo idempotente
  if v_game.booked_by_user_id is distinct from v_actor then raise exception 'NOT_BOOKER'; end if;
  if v_game.date_key is null or v_game.time is null then raise exception 'GAME_START_UNAVAILABLE'; end if;

  -- 4) Recalcular el tramo AQUÍ con now() autoritativo (mismo criterio que la ventana).
  v_start := (v_game.date_key + v_game.time) at time zone 'America/Lima';

  -- Guard temporal: un rental ya iniciado (o pasado) NO puede autocancelarse. Rechazo con
  -- error explícito ANTES de cualquier ledger/wallet/update de games/notificación.
  if v_start <= v_now then raise exception 'RENTAL_ALREADY_STARTED'; end if;

  v_pct := case
             when v_now < v_start - interval '72 hours' then 100
             when v_now < v_start - interval '24 hours' then 50
             else 0
           end;

  -- 5) Spend histórico autoritativo: el más reciente de ESTE game por el propio usuario.
  select r.id, coalesce(r.subtotal_amount, r.total_amount, 0)
    into v_spend_id, v_gross
    from public.reservations r
   where r.game_id = p_game_id
     and r.user_id = v_actor
     and r.status  = 'spend'
   order by r.reserved_at desc
   limit 1;

  -- 6) Refund definitivo = pago histórico × tramo, redondeado a 2 decimales.
  if v_spend_id is not null and v_pct > 0 then
    v_refund := round(v_gross * v_pct / 100.0, 2);
  else
    v_refund := 0;
  end if;

  -- 7) Refund > 0 → ledger (enlazado al spend original) + wallet, EXACTAMENTE una vez.
  --    Todo dentro de esta transacción: si el wallet o el ledger fallan, rollback total.
  if v_refund > 0 then
    insert into public.reservations
      (game_id, user_id, canceled_by, status, unit_price, subtotal_amount,
       players_count, guest_total, source, refund_of_reservation_id, canceled_at)
    values
      (p_game_id, v_actor, v_actor, 'refund', v_refund, v_refund,
       1, 0, 'rental', v_spend_id, now());

    perform public.apply_wallet_refund(v_actor, v_refund);
  end if;
  -- 8) refund = 0 → NO se crea ningún movimiento monetario/refund cero.

  -- 9) Liberar el horario (semántica de auto-cancelación Rental, idéntica a la actual):
  --    vuelve a 'published' y se limpia booked_by_user_id.
  update public.games
     set status            = 'published',
         booked_by_user_id = null
   where id = p_game_id;

  -- 10) Notificación SIEMPRE (incluido refund = 0). Reutiliza el sistema existente
  --     (template_key rendido por notificationTemplates.js). Tramo 50% → plantilla DEDICADA
  --     (no toca la compartida del 100%); 100% → compartida; sin crédito → plantilla neutra.
  --     reservation_id = v_spend_id (id del spend de ESTE ciclo) → correlación por ciclo en
  --     la navegación de notificaciones (S1→C1 / S2→C2), sin nuevo esquema.
  v_tpl := case
             when v_refund > 0 and v_pct = 50 then 'reservation_cancelled_credit_partial'
             when v_refund > 0                then 'reservation_cancelled_credit_self'
             else                                  'reservation_cancelled_no_refund'
           end;
  insert into public.notifications
    (recipient_user_id, source_type, delivery_type, category, template_key,
     reservation_id, game_id, created_by, sent_at)
  values
    (v_actor, 'venue', 'automatic',
     -- El CASE se resuelve a `text`; notifications.category es el enum notification_category
     -- y text→enum no tiene cast implícito (error 42804). Cast explícito, como el patrón de
     -- literales 'reservation'/'refund' de cancel_match/cancel_rental. Ambos valores existen
     -- en el enum (usados por esos RPC y por el antiguo cancelRental).
     (case when v_refund > 0 then 'refund' else 'reservation' end)::public.notification_category,
     v_tpl, v_spend_id, p_game_id, v_actor, now());

  -- 11) Resultado autoritativo para la confirmación posterior de la UI.
  return jsonb_build_object(
    'ok',            true,
    'refund_pct',    v_pct,
    'refund_amount', v_refund,
    'game_id',       p_game_id
  );
end;
$$;

revoke all on function public.cancel_rental_self(uuid) from public;
revoke execute on function public.cancel_rental_self(uuid) from anon;
grant execute on function public.cancel_rental_self(uuid) to authenticated;


-- ============================================================================
-- IDEMPOTENCIA — análisis de refund_of_reservation_id (NO se añade constraint)
-- ============================================================================
-- La garantía de "un solo refund" la da el CAS de estado bajo lock: la RPC solo
-- procede si status='reserved' AND booked_by_user_id=auth.uid(), y flipa a 'published'
-- en la MISMA transacción; una 2.ª ejecución (secuencial o concurrente) ve 'published'
-- → RENTAL_NOT_ACTIVE antes de tocar dinero.
--
-- NO se añade un índice único sobre refund_of_reservation_id porque:
--   · Match NO usa refund_of_reservation_id (queda NULL) → un único global no encaja.
--   · La cancelación normal y la administrativa de un mismo spend son mutuamente
--     excluyentes por estado (self exige 'reserved'; admin deja 'canceled'), así que el
--     invariante "≤1 refund por spend de rental" ya se cumple sin constraint.
--   · En una BD de desarrollo pueden existir refunds duplicados heredados del antiguo
--     cancelRental() client-side; un índice único fallaría al aplicarse. El CAS ya es
--     suficiente; un índice parcial queda como endurecimiento futuro tras depurar datos.
-- ============================================================================


-- ============================================================================
-- VERIFICACIÓN (ejecutar tras aplicar en el editor SQL de Supabase)
-- ============================================================================
-- 1) Existencia + SECURITY (definer/invoker) + search_path fijo:
--    select p.proname, p.prosecdef,
--           (select string_agg(c, ', ') from unnest(p.proconfig) c) as config
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and p.proname in ('rental_cancellation_window', 'cancel_rental_self');
--    Esperado: rental_cancellation_window → prosecdef = false; cancel_rental_self →
--              prosecdef = true; ambas con config incluyendo 'search_path=public'.
--
-- 2) EXECUTE solo a authenticated, sin PUBLIC y sin anon:
--    select p.proname, p.proacl
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and p.proname in ('rental_cancellation_window', 'cancel_rental_self');
--    Esperado: proacl contiene 'authenticated=X/...' y NO una entrada '=X/...' (PUBLIC)
--    NI 'anon=X/...'. anon NO debe tener EXECUTE en ninguna de las dos funciones.
--    Chequeo explícito de que anon NO puede ejecutar (debe devolver false, false):
--    select
--      has_function_privilege('anon', 'public.rental_cancellation_window(uuid)', 'execute') as anon_window,
--      has_function_privilege('anon', 'public.cancel_rental_self(uuid)',        'execute') as anon_self;
--    Esperado: anon_window = false, anon_self = false.
--
-- 3) Comportamiento 100/50/0 (contra un rental real; sustituir :gid):
--    select * from public.rental_cancellation_window(':gid'::uuid);
--    Comprobar refund_pct según now() vs cutoff_72h / cutoff_24h.
--
-- 4) Propiedad/estado/concurrencia: se validan por las guardas internas (NOT_BOOKER,
--    RENTAL_NOT_ACTIVE, NOT_A_RENTAL) y el CAS bajo FOR UPDATE. Prueba manual:
--    ejecutar cancel_rental_self dos veces seguidas → la 2.ª devuelve error
--    RENTAL_NOT_ACTIVE y NO genera un segundo refund.
-- ============================================================================
