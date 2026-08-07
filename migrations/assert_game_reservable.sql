-- ============================================================================
-- Orders · Fase 1 · Etapa 2 — assert_game_reservable (FUENTE ÚNICA de precondiciones)
-- ============================================================================
-- Precondiciones de RECURSO (tipo / estado publicado-reservable / no iniciado),
-- EXTRAÍDAS SIN CAMBIOS de reserve_slots (sus pasos 4 y 5): mismas condiciones,
-- mismos nombres de excepción y MISMO ORDEN. No introduce, quita ni reinterpreta
-- ninguna regla — solo elimina la duplicación.
--
-- La usan reserve_slots y create_order (y el resto del dominio que lo necesite),
-- para tener UNA sola definición de "¿este recurso es reservable ahora?".
--
-- NO hace lock ni cuenta capacidad: el FOR UPDATE (serialización) y el conteo
-- viven en los llamadores. Es una guarda de estado/tiempo, pura.
--
-- SECURITY DEFINER + stable: solo lee games y lanza excepciones.
-- ============================================================================

create or replace function public.assert_game_reservable(p_game_id uuid, p_expected_type text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_type     text;
  v_status   text;
  v_date_key date;
  v_time     time;
  v_start    timestamptz;
begin
  select g.type, g.status, g.date_key, g.time
    into v_type, v_status, v_date_key, v_time
    from public.games g
   where g.id = p_game_id;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;

  -- Mismo orden que reserve_slots: tipo → canceled → estado → (start null) → iniciado.
  if v_type is distinct from p_expected_type then raise exception 'GAME_NOT_RESERVABLE'; end if;
  if v_status = 'canceled' then raise exception 'GAME_CANCELED'; end if;
  if v_status not in ('published','reserved') then raise exception 'GAME_NOT_RESERVABLE'; end if;

  v_start := (v_date_key + v_time) at time zone 'America/Lima';
  if v_start is null then raise exception 'GAME_NOT_RESERVABLE'; end if;
  if now() >= v_start then raise exception 'GAME_ALREADY_STARTED'; end if;
end;
$$;

grant execute on function public.assert_game_reservable(uuid, text) to authenticated;
