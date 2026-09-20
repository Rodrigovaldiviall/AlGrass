-- ============================================================================
-- Campeonatos · Fase 2 — TRANSFER HOLD MULTICANCHA (aditivo, incremental sobre Fase 1)
-- ============================================================================
-- Prepara el backend del hold de 10 min de Transferencia. NO implementa Admin,
-- spend, refunds, publicación, equipos, jugadores, fixture, sorteo ni resultados.
--
-- Reutiliza al máximo lo existente:
--   · `orders` (resource_type='championship' + amount_total=0 → hold, sin spend);
--   · triggers de doble salida (published→reserved bloquea gemelo; reserved→published lo reabre);
--   · assert_game_reservable (type='rental' + no-empezado);
--   · pg_cron (mismo patrón que expire-slot-reservations, cada 1 minuto).
--
-- DECISIÓN CERRADA: durante el hold cada game queda status='reserved' + championship_id,
--   con booked_by_user_id = NULL (rellenarlo lo haría interpretar como Rental del usuario:
--   Profile/"reservado por ti"/cancelable/rewards). host_user_id NO se toca.
--
-- ADVERTENCIA DE PROFILE (guard de FRONTEND pendiente, NO en este SQL): la query de
--   "hosted games" de Profile es `.eq('host_user_id',uid).in('type',['match','rental'])
--   .in('status',['published','reserved','completed','expired'])`. En cuanto un game pase a
--   'reserved' por un hold, el HOST ORIGINAL lo vería como hosted 'reserved'. Antes del primer
--   hold real hay que añadir en esa query `.is('championship_id', null)` (fase frontend).
--
-- ESTADO 'validation' EN ORDERS: la Transferencia de Campeonato necesita un estado NO terminal
--   entre pending y confirmed (usuario afirmó pagar + adjuntó comprobante; espera Admin, SIN TTL).
--   Se extiende orders.status (+'validation'), la constraint resolved_at (pending|validation ⇔
--   NULL) y se hace pending_expires_at nullable (con guard: 'pending' siempre exige TTL). Pasarelas
--   (Yape/Tarjeta/…) NO usan 'validation': su flujo pending→confirmed/failed/expired queda idéntico.
--
-- 100% ADITIVA: extiende CHECKs, añade 1 columna nullable, relaja 1 NOT NULL (con constraint que
--   preserva la invariante de 'pending'), añade el guard mínimo a create_order (rental) y crea
--   funciones/cron nuevas. No borra datos. Match/Rental/pending normal/doble salida siguen idénticos.
-- ============================================================================


-- ── 1) championships.status: añadir estado transitorio 'transfer_hold' ──────────────────────
-- El CHECK inline de Fase 1 se llama championships_status_check. Se re-crea conservando TODOS
-- los valores existentes y añadiendo 'transfer_hold' al inicio. Compatible con datos actuales.
alter table public.championships drop constraint if exists championships_status_check;
alter table public.championships
  add constraint championships_status_check
  check (status in (
    'transfer_hold',        -- NUEVO: 10 min para transferir + adjuntar comprobante (sin spend)
    'payment_validation',
    'pending_publish',
    'registration_open',
    'registration_closed',
    'in_progress',
    'completed',
    'canceled'
  ));

-- Referencia futura al comprobante (Storage path/id). Nullable; hoy el upload es mock (no hay
-- Storage real conectado) → queda NULL hasta la fase de frontend/pagos.
alter table public.championships
  add column if not exists payment_voucher_ref text;


-- ── 1b) orders.status: añadir estado NO terminal 'validation' (revisión manual) ─────────────
-- Semántica de los estados de order:
--   pending    = hold de 10 min corriendo (SÍ expira por TTL).
--   validation = NUEVO. El usuario afirmó haber transferido + adjuntó comprobante; espera
--                validación de AlGrass. NO terminal (resolved_at IS NULL) y SIN TTL (no expira).
--   confirmed/failed/expired = terminales (resolved_at IS NOT NULL). Sin cambios.
-- EXCLUSIVO de pagos con revisión manual (empieza en Transferencia de Campeonato). Las pasarelas
-- (Yape/Tarjeta/Apple/Google Pay) NUNCA pasan por 'validation': su flujo sigue siendo
-- pending→confirmed o pending→failed/expired, idéntico.
-- El CHECK inline de orders.sql se auto-nombra orders_status_check. Se re-crea conservando los 4
-- valores + 'validation'. Compatible con datos existentes.
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in ('pending','validation','confirmed','failed','expired'));

-- Estados NO resueltos: antes SOLO 'pending'. Ahora 'pending' Y 'validation' son no terminales.
-- Regla: status IN ('pending','validation') ⇔ resolved_at IS NULL;
--        status IN ('confirmed','failed','expired') ⇔ resolved_at IS NOT NULL.
-- La constraint original se llama orders_resolved_at_consistency (nombre explícito en orders.sql).
alter table public.orders drop constraint if exists orders_resolved_at_consistency;
alter table public.orders
  add constraint orders_resolved_at_consistency
  check ((status in ('pending','validation')) = (resolved_at is null));

-- 'validation' NO tiene TTL: pending_expires_at debe poder ser NULL. La columna era NOT NULL;
-- la hacemos nullable (aditivo: filas 'pending' existentes conservan su valor). Para no perder la
-- invariante crítica, se añade una constraint que exige TTL presente SIEMPRE que status='pending'
-- (así expire_orders nunca ve un 'pending' con TTL NULL). Terminales y 'validation' pueden ser NULL.
alter table public.orders alter column pending_expires_at drop not null;
alter table public.orders drop constraint if exists orders_pending_ttl_present;
alter table public.orders
  add constraint orders_pending_ttl_present
  check (status <> 'pending' or pending_expires_at is not null);


-- ── 2) GUARD MÍNIMO en create_order (rental) — NO tomar un game retenido por Championship ───
-- create_order VIGENTE = orders_allow_zero_amount_hold.sql. Copia EXACTA + 3 cambios marcados
-- (v_champ_id / select championship_id / guard en rama rental). Match y championship no se tocan
-- (championship ni siquiera pasa por aquí: resource_type != match/rental → INVALID_RESOURCE_TYPE).
create or replace function public.create_order(
  p_idempotency_key    text,
  p_resource_type      text,
  p_resource_id        uuid,
  p_claim_composition  jsonb,
  p_amount_total       numeric,
  p_currency           text,
  p_financial_snapshot jsonb,
  p_pending_expires_at timestamptz,
  p_payment_provider   text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_existing   public.orders%rowtype;
  v_units      integer;
  v_host       uuid;
  v_booked_by  uuid;
  v_champ_id   uuid;   -- [CHAMPIONSHIP GUARD] championship_id del game
  v_avail      integer;
  v_holds      integer;
  v_referral          uuid;
  v_referral_reserved integer := 0;
  v_titular    boolean;
  v_order      public.orders%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_existing
    from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;

  if p_amount_total is null or p_amount_total < 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_pending_expires_at is null or p_pending_expires_at <= now() then raise exception 'INVALID_TTL'; end if;
  if p_resource_type not in ('match','rental') then raise exception 'INVALID_RESOURCE_TYPE'; end if;

  v_titular := coalesce((p_claim_composition->>'titular')::boolean, false);
  if p_resource_type = 'rental' then
    v_units := 1;
  else
    v_units := (case when v_titular then 1 else 0 end)
             + coalesce(jsonb_array_length(p_claim_composition->'guests'), 0)
             + coalesce((p_claim_composition->>'reserved_slots')::integer, 0);
  end if;
  if v_units < 1 then raise exception 'EMPTY_CLAIM'; end if;

  -- [CHAMPIONSHIP GUARD] además de host/booker, leemos championship_id bajo el mismo lock.
  select g.host_user_id, g.booked_by_user_id, g.championship_id
    into v_host, v_booked_by, v_champ_id
    from public.games g
   where g.id = p_resource_id
   for update of g;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;

  perform public.assert_game_reservable(p_resource_id, p_resource_type);
  if p_resource_type = 'match' and v_titular and v_host is not null and v_host = v_actor then
    raise exception 'HOST_CANNOT_RESERVE';
  end if;

  if p_resource_type = 'match' then
    v_avail := public.public_availability(p_resource_id);
    v_referral := nullif(p_financial_snapshot->>'referral', '')::uuid;
    if v_referral is not null then
      select coalesce(gsr.effective_reserved_slots_remaining, 0)
        into v_referral_reserved
        from public.get_slot_reservation_for_user(p_resource_id, v_referral) gsr;
    end if;
    select coalesce(sum(o.claimed_units), 0)::integer
      into v_holds
      from public.orders o
     where o.resource_id = p_resource_id
       and o.status = 'pending'
       and o.pending_expires_at > now();
    if coalesce((p_claim_composition->>'reserved_slots')::integer, 0) > greatest(v_avail - v_holds, 0) then
      raise exception 'INSUFFICIENT_PUBLIC_SLOTS';
    end if;
    if (v_avail + v_referral_reserved - v_holds) < v_units then raise exception 'NO_CAPACITY'; end if;
  else
    -- rental: 1 unidad. Ocupado si ya está reservado o hay un hold vivo…
    if v_booked_by is not null then raise exception 'NO_CAPACITY'; end if;
    -- [CHAMPIONSHIP GUARD] …o si el game está retenido/reservado por un Campeonato (reserved +
    -- championship_id, booked_by NULL). Sin este guard, el gate rental (solo booked_by) lo dejaría pasar.
    if v_champ_id is not null then raise exception 'NO_CAPACITY'; end if;
    if exists (
      select 1 from public.orders o
       where o.resource_id = p_resource_id and o.status = 'pending' and o.pending_expires_at > now()
    ) then raise exception 'NO_CAPACITY'; end if;
  end if;

  insert into public.orders (
    idempotency_key, payer_user_id, resource_type, resource_id,
    claim_composition, claimed_units, pending_expires_at,
    amount_total, currency, financial_snapshot, payment_provider, status
  ) values (
    p_idempotency_key, v_actor, p_resource_type, p_resource_id,
    p_claim_composition, v_units, p_pending_expires_at,
    p_amount_total, coalesce(p_currency, 'PEN'), p_financial_snapshot, p_payment_provider, 'pending'
  )
  returning * into v_order;

  return v_order;

exception
  when unique_violation then
    select * into v_existing
      from public.orders
     where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
    return v_existing;
end;
$$;
grant execute on function public.create_order(text, text, uuid, jsonb, numeric, text, jsonb, timestamptz, text) to authenticated;


-- ── 3) Helper INTERNO — liberar el hold de un campeonato (games → published, links, order, canceled) ──
-- Asume la fila championships YA bloqueada y verificada por el caller (definer). No expuesto al cliente.
-- ÚNICA lógica central de liberación (games/links/order/championship). La CAUSA la fija el caller,
-- NO el frontend, mediante p_reason (interno, whitelist estricta):
--   'timeout'       → order.status='expired'  (vencimiento real de los 10 min; lo usa el cron).
--   'user_canceled' → order.status='failed'   (cancelación voluntaria; lo usa release_… ).
-- Ambas resuelven el order (resolved_at=now()). El resto de la liberación es idéntico.
create or replace function public._championship_release_hold(
  p_championship_id uuid,
  p_reason          text default 'timeout'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order        uuid;
  v_order_status text;   -- estado terminal del order según la causa
begin
  -- Whitelist de causas (no se aceptan valores arbitrarios). Mapea causa → estado terminal del order.
  if p_reason not in ('timeout','user_canceled') then
    raise exception 'INVALID_RELEASE_REASON: %', p_reason;
  end if;
  v_order_status := case when p_reason = 'user_canceled' then 'failed' else 'expired' end;

  -- Solo games que TODAVÍA pertenezcan a este campeonato y sigan 'reserved'.
  -- reserved → published dispara trg_reopen_double_out_twin (reabre gemelo). booked_by permanece NULL.
  update public.games g
     set status = 'published', championship_id = null
   where g.championship_id = p_championship_id
     and g.status = 'reserved';

  delete from public.championship_reservation_games where championship_id = p_championship_id;

  select order_id into v_order from public.championships where id = p_championship_id;
  if v_order is not null then
    -- Solo un order 'pending' es liberable aquí (el hold sigue vivo). Un 'validation' NO llega a este
    -- helper porque release/expire exigen championship en 'transfer_hold' antes de invocarlo.
    update public.orders
       set status = v_order_status, terminal_reason = p_reason, resolved_at = now(), updated_at = now()
     where id = v_order and status = 'pending';
  end if;

  update public.championships
     set status = 'canceled', hold_expires_at = null, updated_at = now()
   where id = p_championship_id;
end;
$$;
revoke all on function public._championship_release_hold(uuid, text) from public, anon, authenticated;


-- ── 4) RPC — crear el hold multicancha (ATÓMICO: los N games o ninguno) ─────────────────────
create or replace function public.create_championship_transfer_hold(
  p_game_ids        uuid[],
  p_idempotency_key text,
  p_config          jsonb default '{}'::jsonb
)
returns public.championships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor        uuid := auth.uid();
  v_hold_expires timestamptz := now() + interval '10 minutes';
  v_existing     public.orders%rowtype;
  v_champ        public.championships%rowtype;
  v_order        public.orders%rowtype;
  v_ids          uuid[];
  v_id           uuid;
  v_count        integer;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_game_ids is null or array_length(p_game_ids, 1) is null then raise exception 'NO_GAMES'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then raise exception 'MISSING_IDEMPOTENCY_KEY'; end if;

  -- Idempotencia (mismo patrón que orders): (payer, idempotency_key). Reintentos devuelven el mismo hold.
  select * into v_existing from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    select * into v_champ from public.championships where order_id = v_existing.id;
    if found then return v_champ; end if;
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;

  -- Dedupe + orden determinista (id asc) → lock ordenado, menor riesgo de deadlock.
  select array_agg(x order by x) into v_ids from (select distinct unnest(p_game_ids) x) s;
  v_count := array_length(v_ids, 1);
  if v_count is null or v_count < 1 then raise exception 'NO_GAMES'; end if;

  -- Lock de TODOS los games seleccionados (orden determinista).
  perform 1 from public.games where id = any(v_ids) order by id for update;

  -- Revalidar TODOS bajo lock: existen, son rentals no empezados, publicados, sin booker y sin campeonato.
  if (select count(*) from public.games where id = any(v_ids)) <> v_count then
    raise exception 'AVAILABILITY_CHANGED';   -- algún game no existe
  end if;
  foreach v_id in array v_ids loop
    perform public.assert_game_reservable(v_id, 'rental');  -- type='rental' + status in(published,reserved) + no empezado
  end loop;
  if exists (
    select 1 from public.games
     where id = any(v_ids)
       and (status <> 'published' or booked_by_user_id is not null or championship_id is not null)
  ) then
    raise exception 'AVAILABILITY_CHANGED';    -- una o más canchas ya no están libres
  end if;

  -- Crear el championship en 'transfer_hold' (aún NO payment_validation; sin spend).
  insert into public.championships (
    owner_user_id, status, payment_method, hold_expires_at,
    name, cover_theme, privacy, registration_key, results_public,
    event_date, start_time, end_time, venue_id, format_config, registration_closes_at
  ) values (
    v_actor, 'transfer_hold', 'transfer', v_hold_expires,
    p_config->>'name', p_config->>'cover_theme',
    coalesce(p_config->>'privacy', 'private'), p_config->>'registration_key',
    coalesce((p_config->>'results_public')::boolean, true),
    nullif(p_config->>'event_date','')::date, nullif(p_config->>'start_time','')::time,
    nullif(p_config->>'end_time','')::time, nullif(p_config->>'venue_id','')::uuid,
    coalesce(p_config->'format_config', '{}'::jsonb), nullif(p_config->>'registration_closes_at','')::timestamptz
  ) returning * into v_champ;

  -- Order del campeonato — reutiliza `orders` (resource_type='championship'). HOLD sin spend:
  -- amount_total = 0 (permitido por orders_allow_zero_amount_hold). El total intencional queda en el snapshot.
  insert into public.orders (
    idempotency_key, payer_user_id, resource_type, resource_id,
    claim_composition, claimed_units, pending_expires_at,
    amount_total, currency, financial_snapshot, status
  ) values (
    p_idempotency_key, v_actor, 'championship', v_champ.id,
    jsonb_build_object('kind', 'championship_transfer_hold', 'game_ids', to_jsonb(v_ids)),
    v_count, v_hold_expires,
    0, 'PEN',
    jsonb_build_object('source', 'championship_transfer_hold',
                       'intended_total', p_config->'intended_total'),
    'pending'
  ) returning * into v_order;

  update public.championships set order_id = v_order.id, updated_at = now() where id = v_champ.id;

  -- Adquirir físicamente: published → reserved + championship_id (booked_by permanece NULL).
  -- Cada fila dispara trg_block_double_out_twin: si un gemelo ya está tomado → RAISE → rollback total.
  update public.games set status = 'reserved', championship_id = v_champ.id
   where id = any(v_ids);

  -- Links (misma transacción). El unique(game_id) garantiza que ningún game quede en dos campeonatos.
  insert into public.championship_reservation_games (championship_id, game_id)
  select v_champ.id, unnest(v_ids);

  select * into v_champ from public.championships where id = v_champ.id;
  return v_champ;

exception
  when unique_violation then
    -- Carrera de idempotencia (misma key en paralelo) → devolver el hold existente; si no, disponibilidad cambió.
    select * into v_existing from public.orders where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
    if found then
      select * into v_champ from public.championships where order_id = v_existing.id;
      if found then return v_champ; end if;
    end if;
    raise exception 'AVAILABILITY_CHANGED';
end;
$$;
grant execute on function public.create_championship_transfer_hold(uuid[], text, jsonb) to authenticated;


-- ── 5) RPC — liberación VOLUNTARIA del propio hold (X / "Salir y cancelar" / cambiar método) ──
create or replace function public.release_championship_transfer_hold(p_championship_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.owner_user_id <> v_actor then raise exception 'NOT_OWNER'; end if;
  if v_champ.status = 'canceled' then return; end if;                  -- idempotente
  -- Solo se libera un transfer_hold. NUNCA payment_validation / pending_publish / campeonato ajeno.
  if v_champ.status <> 'transfer_hold' then raise exception 'INVALID_STATE'; end if;
  -- Causa fijada por la RPC (no por el frontend): cancelación voluntaria → order 'failed'/user_canceled.
  perform public._championship_release_hold(p_championship_id, 'user_canceled');
end;
$$;
grant execute on function public.release_championship_transfer_hold(uuid) to authenticated;


-- ── 6) RPC — confirmar transferencia (detiene el TTL): transfer_hold → payment_validation ────
-- Games SIGUEN reserved + championship_id + booked_by NULL. NO libera. NO spend. Espera a Admin.
--
-- TODO STORAGE (NO implementar ahora — el upload del comprobante todavía es mock): antes de conectar
-- el flujo real de Transferencia, esta confirmación DEBERÁ exigir y validar un comprobante realmente
-- subido por el owner (p_voucher_ref NOT NULL + verificación de que el objeto existe en Storage y
-- pertenece al owner del campeonato). Hoy p_voucher_ref es opcional a propósito. La UI ya exige adjuntar
-- comprobante para habilitar "Ya realicé la transferencia"; al conectar Storage, el backend debe imponer
-- la MISMA regla aquí (y payment_voucher_ref dejará de ser nullable en esa fase).
create or replace function public.confirm_championship_transfer(
  p_championship_id uuid,
  p_voucher_ref     text default null
)
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
  -- Lock de la fila (serializa contra el cron de expiración — carrera del 00:00).
  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.owner_user_id <> v_actor then raise exception 'NOT_OWNER'; end if;
  if v_champ.status = 'payment_validation' then return v_champ; end if;  -- idempotente (order ya en 'validation')
  if v_champ.status = 'canceled' then raise exception 'HOLD_EXPIRED'; end if; -- el cron ganó la carrera
  if v_champ.status <> 'transfer_hold' then raise exception 'INVALID_STATE'; end if;
  if v_champ.hold_expires_at is null or v_champ.hold_expires_at <= now() then raise exception 'HOLD_EXPIRED'; end if;

  -- Transición ATÓMICA del order asociado: pending → validation (NO terminal, SIN TTL).
  -- Se bloquea la fila del order (mismo lock lógico que el cron, que lo expira vía _release_hold).
  if v_champ.order_id is not null then
    select * into v_order from public.orders where id = v_champ.order_id for update;
    if not found then raise exception 'ORDER_NOT_FOUND'; end if;
    if v_order.status = 'validation' then
      null;  -- idempotente: ya confirmado en una llamada previa dentro de la misma tx lógica
    elsif v_order.status <> 'pending' then
      raise exception 'HOLD_EXPIRED';  -- expired/failed → el cron/otro terminal ganó; no confirmable
    else
      update public.orders
         set status             = 'validation',
             pending_expires_at = null,   -- 'validation' no expira automáticamente
             resolved_at        = null,   -- sigue NO terminal
             updated_at         = now()
       where id = v_champ.order_id;
    end if;
  end if;

  update public.championships
     set status = 'payment_validation',
         hold_expires_at = null,
         payment_voucher_ref = coalesce(p_voucher_ref, payment_voucher_ref),
         updated_at = now()
   where id = p_championship_id
  returning * into v_champ;
  return v_champ;
end;
$$;
grant execute on function public.confirm_championship_transfer(uuid, text) to authenticated;


-- ── 7) Barrido idempotente de holds vencidos (cron). NO expira payment_validation. ──────────
create or replace function public.expire_championship_transfer_holds()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_status text;
  v_exp    timestamptz;
  v_n      integer := 0;
begin
  for v_id in
    select id from public.championships
     where status = 'transfer_hold' and hold_expires_at is not null and hold_expires_at <= now()
     order by id
  loop
    -- Re-check BAJO lock (carrera vs confirm_championship_transfer): solo si sigue vencido.
    select status, hold_expires_at into v_status, v_exp
      from public.championships where id = v_id for update;
    if v_status = 'transfer_hold' and v_exp is not null and v_exp <= now() then
      -- Causa fijada por el cron (no por el frontend): vencimiento real → order 'expired'/timeout.
      perform public._championship_release_hold(v_id, 'timeout');
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.expire_championship_transfer_holds() from public, anon, authenticated;
grant execute on function public.expire_championship_transfer_holds() to service_role;


-- ── 8) Cron cada 1 minuto (mismo patrón que expire-slot-reservations) ───────────────────────
do $$
begin
  perform cron.unschedule('expire-championship-transfer-holds');
exception when others then
  null;
end $$;

select cron.schedule(
  'expire-championship-transfer-holds',
  '* * * * *',                                    -- cada minuto
  $$ select public.expire_championship_transfer_holds(); $$
);
