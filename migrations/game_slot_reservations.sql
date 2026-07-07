-- ============================================================================
-- FASE 2/3 — game_slot_reservations. GRUPO de cupos originado por el capitán.
-- ============================================================================
-- La reserva representa el GRUPO del capitán en un partido. La pertenencia
-- permanente vive en game_players.game_slot_reservation_id (ver migración
-- add_game_players_reservation_link.sql).
--
-- Semántica de contadores (modelo grupo):
--   reserved_slots_total     : capacidad GARANTIZADA reservada al público.
--   reserved_slots_used      : nº ACTUAL de jugadores confirmados del grupo.
--                              Lo mantienen EXPLÍCITAMENTE las RPC (sin trigger).
--                              PUEDE superar reserved_slots_total.
--   reserved_slots_remaining : capacidad garantizada aún no utilizada. COLUMNA
--                              GENERADA = greatest(total - used, 0). No se inserta.
--   Ya NO existe el invariante used + remaining = total.
--
-- Ciclo de vida (status): active · released · expired · canceled.
--   - SOLO status='active' RETIENE cupos (aporta remaining al held).
--   - released puede volver a active (reserve_slots, "volver a reservar cupos").
--   - expired y canceled son terminales (nunca vuelven a active).
--   - released/expired/canceled: el grupo sigue vivo y el link sigue admitiendo
--     nuevos miembros al mismo game_slot_reservation_id, pero como PÚBLICOS.
--
-- Snapshot al dejar de retener (se rellena una vez al pasar a released/expired/
-- canceled; lo mantienen las RPC, sin trigger):
--   released_reserved_slots_used / released_reserved_slots_remaining.
--   Tras el snapshot, reserved_slots_used sigue evolucionando (tamaño actual del grupo).
--
-- Máximo UNA reserva REUTILIZABLE por (game_id, reserved_by_user_id):
--   status IN ('active','released'). Los terminales (expired/canceled) no cuentan.
-- No modifica users.role. Escritura cerrada al cliente (RLS lectura-propia).
-- ============================================================================

-- ── Tabla ────────────────────────────────────────────────────────────────────
create table if not exists public.game_slot_reservations (
  id                       uuid        primary key default gen_random_uuid(),
  game_id                  uuid        not null references public.games(id) on delete cascade,
  reserved_by_user_id      uuid        not null references public.users(id) on delete cascade,
  reserved_by_role         text        not null,
  status                   text        not null default 'active',
  reserved_slots_total     integer     not null,
  reserved_slots_used      integer     not null default 0,
  reserved_slots_remaining integer     generated always as (greatest(reserved_slots_total - reserved_slots_used, 0)) stored,
  released_reserved_slots_used      integer,
  released_reserved_slots_remaining integer,
  expires_at               timestamptz,
  released_at              timestamptz,
  released_by_user_id      uuid        references public.users(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint game_slot_reservations_role_check
    check (reserved_by_role in ('captain', 'captain_gold', 'algrass_staff', 'algrass_admin', 'venue_owner')),
  constraint game_slot_reservations_status_check
    check (status in ('active', 'released', 'expired', 'canceled')),
  constraint game_slot_reservations_total_positive check (reserved_slots_total > 0),
  constraint game_slot_reservations_used_nonneg    check (reserved_slots_used >= 0)
);

-- ── Índices ──────────────────────────────────────────────────────────────────
-- Máximo UNA reserva REUTILIZABLE por (game_id, reserved_by_user_id): las
-- reutilizables son active y released; los terminales (expired/canceled) no
-- cuentan, por lo que un capitán puede acumular varios históricos y crear R2.
create unique index if not exists game_slot_reservations_active_uk
  on public.game_slot_reservations using btree (game_id, reserved_by_user_id)
  where status in ('active', 'released');

create index if not exists game_slot_reservations_game_id_idx
  on public.game_slot_reservations using btree (game_id);
create index if not exists game_slot_reservations_reserved_by_idx
  on public.game_slot_reservations using btree (reserved_by_user_id);

-- ── RLS (capa adicional, NO es el mecanismo de autorización) ─────────────────
revoke all on public.game_slot_reservations from anon, authenticated;
grant select on public.game_slot_reservations to authenticated;

alter table public.game_slot_reservations enable row level security;

-- Lectura: cada usuario SOLO ve las reservas que creó.
drop policy if exists game_slot_reservations_select_own on public.game_slot_reservations;
create policy game_slot_reservations_select_own
  on public.game_slot_reservations
  for select
  to authenticated
  using (reserved_by_user_id = auth.uid());

-- Sin policies de INSERT/UPDATE/DELETE → ningún cliente escribe. La composición
-- del grupo (reserved_slots_used, propagación, snapshot released_*) la mantienen
-- EXPLÍCITAMENTE las RPC (service_role / SECURITY DEFINER).
