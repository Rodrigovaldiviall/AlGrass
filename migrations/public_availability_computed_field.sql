-- ============================================================================
-- V6 — public_availability(g public.games) : ADAPTADOR PostgREST (computed field)
-- ============================================================================
-- Overload que expone la disponibilidad pública como CAMPO COMPUTADO sobre games,
-- para que la consulta de la lista pueda pedir `public_availability` en el select.
--
-- NO contiene lógica propia ni duplica la fórmula: solo delega en la fuente única
-- public.public_availability(uuid). Es un simple adaptador de firma (games → id).
-- ============================================================================

create or replace function public.public_availability(g public.games)
returns integer
language sql
stable
set search_path = public
as $$
  select public.public_availability(g.id);
$$;

grant execute on function public.public_availability(public.games) to authenticated, anon;
