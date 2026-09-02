-- ============================================================================
-- Cancelación (auto): leer cortes/porcentajes de public.app_settings (id=1)
-- ============================================================================
-- SUSTITUYE constantes por configuración en las funciones EXISTENTES. Con los valores
-- actuales (match=24, rental full=72, partial=24, partial_pct=50) el resultado es
-- MATEMÁTICAMENTE IDÉNTICO al actual.
--
-- SIN default oculto: si falta la fila id=1 o algún valor necesario es NULL/inválido,
-- la función ABORTA con CANCELLATION_CONFIG_UNAVAILABLE ANTES de emitir veredicto o de
-- tocar ledger/wallet/games. Nunca cae a 24/72/50 como fallback.
--
-- NO toca: cancel_match / cancel_rental (Admin), invitados gratis, ni la aplicación
-- client-side del refund de Match. Firmas, returns, permisos y SECURITY intactos.
-- Preview (rental_cancellation_window) y refund real (cancel_rental_self) leen la MISMA
-- fila/columnas → nunca divergen.
-- ============================================================================

-- ── MATCH · ventana (regla configurable, antes 24h) ─────────────────────────
create or replace function public.match_cancellation_window(p_game_id uuid)
returns table (
  refundable        boolean,
  game_start_at     timestamptz,
  refund_cutoff_at  timestamptz,
  server_now        timestamptz
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_date_key     date;
  v_time         time;
  v_start        timestamptz;
  v_cutoff       timestamptz;
  v_now          timestamptz := now();   -- reloj del servidor (autoritativo)
  v_cutoff_hours integer;                -- app_settings.match_refund_cutoff_hours
begin
  select g.date_key, g.time
    into v_date_key, v_time
    from public.games g
   where g.id = p_game_id;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;
  if v_date_key is null or v_time is null then raise exception 'GAME_START_UNAVAILABLE'; end if;

  -- Política desde app_settings id=1 (SIN default oculto).
  select s.match_refund_cutoff_hours
    into v_cutoff_hours
    from public.app_settings s
   where s.id = 1;
  if v_cutoff_hours is null or v_cutoff_hours < 0 then
    raise exception 'CANCELLATION_CONFIG_UNAVAILABLE';
  end if;

  v_start  := (v_date_key + v_time) at time zone 'America/Lima';
  v_cutoff := v_start - v_cutoff_hours * interval '1 hour';   -- antes: interval '24 hours'

  -- Límite ESTRICTO: > cutoff ⇒ reembolsable; exactamente cutoff o menos ⇒ no.
  return query
    select (v_now < v_cutoff), v_start, v_cutoff, v_now;
end;
$$;

revoke all on function public.match_cancellation_window(uuid) from public;
grant execute on function public.match_cancellation_window(uuid) to authenticated;


-- ── RENTAL · A) ventana / preview (tramos configurables, antes 72/24/50) ─────
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
  v_full_h   integer;    -- rental_full_refund_cutoff_hours
  v_part_h   integer;    -- rental_partial_refund_cutoff_hours
  v_part_pct integer;    -- rental_partial_refund_percent
begin
  select g.type, g.date_key, g.time
    into v_type, v_date_key, v_time
    from public.games g
   where g.id = p_game_id;

  if not found then raise exception 'GAME_NOT_FOUND'; end if;
  if v_type is distinct from 'rental' then raise exception 'NOT_A_RENTAL'; end if;
  if v_date_key is null or v_time is null then raise exception 'GAME_START_UNAVAILABLE'; end if;

  -- Política desde app_settings id=1 (MISMA fuente que cancel_rental_self; SIN default).
  select s.rental_full_refund_cutoff_hours, s.rental_partial_refund_cutoff_hours, s.rental_partial_refund_percent
    into v_full_h, v_part_h, v_part_pct
    from public.app_settings s
   where s.id = 1;
  if v_full_h is null or v_part_h is null or v_part_pct is null
     or v_full_h < 0 or v_part_h < 0 or v_part_pct < 0 or v_part_pct > 100
     or v_full_h <= v_part_h then   -- coincide con el constraint: full > partial (estricto)
    raise exception 'CANCELLATION_CONFIG_UNAVAILABLE';
  end if;

  v_start := (v_date_key + v_time) at time zone 'America/Lima';

  if v_start <= v_now then raise exception 'RENTAL_ALREADY_STARTED'; end if;

  return query
    select
      case
        when v_now < v_start - v_full_h * interval '1 hour' then 100          -- tope estructural
        when v_now < v_start - v_part_h * interval '1 hour' then v_part_pct   -- antes: 50
        else 0                                                                -- piso estructural
      end,
      v_start,
      v_start - v_full_h * interval '1 hour',
      v_start - v_part_h * interval '1 hour',
      v_now;
end;
$$;

revoke all on function public.rental_cancellation_window(uuid) from public;
revoke execute on function public.rental_cancellation_window(uuid) from anon;
grant execute on function public.rental_cancellation_window(uuid) to authenticated;


-- ── RENTAL · B) autoridad definitiva (atómica) ──────────────────────────────
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
  v_full_h   integer;    -- rental_full_refund_cutoff_hours
  v_part_h   integer;    -- rental_partial_refund_cutoff_hours
  v_part_pct integer;    -- rental_partial_refund_percent
begin
  -- 1) Autenticación (nunca se acepta user_id del cliente).
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_game_id is null then raise exception 'INVALID_GAME_ID'; end if;

  -- 2) Lock autoritativo del game.
  select * into v_game
    from public.games g
   where g.id = p_game_id
   for update of g;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;

  -- 3) Propiedad y estado.
  if v_game.type is distinct from 'rental' then raise exception 'NOT_A_RENTAL'; end if;
  if v_game.status is distinct from 'reserved' then raise exception 'RENTAL_NOT_ACTIVE'; end if;
  if v_game.booked_by_user_id is distinct from v_actor then raise exception 'NOT_BOOKER'; end if;
  if v_game.date_key is null or v_game.time is null then raise exception 'GAME_START_UNAVAILABLE'; end if;

  -- 4) Recalcular el tramo AQUÍ con now() autoritativo (mismo criterio que la ventana).
  v_start := (v_game.date_key + v_game.time) at time zone 'America/Lima';

  -- Guard temporal: rental ya iniciado NO puede autocancelarse (antes de cualquier escritura).
  if v_start <= v_now then raise exception 'RENTAL_ALREADY_STARTED'; end if;

  -- Política desde app_settings id=1 (MISMA fuente que la ventana). SIN default oculto:
  -- si falta/NULL/inválido → ABORTAR aquí, ANTES de ledger/wallet/update/notificación.
  select s.rental_full_refund_cutoff_hours, s.rental_partial_refund_cutoff_hours, s.rental_partial_refund_percent
    into v_full_h, v_part_h, v_part_pct
    from public.app_settings s
   where s.id = 1;
  if v_full_h is null or v_part_h is null or v_part_pct is null
     or v_full_h < 0 or v_part_h < 0 or v_part_pct < 0 or v_part_pct > 100
     or v_full_h <= v_part_h then   -- coincide con el constraint: full > partial (estricto)
    raise exception 'CANCELLATION_CONFIG_UNAVAILABLE';
  end if;

  v_pct := case
             when v_now < v_start - v_full_h * interval '1 hour' then 100          -- tope estructural
             when v_now < v_start - v_part_h * interval '1 hour' then v_part_pct   -- antes: 50
             else 0                                                                -- piso estructural
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

  -- 9) Liberar el horario (semántica de auto-cancelación Rental, idéntica a la actual).
  update public.games
     set status            = 'published',
         booked_by_user_id = null
   where id = p_game_id;

  -- 10) Notificación SIEMPRE. Tramo PARCIAL (antes v_pct=50) → plantilla dedicada.
  v_tpl := case
             when v_refund > 0 and v_pct = v_part_pct then 'reservation_cancelled_credit_partial'
             when v_refund > 0                        then 'reservation_cancelled_credit_self'
             else                                          'reservation_cancelled_no_refund'
           end;
  insert into public.notifications
    (recipient_user_id, source_type, delivery_type, category, template_key,
     reservation_id, game_id, created_by, sent_at)
  values
    (v_actor, 'venue', 'automatic',
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
