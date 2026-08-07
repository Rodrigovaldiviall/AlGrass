-- ============================================================================
-- Orders · Fase 1 · Etapa 1 — Infraestructura de la tabla `orders`
-- ============================================================================
-- Agregado que coordina un intento de reserva + pago EXTERNO.
--
-- El HOLD es una responsabilidad INTERNA de la Order (no una entidad): se
-- representa por (status = 'pending') + claim_composition + pending_expires_at.
-- NO existe materialized_reservation_ref: la trazabilidad vivirá como columna de
-- proveniencia en el lado DURABLE (reservations) en una etapa posterior.
--
-- Migración COMPLETAMENTE ADITIVA: crea `orders`, sus índices y su RLS.
-- No toca ninguna tabla existente. Sin triggers, sin RPC, sin lógica de negocio,
-- sin consumidores. No cambia ningún comportamiento de la aplicación.
-- ============================================================================

create table if not exists public.orders (
  -- ── Identidad ─────────────────────────────────────────────────────────────
  id                 uuid primary key default gen_random_uuid(),

  -- ── Idempotencia ──────────────────────────────────────────────────────────
  idempotency_key    text not null,   -- único POR usuario (ver constraint compuesto)

  -- ── Estado (4 estados de dominio; el terminal fija resolved_at) ────────────
  status             text not null default 'pending'
                       check (status in ('pending','confirmed','failed','expired')),
  terminal_reason    text,   -- solo para failed/expired (audit). Valores esperados:
                             -- 'payment_rejected' | 'materialization_error'
                             -- | 'resource_canceled' | 'timeout'

  -- ── Usuario ───────────────────────────────────────────────────────────────
  payer_user_id      uuid not null,   -- referencia lógica al pagador (sin FK a propósito)

  -- ── Recurso reservable (polimórfico) ──────────────────────────────────────
  resource_type      text not null check (resource_type in ('match','rental')),
  resource_id        uuid not null,   -- sin FK por polimorfismo

  -- ── Reclamación / HOLD (interno) ──────────────────────────────────────────
  claim_composition  jsonb not null,        -- sobre polimórfico congelado (quién/rol/relación)
  claimed_units      integer not null check (claimed_units >= 1),  -- capacidad que el HOLD consume
  pending_expires_at timestamptz not null,  -- TTL del HOLD (ventana de pago)

  -- ── Snapshot económico congelado (intención al pulsar Pagar) ──────────────
  amount_total       numeric(12,2) not null check (amount_total >= 0), -- monto a cobrar
  currency           text not null default 'PEN',
  financial_snapshot jsonb not null,        -- desglose congelado: unit_price, guests_total,
                                            -- promo, credit_to_apply, players_count, source…
  snapshot_version   smallint not null default 1,  -- forward-compat de la interpretación del jsonb

  -- ── Pago (agnóstico, bifásico-capaz; opaco al dominio) ────────────────────
  -- payment_provider NO es una lista cerrada de proveedores: es únicamente el
  -- identificador LÓGICO del adaptador de pago (slug de enrutamiento). Toda la
  -- semántica específica de un proveedor pertenece al ADAPTADOR, no al dominio.
  -- Por eso: sin CHECK, sin enumeración, texto libre.
  payment_provider   text,    -- nullable hasta iniciar el pago
  payment_binding    jsonb,   -- nullable; contenedor opaco de referencias por rol
                              -- (authorization/capture/intent/session/token…), del adaptador

  -- ── Timestamps / auditoría ────────────────────────────────────────────────
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),  -- mantenido por los RPC en cada mutación
  resolved_at        timestamptz,   -- se fija en la transición terminal

  -- ── Invariantes del modelo (integridad, no lógica de negocio) ─────────────
  constraint orders_payer_idempotency_unique unique (payer_user_id, idempotency_key),
  constraint orders_terminal_reason_scope
    check (terminal_reason is null or status in ('failed','expired')),
  constraint orders_resolved_at_consistency
    check ((status = 'pending') = (resolved_at is null))
);

-- ── Índices para las etapas siguientes (hot path = PENDING) ──────────────────
-- Conteo de HOLDs vivos por recurso (capacidad en create_order) + cancel_game:
create index if not exists orders_resource_pending_idx
  on public.orders (resource_id) where status = 'pending';
-- Barrido de expiración (expire_order sobre PENDING vencidas):
create index if not exists orders_expiry_sweep_idx
  on public.orders (pending_expires_at) where status = 'pending';
-- (Las consultas "órdenes de un usuario" y la política SELECT quedan cubiertas
--  por el índice del UNIQUE compuesto, cuya columna líder es payer_user_id.)

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- El cliente SOLO LEE sus propias órdenes. Toda ESCRITURA irá por RPC
-- SECURITY DEFINER (etapas posteriores) o service_role, que no dependen de
-- estas políticas. Al no existir políticas de INSERT/UPDATE/DELETE, el rol
-- `authenticated` no puede escribir directamente.
alter table public.orders enable row level security;

grant select on public.orders to authenticated;

drop policy if exists orders_select_own on public.orders;
create policy orders_select_own
  on public.orders for select
  to authenticated
  using (payer_user_id = auth.uid());
