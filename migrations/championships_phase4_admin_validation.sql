-- ============================================================================
-- Campeonatos · Fase 4 — Validación manual por Admin (approve / reject)
-- ============================================================================
-- Añade el paso back-office que faltaba: tras "Ya realicé la transferencia" el campeonato
-- queda en payment_validation (order 'validation'); aquí Admin APRUEBA o RECHAZA.
--
-- APRUEBA  → order 'confirmed', championship 'pending_publish', nace el ASIENTO financiero
--            (reservations.status='spend'); games siguen reserved (NO se liberan).
-- RECHAZA  → order 'failed', championship 'canceled', games reserved→published (double-out
--            se restaura por trigger), links eliminados; NO se crea spend ni refund.
--
-- reservations = ledger resumido. El detalle comercial (trofeos/medallas/court/árbitros/fee)
-- vive congelado en orders.financial_snapshot; NO se duplica aquí.
--
-- ADITIVA. NO edita migraciones históricas. NO toca create_championship_transfer_hold,
-- confirm_championship_transfer, pricing, quote, availability, championship_settings,
-- ni el flujo Match/Rental / double-out existente.
-- ============================================================================


-- ── 1) reservations — integrar Championship en el ledger existente (sin ledger paralelo) ─────
-- 1A) game_id nullable: Match/Rental siguen enviando game_id; SOLO Championship usa NULL.
alter table public.reservations alter column game_id drop not null;

-- 1B) championship_id: referencia al campeonato del asiento. ON DELETE NO ACTION (RESTRICT):
--     un campeonato con movimientos financieros NO se borra físicamente; se cancela por status.
alter table public.reservations
  add column if not exists championship_id uuid references public.championships(id) on delete no action;

-- 1C) Índice de acceso (lookups / refund futuro).
create index if not exists reservations_championship_id_idx
  on public.reservations (championship_id) where championship_id is not null;

-- 1D) UNIQUE parcial: un solo asiento 'spend' por campeonato. Defensa CONTABLE/idempotencia
--     (doble clic / dos admins / bug). NO es protección de inventario (esa vive en el hold).
create unique index if not exists reservations_championship_spend_uq
  on public.reservations (championship_id) where status = 'spend' and championship_id is not null;


-- ── 2) approve_championship_transfer — Admin confirma que el dinero llegó ────────────────────
-- Precondición: championship 'payment_validation' + order 'validation'. Autoriza solo back-office.
-- Idempotente: 2º clic (championship ya 'pending_publish') → no-op; el UNIQUE parcial es la última
-- barrera contra doble spend. Pagador autoritativo = orders.payer_user_id (NO owner_user_id).
create or replace function public.approve_championship_transfer(p_championship_id uuid)
returns public.championships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_order public.orders%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.user_roles
     where user_id = v_actor and role in ('algrass_admin', 'algrass_staff')
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- Lock championship PRIMERO (mismo orden que reject → mutuamente excluyentes, sin deadlock).
  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- Idempotencia VERIFICADA: 'pending_publish' es no-op SOLO si la operación financiera quedó COMPLETA.
  -- Un estado inconsistente (order no confirmed, o spend inexistente) NO se considera éxito → error.
  if v_champ.status = 'pending_publish' then
    if v_champ.order_id is null then raise exception 'INVALID_STATE'; end if;
    if not exists (select 1 from public.orders where id = v_champ.order_id and status = 'confirmed') then
      raise exception 'INVALID_STATE';   -- pending_publish + order no 'confirmed' → inconsistente
    end if;
    if not exists (select 1 from public.reservations where championship_id = p_championship_id and status = 'spend') then
      raise exception 'INVALID_STATE';   -- pending_publish + spend inexistente → inconsistente
    end if;
    return v_champ;                       -- estado terminal COMPLETO y consistente → no-op idempotente
  end if;
  if v_champ.status <> 'payment_validation' then raise exception 'INVALID_STATE'; end if;
  if v_champ.order_id is null then raise exception 'ORDER_NOT_FOUND'; end if;

  -- Lock order y validar transición.
  select * into v_order from public.orders where id = v_champ.order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'validation' then raise exception 'INVALID_STATE'; end if;

  -- orders: validation → confirmed (terminal, fija resolved_at).
  update public.orders
     set status = 'confirmed', resolved_at = now(), updated_at = now()
   where id = v_order.id;

  -- championships: payment_validation → pending_publish (puede publicar; NO se auto-publica).
  update public.championships
     set status = 'pending_publish', updated_at = now()
   where id = p_championship_id
  returning * into v_champ;

  -- games: NO se tocan (siguen reserved + championship_id). championship_reservation_games: NO se tocan.

  -- Asiento financiero (spend) — 1 por campeonato. Campos sin semántica en Championship = NULL.
  -- payment_method real = método del campeonato (transferencia). Sin applySpend (pago EXTERNO).
  insert into public.reservations (
    game_id, championship_id, user_id, order_id,
    status, reservation_type, source, payment_method,
    total_amount, subtotal_amount, credit_applied, reward_applied, promo_discount, promo_code_id,
    reserved_at
  ) values (
    null, v_champ.id, v_order.payer_user_id, v_order.id,
    'spend', 'championship', 'championship', coalesce(v_champ.payment_method, 'transfer'),
    v_order.amount_total, v_order.amount_total, 0, 0, 0, null,
    now()
  );

  return v_champ;
end;
$$;
revoke all on function public.approve_championship_transfer(uuid) from public, anon;
grant execute on function public.approve_championship_transfer(uuid) to authenticated;


-- ── 3) reject_championship_transfer — Admin no recibió / transferencia inválida ──────────────
-- Función DEDICADA (no se extiende _championship_release_hold, para no alterar timeout/user_canceled).
-- Libera games REUSANDO el trigger de double-out (reserved→published dispara trg_reopen_double_out_twin).
-- Verificación estricta de composición: si algún game esperado ya no está reserved/no pertenece, o hay
-- games extra reclamando el campeonato → aborta y hace rollback total (nunca liberación parcial).
-- p_reason: nota humana OPCIONAL. NO se persiste hoy (terminal_reason es un CÓDIGO de máquina y no hay
-- columna de detalle). Cuando exista auditoría/motivo de rechazo, p_reason deberá guardarse ahí.
create or replace function public.reject_championship_transfer(
  p_championship_id uuid,
  p_reason          text default null
)
returns public.championships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid := auth.uid();
  v_champ    public.championships%rowtype;
  v_expected uuid[];
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.user_roles
     where user_id = v_actor and role in ('algrass_admin', 'algrass_staff')
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- Lock championship PRIMERO (mismo orden que approve).
  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- Idempotencia VERIFICADA: 'canceled' es no-op SOLO si el terminal quedó CONSISTENTE.
  -- (order failed/expired, sin spend, sin canchas aún reserved de este campeonato.)
  if v_champ.status = 'canceled' then
    if exists (select 1 from public.reservations where championship_id = p_championship_id and status = 'spend') then
      raise exception 'INVALID_STATE';   -- canceled + spend → inconsistente (no debió cancelarse)
    end if;
    if exists (select 1 from public.games where championship_id = p_championship_id and status = 'reserved') then
      raise exception 'INVALID_STATE';   -- canceled + canchas aún reserved → liberación incompleta
    end if;
    if v_champ.order_id is not null
       and not exists (select 1 from public.orders where id = v_champ.order_id and status in ('failed','expired')) then
      raise exception 'INVALID_STATE';   -- canceled + order no terminal → inconsistente
    end if;
    return v_champ;                       -- terminal consistente → no-op idempotente
  end if;
  if v_champ.status <> 'payment_validation' then raise exception 'INVALID_STATE'; end if;

  -- Defensa contable: nunca rechazar un campeonato que YA tiene spend (fue aprobado).
  if exists (
    select 1 from public.reservations where championship_id = p_championship_id and status = 'spend'
  ) then
    raise exception 'ALREADY_PAID';
  end if;

  -- Order debe estar en 'validation'. Lock.
  if v_champ.order_id is not null then
    perform 1 from public.orders where id = v_champ.order_id for update;
    if not exists (select 1 from public.orders where id = v_champ.order_id and status = 'validation') then
      raise exception 'INVALID_STATE';
    end if;
  end if;

  -- Composición esperada = links del campeonato. Lock de esos games (orden estable).
  select array_agg(game_id) into v_expected
    from public.championship_reservation_games where championship_id = p_championship_id;
  if v_expected is null or array_length(v_expected, 1) is null then
    raise exception 'CHAMPIONSHIP_RELEASE_NO_GAMES';
  end if;
  perform 1 from public.games where id = any(v_expected) order by id for update;

  -- TODOS los esperados deben seguir reserved + pertenecer a ESTE campeonato.
  if exists (
    select 1 from unnest(v_expected) gid
     where not exists (
       select 1 from public.games g
        where g.id = gid and g.championship_id = p_championship_id and g.status = 'reserved'
     )
  ) then
    raise exception 'CHAMPIONSHIP_RELEASE_COMPOSITION_MISMATCH';
  end if;
  -- Ningún game EXTRA puede reclamar este campeonato (consistencia).
  if exists (
    select 1 from public.games g
     where g.championship_id = p_championship_id and g.id <> all(v_expected)
  ) then
    raise exception 'CHAMPIONSHIP_RELEASE_COMPOSITION_MISMATCH';
  end if;

  -- Liberar: reserved → published + championship_id NULL. Dispara trg_reopen_double_out_twin
  -- (gemelo 'blocked' → blocked_from_status). booked_by_user_id ya es NULL en el hold.
  update public.games
     set status = 'published', championship_id = null
   where id = any(v_expected) and championship_id = p_championship_id and status = 'reserved';

  -- Links: eliminar (mismo patrón que _championship_release_hold).
  delete from public.championship_reservation_games where championship_id = p_championship_id;

  -- orders: validation → failed (CAS; si no estaba 'validation', abortar y rollback total).
  if v_champ.order_id is not null then
    -- terminal_reason es CÓDIGO de máquina (como 'timeout'/'user_canceled' del release). Se fija el código
    -- 'admin_rejected'. La nota humana p_reason NO se persiste aquí (no hay columna de detalle; ver nota).
    update public.orders
       set status = 'failed',
           terminal_reason = 'admin_rejected',
           resolved_at = now(),
           updated_at = now()
     where id = v_champ.order_id and status = 'validation';
    if not found then raise exception 'INVALID_STATE'; end if;
  end if;

  -- championships: payment_validation → canceled.
  update public.championships
     set status = 'canceled', hold_expires_at = null, updated_at = now()
   where id = p_championship_id
  returning * into v_champ;

  return v_champ;
end;
$$;
revoke all on function public.reject_championship_transfer(uuid, text) from public, anon;
grant execute on function public.reject_championship_transfer(uuid, text) to authenticated;
