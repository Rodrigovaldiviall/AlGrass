-- ============================================================================
-- Solicitudes de campeonato · Lectura PROPIA (Perfil) — list_my_championship_requests
-- ============================================================================
-- CONTEXTO: championship_requests solo concede INSERT por columnas a `authenticated` y NO tiene SELECT (para
-- que el cliente jamás lea internal_notes / contacted_at / managed_by_user_id). Por eso Perfil no podía leer el
-- status REAL y dependía de un snapshot local (sessionStorage), que quedaba stale: al pasar closed→pending/contacted
-- en Admin, la solicitud no volvía a aparecer.
--
-- FIX (Supabase = fuente de verdad): RPC SECURITY DEFINER que devuelve SOLO las solicitudes DEL PROPIO usuario
-- (user_id = auth.uid()) con columnas SEGURAS (sin las internas de Admin) y SOLO estados ACTIVOS. 'closed' NO se
-- devuelve → oculto en Perfil; y como es reversible, closed→pending/contacted vuelve a devolver la fila.
--
-- No crea tablas, no toca Admin, ni el INSERT, ni las policies, ni los campos internos. Solo AÑADE una función de
-- lectura acotada. Reglas de visibilidad del Perfil: pending/contacted visibles, closed oculto.
-- ============================================================================

create or replace function public.list_my_championship_requests()
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'championship_name', r.championship_name,
    'city', r.city,
    'districts', r.districts,
    'format', r.format,
    'participant_type', r.participant_type,
    'participant_quantity', r.participant_quantity,
    'tentative_date', r.tentative_date,
    'tentative_start_date', r.tentative_start_date,
    'tentative_end_date', r.tentative_end_date,
    'match_duration_min', r.match_duration_min,
    'contact_name', r.contact_name,
    'email', r.email,
    'phone_country_code', r.phone_country_code,
    'contact_phone', r.contact_phone,
    'company', r.company,
    'job_title', r.job_title,
    'message', r.message,
    'created_at', r.created_at,
    'updated_at', r.updated_at
    -- NO se exponen: internal_notes, contacted_at, managed_by_user_id (gestión interna de Admin).
  )
  from public.championship_requests r
  where r.user_id = auth.uid()
    and r.status in ('pending', 'contacted')   -- 'closed' NO visible en Perfil (reversible: vuelve al reabrirse)
  order by r.created_at desc;
$$;
revoke all on function public.list_my_championship_requests() from public, anon;
grant execute on function public.list_my_championship_requests() to authenticated;

do $$
begin
  raise notice 'OK: list_my_championship_requests (propias, columnas seguras, estados activos).';
end $$;
