-- ============================================================================
-- Campeonatos · Fase 12 — Membership del OWNER en pending_publish
-- ============================================================================
-- El pagador/owner (championships.owner_user_id) ya podía CREAR equipos en pending_publish; ahora también
-- puede INSCRIBIRSE en esa etapa (unirse a un equipo, cambiarse, quedar sin equipo, salir). El jugador
-- normal sigue SIN membership hasta registration_open. AlGrass NO recibe membership en pending (mantiene
-- solo su gestión de teams).
--
-- Único cambio: el GATE DE ESTADO de las 3 RPCs de membership existentes admite además pending_publish
-- cuando `owner_user_id = auth.uid()`. Todo lo demás (SET membership única, advisory lock, closes_at,
-- errores, registration_open/closed) queda IGUAL. NO se crean RPCs nuevas.
-- ============================================================================

-- ── join_championship_team — unirse/cambiar a un team EXISTENTE ──────────────────────────────────────
create or replace function public.join_championship_team(
  p_championship_id uuid,
  p_team_id         uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  -- registration_open/closed (cualquiera) o pending_publish (SOLO owner).
  if not (v_champ.status in ('registration_open', 'registration_closed')
          or (v_champ.status = 'pending_publish' and v_champ.owner_user_id = v_actor)) then
    raise exception 'NOT_OPEN';
  end if;
  if v_champ.status = 'registration_open'
     and v_champ.registration_closes_at is not null and now() >= v_champ.registration_closes_at then
    raise exception 'REGISTRATION_CLOSED';
  end if;
  if not exists (select 1 from public.championship_teams where id = p_team_id and championship_id = p_championship_id) then
    raise exception 'TEAM_NOT_FOUND';
  end if;

  -- SET membership (una sola fila por UNIQUE): sin fila → INSERT; con fila → UPDATE al nuevo team.
  insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, v_actor, p_team_id)
  on conflict (championship_id, user_id) do update set team_id = excluded.team_id;

  return jsonb_build_object('championship_id', p_championship_id, 'team_id', p_team_id);
end; $$;
revoke all on function public.join_championship_team(uuid, uuid) from public, anon;
grant execute on function public.join_championship_team(uuid, uuid) to authenticated;


-- ── join_championship_without_team — quedar SIN equipo (team_id NULL) ────────────────────────────────
create or replace function public.join_championship_without_team(p_championship_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  -- "Sin equipo" solo en registration_open (cualquiera) o pending_publish (SOLO owner). En closed no aplica.
  if not (v_champ.status = 'registration_open'
          or (v_champ.status = 'pending_publish' and v_champ.owner_user_id = v_actor)) then
    raise exception 'NOT_OPEN';
  end if;
  if v_champ.status = 'registration_open'
     and v_champ.registration_closes_at is not null and now() >= v_champ.registration_closes_at then
    raise exception 'REGISTRATION_CLOSED';
  end if;

  insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, v_actor, null)
  on conflict (championship_id, user_id) do update set team_id = null;

  return jsonb_build_object('championship_id', p_championship_id, 'team_id', null);
end; $$;
revoke all on function public.join_championship_without_team(uuid) from public, anon;
grant execute on function public.join_championship_without_team(uuid) to authenticated;


-- ── leave_championship — salir/desinscribirse (DELETE de la membership del actor) ────────────────────
create or replace function public.leave_championship(p_championship_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_deleted int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  -- registration_open/closed (cualquiera) o pending_publish (SOLO owner).
  if not (v_champ.status in ('registration_open', 'registration_closed')
          or (v_champ.status = 'pending_publish' and v_champ.owner_user_id = v_actor)) then
    raise exception 'NOT_OPEN';
  end if;

  delete from public.championship_players
   where championship_id = p_championship_id and user_id = v_actor;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('left', v_deleted > 0);
end; $$;
revoke all on function public.leave_championship(uuid) from public, anon;
grant execute on function public.leave_championship(uuid) to authenticated;
