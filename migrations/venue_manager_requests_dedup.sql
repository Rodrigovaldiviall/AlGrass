-- ============================================================================
-- Venue Manager Requests — anti-duplicado (máx. 1 solicitud ABIERTA por usuario)
-- ============================================================================
-- Aditiva y no destructiva: NO modifica el modelo, columnas, policies ni filas
-- existentes. NO toca venue_leads. Añade dos objetos:
--   (1) índice UNIQUE parcial → a lo sumo UNA solicitud pending/contacted por user_id.
--       Garantía a nivel BD, segura ante concurrencia (dos envíos rápidos / dos dispositivos):
--       el 2º INSERT falla con unique_violation (SQLSTATE 23505).
--   (2) RPC booleana has_open_venue_manager_request() → la App sabe SOLO si el usuario tiene
--       una solicitud abierta, SIN conceder SELECT sobre la tabla (no expone campos internos).
--
-- NOTA: si en la tabla ya existieran DOS filas abiertas del mismo user_id (p. ej. por pruebas
-- previas), la creación del índice fallará. En ese caso, cerrar/eliminar el duplicado ANTES.
-- ============================================================================

-- (1) A lo sumo una solicitud ABIERTA (pending/contacted) por usuario. 'closed' NO cuenta →
--     tras un cierre el usuario puede volver a solicitar (fila nueva). Mismo patrón que
--     captain_requests_one_open.
create unique index if not exists venue_manager_requests_one_open
  on public.venue_manager_requests (user_id)
  where status in ('pending', 'contacted');

-- (2) Booleano mínimo para la App: ¿auth.uid() tiene una solicitud abierta? SECURITY DEFINER
--     para leer la tabla SIN grant de SELECT a authenticated; devuelve SOLO un boolean, nunca
--     la fila ni campos administrativos (admin_notes/closed_*). auth.uid() sigue siendo el del
--     llamador dentro de SECURITY DEFINER.
create or replace function public.has_open_venue_manager_request()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.venue_manager_requests
     where user_id = auth.uid()
       and status in ('pending', 'contacted')
  );
$$;

revoke all on function public.has_open_venue_manager_request() from public, anon;
grant execute on function public.has_open_venue_manager_request() to authenticated;
