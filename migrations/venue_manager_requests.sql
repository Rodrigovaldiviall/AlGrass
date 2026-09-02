-- ============================================================================
-- Solicitudes Venue Manager (gestión comercial/operativa de AlGrass)
-- ============================================================================
-- Tabla NUEVA e INDEPENDIENTE. NO otorga rol, NO asigna permisos, NO crea venues,
-- NO convierte al usuario en Venue Manager. Es solo una gestión operativa:
--   usuario envía → pending → AlGrass contacta (contacted) → sin gestiones (closed).
--
-- Aditiva y no destructiva: no toca venue_leads ni ninguna tabla existente. El
-- formulario "Dueño de cancha" pasa a escribir aquí; venue_leads queda intacta.
--
-- Patrón de seguridad = captain_requests.sql: RLS, el usuario SOLO inserta su propia
-- solicitud; los campos de gestión (status/notas/cierre) NUNCA los escribe el cliente.
-- ============================================================================

create table if not exists public.venue_manager_requests (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,

  -- Datos del solicitante (del formulario; NO son notas internas):
  name              text not null,
  email             text not null,
  city              text not null,
  district          text not null,
  venue_name        text not null,
  website           text,

  -- Gestión interna (solo Admin/Staff en fase posterior; el solicitante NUNCA los escribe):
  status            text not null default 'pending'
                      check (status in ('pending', 'contacted', 'closed')),
  admin_notes       text,                              -- seguimiento interno AlGrass (no lo ve el solicitante)
  closed_comment    text,                              -- cómo terminó la gestión (obligatorio al cerrar)
  closed_by_user_id uuid references public.users(id),  -- quién cerró (el NOMBRE se resuelve vía public.users_public.full_name)
  closed_at         timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Integridad del cierre: 'closed' exige comentario NO vacío, fecha y autor; cualquier
  -- estado abierto (pending/contacted) mantiene esos tres campos limpios.
  constraint vmr_closed_fields check (
    (status = 'closed'
       and closed_comment is not null and btrim(closed_comment) <> ''
       and closed_at is not null
       and closed_by_user_id is not null)
    or (status <> 'closed'
       and closed_comment is null
       and closed_at is null
       and closed_by_user_id is null)
  )
);

-- Índice para el futuro Admin: listar por estado, más recientes primero.
create index if not exists venue_manager_requests_status_created
  on public.venue_manager_requests (status, created_at desc);

-- updated_at automático en cada UPDATE (trigger AISLADO a esta tabla).
create or replace function public.venue_manager_requests_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- EXECUTE explícito: nadie puede llamarla directamente (el trigger la ejecuta igual;
-- PostgreSQL solo verifica EXECUTE al crear el trigger, no al dispararse).
revoke all on function public.venue_manager_requests_touch() from public, anon, authenticated;

drop trigger if exists trg_venue_manager_requests_touch on public.venue_manager_requests;
create trigger trg_venue_manager_requests_touch
  before update on public.venue_manager_requests
  for each row execute function public.venue_manager_requests_touch();

alter table public.venue_manager_requests enable row level security;

-- Grants EXPLÍCITOS (no depender de defaults de Supabase, que conceden ALL a anon/authenticated).
-- Se revoca todo a public/anon/authenticated y se concede SOLO INSERT a authenticated. service_role
-- se deja intacto (bypassa RLS; lo usará el backoffice/RPC admin en fase posterior).
-- El solicitante SOLO inserta: sin SELECT/UPDATE/DELETE → no lee notas internas, ni cambia status,
-- ni toca los campos de gestión/cierre.
revoke all on table public.venue_manager_requests from public, anon, authenticated;
grant insert on table public.venue_manager_requests to authenticated;

-- INSERT: el usuario crea SOLO su propia solicitud, en 'pending', sin campos internos.
drop policy if exists venue_manager_requests_insert_own on public.venue_manager_requests;
create policy venue_manager_requests_insert_own
  on public.venue_manager_requests for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and admin_notes is null
    and closed_comment is null
    and closed_by_user_id is null
    and closed_at is null
  );

-- ── Gestión Admin (FASE POSTERIOR — NO incluida aquí) ───────────────────────
-- No hay policies de SELECT/UPDATE/DELETE para authenticated a propósito. La gestión
-- completa (leer solicitudes, escribir admin_notes, pasar a 'contacted'/'closed') irá
-- por RPC SECURITY DEFINER admin-gated, reutilizando el patrón de rol YA existente
-- (mismo que cancel_match / reserve_slots):
--
--   if not exists (select 1 from public.user_roles
--                   where user_id = auth.uid()
--                     and role in ('algrass_admin', 'algrass_staff'))
--   then raise exception 'NOT_AUTHORIZED'; end if;
--
-- Al cerrar, esa RPC fijará: status='closed', closed_comment=<texto>, closed_at=now(),
-- closed_by_user_id=auth.uid(). El constraint vmr_closed_fields garantiza la integridad.
