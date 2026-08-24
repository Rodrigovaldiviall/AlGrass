-- ============================================================================
-- match_cancellation_window(p_game_id uuid) — ventana de devolución (regla 24h)
-- ============================================================================
-- Autoridad ECONÓMICA de la política de cancelación de MATCH: decide, usando el
-- reloj del servidor (now() de PostgreSQL), si una cancelación es reembolsable.
--
-- Regla EXACTA (límite estricto: reembolso solo si faltan MÁS de 24h):
--   refundable = now() < ( ((date_key + time) AT TIME ZONE 'America/Lima')
--                          - interval '24 hours' )
--   · 19:59 del día anterior a un partido de 20:00 Lima → refundable = true  (>24h)
--   · 20:00 del día anterior (exactamente 24h)          → refundable = false (<=24h)
--   · 20:01 del día anterior                            → refundable = false (<24h)
--
-- El datetime del partido se construye SIEMPRE aquí, desde public.games, a partir de
-- p_game_id (el cliente NO envía date_key/time ni "now"). Perú no tiene DST, así que
-- 'America/Lima' equivale al offset fijo -05:00 usado por parsePeruDateTime en la App.
--
-- Solo LECTURA: no escribe, no toca capacidad, refunds, wallet ni notificaciones.
-- Falla explícitamente si el partido no existe (GAME_NOT_FOUND) para no devolver un
-- resultado engañoso.
--
-- SECURITY INVOKER (mínimo privilegio): public.games no tiene RLS y es legible por
-- authenticated (la App ya lo lee en getGames/getGameById), y esta función solo lee
-- date_key/time (no sensible) y calcula un booleano/timestamps. No requiere elevación,
-- por lo que NO se usa SECURITY DEFINER. `set search_path = public` es higiene estándar.
-- No crea/modifica tablas, columnas, triggers ni otras funciones.
-- ============================================================================

create or replace function public.match_cancellation_window(p_game_id uuid)
returns table (
  refundable        boolean,
  game_start_at     timestamptz,
  refund_cutoff_at  timestamptz,
  server_now        timestamptz
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_date_key date;
  v_time     time;
  v_start    timestamptz;
  v_cutoff   timestamptz;
  v_now      timestamptz := now();   -- reloj del servidor (autoritativo)
begin
  -- El datetime del partido se obtiene aquí, NUNCA del cliente.
  select g.date_key, g.time
    into v_date_key, v_time
    from public.games g
   where g.id = p_game_id;

  if not found then
    raise exception 'GAME_NOT_FOUND';
  end if;

  if v_date_key is null or v_time is null then
    raise exception 'GAME_START_UNAVAILABLE';
  end if;

  -- (date + time) interpretado como hora de pared en America/Lima → timestamptz.
  v_start  := (v_date_key + v_time) at time zone 'America/Lima';
  v_cutoff := v_start - interval '24 hours';

  -- Límite ESTRICTO: > 24h ⇒ reembolsable; exactamente 24h o menos ⇒ no.
  return query
    select (v_now < v_cutoff), v_start, v_cutoff, v_now;
end;
$$;

-- Solo authenticated ejecuta esta función (el flujo de cancelación es de usuarios
-- logueados). Se revoca de public (incluye anon) por mínimo privilegio.
revoke all on function public.match_cancellation_window(uuid) from public;
grant execute on function public.match_cancellation_window(uuid) to authenticated;
