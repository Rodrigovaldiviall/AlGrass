-- ============================================================================
-- FASE 4 — consume_reserved_slot(p_reservation_id uuid)
-- ============================================================================
-- Un jugador se une a un partido MEDIANTE el link de una reserva (grupo del
-- capitán). Gestiona SOLO la pertenencia al grupo y reserved_slots_used.
-- NO modifica games.status. NO tiene efecto económico. La admisibilidad física
-- la impone el trigger existente enforce_capacity() (no se toca).
--
-- Orden de locks: reserva (FOR UPDATE aquí) → partido (FOR UPDATE que toma
-- enforce_capacity en el write a game_players).
--
-- Invariante que mantiene: reserved_slots_used(R) = nº de game_players
-- confirmed con game_slot_reservation_id = R. El +1 y el write de game_players
-- van en la MISMA transacción; cualquier error (p.ej. GAME_FULL) revierte todo.
-- No captura excepciones.
--
-- No modifica: game_slot_reservations (estructura), game_players (estructura),
-- reserve_slots(), enforce_capacity(). No crea tablas/columnas/triggers/índices.
-- ============================================================================

create or replace function public.consume_reserved_slot(p_reservation_id uuid)
returns public.game_players
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_game_id    uuid;
  v_type       text;
  v_gstatus    text;
  v_date_key   date;
  v_time       time;
  v_host       uuid;
  v_game_start timestamptz;
  v_gp         public.game_players%rowtype;
  v_gp_new     public.game_players%rowtype;
begin
  -- 1) Sesión.
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- 2) Reserva del link. Se BLOQUEA (fija el orden de locks reserva → partido y
  --    serializa el contador reserved_slots_used).
  select game_id
    into v_game_id
    from public.game_slot_reservations
   where id = p_reservation_id
   for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND';
  end if;

  -- 3) Partido derivado (lectura; el lock de games lo toma enforce_capacity en el write).
  select g.type,
         g.status,
         g.date_key,
         g.time,
         coalesce(g.host_user_id, f.default_host_user_id)
    into v_type, v_gstatus, v_date_key, v_time, v_host
    from public.games g
    left join public.fields f on f.id = g.field_id
   where g.id = v_game_id;
  if not found then
    raise exception 'GAME_NOT_FOUND';
  end if;

  if v_type is distinct from 'match' then
    raise exception 'GAME_NOT_RESERVABLE';
  end if;
  if v_gstatus = 'canceled' then
    raise exception 'GAME_CANCELED';
  end if;
  if v_gstatus not in ('published', 'reserved') then
    raise exception 'GAME_NOT_RESERVABLE';
  end if;

  -- No iniciado (game_start = date_key + time interpretado como America/Lima; a
  -- partir de aquí solo timestamptz y now()).
  v_game_start := (v_date_key + v_time) at time zone 'America/Lima';
  if v_game_start is null then
    raise exception 'GAME_NOT_RESERVABLE';
  end if;
  if now() >= v_game_start then
    raise exception 'GAME_ALREADY_STARTED';
  end if;

  -- 4) El host del partido no puede unirse como jugador.
  if v_host is not null and v_host = v_actor then
    raise exception 'HOST_CANNOT_JOIN';
  end if;

  -- 5) El estado de la reserva (active/released/expired/canceled) NO gatea el
  --    consumo: en cualquiera el link admite nuevos miembros (públicos si no es active).

  -- 6) Fila del actor en este partido (única por UNIQUE(game_id, user_id)).
  select *
    into v_gp
    from public.game_players
   where game_id = v_game_id and user_id = v_actor;

  -- (A) Ya CONFIRMADO → no-op idempotente: no cambia de grupo ni toca used.
  if found and v_gp.status = 'confirmed' then
    return v_gp;
  end if;

  if found then
    -- (B) CANCELADO → reingreso. CAS sobre status='canceled' para no incrementar
    --     dos veces si otra transacción lo confirmó en paralelo. enforce_capacity
    --     corre en este UPDATE (canceled→confirmed) con el nuevo grupo.
    update public.game_players
       set status                   = 'confirmed',
           game_slot_reservation_id = p_reservation_id,
           canceled_at              = null,
           joined_at                = now()
     where id = v_gp.id
       and status = 'canceled'
    returning * into v_gp_new;

    if not found then
      -- Otra transacción ya lo confirmó → ya confirmado, no-op (sin tocar used).
      select * into v_gp_new from public.game_players where id = v_gp.id;
      return v_gp_new;
    end if;

    update public.game_slot_reservations
       set reserved_slots_used = reserved_slots_used + 1,
           updated_at          = now()
     where id = p_reservation_id;

    return v_gp_new;
  end if;

  -- (C) SIN fila → primera vez. enforce_capacity corre en el INSERT.
  insert into public.game_players (
    game_id,
    user_id,
    payer_id,
    reservation_id,
    amount,
    status,
    canceled_at,
    joined_at,
    reservation_type,
    invited_by_user_id,
    game_slot_reservation_id
  ) values (
    v_game_id,
    v_actor,
    v_actor,
    null,
    0,
    'confirmed',
    null,
    now(),
    'normal',
    null,
    p_reservation_id
  )
  returning * into v_gp_new;

  update public.game_slot_reservations
     set reserved_slots_used = reserved_slots_used + 1,
         updated_at          = now()
   where id = p_reservation_id;

  return v_gp_new;
end;
$$;

-- Ejecutable desde el cliente: la autorización se valida DENTRO de la función.
grant execute on function public.consume_reserved_slot(uuid) to authenticated;
