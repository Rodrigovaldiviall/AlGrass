-- ============================================================================
-- FASE 1 (solo lectura) — get_slot_reservation(p_game_id uuid)
-- ============================================================================
-- Snapshot de SOLO LECTURA para la UX "Reserva de cupos". Devuelve la R1 ÚNICA
-- del usuario en CUALQUIER estado (inactive/active/canceled), o NULL si no existe,
-- y el pool público del partido.
--
-- No escribe nada. No toca game_players, reserve_slots(), enforce_capacity().
-- Es SECURITY DEFINER porque el `pool` depende del held de TODOS los grupos
-- activos (SUM(reserved_slots_remaining)), que la RLS select-own de
-- game_slot_reservations oculta al cliente: no es calculable en React.
--
-- Mapeo con la UI del sheet:
--   reserved_slots_used      → "X Inscritos"
--   reserved_slots_remaining → "Y Disponibles"
--   reserved_slots_total     → contador "Cupos reservados"
--   pool                     → "Solo quedan X cupos públicos disponibles"
--   status='active'          → tarjeta editable; resto → solo lectura
-- ============================================================================

create or replace function public.get_slot_reservation(p_game_id uuid)
returns table (
  has_reservation          boolean,
  reservation_id           uuid,
  status                   text,
  reserved_slots_total     integer,
  reserved_slots_used      integer,
  reserved_slots_remaining integer,
  pool                     integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor     uuid := auth.uid();
  v_total     integer;
  v_confirmed integer;
  v_held      integer;
  v_res       public.game_slot_reservations%rowtype;
  v_has       boolean := false;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- Capacidad del partido (misma fuente que reserve_slots).
  select coalesce(g.total_spots, f.total_spots)
    into v_total
    from public.games g
    left join public.fields f on f.id = g.field_id
   where g.id = p_game_id;
  if not found then
    raise exception 'GAME_NOT_FOUND';
  end if;

  -- R1 ÚNICA del usuario, SIN filtrar por estado (inactive/active/canceled).
  -- Garantizada única por el índice incondicional (game_id, reserved_by_user_id).
  select gsr.* into v_res
    from public.game_slot_reservations gsr
   where gsr.game_id = p_game_id
     and gsr.reserved_by_user_id = v_actor
   limit 1;
  v_has := found;

  -- Confirmados del partido y held de grupos ACTIVOS (idéntico a enforce_capacity).
  select count(*)::integer
    into v_confirmed
    from public.game_players gp
   where gp.game_id = p_game_id and gp.status = 'confirmed';

  select coalesce(sum(gsr.reserved_slots_remaining), 0)::integer
    into v_held
    from public.game_slot_reservations gsr
   where gsr.game_id = p_game_id and gsr.status = 'active';

  return query select
    v_has,
    case when v_has then v_res.id                       else null end,
    case when v_has then v_res.status                   else null end,
    case when v_has then v_res.reserved_slots_total      else 0 end,
    case when v_has then v_res.reserved_slots_used        else 0 end,
    case when v_has then v_res.reserved_slots_remaining   else 0 end,
    greatest(coalesce(v_total, 0) - v_confirmed - v_held, 0);
end;
$$;

grant execute on function public.get_slot_reservation(uuid) to authenticated;
