-- Solicitudes para ser Capitán (Fase 2A). Tabla INDEPENDIENTE: user_roles sigue
-- representando EXCLUSIVAMENTE roles efectivos (esta tabla NO otorga rol alguno).
-- Aditiva y no destructiva: no toca datos ni tablas existentes.

create table if not exists public.captain_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  group_size    text not null check (group_size in ('6_plus', '12_plus', '16_plus')),
  status        text not null default 'pending_review'
                  check (status in ('pending_email_confirmation', 'pending_review', 'approved', 'rejected')),
  review_note   text,
  requested_at  timestamptz not null default now(),
  reviewed_at   timestamptz,
  reviewed_by_user_id uuid references public.users(id),
  assigned_role text check (assigned_role is null or assigned_role in ('captain', 'captain_gold')),

  -- Consistencia de estados (mínima, sin dificultar el futuro Admin):
  -- (1) Solicitud ABIERTA (pending_*): sin datos de revisión ni rol asignado.
  constraint captain_requests_open_clean check (
    status not in ('pending_email_confirmation', 'pending_review')
    or (reviewed_at is null and reviewed_by_user_id is null and assigned_role is null)
  ),
  -- (2) assigned_role SOLO puede existir en approved.
  constraint captain_requests_role_only_approved check (
    assigned_role is null or status = 'approved'
  ),
  -- (3) approved DEBE tener rol asignado (lo pondrá la futura RPC de aprobación).
  constraint captain_requests_approved_has_role check (
    status <> 'approved' or assigned_role is not null
  )
);

-- Una sola solicitud ABIERTA por usuario. rejected/approved NO cuentan → se preserva
-- historial y el usuario puede volver a solicitar tras un rechazo (nueva fila).
create unique index if not exists captain_requests_one_open
  on public.captain_requests (user_id)
  where status in ('pending_email_confirmation', 'pending_review');

-- Índice para el futuro Admin: listar por estado, más recientes primero.
create index if not exists captain_requests_status_requested_at
  on public.captain_requests (status, requested_at desc);

alter table public.captain_requests enable row level security;

-- Grants explícitos (mismo patrón que orders.sql). El cliente lee sus solicitudes e inserta la suya;
-- la autorización fina la imponen las policies + los CHECK. Sin UPDATE/DELETE para authenticated.
grant select, insert on public.captain_requests to authenticated;

-- SELECT: cada usuario ve SOLO sus propias solicitudes.
drop policy if exists captain_requests_select_own on public.captain_requests;
create policy captain_requests_select_own
  on public.captain_requests for select
  to authenticated
  using (user_id = auth.uid());

-- INSERT: el usuario crea SOLO su solicitud, en 'pending_review', sin campos de revisión/rol.
-- (En esta fase NO se permite crear en 'pending_email_confirmation'; eso llegará con el correo.)
drop policy if exists captain_requests_insert_own on public.captain_requests;
create policy captain_requests_insert_own
  on public.captain_requests for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending_review'
    and reviewed_at is null
    and reviewed_by_user_id is null
    and assigned_role is null
    and review_note is null
  );

-- SIN policies de UPDATE/DELETE para authenticated: aprobar/rechazar/asignar rol irá por
-- RPC SECURITY DEFINER admin-gated en una fase posterior. El usuario no puede modificar ni borrar.
