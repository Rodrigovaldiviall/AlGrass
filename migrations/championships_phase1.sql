-- ============================================================================
-- Campeonatos · Fase 1 — MODELO BASE (aditivo, seguro para producción)
-- ============================================================================
-- Crea la infraestructura mínima para soportar POSTERIORMENTE el hold multi-cancha
-- de Transferencia + orders de campeonato. NO implementa todavía ninguna lógica de
-- negocio (nada de create_championship_hold, cron, confirm/approve/reject, spend,
-- fixture, equipos, inscripciones, resultados). Solo tablas/columnas/constraints/RLS.
--
-- 100% ADITIVA:
--   · crea `championships` y `championship_reservation_games` (nuevas);
--   · añade `games.championship_id` (nullable, default null → games actuales intactos);
--   · EXTIENDE el CHECK de `orders.resource_type` para admitir 'championship'
--     (compatible: 'match'/'rental' siguen válidos).
-- NO toca: create_order, public_availability, claim_rental_double_out_aware,
--   cancelaciones, triggers de doble salida, ni ningún order/game existente.
--
-- DECISIÓN validada (booked_by_user_id): el hold de Transferencia NO debe rellenar
--   games.booked_by_user_id. El estado del hold será status='reserved' + championship_id
--   (con booked_by_user_id = NULL). Rellenar booked_by_user_id haría que la cancha del
--   campeonato apareciera como RENTAL del usuario en Profile, como "reservado por ti" y
--   cancelable en RentalDetail, generara notificaciones/recompensas de rental y fuese
--   auto-cancelable/refundable — todos efectos incorrectos. Ese guard (que create_order
--   rechace un game con championship_id) vive en la MIGRACIÓN DEL HOLD, no aquí.
-- ============================================================================


-- ── 1) championships — agregado principal (sustituye cv.championship del mock) ──────────────
create table if not exists public.championships (
  id                    uuid primary key default gen_random_uuid(),

  -- Owner = usuario que pagó/creó (referencia LÓGICA, sin FK, igual que orders.payer_user_id).
  owner_user_id         uuid not null,

  -- Estado del campeonato. text + CHECK (convención del proyecto; sin ENUM).
  status                text not null default 'payment_validation'
    check (status in (
      'payment_validation',   -- transferencia enviada, esperando validación de AlGrass ("Validando pago")
      'pending_publish',      -- pago confirmado (electrónico) o transferencia aprobada → puede publicar
      'registration_open',    -- publicado; inscripciones abiertas
      'registration_closed',  -- inscripciones cerradas (sorteo + fixture) → Calendario y resultados
      'in_progress',          -- en juego (futuro)
      'completed',            -- finalizado (futuro)
      'canceled'              -- cancelado (hold expirado / Admin rechaza)
    )),

  -- Método de pago con el que se creó (define el status inicial: electrónico → pending_publish,
  -- transferencia → payment_validation). text libre (adaptador), sin CHECK cerrado.
  payment_method        text,

  -- ── Configuración/portada (lo que ya usa la UX; persiste el mock) ─────────────────────────
  name                  text,
  cover_theme           text,
  privacy               text not null default 'private' check (privacy in ('private','public')),
  registration_key      text,
  results_public        boolean not null default true,

  -- ── Fecha / horario / sede del evento ─────────────────────────────────────────────────────
  event_date            date,
  start_time            time,
  end_time              time,
  venue_id              uuid,   -- referencia lógica a venues (sin FK a propósito, como orders/games)

  -- Snapshot de la configuración contratada (mode liga/torneo, rango de equipos, formato,
  -- slot/sede, capacidad visual…). jsonb para forward-compat sin migraciones por cada campo.
  format_config         jsonb  not null default '{}'::jsonb,

  -- ── Ciclo de vida ─────────────────────────────────────────────────────────────────────────
  registration_closes_at timestamptz,  -- cierre de inscripciones (regla AlGrass, N días antes)
  published_at           timestamptz,   -- se fija al publicar
  hold_expires_at        timestamptz,   -- TTL del transfer_hold (10 min); NULL fuera del hold

  -- Proveniencia del pago (Order que originó el campeonato). Solo trazabilidad; el dominio no la
  -- lee para decidir estado (mismo criterio que reservations.order_id). Sin FK.
  order_id               uuid,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Índices de acceso frecuente.
create index if not exists championships_owner_idx on public.championships (owner_user_id);
-- Barrido futuro del hold vencido (cron de expiración): holds vivos con TTL.
create index if not exists championships_hold_sweep_idx
  on public.championships (hold_expires_at) where hold_expires_at is not null;


-- ── 2) games.championship_id — asociar los bloques físicos (rentals) al campeonato ──────────
-- Nullable + default null → TODOS los games actuales (match/rental/doble salida) quedan
-- championship_id = null y su comportamiento no cambia. FK con ON DELETE SET NULL.
alter table public.games
  add column if not exists championship_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'games_championship_id_fkey'
  ) then
    alter table public.games
      add constraint games_championship_id_fkey
      foreign key (championship_id) references public.championships(id) on delete set null;
  end if;
end $$;

create index if not exists games_championship_id_idx
  on public.games (championship_id) where championship_id is not null;


-- ── 3) championship_reservation_games — link 1 campeonato → N games/canchas reservadas ──────
-- SOLO reserva física (qué canchas pertenecen al campeonato). NO jugadores, NO fixture.
create table if not exists public.championship_reservation_games (
  championship_id uuid not null references public.championships(id) on delete cascade,
  game_id         uuid not null references public.games(id)         on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (championship_id, game_id)
);
-- Un game solo puede pertenecer a la reserva de UN campeonato a la vez.
create unique index if not exists championship_reservation_games_game_unique
  on public.championship_reservation_games (game_id);


-- ── 4) orders.resource_type → admitir 'championship' (EXTENSIÓN compatible) ─────────────────
-- El CHECK inline original ('match','rental') se llama orders_resource_type_check.
-- Se reemplaza por uno que además admite 'championship'. Compatible con datos existentes
-- (todos son match/rental, que siguen siendo válidos). NO se crea otra tabla financiera.
alter table public.orders drop constraint if exists orders_resource_type_check;
alter table public.orders
  add constraint orders_resource_type_check
  check (resource_type in ('match','rental','championship'));


-- ── 5) RLS — cerrar las tablas nuevas (patrón del proyecto) ─────────────────────────────────
-- Sin permisos de escritura al cliente: TODA mutación de estado (crear, hold, aprobar, rechazar,
-- publicar, cerrar) irá por RPCs SECURITY DEFINER en migraciones posteriores. Aquí solo SELECT.
alter table public.championships enable row level security;

-- SELECT: el owner ve su campeonato; cualquiera ve los ya publicados en adelante; staff/admin ven todo.
create policy championships_select
  on public.championships
  for select
  using (
    owner_user_id = auth.uid()
    or status in ('registration_open','registration_closed','in_progress','completed')
    or exists (
      select 1 from public.user_roles ur
       where ur.user_id = auth.uid()
         and ur.role in ('algrass_admin','algrass_staff')
    )
  );

alter table public.championship_reservation_games enable row level security;

-- SELECT: solo el owner del campeonato asociado (o staff/admin). Sin escritura del cliente.
create policy championship_reservation_games_select
  on public.championship_reservation_games
  for select
  using (
    exists (
      select 1 from public.championships c
       where c.id = championship_reservation_games.championship_id
         and c.owner_user_id = auth.uid()
    )
    or exists (
      select 1 from public.user_roles ur
       where ur.user_id = auth.uid()
         and ur.role in ('algrass_admin','algrass_staff')
    )
  );
