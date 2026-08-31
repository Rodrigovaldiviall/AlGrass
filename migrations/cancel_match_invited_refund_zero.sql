-- ============================================================================
-- cancel_match — refund de INVITADOS gratuitos con economía 0 (coherencia ledger)
-- ============================================================================
-- CREATE OR REPLACE partiendo EXACTAMENTE de migrations/cancel_match.sql. ÚNICO
-- cambio: el BLOQUE 7b (refund de reservation_type='invited') deja de reconstruir el
-- bruto (v_game.price_per_person × nº slots + descuento 100% = neto 0) y pasa a
-- economía TODO-0, igual que el spend invited nuevo (createReservation con invited=true)
-- y que cancelInvitedPlayers:
--     unit_price = promo_discount = subtotal_amount = total_amount = guest_total = 0
-- players_count se conserva (nº slots). reservation_type='invited' e invited_by intactos.
--
-- NO cambia: BLOQUE 7a (refunds de PAGADOS), wallet (BLOQUE 8), capacidad, Orders, R1,
-- ni ningún otro bloque. Una invitación gratis tiene economía 0 al crearla y al
-- cancelarla; no se inventa descuento ficticio. CREATE OR REPLACE preserva los grants.
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
  v_canceled_waitlist integer := 0;  -- nº de filas waitlist 'waiting'→'canceled' (bloque 6b) → resumen
  v_reason_text       text;          -- primera frase del custom_text según p_cancel_reason (bloque 10)
begin
  -- ── BLOQUE 1 · Validaciones iniciales ──────────────────────────────────────
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

  -- ── BLOQUE 2 · Lock autoritativo del partido ───────────────────────────────
  select * into v_game
    from public.games g
   where g.id = p_game_id
   for update of g;

  if not found then
    raise exception 'GAME_NOT_FOUND';
  end if;

  if v_game.type is distinct from 'match' then
    raise exception 'NOT_A_MATCH';
  end if;
  if v_game.status = 'canceled' then
    raise exception 'ALREADY_CANCELED';
  end if;

  -- ── BLOQUE 3 · Guard de Orders PENDING vigentes ────────────────────────────
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
  select coalesce(array_agg(gsr.id), '{}'::uuid[])
    into v_r1_ids
    from public.game_slot_reservations gsr
   where gsr.game_id = p_game_id
     and gsr.status = 'active';

  select coalesce(array_agg(gw.user_id), '{}'::uuid[])
    into v_waitlist_user_ids
    from public.game_waitlist gw
   where gw.game_id = p_game_id
     and gw.status = 'waiting';

  -- ── BLOQUE 5 · Liberación de R1 (vía primitiva) ────────────────────────────
  foreach v_r1_id in array v_r1_ids loop
    perform public.release_slot_reservation(v_r1_id, 'admin');
  end loop;

  -- ── BLOQUE 6 · Cancelación de game_players (fuente autoritativa) ────────────
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

  -- ── BLOQUE 6b · Cancelación de game_waitlist ───────────────────────────────
  with wl as (
    update public.game_waitlist
       set status  = 'canceled',
           left_at = now()
     where game_id = p_game_id
       and status  = 'waiting'
    returning 1
  )
  select count(*)::integer into v_canceled_waitlist from wl;

  -- ── BLOQUE 7 · Construcción del ledger refund (append-only) ─────────────────

  -- 7a) PAGADOS (reservation_type='normal', amount>0): UNA fila por payer. SIN CAMBIOS.
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

  -- 7b) INVITADOS (reservation_type='invited'): fila ANALÍTICA por invited_by. CAMBIO:
  --     economía TODO-0 (una invitación gratis vale 0 al crearla y al cancelarla). Sin
  --     wallet (neto 0), sin descuento ficticio. players_count = nº slots (conservado).
  insert into public.reservations
    (game_id, user_id, canceled_by, status, unit_price, promo_discount,
     subtotal_amount, total_amount, players_count, guest_total, canceled_at,
     reservation_type, invited_by_user_id)
  select
    p_game_id,
    cp.invited_by_user_id,
    v_actor,
    'refund',
    0,            -- unit_price
    0,            -- promo_discount
    0,            -- subtotal_amount
    0,            -- total_amount
    count(*),     -- players_count (nº slots invitados cancelados)
    0,            -- guest_total
    now(),
    'invited',
    cp.invited_by_user_id
  from _cancelled_players cp
  where cp.reservation_type = 'invited'
  group by cp.invited_by_user_id;

  -- ── BLOQUE 8 · Wallet refunds (vía primitiva) ──────────────────────────────
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
  update public.games
     set status               = 'canceled',
         cancel_reason        = p_cancel_reason,
         cancel_reason_detail = p_cancel_reason_detail,
         cancelled_by_user_id = v_actor,
         cancelled_at         = now()
   where id = p_game_id;

  -- ── BLOQUE 10 · Notificaciones "Partido cancelado" ─────────────────────────
  v_reason_text := 'Lamentamos informarte que el partido fue cancelado '
    || case p_cancel_reason
         when 'weather'        then 'por condiciones climáticas'
         when 'low_attendance' then 'por falta de jugadores'
         else                       'por un problema operativo'
       end
    || '.';

  insert into public.notifications
    (recipient_user_id, source_type, delivery_type, category, template_key,
     custom_text, game_id, created_by, sent_at)
  select
    aud.user_id,
    'venue', 'automatic', 'reservation', 'PARTIDO_CANCELADO',
    case when aud.paid
           then v_reason_text || E'\n\nEl crédito fue añadido a tu billetera.'
           else v_reason_text
         end,
    p_game_id, v_actor, now()
  from (
    select a.user_id, bool_or(a.credited) as paid
    from (
      select user_id,  false as credited from _cancelled_players
      union all
      select payer_id, false              from _cancelled_players
      union all
      select unnest(v_waitlist_user_ids), false
      union all
      select payer_id, true
        from _cancelled_players
       where reservation_type = 'normal' and amount > 0
    ) a
    where a.user_id is not null
    group by a.user_id
  ) aud;

  -- ── BLOQUE 11 · Return (resumen de observabilidad) ─────────────────────────
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
    'canceled_waitlist', v_canceled_waitlist,
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
