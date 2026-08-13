-- ============================================================================
-- count_promo_uses(p_promo_id) — usos globales reales de una promoción
-- ============================================================================
-- Único fin: contar el TOTAL de usos de una promo entre TODOS los usuarios para el
-- límite max_uses_total. El COUNT desde el cliente no sirve: la RLS de reservations
-- (reservations_select_own) solo deja ver filas propias, así que un count autenticado
-- subcuenta el global. SECURITY DEFINER salta la RLS y devuelve SOLO el número — nunca
-- filas de reservations, nunca datos de otros usuarios.
--
-- Fuente de verdad = reservations (append-only). Los refunds NO restan usos (solo se
-- cuentan status='spend'). Sin contadores ni columnas nuevas. Reutiliza el índice
-- parcial existente reservations_promo_usage_idx (prefijo promo_code_id).
--
-- Re-ejecutable: create or replace + revoke/grant idempotentes.
-- ============================================================================

create or replace function public.count_promo_uses(p_promo_id uuid)
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::integer
    from public.reservations
   where status = 'spend'
     and promo_code_id = p_promo_id;
$$;

-- Solo lectura para authenticated; nunca anon/PUBLIC.
revoke all on function public.count_promo_uses(uuid) from public;
grant execute on function public.count_promo_uses(uuid) to authenticated;
