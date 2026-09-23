-- ============================================================================
-- Campeonatos · Fase 7 — Acceso público seguro + verificación de clave (sin exponer registration_key)
-- ============================================================================
-- Cierra la fase de ACCESO/PERMISOS de campeonatos publicados. NO crea tablas de membership/equipos.
--
-- Problema de seguridad: la RLS de championships permite a cualquier authenticated LEER las filas
-- publicadas, y esas filas incluyen registration_key → la clave llegaba al cliente. Aquí se define una
-- SUPERFICIE PÚBLICA explícita (RPCs SECURITY DEFINER) que NUNCA devuelve registration_key:
--   · list_public_championships()            → listado seguro (anon+authenticated)
--   · get_championship_public(id)            → detalle seguro (anon+authenticated); incluye owner_user_id
--                                              y has_registration_key, NO la clave
--   · verify_championship_access(id, key)    → true/false server-side (anon+authenticated); owner bypass
--   · get_championship_registration_key(id)  → devuelve la clave SOLO al owner (authenticated)
--
-- SEMÁNTICA (dejar explícita): results_public / privacy NO controlan el acceso durante inscripciones.
-- Durante registration_open el visitante NO-owner SIEMPRE necesita la clave para entrar. results_public
-- es configuración GUARDADA para la fase futura de Calendario/Resultados (no se usa como gate hoy).
--
-- ADITIVA. NO toca RLS existente, publish/privacy/cover, payment/order, checkout, Admin. NO service_role.
--
-- CIERRE DE FUGA (columna): la RLS es row-level y NO protege columnas; con el SELECT por defecto de
-- Supabase, cualquier anon/authenticated podía pedir championships.registration_key directamente. Aquí
-- se RETIRA el SELECT directo sobre la tabla (anon+authenticated) y TODA lectura pasa por estas RPC
-- SECURITY DEFINER (que corren como owner y no dependen de ese grant). El owner obtiene su clave solo por
-- get_championship_registration_key. "Mis campeonatos" pasa a list_my_championships (owner-scoped).
-- ============================================================================

-- ── 0) Cerrar la lectura directa de la tabla (todo por RPC). Los writes ya solo ocurren vía RPC
--       SECURITY DEFINER + RLS (sin policy de escritura), así que basta con retirar SELECT. ──────────
revoke select on public.championships from anon;
revoke select on public.championships from authenticated;

-- Estados en los que un campeonato es "accesible/visible" públicamente (publicado en adelante).
-- (Se replica inline en cada función para no depender de un helper.)

-- ── 1) list_public_championships — listado público (columnas seguras, SIN registration_key) ──────────
create or replace function public.list_public_championships()
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'cover_theme', c.cover_theme, 'status', c.status,
    'privacy', c.privacy, 'results_public', c.results_public,
    'event_date', c.event_date, 'start_time', c.start_time, 'end_time', c.end_time,
    'venue_id', c.venue_id, 'format_config', c.format_config,
    'registration_closes_at', c.registration_closes_at, 'published_at', c.published_at
  )
  from public.championships c
  -- Publicado en adelante = visible para todos. NO se filtra por privacy/registration_key/results_public.
  where c.status in ('registration_open', 'registration_closed', 'in_progress', 'completed')
  order by c.event_date asc;
$$;
revoke all on function public.list_public_championships() from public;
grant execute on function public.list_public_championships() to anon, authenticated;


-- ── 2) get_championship_public — detalle público (SIN registration_key) ──────────────────────────────
-- Devuelve columnas seguras + owner_user_id (para que el cliente sepa si es el owner) + has_registration_key
-- (para saber si el acceso exige clave). Accesible si está publicado O si el solicitante es el owner
-- (así el owner carga su detalle aunque esté en pending_publish/payment_validation). NUNCA devuelve la clave.
create or replace function public.get_championship_public(p_championship_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_champ public.championships%rowtype;
begin
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if not (v_champ.status in ('registration_open', 'registration_closed', 'in_progress', 'completed')
          or v_champ.owner_user_id = auth.uid()) then
    raise exception 'CHAMPIONSHIP_NOT_FOUND';   -- no publicado y no eres el owner → no existe (no filtrar)
  end if;

  return jsonb_build_object(
    'id', v_champ.id, 'status', v_champ.status, 'name', v_champ.name,
    'cover_theme', v_champ.cover_theme, 'event_date', v_champ.event_date,
    'start_time', v_champ.start_time, 'end_time', v_champ.end_time, 'venue_id', v_champ.venue_id,
    'format_config', v_champ.format_config, 'registration_closes_at', v_champ.registration_closes_at,
    'published_at', v_champ.published_at, 'privacy', v_champ.privacy,
    'results_public', v_champ.results_public, 'owner_user_id', v_champ.owner_user_id,
    'has_registration_key', (nullif(btrim(coalesce(v_champ.registration_key, '')), '') is not null)
  );
end;
$$;
revoke all on function public.get_championship_public(uuid) from public;
grant execute on function public.get_championship_public(uuid) to anon, authenticated;


-- ── 3) verify_championship_access — compara la clave EN SERVIDOR; devuelve solo true/false ───────────
-- Owner (auth.uid() = owner_user_id) → true sin clave. Visitante → true solo si la clave coincide.
-- results_public / privacy NO intervienen (no son gate de inscripciones). Anon permitido.
-- SEMÁNTICA FUTURA (Calendario/Resultados, NO implementada aún): en registration_closed/in_progress/
-- completed el acceso pasará a depender de results_public → true = entrar sin clave; false = clave.
-- Por ahora, mientras esa fase no esté conectada, el gate sigue siendo por clave en TODOS los estados.
create or replace function public.verify_championship_access(
  p_championship_id  uuid,
  p_registration_key text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_champ public.championships%rowtype;
  v_typed text := btrim(coalesce(p_registration_key, ''));
begin
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then return false; end if;
  if v_champ.status not in ('registration_open', 'registration_closed', 'in_progress', 'completed') then
    return false;
  end if;
  if v_champ.owner_user_id = auth.uid() then return true; end if;                 -- owner bypass
  if nullif(btrim(coalesce(v_champ.registration_key, '')), '') is null then       -- sin clave configurada
    return false;
  end if;
  return v_typed = btrim(v_champ.registration_key);                               -- comparación server-side
end;
$$;
revoke all on function public.verify_championship_access(uuid, text) from public;
grant execute on function public.verify_championship_access(uuid, text) to anon, authenticated;


-- ── 4) get_championship_registration_key — la clave SOLO para el owner (para mostrar/editar) ─────────
create or replace function public.get_championship_registration_key(p_championship_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_champ public.championships%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.owner_user_id is distinct from auth.uid() then raise exception 'NOT_OWNER'; end if;
  return v_champ.registration_key;
end;
$$;
revoke all on function public.get_championship_registration_key(uuid) from public, anon;
grant execute on function public.get_championship_registration_key(uuid) to authenticated;


-- ── 5) list_my_championships — "Mis campeonatos" del owner (reemplaza el .from().select() de Profile) ─
-- Owner-scoped por auth.uid(). SIN registration_key ni payment_voucher_ref ni datos de pago (Profile no
-- los necesita). Muestra el ciclo relevante COMPLETO del owner (incluye no publicados propios + histórico
-- terminado/cancelado). Los holds técnicos (transfer_hold/gateway_hold) NO se listan.
create or replace function public.list_my_championships()
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id, 'status', c.status, 'name', c.name, 'cover_theme', c.cover_theme,
    'event_date', c.event_date, 'start_time', c.start_time, 'format_config', c.format_config,
    'registration_closes_at', c.registration_closes_at, 'created_at', c.created_at
  )
  from public.championships c
  where c.owner_user_id = auth.uid()
    and c.status in ('payment_validation', 'pending_publish', 'registration_open',
                     'registration_closed', 'in_progress', 'completed', 'canceled')
  order by c.event_date asc;
$$;
revoke all on function public.list_my_championships() from public, anon;
grant execute on function public.list_my_championships() to authenticated;
