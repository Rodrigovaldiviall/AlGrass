-- ============================================================================
-- V6 · expire_slot_reservations() — barrido de expiración automática (cron)
-- ============================================================================
-- Libera automáticamente las R1 vencidas. Procesa ÚNICAMENTE:
--   · status = 'active'
--   · expires_at is not null AND expires_at <= now()
--
-- Reutiliza el PUNTO ÚNICO de liberación release_slot_reservation(..., 'automatic'):
-- el resultado es idéntico a una liberación manual salvo released_reason='automatic'.
--
-- FOR UPDATE SKIP LOCKED: si una R1 está bloqueada por reserve_slots en ese instante
-- (el capitán la está modificando), se omite en esta pasada y se reevalúa en la
-- siguiente hora. Evita doble trabajo y bloqueos.
--
-- Devuelve cuántas R1 expiró (observabilidad). SECURITY DEFINER e INTERNA: sin grant
-- a authenticated/anon; solo la ejecuta el cron (rol postgres) o un rol de servicio.
-- ============================================================================

create or replace function public.expire_slot_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_count integer := 0;
begin
  for r in
    select id
      from public.game_slot_reservations
     where status = 'active'
       and expires_at is not null
       and expires_at <= now()
     for update skip locked
  loop
    perform public.release_slot_reservation(r.id, 'automatic');
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.expire_slot_reservations() from public;
revoke all on function public.expire_slot_reservations() from anon;
revoke all on function public.expire_slot_reservations() from authenticated;
