-- ============================================================================
-- get_slot_reservation(p_game_id uuid) — SOLO LECTURA (ampliada para V6)
-- ============================================================================
-- Devuelve la R1 ÚNICA del usuario (su reserva PROPIA) + el pool público, igual
-- que antes. V6 añade, además, `member_reservation_*`: la SlotReservation a la
-- que el actor PERTENECE (game_players.game_slot_reservation_id), con id y status.
--
-- Esa pertenencia se resuelve con SECURITY DEFINER porque la reserva puede ser de
-- OTRO capitán y la RLS select-own la ocultaría al cliente.
--
-- No escribe nada. No toca game_players ni ninguna tabla. No cambia nombre,
-- parámetros, permisos, validaciones ni ninguno de los datos que ya devolvía.
-- (Se hace DROP + CREATE porque cambia la forma del RETURNS TABLE; sigue siendo
-- la MISMA RPC.)
-- ============================================================================

drop function if exists public.get_slot_reservation(uuid);

create or replace function public.get_slot_reservation(p_game_id uuid)
returns table (
  has_reservation           boolean,
  reservation_id            uuid,
  status                    text,
  reserved_slots_total      integer,
  reserved_slots_used       integer,
  reserved_slots_remaining  integer,
  pool                      integer,
  member_reservation_id     uuid,
  member_reservation_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor         uuid := auth.uid();
  v_total         integer;
  v_confirmed     integer;
  v_held          integer;
  v_res           public.game_slot_reservations%rowtype;
  v_has           boolean := false;
  v_member_id     uuid;
  v_member_status text;
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

  -- R1 ÚNICA del usuario (reserva PROPIA), sin filtrar por estado.
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

  -- V6 · PERTENENCIA del actor: la SlotReservation vinculada en su fila.
  -- DEFINER: el status se lee aunque la reserva sea de otro capitán (RLS bypass).
  -- Prioridad: fila confirmed; si no existe ninguna, la más reciente por updated_at
  -- (cualquier status). El orden por (status='confirmed') desc antepone las confirmed.
  select gp.game_slot_reservation_id
    into v_member_id
    from public.game_players gp
   where gp.game_id = p_game_id
     and gp.user_id = v_actor
   order by (gp.status = 'confirmed') desc, gp.updated_at desc
   limit 1;

  if v_member_id is not null then
    select gsr.status
      into v_member_status
      from public.game_slot_reservations gsr
     where gsr.id = v_member_id;
  end if;

  return query select
    v_has,
    case when v_has then v_res.id                       else null end,
    case when v_has then v_res.status                   else null end,
    case when v_has then v_res.reserved_slots_total      else 0 end,
    case when v_has then v_res.reserved_slots_used        else 0 end,
    case when v_has then v_res.reserved_slots_remaining   else 0 end,
    greatest(coalesce(v_total, 0) - v_confirmed - v_held, 0),
    v_member_id,
    v_member_status;
end;
$$;

grant execute on function public.get_slot_reservation(uuid) to authenticated;
