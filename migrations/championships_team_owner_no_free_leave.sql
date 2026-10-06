-- ============================================================================
-- Campeonatos PÚBLICOS · el TEAM OWNER (capitán fijo) NO sale gratis por leave
-- ============================================================================
-- HALLAZGO: leave_championship (championships_phase35_self_roster_matrix.sql) borra el
-- championship_player del actor en registration_open SIN comprobar si es el OWNER de un
-- equipo pagado. Eso permitiría al dueño de la reserva del equipo abandonar su propio
-- equipo gratis (team_id → fuera) sin pasar por "Cancelar reserva" ni refund, dejando el
-- equipo pagado huérfano. Regla de producto: el owner solo sale cancelando la reserva.
--
-- FIX mínimo: reemitir leave_championship añadiendo un único guard — si el actor es
-- 'team_owner' (reutiliza _championship_participation: creó un equipo con order_id donde
-- milita) → TEAM_OWNER_MUST_CANCEL_RESERVATION. Todo lo demás IDÉNTICO. Los miembros
-- gratuitos siguen pudiendo salir. No toca join/token/secret (ya bloquean team_owner),
-- ni pagos, ni privados, ni Admin.
-- ============================================================================

begin;

do $pre$
begin
  if to_regprocedure('public._championship_participation(uuid, uuid)') is null then
    raise exception 'Abortado: falta _championship_participation (aplica antes championships_public_individual_itemized.sql).';
  end if;
end $pre$;

create or replace function public.leave_championship(p_championship_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_is_owner boolean;
  v_is_host  boolean;
  v_deleted int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  v_is_owner := (v_champ.owner_user_id = v_actor);
  v_is_host  := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  if v_is_host then raise exception 'NOT_AUTHORIZED'; end if;   -- Host NUNCA (aunque sea owner)

  -- NUEVO guard: el OWNER de un equipo pagado (capitán fijo) no sale por la vía gratuita;
  -- su única salida es cancelar la reserva del equipo (cancel_championship_team_registration).
  if public._championship_participation(p_championship_id, v_actor) = 'team_owner' then
    raise exception 'TEAM_OWNER_MUST_CANCEL_RESERVATION';
  end if;

  -- registration_open (cualquiera) o pending_publish (SOLO owner). Congelado desde registration_closed.
  if not (v_champ.status = 'registration_open'
          or (v_champ.status = 'pending_publish' and v_is_owner)) then
    raise exception 'NOT_OPEN';
  end if;

  delete from public.championship_players
   where championship_id = p_championship_id and user_id = v_actor;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('left', v_deleted > 0);
end; $$;
revoke all on function public.leave_championship(uuid) from public, anon;
grant execute on function public.leave_championship(uuid) to authenticated;

do $verify$
declare v_def text;
begin
  select pg_get_functiondef(to_regprocedure('public.leave_championship(uuid)')) into v_def;
  if v_def !~ 'TEAM_OWNER_MUST_CANCEL_RESERVATION' then
    raise exception 'VERIFY: leave_championship no bloquea al team_owner.';
  end if;
  if v_def !~ '_championship_participation' then
    raise exception 'VERIFY: leave_championship no usa el clasificador de participacion.';
  end if;
  raise notice 'OK: leave_championship bloquea al team_owner (sale solo cancelando la reserva). Miembros gratuitos salen igual.';
end $verify$;

commit;
