-- ============================================================================
-- Doble salida · claim Rental transaccional con orden de locks A+B por id
-- ============================================================================
-- Reemplaza el UPDATE directo del claim Rental de createReservation por una RPC que
-- adquiere los locks en el MISMO orden determinista (ORDER BY id) que el gate Match
-- (Paso 3), create_order y set_double_out_mode. Así el commit Rental deja de lockear
-- R→gemelo (vía UPDATE + Paso 1) y pasa a lockear {R,gemelo} por id ANTES del UPDATE,
-- eliminando el deadlock Match-commit vs Rental-commit del mismo par.
--
-- REGLA DE NEGOCIO (inmutable): solo hay carrera mientras ambos lados están
-- 'published'; gana el primero que consigue el compromiso válido; sin prioridad de
-- ningún lado; cuando uno queda 'reserved' el gemelo queda 'blocked' (lo hace Paso 1)
-- y la carrera terminó. Esta RPC NO decide ganador: solo ordena los locks y ejecuta
-- EXACTAMENTE el claim actual; Paso 1 (disparado por el UPDATE) sella el gemelo.
--
-- Singleton (sin alternative_game_id): comportamiento funcional idéntico al actual
-- (lockea solo R y hace el mismo UPDATE; no hay Paso 1). Carrera NULL→emparejado
-- cerrada como en create_order/Paso 3: si parece singleton se revalida bajo el lock
-- de R y, si apareció gemelo, se ABORTA conservador (NO se adquiere el gemelo después,
-- para no invertir el orden id); el reintento va por el camino con pareja.
--
-- RENTAL_TAKEN: devuelve el id reclamado, o NULL si el UPDATE afecta 0 filas (R ya
-- reservado/booked/blocked) — semántica idéntica a la actual.
--
-- NO toca: create_order, Paso 1/2/3, Match, Orders/PENDING, R1, pagos, credit,
-- invited, addGuests, Admin, ni los caminos de liberación/Paso 2.
-- ============================================================================

create or replace function public.claim_rental_double_out_aware(p_game_id uuid, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid := coalesce(auth.uid(), p_actor);  -- browser: auth.uid(); confirm_order (service-role): p_actor
  v_alt      uuid;
  v_r_alt    uuid;
  v_twin_alt uuid;
  v_claimed  uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  -- 1) Leer alternative_game_id SIN lock para decidir el conjunto a lockear en orden id.
  select alternative_game_id into v_alt from public.games where id = p_game_id;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;

  if v_alt is null then
    -- SINGLETON: lockear SOLO R y REVALIDAR alternative_game_id bajo el lock.
    perform 1 from public.games where id = p_game_id for update;
    select alternative_game_id into v_alt from public.games where id = p_game_id;
    if v_alt is not null then
      -- NULL→emparejado bajo el lock → ABORTAR conservador. NO se adquiere el gemelo
      -- ahora (sería R→gemelo, rompiendo el orden id). El reintento leerá la pareja
      -- desde el inicio y la resolverá por el camino con pareja.
      raise exception 'DOUBLE_OUT_RACE';
    end if;
    -- Sigue singleton → claim normal (R ya lockeado; re-entrante en el UPDATE).
  else
    -- PAREJA: lockear R+gemelo en ORDER BY id FOR UPDATE (mismo orden que gate/create_order).
    perform 1 from public.games where id in (p_game_id, v_alt) order by id for update;
    -- Revalidar bajo el lock: la relación sigue siendo la misma y bidireccional.
    select alternative_game_id into v_r_alt    from public.games where id = p_game_id;
    select alternative_game_id into v_twin_alt from public.games where id = v_alt;
    if v_r_alt is distinct from v_alt or v_twin_alt is distinct from p_game_id then
      raise exception 'DOUBLE_OUT_LINK_BROKEN';
    end if;
  end if;

  -- Corte autoritativo de reservabilidad ANTES del claim, BAJO el lock ya adquirido
  -- (singleton: for update de R; pareja: order by id for update de R+gemelo). Reusa la
  -- FUENTE ÚNICA: rechaza iniciado y estados no-reservables (misma regla que create_order).
  -- NO toca el WHERE del UPDATE (exclusividad/booked_by), ni Paso 1, ni el HOLD de la Order.
  perform public.assert_game_reservable(p_game_id, 'rental');

  -- 2) CLAIM idéntico al actual: published → reserved+booked, o reserved-sin-booking →
  --    booked. Con pareja, el UPDATE dispara Paso 1 (que lockea el gemelo YA tomado →
  --    re-entrante) y lo sella a 'blocked'. Singleton: no dispara Paso 1.
  update public.games
     set status = 'reserved', booked_by_user_id = v_actor
   where id = p_game_id
     and (status = 'published' or (status = 'reserved' and booked_by_user_id is null))
  returning id into v_claimed;

  -- 3) id si reclamó; NULL si 0 filas (RENTAL_TAKEN, semántica idéntica).
  return v_claimed;
end;
$$;

grant execute on function public.claim_rental_double_out_aware(uuid, uuid) to authenticated, service_role;
