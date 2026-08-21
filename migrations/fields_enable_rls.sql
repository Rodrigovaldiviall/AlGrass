-- ============================================================================
-- Seguridad · Fase 2 — RLS en public.fields (lectura pública preservada)
-- ============================================================================
-- Objetivo: ACTIVAR Row Level Security en public.fields SIN cambiar el
-- comportamiento funcional actual de la App.
--
-- Estado y justificación (auditado):
--   · Hoy la App SOLO LEE fields: vía join games→fields→venues en GAME_SELECT
--     (getGames/getRentalGames/getGameById) y un select puntual en
--     venueStaffService, desde los roles anon (pre-login) y authenticated.
--   · La App NO escribe fields: no existe ningún INSERT/UPDATE/DELETE sobre la
--     tabla en el código de la App. Las mutaciones de fields provienen de
--     AlGrass-Admin con la service_role key, cuyo rol de Postgres tiene BYPASSRLS
--     → RLS no lo afecta.
--
-- Efecto de esta migración:
--   · RLS habilitado.
--   · UNA política SELECT (anon + authenticated, USING true) → cualquier usuario
--     lee TODAS las canchas, EXACTAMENTE igual que hoy.
--   · INSERT/UPDATE/DELETE desde anon/authenticated quedan denegados por RLS
--     (endurecimiento; la App no los hacía). service_role sigue operando normal.
--
-- Decisiones de estilo (idénticas a la Fase 1 de venues):
--   · NO se usa FORCE ROW LEVEL SECURITY: service_role debe seguir con bypass.
--   · NO se tocan GRANTs, otras tablas, funciones, games, ni Storage.
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
       and c.relname = 'fields'
       and c.relkind = 'r'
  ) then
    raise exception 'ABORT: public.fields no existe como tabla (relkind r); no se aplica RLS.';
  end if;
end $$;

-- ── 2) Activar RLS (idempotente: no-op si ya estaba activo) ───────────────────
alter table public.fields enable row level security;

-- ── 2b) Guard: no debe existir OTRA política de lectura sobre fields ──────────
-- Antes de crear fields_select_public, se verifica que no exista ninguna otra
-- política que otorgue lectura (cmd SELECT o ALL) distinta de la nuestra. Si
-- existe, se ABORTA para NO duplicar políticas de lectura: debe revisarse
-- manualmente primero. (fields_select_public se excluye porque esta migración la
-- recrea de forma idempotente en el paso 3.)
do $$
declare
  v_other text;
begin
  select policyname
    into v_other
    from pg_catalog.pg_policies
   where schemaname = 'public'
     and tablename  = 'fields'
     and cmd in ('SELECT', 'ALL')
     and policyname <> 'fields_select_public'
   order by policyname
   limit 1;

  if v_other is not null then
    raise exception 'ABORT: ya existe otra politica de lectura en public.fields (%). Revisar manualmente antes de crear fields_select_public para no duplicar policies de lectura.', v_other;
  end if;
end $$;

-- ── 3) Política de LECTURA PÚBLICA (anon + authenticated, todos los rows) ──────
-- Idempotente: DROP + CREATE garantiza la definición exacta. USING (true) = sin
-- filtro por fila (comportamiento actual: se leen todas las canchas). Solo SELECT;
-- no se crean políticas de escritura (writes de anon/authenticated denegados).
drop policy if exists fields_select_public on public.fields;
create policy fields_select_public
  on public.fields
  for select
  to anon, authenticated
  using (true);

-- ── 4) Verificación final: RLS activo + política SELECT presente ──────────────
-- No se compara el texto de qual (PostgreSQL puede representarlo distinto entre
-- versiones). Cualquier discrepancia aborta la transacción (rollback total).
do $$
declare
  v_rls boolean;
  v_pol boolean;
begin
  select c.relrowsecurity
    into v_rls
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'fields';

  if v_rls is distinct from true then
    raise exception 'ABORT: RLS no quedó activo en public.fields.';
  end if;

  select exists (
    select 1
      from pg_catalog.pg_policies
     where schemaname = 'public'
       and tablename  = 'fields'
       and policyname = 'fields_select_public'
       and cmd        = 'SELECT'
  )
    into v_pol;

  if not v_pol then
    raise exception 'ABORT: la politica fields_select_public no quedo como se esperaba (FOR SELECT en public.fields).';
  end if;

  raise notice 'OK: RLS activo en public.fields + politica fields_select_public (SELECT, anon+authenticated). Lectura publica preservada.';
end $$;

commit;
