-- ============================================================================
-- Campeonatos PÚBLICOS · Inscripción INDIVIDUAL pagada (sin equipo) — backend
-- ============================================================================
-- Reutiliza la MISMA infraestructura de pagos que ya usan los campeonatos (tabla
-- `orders` + wallet/crédito + triggers `trg_championship_spend_wallet` /
-- `trg_orders_credit_restore`), SIN tocar create_order/confirm_order (match/rental)
-- ni game_players. Espejo del patrón de create_championship_gateway_order /
-- confirm_championship_gateway_payment, pero materializando filas en
-- `championship_players` (team_id = NULL) en vez de reservar games.
--
-- Campeonato PÚBLICO = `order_id IS NULL AND public_individual_price IS NOT NULL`
-- (lo fija la creación pública de Admin, 20261105120000). El precio es AUTORIDAD
-- del backend: unit = championships.public_individual_price; total = unit × N.
--
-- Materialización = N filas championship_players(championship_id, user_id, team_id
-- NULL), una por persona pagada (comprador + invitados, todos usuarios reales de
-- users_public). Respeta el UNIQUE(championship_id, user_id): si alguno ya está
-- inscrito (individual o en equipo) la compra se bloquea (all-or-none), NUNCA se
-- sobreescribe su membership.
--
-- NO toca: privados, create_order/confirm_order, game_players, reserve_slots,
-- creación/contraseña de equipos (fase siguiente). Idempotente. Rewards NO se
-- aplican (igual que el resto de pagos de campeonato; reward_applied = 0).
--
-- Errores: AUTH_REQUIRED · CHAMPIONSHIP_NOT_FOUND · NOT_PUBLIC · NOT_OPEN ·
--   NO_PLAYERS · PAYER_NOT_INCLUDED · INVALID_INPUT · ALREADY_ENROLLED ·
--   INVALID_CREDIT · CREDIT_EXCEEDS_TOTAL · INSUFFICIENT_CREDIT · AVAILABILITY_CHANGED.
-- ============================================================================

begin;

-- ── 0 · Pre-checks ───────────────────────────────────────────────────────────
do $pre$
begin
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='championships' and column_name='public_individual_price') then
    raise exception 'Abortado: falta championships.public_individual_price (aplica antes 20261105120000_admin_create_championship_public.sql).';
  end if;
  if to_regprocedure('public.spend_wallet_credit(uuid, numeric)') is null then
    raise exception 'Abortado: falta spend_wallet_credit (nucleo de credito).';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.reservations'::regclass
    and tgname='trg_championship_spend_wallet' and not tgisinternal) then
    raise exception 'Abortado: falta trg_championship_spend_wallet (nucleo de credito).';
  end if;
end $pre$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 1 · Lectura PÚBLICA de precios (para que el App muestre el CTA "Unirme · S/X")
-- ══════════════════════════════════════════════════════════════════════════════
-- Dedicada y mínima: NO reemite get_championship_public (evita drift del read grande).
-- Expone solo is_public + los dos precios. anon + authenticated (el detalle es visible).
create or replace function public.get_championship_public_pricing(p_championship_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'championship_id',        c.id,
    'is_public',              (c.order_id is null and c.public_individual_price is not null),
    'public_individual_price', c.public_individual_price,
    'public_team_price',      c.public_team_price
  )
  from public.championships c
  where c.id = p_championship_id;
$$;
revoke all on function public.get_championship_public_pricing(uuid) from public;
grant execute on function public.get_championship_public_pricing(uuid) to anon, authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2 · Crear la ORDER de inscripción individual (pending) + débito de crédito
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.create_championship_registration_order(
  p_championship_id uuid,
  p_idempotency_key text,
  p_user_ids        uuid[],
  p_config          jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid := auth.uid();
  v_existing public.orders%rowtype;
  v_champ    public.championships%rowtype;
  v_ids      uuid[];
  v_count    integer;
  v_unit     numeric;
  v_total    numeric;
  v_credito  numeric := 0;
  v_externo  numeric;
  v_method   text;
  v_order    public.orders%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  -- Idempotencia (payer, key): reintentos devuelven la MISMA order (sin re-debitar).
  select * into v_existing from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('order_id', v_existing.id, 'amount_total', v_existing.amount_total,
      'external_amount', coalesce((v_existing.financial_snapshot->>'external_amount')::numeric, v_existing.amount_total),
      'status', v_existing.status);
  end if;

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  -- PÚBLICO = sin order de contrato + con precio individual. (No depende de privacy.)
  if not (v_champ.order_id is null and v_champ.public_individual_price is not null) then
    raise exception 'NOT_PUBLIC';
  end if;
  -- Ventana de inscripción: solo con inscripciones abiertas.
  if v_champ.status <> 'registration_open' then raise exception 'NOT_OPEN'; end if;

  -- Personas pagadas: dedup, el COMPRADOR debe ir incluido, y todas usuarios reales.
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_user_ids, '{}'::uuid[])) x where x is not null;
  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count = 0 then raise exception 'NO_PLAYERS'; end if;
  if not (v_actor = any(v_ids)) then raise exception 'PAYER_NOT_INCLUDED'; end if;
  if (select count(*) from public.users_public u where u.id = any(v_ids)) <> v_count then
    raise exception 'INVALID_INPUT';
  end if;

  -- Serializa contra join/leave/manage y contra otra inscripción del mismo campeonato.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  -- Nadie del grupo puede estar ya inscrito (individual o en equipo): all-or-none.
  if exists (select 1 from public.championship_players
              where championship_id = p_championship_id and user_id = any(v_ids)) then
    raise exception 'ALREADY_ENROLLED';
  end if;

  -- PRECIO (autoridad backend). unit = precio individual del campeonato.
  v_unit  := v_champ.public_individual_price;
  v_total := round(v_unit * v_count, 2);

  -- Crédito del comprador (p_config.credit_applied), acotado al total.
  v_credito := round(coalesce((p_config->>'credit_applied')::numeric, 0), 2);
  if v_credito < 0 then raise exception 'INVALID_CREDIT'; end if;
  if v_credito > v_total then raise exception 'CREDIT_EXCEEDS_TOTAL: % > %', v_credito, v_total; end if;
  v_externo := round(v_total - v_credito, 2);
  -- Método EFECTIVO fijado por el backend, SIN confiar en p_config.payment_method: external=0 → 'credit';
  -- external>0 → 'gateway' (única vía externa de esta fase). transfer/cash/yape NO pueden entrar.
  v_method  := case when v_externo = 0 and v_total > 0 then 'credit' else 'gateway' end;

  -- Order pending (TTL 10 min). resource_type='championship'; la distingue claim_composition.kind.
  insert into public.orders (
    idempotency_key, payer_user_id, resource_type, resource_id,
    claim_composition, claimed_units, pending_expires_at,
    amount_total, currency, financial_snapshot, payment_provider, status
  ) values (
    p_idempotency_key, v_actor, 'championship', p_championship_id,
    jsonb_build_object('kind', 'championship_registration', 'user_ids', to_jsonb(v_ids)),
    v_count, now() + interval '10 minutes',
    v_total, 'PEN',
    jsonb_build_object('source','championship_registration','unit_price',v_unit,'player_count',v_count,
      'user_ids', to_jsonb(v_ids), 'credit_applied', v_credito, 'external_amount', v_externo),
    v_method,   -- 'credit' (external=0) o 'gateway' (external>0). Nunca transfer/otros.
    'pending'
  ) returning * into v_order;

  -- Débito de crédito SOLO al crear (nunca en el retorno idempotente). Si falla, rollback total.
  if v_credito > 0 then perform public.spend_wallet_credit(v_actor, v_credito); end if;

  return jsonb_build_object('order_id', v_order.id, 'amount_total', v_total,
    'external_amount', v_externo, 'credit_applied', v_credito, 'status', 'pending', 'payment_method', v_method);
end $$;
revoke all on function public.create_championship_registration_order(uuid, text, uuid[], jsonb) from public, anon;
grant execute on function public.create_championship_registration_order(uuid, text, uuid[], jsonb) to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3 · Confirmar la inscripción → materializar championship_players (team_id NULL)
-- ══════════════════════════════════════════════════════════════════════════════
-- MODELO DE CONFIANZA (decisión explícita): la pasarela es un MOCK en TODA la app
-- (no hay webhook ni prueba externa). Este confirm replica EXACTAMENTE el patrón ya
-- en producción de confirm_championship_gateway_payment: el cliente lo llama tras el
-- cobro simulado; para external_amount>0 NO hay evidencia autoritativa de pago (igual
-- que el gateway del contrato y que Match). El crédito SÍ es autoritativo (se debita
-- server-side en create_...order). Riesgo conocido app-wide: se cerrará globalmente
-- cuando se integre una pasarela real con webhook/aprobación; la única prueba real
-- HOY es la vía TRANSFERENCIA (comprobante + approve_championship_transfer de AlGrass).
create or replace function public.confirm_championship_registration(
  p_championship_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order  public.orders%rowtype;
  v_champ  public.championships%rowtype;
  v_ids    uuid[];
  v_uid    uuid;
  v_method text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_order from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.resource_type <> 'championship' or v_order.resource_id <> p_championship_id
     or coalesce(v_order.claim_composition->>'kind','') <> 'championship_registration' then
    raise exception 'INVALID_STATE';
  end if;

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  -- Idempotencia verificada: ya confirmada + asiento existente → no-op.
  if v_order.status = 'confirmed' then
    if exists (select 1 from public.reservations where order_id = v_order.id and status = 'spend') then
      return jsonb_build_object('order_id', v_order.id, 'status', 'confirmed', 'already', true);
    end if;
    raise exception 'INVALID_STATE';
  end if;
  if v_order.status <> 'pending' then raise exception 'INVALID_STATE'; end if;
  if v_order.pending_expires_at <= now() then raise exception 'ORDER_EXPIRED'; end if;

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.status <> 'registration_open' then raise exception 'AVAILABILITY_CHANGED'; end if;

  select array(select jsonb_array_elements_text(v_order.claim_composition->'user_ids'))::uuid[] into v_ids;
  if v_ids is null or array_length(v_ids,1) is null then raise exception 'INVALID_STATE'; end if;

  -- Revalidar bajo lock: ninguno inscrito entretanto (all-or-none).
  if exists (select 1 from public.championship_players
              where championship_id = p_championship_id and user_id = any(v_ids)) then
    raise exception 'AVAILABILITY_CHANGED';
  end if;

  -- Materializar: una fila por persona, SIN equipo. El UNIQUE(champ,user) aborta ante carrera.
  foreach v_uid in array v_ids loop
    insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, v_uid, null);
  end loop;

  -- Order → confirmed.
  update public.orders set status = 'confirmed', resolved_at = now(), updated_at = now()
   where id = v_order.id;

  -- Método del asiento: 'credit' si el saldo cubrió el total; si no, el provider de la order ('gateway').
  v_method := case when coalesce((v_order.financial_snapshot->>'external_amount')::numeric, v_order.amount_total) = 0
                        and v_order.amount_total > 0
                   then 'credit' else coalesce(v_order.payment_provider, 'gateway') end;

  -- Asiento financiero: 1 spend por order (UNIQUE parcial reservations_championship_order_spend_uq).
  -- El trigger trg_championship_spend_wallet rellena credit_applied desde el snapshot y contabiliza
  -- external_amount; el crédito ya se movió al crear la order.
  insert into public.reservations (
    game_id, championship_id, user_id, order_id,
    status, reservation_type, source, payment_method,
    total_amount, subtotal_amount, credit_applied, reward_applied, promo_discount, promo_code_id,
    reserved_at
  ) values (
    null, p_championship_id, v_order.payer_user_id, v_order.id,
    'spend', 'championship', 'championship_registration', v_method,
    v_order.amount_total, v_order.amount_total, 0, 0, 0, null,
    now()
  );

  return jsonb_build_object('order_id', v_order.id, 'status', 'confirmed',
    'players', array_length(v_ids,1), 'already', false);
end $$;
revoke all on function public.confirm_championship_registration(uuid, text) from public, anon;
grant execute on function public.confirm_championship_registration(uuid, text) to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 4 · Fallo de pasarela → matar la order (crédito se restituye por trigger)
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.fail_championship_registration(
  p_championship_id uuid,
  p_idempotency_key text,
  p_reason          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_order from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status = 'failed' then return jsonb_build_object('order_id', v_order.id, 'status', 'failed'); end if;
  if v_order.status <> 'pending' then raise exception 'INVALID_STATE'; end if;
  -- pending → failed: trg_orders_credit_restore devuelve el crédito aplicado. Sin games que liberar.
  update public.orders
     set status = 'failed', terminal_reason = coalesce(nullif(btrim(p_reason),''),'payment_failed'),
         resolved_at = now(), updated_at = now()
   where id = v_order.id and status = 'pending';
  return jsonb_build_object('order_id', v_order.id, 'status', 'failed');
end $$;
revoke all on function public.fail_championship_registration(uuid, text, text) from public, anon;
grant execute on function public.fail_championship_registration(uuid, text, text) to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 5 · Cerrar el bypass de inscripción GRATIS en públicos pagados
-- ══════════════════════════════════════════════════════════════════════════════
-- join_championship_without_team sigue concedida a `authenticated`: sin este gate,
-- un usuario podría inscribirse GRATIS en un campeonato público de AlGrass llamando
-- la RPC directamente, saltándose el checkout pagado. Se reemite la versión VIGENTE
-- (championships_registration_close_informative.sql) IDÉNTICA + un único corte al
-- inicio: si el campeonato es PÚBLICO de AlGrass (criterio estructural ya vigente:
-- order_id IS NULL AND public_individual_price IS NOT NULL) → PUBLIC_CHAMPIONSHIP_
-- PAYMENT_REQUIRED. Los PRIVADOS (order_id no nulo o sin precio público) se comportan
-- EXACTAMENTE igual que hoy. No se elimina la RPC: el flujo gratuito privado la sigue
-- usando.
create or replace function public.join_championship_without_team(p_championship_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_is_owner boolean;
  v_is_host  boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- (NUEVO) Público de AlGrass con modelo pagado: la inscripción individual es de PAGO
  -- (create_championship_registration_order + confirm). La vía gratuita queda cerrada.
  if v_champ.order_id is null and v_champ.public_individual_price is not null then
    raise exception 'PUBLIC_CHAMPIONSHIP_PAYMENT_REQUIRED';
  end if;

  v_is_owner := (v_champ.owner_user_id = v_actor);
  v_is_host  := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  if v_is_host then raise exception 'NOT_AUTHORIZED'; end if;   -- Host NUNCA (aunque sea owner)

  -- "Sin equipo" SOLO en registration_open (cualquiera) o pending_publish (SOLO owner). En closed+ no aplica.
  if not (v_champ.status = 'registration_open'
          or (v_champ.status = 'pending_publish' and v_is_owner)) then
    raise exception 'NOT_OPEN';
  end if;
  -- (ELIMINADO) corte por now() >= registration_closes_at en registration_open.

  insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, v_actor, null)
  on conflict (championship_id, user_id) do update set team_id = null;

  return jsonb_build_object('championship_id', p_championship_id, 'team_id', null);
end; $$;
-- grants/revokes se conservan de la definición previa (no cambian).


-- ══════════════════════════════════════════════════════════════════════════════
-- 5b · Cerrar el bypass de EQUIPO GRATIS en públicos pagados
-- ══════════════════════════════════════════════════════════════════════════════
-- create_championship_team, save_championship_team (rama CREATE) y join_championship_team
-- están concedidas a `authenticated` y crean championship_teams / championship_players(team_id≠null)
-- SIN pago. Mientras el checkout pagado por equipo (public_team_price) no exista, un usuario normal
-- no debe crear ni unirse a un equipo gratis en un público de AlGrass. Se reemiten las TRES versiones
-- VIGENTES (championships_registration_close_informative.sql) IDÉNTICAS + un único corte:
--   público de AlGrass (order_id IS NULL AND public_individual_price IS NOT NULL) Y actor NO AlGrass staff
--   → PUBLIC_CHAMPIONSHIP_TEAM_PAYMENT_REQUIRED.
-- AlGrass staff NO se bloquea (operaciones internas de organización). Privados: idénticos. No se eliminan
-- las RPC ni se cambian sus grants (create or replace conserva privilegios). La rama UPDATE de
-- save_championship_team no se gatea: en un público pagado no hay capitán/creador normal (la creación ya
-- queda bloqueada) y _champ_can_manage_roster sigue restringiéndola a owner/host/AlGrass.

create or replace function public.create_championship_team(
  p_championship_id uuid,
  p_name            text,
  p_color           text default null,
  p_design          text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
  v_cap   int; v_count int; v_team_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_name is null then raise exception 'INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  -- (NUEVO) público de AlGrass pagado: crear equipo gratis cerrado para usuarios normales.
  if v_champ.order_id is null and v_champ.public_individual_price is not null
     and not public._is_algrass_staff(v_actor) then
    raise exception 'PUBLIC_CHAMPIONSHIP_TEAM_PAYMENT_REQUIRED';
  end if;
  if v_champ.status <> 'registration_open' then raise exception 'NOT_OPEN'; end if;
  -- (ELIMINADO) corte por now() >= registration_closes_at.
  -- Crear equipo ≠ inscribirse: NO se comprueba membership ni se crea championship_player.

  v_cap := public._championship_team_capacity(v_champ.format_config);
  select count(*) into v_count from public.championship_teams where championship_id = p_championship_id;
  if v_count >= v_cap then raise exception 'CAPACITY_FULL'; end if;

  insert into public.championship_teams (championship_id, name, color, design, created_by_user_id)
    values (p_championship_id, v_name, nullif(btrim(coalesce(p_color, '')), ''), nullif(btrim(coalesce(p_design, '')), ''), v_actor)
    returning id into v_team_id;

  return jsonb_build_object('team_id', v_team_id, 'name', v_name);
end; $$;

create or replace function public.join_championship_team(
  p_championship_id uuid,
  p_team_id         uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_is_owner boolean;
  v_is_host  boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- (NUEVO) público de AlGrass pagado: unirse gratis a un equipo cerrado para usuarios normales.
  if v_champ.order_id is null and v_champ.public_individual_price is not null
     and not public._is_algrass_staff(v_actor) then
    raise exception 'PUBLIC_CHAMPIONSHIP_TEAM_PAYMENT_REQUIRED';
  end if;

  v_is_owner := (v_champ.owner_user_id = v_actor);
  v_is_host  := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  -- El HOST NUNCA se inscribe como jugador, AUNQUE además sea owner (el rol Host tiene prioridad para SELF).
  if v_is_host then raise exception 'NOT_AUTHORIZED'; end if;

  -- Ventana SELF de auto-inscripción a EQUIPO (Fase 35):
  --   · RO, RC, in_progress PRE-LIVE → cualquiera (owner/player).
  --   · in_progress LIVE → SOLO owner.
  --   · pending_publish → SOLO owner (membership anticipada).
  if not (
       v_champ.status = 'registration_open'
       or v_champ.status = 'registration_closed'
       or (v_champ.status = 'in_progress' and v_champ.live_started_at is null)
       or (v_champ.status = 'in_progress' and v_champ.live_started_at is not null and v_is_owner)
       or (v_champ.status = 'pending_publish' and v_is_owner)
     ) then
    raise exception 'NOT_OPEN';
  end if;
  -- (ELIMINADO) corte por now() >= registration_closes_at en registration_open.
  if not exists (select 1 from public.championship_teams where id = p_team_id and championship_id = p_championship_id) then
    raise exception 'TEAM_NOT_FOUND';
  end if;

  insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, v_actor, p_team_id)
  on conflict (championship_id, user_id) do update set team_id = excluded.team_id;

  return jsonb_build_object('championship_id', p_championship_id, 'team_id', p_team_id);
end; $$;

create or replace function public.save_championship_team(
  p_championship_id uuid,
  p_team_id         uuid,
  p_name            text,
  p_color           text default null,
  p_design          text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor   uuid := auth.uid();
  v_champ   public.championships%rowtype;
  v_team    public.championship_teams%rowtype;
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_color   text := nullif(btrim(coalesce(p_color, '')), '');
  v_design  text := nullif(btrim(coalesce(p_design, '')), '');
  v_is_owner   boolean;
  v_is_host    boolean;
  v_is_algrass boolean;
  v_is_creator boolean;
  v_creator_priv boolean;
  v_captain    uuid;
  v_is_captain boolean;
  v_can_full   boolean;
  v_can_create boolean;
  v_can_edit   boolean;
  v_can_rename boolean;
  v_cap int; v_count int; v_team_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_name is null then raise exception 'INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  v_is_owner   := (v_champ.owner_user_id = v_actor);
  v_is_host    := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  v_is_algrass := public._is_algrass_staff(v_actor);

  if p_team_id is null then
    -- (NUEVO) público de AlGrass pagado: crear equipo gratis cerrado para usuarios normales (no staff).
    if v_champ.order_id is null and v_champ.public_individual_price is not null and not v_is_algrass then
      raise exception 'PUBLIC_CHAMPIONSHIP_TEAM_PAYMENT_REQUIRED';
    end if;
    -- ── CREATE ── administrativa (owner/host/AlGrass en ventana create_team) o self-service normal en open.
    v_can_create := public._champ_can_manage_roster(p_championship_id, v_actor, 'create_team');
    if not (v_can_create or v_champ.status = 'registration_open') then
      raise exception 'NOT_OPEN';
    end if;
    -- (ELIMINADO) corte por now() >= registration_closes_at para la vía no administrativa en open.
    v_cap := public._championship_team_capacity(v_champ.format_config);
    select count(*) into v_count from public.championship_teams where championship_id = p_championship_id;
    if v_count >= v_cap then raise exception 'CAPACITY_FULL'; end if;

    insert into public.championship_teams (championship_id, name, color, design, created_by_user_id)
      values (p_championship_id, v_name, v_color, v_design, v_actor)
      returning id into v_team_id;
    return jsonb_build_object('team_id', v_team_id, 'name', v_name);
  end if;

  -- ── UPDATE ── (sin cambios: _champ_can_manage_roster + v_can_full ya restringen; en públicos pagados
  -- no existe capitán/creador normal porque la CREATE queda bloqueada arriba).
  select * into v_team from public.championship_teams
   where id = p_team_id and championship_id = p_championship_id for update;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  v_is_creator := (v_team.created_by_user_id = v_actor);
  v_creator_priv := (v_team.created_by_user_id = v_champ.owner_user_id)
                    or public._is_algrass_staff(v_team.created_by_user_id);

  select count(*) into v_count from public.championship_players where team_id = p_team_id;
  select user_id into v_captain from public.championship_players
   where team_id = p_team_id order by joined_at asc, user_id asc limit 1;
  v_is_captain := (v_captain is not null and v_captain = v_actor);

  v_can_full := (v_count = 0 and (not v_creator_priv or v_is_owner or v_is_algrass))
                or (v_count >= 1 and v_is_captain);
  v_can_edit := public._champ_can_manage_roster(p_championship_id, v_actor, 'edit_team');
  v_can_rename := (v_is_owner or v_is_host or v_is_algrass) and v_champ.status <> 'canceled';

  if not (v_can_edit or v_can_full or v_can_rename) then raise exception 'NOT_AUTHORIZED'; end if;
  if v_can_edit or (v_can_full and v_champ.status = 'registration_open') then
    update public.championship_teams
       set name = v_name, color = v_color, design = v_design, updated_at = now()
     where id = p_team_id;
  elsif v_can_rename then
    update public.championship_teams
       set name = v_name, updated_at = now()
     where id = p_team_id;
  else
    raise exception 'NOT_OPEN';
  end if;

  return jsonb_build_object('team_id', p_team_id, 'name', v_name);
end; $$;
-- grants/revokes se conservan de la definición previa (create or replace no los cambia).


-- ══════════════════════════════════════════════════════════════════════════════
-- 6 · Verificación
-- ══════════════════════════════════════════════════════════════════════════════
do $verify$
declare v_def text; v_fn text;
begin
  -- El gate gratis-público quedó puesto.
  select pg_get_functiondef(to_regprocedure('public.join_championship_without_team(uuid)')) into v_def;
  if v_def !~ 'PUBLIC_CHAMPIONSHIP_PAYMENT_REQUIRED' then
    raise exception 'VERIFY: join_championship_without_team no bloquea los publicos pagados.';
  end if;
  if v_def !~ 'public_individual_price is not null' then
    raise exception 'VERIFY: el gate no usa el criterio estructural de publico.';
  end if;
  -- expire_orders sigue siendo GENERICO (expira championship sin filtrar por resource_type).
  select pg_get_functiondef(to_regprocedure('public.expire_orders()')) into v_def;
  if v_def ~* 'resource_type' then
    raise exception 'VERIFY: expire_orders filtra por resource_type; una inscripcion de campeonato no expiraria.';
  end if;
  -- La restitucion de credito al morir la order de campeonato existe (nucleo de credito).
  if not exists (select 1 from pg_trigger where tgrelid='public.orders'::regclass
    and tgname='trg_orders_credit_restore' and not tgisinternal) then
    raise exception 'VERIFY: falta trg_orders_credit_restore; el credito de una inscripcion expirada no se devolveria.';
  end if;

  -- Gates de EQUIPO: crear/unirse gratis bloqueado en publicos pagados (las 3 RPC de usuario normal).
  foreach v_fn in array array[
    'public.create_championship_team(uuid, text, text, text)',
    'public.join_championship_team(uuid, uuid)',
    'public.save_championship_team(uuid, uuid, text, text, text)'
  ] loop
    select pg_get_functiondef(v_fn::regprocedure) into v_def;
    if v_def !~ 'PUBLIC_CHAMPIONSHIP_TEAM_PAYMENT_REQUIRED' then
      raise exception 'VERIFY: % no bloquea equipo gratis en publicos pagados.', v_fn;
    end if;
    if v_def !~ 'public_individual_price is not null' then
      raise exception 'VERIFY: % no usa el criterio estructural de publico.', v_fn;
    end if;
  end loop;

  -- El método externo de la inscripción NO puede ser 'transfer' (ni confiar en p_config): se fuerza gateway.
  select pg_get_functiondef(to_regprocedure('public.create_championship_registration_order(uuid, text, uuid[], jsonb)')) into v_def;
  if v_def ~ 'p_config->>''payment_method''' then
    raise exception 'VERIFY: create_championship_registration_order sigue leyendo p_config.payment_method (transfer podria colarse).';
  end if;
  if v_def !~ '''credit'' else ''gateway''' then
    raise exception 'VERIFY: el metodo externo no esta forzado a gateway.';
  end if;

  raise notice 'OK: bypass gratis (individual y equipo) cerrado en publicos; metodo externo forzado a gateway; expire_orders generico; restitucion de credito presente.';
end $verify$;

commit;
