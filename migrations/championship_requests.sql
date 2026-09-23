-- ============================================================================
-- Solicitudes de campeonato (gestión comercial de AlGrass)
-- ============================================================================
-- Tabla NUEVA e INDEPENDIENTE. NO crea campeonatos, NO reserva canchas, NO
-- cotiza y NO se convierte en nada por sí sola. Es el seguimiento de una
-- conversación: alguien quiere organizar un campeonato y no completó el flujo
-- normal de creación y pago.
--
--   usuario envía → pending → AlGrass contacta (contacted) → sin gestiones (closed)
--
-- POR QUÉ UNA TABLA NUEVA Y NO UNA EXISTENTE
--
--   · `championships` es otra cosa: una solicitud NO es un campeonato, no tiene
--     orden, ni canchas, ni estado de pago. Mezclarlas obligaría a llenar de
--     nulos la mitad de sus columnas y a inventar un estado más en su CHECK.
--   · `venue_leads` y `venue_manager_requests` son del mundo de los dueños de
--     cancha: sus columnas —venue_name, website, district único— no sirven aquí,
--     y las que hacen falta —formato, equipos, fechas tentativas— no existen.
--   · `captain_requests` es la solicitud de capitán, con su propio ciclo.
--
-- Las COLUMNAS salen una a una del formulario REAL de la App
-- (`src/screens/ChampionshipContact.jsx`, función `buildFields`). No hay ninguna
-- inventada ni ninguna derivada: lo que el usuario escribe, y nada más.
--
-- Patrón de seguridad = `venue_manager_requests.sql`: RLS, el usuario SOLO
-- inserta la suya, y los campos de gestión —estado, notas, contacto, responsable—
-- NUNCA los escribe el cliente. La gestión completa va por RPC admin-gated, en
-- la migración del Back Office.
-- ============================================================================

create table if not exists public.championship_requests (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,

  -- ── Contacto (del formulario) ──────────────────────────────────────────────
  contact_name        text not null,
  email               text not null,
  phone_country_code  text,
  contact_phone       text,
  company             text,
  job_title           text,
  message             text,

  -- ── Qué quiere organizar (del formulario) ──────────────────────────────────
  championship_name   text,
  city                text,
  -- Varios distritos a la vez: el formulario deja marcar más de uno.
  districts           text[],
  format              text,
  -- El formulario pide una estimación: "8 equipos" o "60 personas". Se guardan
  -- las dos mitades porque una cifra sin su unidad no significa nada.
  participant_type    text,
  participant_quantity integer,
  -- Un día suelto (torneo) o un rango (liga). Nunca los dos a la vez, pero eso
  -- lo decide el formulario: aquí los tres son opcionales.
  tentative_date      date,
  tentative_start_date date,
  tentative_end_date  date,
  -- Minutos por partido. Solo lo pide la liga.
  match_duration_min  integer,

  -- ── Gestión interna (solo Admin/Staff; el solicitante NUNCA los escribe) ───
  status              text not null default 'pending'
                        check (status in ('pending', 'contacted', 'closed')),
  -- Seguimiento interno de AlGrass. No se enseña en la App.
  internal_notes      text,
  -- Cuándo se contactó por primera vez. Se fija al pasar a 'contacted' y NO se
  -- borra si la solicitud vuelve atrás: que ya hubo contacto es un hecho.
  contacted_at        timestamptz,
  -- Quién la está gestionando. El NOMBRE se resuelve al leer contra
  -- `users_public.full_name`; aquí solo vive el id.
  managed_by_user_id  uuid references public.users(id),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Listar por estado, más recientes primero (el orden del Back Office).
create index if not exists championship_requests_status_created
  on public.championship_requests (status, created_at desc);

-- updated_at automático en cada UPDATE (trigger AISLADO a esta tabla).
create or replace function public.championship_requests_touch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- EXECUTE explícito: nadie la llama directamente (el trigger la ejecuta igual;
-- PostgreSQL solo verifica EXECUTE al crear el trigger, no al dispararse).
revoke all on function public.championship_requests_touch() from public, anon, authenticated;

drop trigger if exists trg_championship_requests_touch on public.championship_requests;
create trigger trg_championship_requests_touch
  before update on public.championship_requests
  for each row execute function public.championship_requests_touch();

alter table public.championship_requests enable row level security;

-- Grants EXPLÍCITOS: no se depende de los defaults de Supabase, que conceden ALL
-- a anon/authenticated. Se revoca todo y se concede INSERT SOLO SOBRE LAS COLUMNAS
-- QUE EL FORMULARIO ENVÍA. service_role queda intacto (bypassa RLS).
--
-- El grant por columnas no es un adorno: un INSERT que nombre cualquier otra
-- columna es rechazado por PERMISOS, antes de que la policy llegue a mirarlo. Con
-- un `grant insert` de tabla entera, el cliente podría NOMBRAR `id`, `created_at`
-- o `updated_at` —que la policy no comprueba— y colarse con valores propios.
-- Así no: lo que no está en esta lista lo pone la base con su DEFAULT.
--
-- Por eso `status`, `internal_notes`, `contacted_at` y `managed_by_user_id` NO
-- aparecen: la fila nace 'pending' con los tres campos de gestión vacíos porque
-- el cliente no puede escribirlos, no porque prometa no hacerlo. La policy sigue
-- comprobándolo igualmente —dos cerrojos, no uno—.
--
-- Y sin SELECT no puede leer las notas internas de nadie —ni las suyas—; sin
-- UPDATE no puede tocar su propio estado.
revoke all on table public.championship_requests from public, anon, authenticated;
grant insert (
  user_id,
  contact_name,
  email,
  phone_country_code,
  contact_phone,
  company,
  job_title,
  message,
  championship_name,
  city,
  districts,
  format,
  participant_type,
  participant_quantity,
  tentative_date,
  tentative_start_date,
  tentative_end_date,
  match_duration_min
) on table public.championship_requests to authenticated;

-- INSERT: cada persona crea SOLO la suya, siempre en 'pending' y sin un solo
-- campo de gestión. Esto no es un adorno de la interfaz: es lo que impide que
-- una solicitud nazca ya "contactada" o con un responsable puesto a dedo.
drop policy if exists championship_requests_insert_own on public.championship_requests;
create policy championship_requests_insert_own
  on public.championship_requests for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and internal_notes is null
    and contacted_at is null
    and managed_by_user_id is null
  );

-- ── Gestión Admin (va en la migración del Back Office) ───────────────────────
-- No hay policies de SELECT/UPDATE/DELETE para `authenticated` a propósito:
-- leer todas, escribir notas y mover el estado va por RPC SECURITY DEFINER con
-- comprobación de rol dentro, igual que en `venue_manager_requests`.


-- ── Verificación ─────────────────────────────────────────────────────────────
do $verify$
declare
  v_cols int;
  v_priv text;
  v_col  text;
begin
  if to_regclass('public.championship_requests') is null then
    raise exception 'VERIFY: la tabla no existe';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.championship_requests'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%pending%contacted%closed%'
  ) then
    raise exception 'VERIFY: falta el CHECK de los tres estados';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'championship_requests'
       and policyname = 'championship_requests_insert_own'
  ) then
    raise exception 'VERIFY: falta la policy de INSERT';
  end if;

  -- Ninguna policy de lectura/escritura para el cliente.
  select count(*) into v_cols from pg_policies
   where schemaname = 'public' and tablename = 'championship_requests'
     and cmd <> 'INSERT';
  if v_cols <> 0 then
    raise exception 'VERIFY: el cliente no debe tener policies de SELECT/UPDATE/DELETE (hay %)', v_cols;
  end if;

  foreach v_priv in array array['SELECT', 'UPDATE', 'DELETE'] loop
    if has_table_privilege('authenticated', 'public.championship_requests', v_priv) then
      raise exception 'VERIFY: authenticated no debe tener % sobre la tabla', v_priv;
    end if;
  end loop;

  -- Con grant por columnas, `has_table_privilege(..., 'INSERT')` es FALSE: el
  -- privilegio vive en las columnas, no en la tabla. Se comprueba una a una.
  foreach v_col in array array[
    'user_id', 'contact_name', 'email', 'phone_country_code', 'contact_phone',
    'company', 'job_title', 'message', 'championship_name', 'city', 'districts',
    'format', 'participant_type', 'participant_quantity', 'tentative_date',
    'tentative_start_date', 'tentative_end_date', 'match_duration_min'
  ] loop
    if not has_column_privilege('authenticated', 'public.championship_requests', v_col, 'INSERT') then
      raise exception 'VERIFY: authenticated necesita INSERT sobre %', v_col;
    end if;
  end loop;

  -- Y NINGUNA de las de gestión ni de las que genera la base.
  foreach v_col in array array[
    'id', 'status', 'internal_notes', 'contacted_at', 'managed_by_user_id',
    'created_at', 'updated_at'
  ] loop
    if has_column_privilege('authenticated', 'public.championship_requests', v_col, 'INSERT') then
      raise exception 'VERIFY: authenticated NO debe poder escribir %', v_col;
    end if;
  end loop;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.championship_requests'::regclass
       and tgname = 'trg_championship_requests_touch'
  ) then
    raise exception 'VERIFY: falta el trigger de updated_at';
  end if;

  raise notice 'VERIFY OK: championship_requests lista (solo INSERT del propio solicitante).';
end $verify$;
