-- ============================================================================
-- Seguridad · Fase 1 — RLS en public.venues (lectura pública preservada)
-- ============================================================================
-- Objetivo: ACTIVAR Row Level Security en public.venues SIN cambiar el
-- comportamiento funcional actual de la App.
--
-- Estado y justificación (auditado):
--   · Hoy la App SOLO LEE venues (getVenues, select city, covers vía join
--     games→fields→venues) desde los roles anon (pre-login) y authenticated.
--   · La App NO escribe venues: el único writer, uploadVenueCover(), está definido
--     pero NO se invoca en ningún flujo de la App. Las mutaciones de venues
--     provienen de AlGrass-Admin con la service_role key, cuyo rol de Postgres
--     tiene BYPASSRLS → RLS no lo afecta.
--
-- Efecto de esta migración:
--   · RLS habilitado.
--   · UNA política SELECT (anon + authenticated, USING true) → cualquier usuario
--     lee TODOS los venues, EXACTAMENTE igual que hoy.
--   · INSERT/UPDATE/DELETE desde anon/authenticated quedan denegados por RLS
--     (endurecimiento; la App no los hacía). service_role sigue operando normal.
--
-- Decisiones de estilo (igual que fases previas):
--   · NO se usa FORCE ROW LEVEL SECURITY: service_role debe seguir con bypass.
--   · NO se tocan GRANTs, otras tablas, funciones, ni Storage.
--   · Idempotente (re-ejecutable) y con verificación final que ABORTA (rollback)
--     si el estado no queda exactamente como se espera.
-- ============================================================================

begin;

-- ── 1) Comprobación previa: la tabla debe existir como tabla ordinaria ────────
do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'venues'
       and c.relkind = 'r'
  ) then
    raise exception 'ABORT: public.venues no existe como tabla (relkind r); no se aplica RLS.';
  end if;
end $$;

-- ── 2) Activar RLS (idempotente: no-op si ya estaba activo) ───────────────────
alter table public.venues enable row level security;

-- ── 2b) Guard: no debe existir OTRA política de lectura sobre venues ──────────
-- Antes de crear venues_select_public, se verifica que no exista ninguna otra
-- política que otorgue lectura (cmd SELECT o ALL) distinta de la nuestra. Si
-- existe, se ABORTA para NO duplicar políticas de lectura: debe revisarse
-- manualmente primero. (venues_select_public se excluye porque esta migración la
-- recrea de forma idempotente en el paso 3.)
do $$
declare
  v_other text;
begin
  select policyname
    into v_other
    from pg_catalog.pg_policies
   where schemaname = 'public'
     and tablename  = 'venues'
     and cmd in ('SELECT', 'ALL')
     and policyname <> 'venues_select_public'
   order by policyname
   limit 1;

  if v_other is not null then
    raise exception 'ABORT: ya existe otra politica de lectura en public.venues (%). Revisar manualmente antes de crear venues_select_public para no duplicar policies de lectura.', v_other;
  end if;
end $$;

-- ── 3) Política de LECTURA PÚBLICA (anon + authenticated, todos los rows) ──────
-- Idempotente: DROP + CREATE garantiza la definición exacta. USING (true) = sin
-- filtro por fila (comportamiento actual: se leen todos los venues). Solo SELECT;
-- no se crean políticas de escritura (writes de anon/authenticated denegados).
drop policy if exists venues_select_public on public.venues;
create policy venues_select_public
  on public.venues
  for select
  to anon, authenticated
  using (true);

-- ── 4) Verificación final: RLS activo + política SELECT/USING(true) presente ───
-- Cualquier discrepancia aborta la transacción (rollback total).
do $$
declare
  v_rls boolean;
  v_pol boolean;
begin
  select c.relrowsecurity
    into v_rls
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'venues';

  if v_rls is distinct from true then
    raise exception 'ABORT: RLS no quedó activo en public.venues.';
  end if;

  select exists (
    select 1
      from pg_catalog.pg_policies
     where schemaname = 'public'
       and tablename  = 'venues'
       and policyname = 'venues_select_public'
       and cmd        = 'SELECT'
  )
    into v_pol;

  if not v_pol then
    raise exception 'ABORT: la politica venues_select_public no quedo como se esperaba (FOR SELECT en public.venues).';
  end if;

  raise notice 'OK: RLS activo en public.venues + politica venues_select_public (SELECT, anon+authenticated, USING true). Lectura publica preservada.';
end $$;

commit;
