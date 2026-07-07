-- ============================================================================
-- FASE 1 — Roles GLOBALES de AlGrass. Migración única, lista para Supabase.
-- ============================================================================
-- Roles globales: captain, captain_gold, algrass_staff, algrass_admin.
-- (No existe 'player'.) captain y captain_gold tienen permisos IDÉNTICOS; solo
-- difieren en la expiración futura de las reservas (captain expira 48h antes;
-- captain_gold no expira). Un usuario NO puede tener ambos tiers a la vez.
--
-- Permisos CONTEXTUALES (NO viven aquí, no se tocan):
--   venues.manager_user_id · venue_staff · host (games.host_user_id)
--
-- No modifica ninguna tabla existente. No reutiliza users.role.
--
-- Autorización: se valida EXPLÍCITAMENTE dentro de grant_captain()/revoke_captain().
-- Las policies RLS son solo una capa adicional de protección, NUNCA el mecanismo
-- principal de autorización.
-- ============================================================================

-- ── Tabla ────────────────────────────────────────────────────────────────────
create table if not exists public.user_roles (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null references public.users(id) on delete cascade,
  role                text        not null,
  granted_by_user_id  uuid        references public.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint user_roles_role_check
    check (role in ('captain', 'captain_gold', 'algrass_staff', 'algrass_admin')),
  -- Un mismo usuario no puede tener dos veces el mismo rol.
  constraint user_roles_user_role_key unique (user_id, role)
);

-- ── Índices ──────────────────────────────────────────────────────────────────
create index if not exists user_roles_user_id_idx on public.user_roles using btree (user_id);
create index if not exists user_roles_role_idx    on public.user_roles using btree (role);

-- Exclusión mutua de tiers de capitán: un usuario tiene como MÁXIMO uno de
-- {captain, captain_gold}. Índice único parcial sobre user_id restringido a esos roles.
create unique index if not exists user_roles_single_captain_tier
  on public.user_roles using btree (user_id)
  where role in ('captain', 'captain_gold');

-- ── RLS (capa adicional, NO es el mecanismo de autorización) ─────────────────
-- Este proyecto concede GRANT ALL a authenticated/anon por defecto en tablas
-- nuevas: lo revocamos y dejamos SOLO SELECT. Escritura únicamente vía
-- service_role o las funciones SECURITY DEFINER de más abajo.
revoke all on public.user_roles from anon, authenticated;
grant select on public.user_roles to authenticated;

alter table public.user_roles enable row level security;

-- Lectura: cada usuario SOLO ve sus propios roles.
drop policy if exists user_roles_select_own on public.user_roles;
create policy user_roles_select_own
  on public.user_roles
  for select
  to authenticated
  using (user_id = auth.uid());

-- Sin policies de INSERT/UPDATE/DELETE → con RLS activo ningún cliente puede
-- escribir. (Defensa en profundidad; la autorización real está en las funciones.)

-- ── Helper functions ─────────────────────────────────────────────────────────
-- ¿Es AlGrass staff o admin?
create or replace function public.is_platform_admin_or_staff(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
     where user_id = p_user_id
       and role in ('algrass_staff', 'algrass_admin')
  );
$$;

-- ¿Es capitán? (cualquiera de los dos tiers; permisos idénticos)
create or replace function public.is_captain(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
     where user_id = p_user_id
       and role in ('captain', 'captain_gold')
  );
$$;

-- ¿Es owner de AL MENOS UN venue? El propietario se identifica por venues.manager_user_id.
create or replace function public.is_any_venue_owner(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.venues
    where manager_user_id = p_user_id
  );
$$;

-- ── grant_captain() ──────────────────────────────────────────────────────────
-- Otorga Captain (rol GLOBAL). Autorizado: AlGrass Staff, AlGrass Admin, o
-- Venue Owner de al menos un venue. El venue solo sirve para autorizar al owner;
-- no forma parte del dato guardado, porque la capitanía es global.
-- granted_by_user_id se guarda solo para auditoría interna.
create or replace function public.grant_captain(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_granter uuid := auth.uid();
begin
  if v_granter is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not (
       public.is_platform_admin_or_staff(v_granter)
    or public.is_any_venue_owner(v_granter)
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- Si ya tiene cualquier tier de capitán (captain o captain_gold), es un error
  -- de lógica: lo hacemos explícito en vez de un return silencioso.
  if public.is_captain(p_user_id) then
    raise exception 'ALREADY_CAPTAIN';
  end if;

  insert into public.user_roles (user_id, role, granted_by_user_id)
  values (p_user_id, 'captain', v_granter)
  on conflict (user_id, role) do nothing;
end;
$$;

-- ── grant_captain_gold() ─────────────────────────────────────────────────────
-- Otorga o eleva a captain_gold. Misma autorización que grant_captain():
-- Venue Owner (de al menos un venue), AlGrass Staff o AlGrass Admin.
--   - Ya tiene captain_gold → ALREADY_CAPTAIN_GOLD.
--   - Tiene captain         → lo reemplaza por captain_gold (preserva exclusión mutua).
--   - Sin ningún tier       → inserta captain_gold directamente.
create or replace function public.grant_captain_gold(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_granter uuid := auth.uid();
begin
  if v_granter is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not (
       public.is_platform_admin_or_staff(v_granter)
    or public.is_any_venue_owner(v_granter)
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if exists (
    select 1 from public.user_roles
     where user_id = p_user_id and role = 'captain_gold'
  ) then
    raise exception 'ALREADY_CAPTAIN_GOLD';
  end if;

  -- Reemplaza el tier básico si existe (delete + insert) manteniendo la exclusión mutua.
  delete from public.user_roles
   where user_id = p_user_id and role = 'captain';

  insert into public.user_roles (user_id, role, granted_by_user_id)
  values (p_user_id, 'captain_gold', v_granter)
  on conflict (user_id, role) do nothing;
end;
$$;

-- ── revoke_captain() ─────────────────────────────────────────────────────────
-- Revoca la capitanía (cualquiera de los dos tiers: captain o captain_gold).
-- Autorizado SOLO: AlGrass Staff, AlGrass Admin. El Venue Owner NO puede revocar.
create or replace function public.revoke_captain(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_granter uuid := auth.uid();
begin
  if v_granter is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_platform_admin_or_staff(v_granter) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  delete from public.user_roles
   where user_id = p_user_id and role in ('captain', 'captain_gold');
end;
$$;

-- ── Grants de ejecución ──────────────────────────────────────────────────────
-- Ejecutables desde el cliente: la autorización se valida DENTRO de cada función.
grant execute on function public.grant_captain(uuid)      to authenticated;
grant execute on function public.grant_captain_gold(uuid) to authenticated;
grant execute on function public.revoke_captain(uuid)     to authenticated;

-- Los helpers no se exponen al cliente (uso interno de las funciones).
revoke all on function public.is_platform_admin_or_staff(uuid) from anon, authenticated;
revoke all on function public.is_captain(uuid)                 from anon, authenticated;
revoke all on function public.is_any_venue_owner(uuid)         from anon, authenticated;
