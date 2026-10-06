-- ============================================================================
-- Campeonatos PÚBLICOS · permitir JOIN GRATIS también en registration_closed
-- ============================================================================
-- Regla de producto: tras cerrar inscripciones NO hay nuevas compras (individual/equipo)
-- ni cancelaciones pagadas, PERO se puede seguir entrando GRATIS a equipos YA existentes
-- por clave / token / owner-add. Esta migración amplía SOLO la ventana de status de las 3
-- RPC de join gratis de registration_open → in (registration_open, registration_closed).
--
-- NO toca: create/confirm de order (siguen exigiendo registration_open → compras cerradas),
-- join_championship_team legacy (sigue bloqueado en públicos), cancelaciones, pagos, reward,
-- claves/token en sí, privados, Admin. Reemite cuerpos COMPLETOS (idénticos salvo el check).
-- ============================================================================

begin;

do $pre$
begin
  if to_regprocedure('public.join_championship_team_with_secret(uuid, text, boolean)') is null
     or to_regprocedure('public.join_championship_team_with_token(text, boolean)') is null
     or to_regprocedure('public.add_championship_team_member(uuid, uuid)') is null then
    raise exception 'Abortado: faltan las RPC de join (aplica antes plaintext + team_registration + owner_add_member).';
  end if;
end $pre$;


-- ── 1 · join por CLAVE ─────────────────────────────────────────────────────────
create or replace function public.join_championship_team_with_secret(
  p_team_id uuid,
  p_secret  text,
  p_confirm_change boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_team  public.championship_teams%rowtype;
  v_champ public.championships%rowtype;
  v_is_host boolean;
  v_part     text;
  v_cur_team uuid;
  v_in  text := nullif(btrim(coalesce(p_secret, '')), '');
  v_key text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_team from public.championship_teams where id = p_team_id;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || v_team.championship_id::text)::bigint);

  select * into v_champ from public.championships where id = v_team.championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  v_is_host := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  if v_is_host then raise exception 'NOT_AUTHORIZED'; end if;

  -- Join gratis a equipo existente: abierto Y cerrado (NO abre compras ni cancelaciones).
  if v_champ.status not in ('registration_open', 'registration_closed') then raise exception 'NOT_OPEN'; end if;

  v_key := nullif(btrim(coalesce(v_team.join_secret, '')), '');
  if v_in is null then raise exception 'INVALID_SECRET'; end if;
  if v_key is null then raise exception 'NO_TEAM_SECRET'; end if;
  if v_in <> v_key then raise exception 'INVALID_SECRET'; end if;

  v_part := public._championship_participation(v_team.championship_id, v_actor);
  if v_part = 'none' then
    insert into public.championship_players (championship_id, user_id, team_id)
      values (v_team.championship_id, v_actor, p_team_id);
    return jsonb_build_object('championship_id', v_team.championship_id, 'team_id', p_team_id);
  end if;

  select cp.team_id into v_cur_team from public.championship_players cp
   where cp.championship_id = v_team.championship_id and cp.user_id = v_actor;
  if v_cur_team = p_team_id then
    return jsonb_build_object('championship_id', v_team.championship_id, 'team_id', p_team_id, 'already', true);
  end if;
  if v_part in ('paid_individual','team_owner') then
    raise exception 'PAID_REGISTRATION_MUST_CANCEL_FIRST';
  end if;
  -- registration_closed: NO se permite CAMBIAR de equipo (ni con confirmación). Solo altas nuevas (v_part='none').
  -- Cambios/retiros excepcionales tras el cierre los hace AlGrass/Admin.
  if v_champ.status = 'registration_closed' then raise exception 'TEAM_CHANGE_CLOSED'; end if;
  if not coalesce(p_confirm_change, false) then raise exception 'CONFIRM_TEAM_CHANGE_REQUIRED'; end if;
  update public.championship_players set team_id = p_team_id
   where championship_id = v_team.championship_id and user_id = v_actor;
  return jsonb_build_object('championship_id', v_team.championship_id, 'team_id', p_team_id, 'changed', true);
end $$;
revoke all on function public.join_championship_team_with_secret(uuid, text, boolean) from public, anon;
grant execute on function public.join_championship_team_with_secret(uuid, text, boolean) to authenticated;


-- ── 2 · join por TOKEN del link ─────────────────────────────────────────────────
create or replace function public.join_championship_team_with_token(
  p_token text,
  p_confirm_change boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tok   text := nullif(btrim(coalesce(p_token,'')),'');
  v_team  public.championship_teams%rowtype;
  v_champ public.championships%rowtype;
  v_is_host boolean;
  v_part     text;
  v_cur_team uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_tok is null then raise exception 'INVALID_LINK'; end if;

  select * into v_team from public.championship_teams where join_token = v_tok;
  if not found then raise exception 'INVALID_LINK'; end if;

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || v_team.championship_id::text)::bigint);

  select * into v_champ from public.championships where id = v_team.championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  v_is_host := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  if v_is_host then raise exception 'NOT_AUTHORIZED'; end if;

  -- Join gratis por link: abierto Y cerrado (NO abre compras ni cancelaciones).
  if v_champ.status not in ('registration_open', 'registration_closed') then raise exception 'NOT_OPEN'; end if;

  v_part := public._championship_participation(v_team.championship_id, v_actor);
  if v_part = 'none' then
    insert into public.championship_players (championship_id, user_id, team_id)
      values (v_team.championship_id, v_actor, v_team.id);
    return jsonb_build_object('championship_id', v_team.championship_id, 'team_id', v_team.id);
  end if;

  select cp.team_id into v_cur_team from public.championship_players cp
   where cp.championship_id = v_team.championship_id and cp.user_id = v_actor;
  if v_cur_team = v_team.id then
    return jsonb_build_object('championship_id', v_team.championship_id, 'team_id', v_team.id, 'already', true);
  end if;
  if v_part in ('paid_individual','team_owner') then
    raise exception 'PAID_REGISTRATION_MUST_CANCEL_FIRST';
  end if;
  -- registration_closed: NO se permite CAMBIAR de equipo (ni con confirmación). Solo altas nuevas (v_part='none').
  -- Cambios/retiros excepcionales tras el cierre los hace AlGrass/Admin.
  if v_champ.status = 'registration_closed' then raise exception 'TEAM_CHANGE_CLOSED'; end if;
  if not coalesce(p_confirm_change, false) then raise exception 'CONFIRM_TEAM_CHANGE_REQUIRED'; end if;
  update public.championship_players set team_id = v_team.id
   where championship_id = v_team.championship_id and user_id = v_actor;
  return jsonb_build_object('championship_id', v_team.championship_id, 'team_id', v_team.id, 'changed', true);
end $$;
revoke all on function public.join_championship_team_with_token(text, boolean) from public, anon;
grant execute on function public.join_championship_team_with_token(text, boolean) to authenticated;


-- ── 3 · owner agrega jugador gratis a su equipo ─────────────────────────────────
create or replace function public.add_championship_team_member(
  p_team_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_team  public.championship_teams%rowtype;
  v_champ public.championships%rowtype;
  v_part  text;
  v_cur   uuid;
  v_has   boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_team from public.championship_teams where id = p_team_id;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  if v_team.created_by_user_id is distinct from v_actor then raise exception 'NOT_AUTHORIZED'; end if;

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || v_team.championship_id::text)::bigint);

  select * into v_champ from public.championships where id = v_team.championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if not (v_champ.order_id is null and (v_champ.public_individual_price is not null or v_champ.public_team_price is not null)) then
    raise exception 'NOT_PUBLIC';
  end if;
  -- Owner agrega gratis: abierto Y cerrado (NO abre compras ni cancelaciones).
  if v_champ.status not in ('registration_open', 'registration_closed') then raise exception 'NOT_OPEN'; end if;

  if p_user_id is null or not exists (select 1 from public.users_public where id = p_user_id) then
    raise exception 'INVALID_INPUT';
  end if;
  if v_champ.host_user_id is not null and v_champ.host_user_id = p_user_id then
    raise exception 'NOT_AUTHORIZED';
  end if;

  v_part := public._championship_participation(v_team.championship_id, p_user_id);
  select true, cp.team_id into v_has, v_cur
    from public.championship_players cp
   where cp.championship_id = v_team.championship_id and cp.user_id = p_user_id;

  if coalesce(v_has, false) and v_cur = p_team_id then
    return jsonb_build_object('team_id', p_team_id, 'user_id', p_user_id, 'already', true);
  end if;
  if v_part in ('paid_individual','team_owner') then raise exception 'ALREADY_ENROLLED'; end if;
  if v_part = 'free_member' then raise exception 'ALREADY_IN_OTHER_TEAM'; end if;

  insert into public.championship_players (championship_id, user_id, team_id)
    values (v_team.championship_id, p_user_id, p_team_id)
  on conflict (championship_id, user_id) do update set team_id = excluded.team_id;

  return jsonb_build_object('team_id', p_team_id, 'user_id', p_user_id, 'already', false);
end $$;
revoke all on function public.add_championship_team_member(uuid, uuid) from public, anon;
grant execute on function public.add_championship_team_member(uuid, uuid) to authenticated;


-- ── 4 · Verificación ────────────────────────────────────────────────────────────
do $verify$
declare v_def text; v_fn text;
begin
  foreach v_fn in array array[
    'public.join_championship_team_with_secret(uuid, text, boolean)',
    'public.join_championship_team_with_token(text, boolean)',
    'public.add_championship_team_member(uuid, uuid)'
  ] loop
    select pg_get_functiondef(to_regprocedure(v_fn)) into v_def;
    if v_def !~ 'registration_open'', ''registration_closed' then
      raise exception 'VERIFY: % no amplia la ventana a registration_closed (altas nuevas).', v_fn;
    end if;
  end loop;
  -- secret/token: en registration_closed el CAMBIO de equipo queda bloqueado (TEAM_CHANGE_CLOSED), sin tocar el
  -- switch con confirmación de registration_open (CONFIRM_TEAM_CHANGE_REQUIRED sigue presente).
  foreach v_fn in array array[
    'public.join_championship_team_with_secret(uuid, text, boolean)',
    'public.join_championship_team_with_token(text, boolean)'
  ] loop
    select pg_get_functiondef(to_regprocedure(v_fn)) into v_def;
    if v_def !~ 'TEAM_CHANGE_CLOSED' then
      raise exception 'VERIFY: % no bloquea el cambio de equipo en registration_closed.', v_fn;
    end if;
    if v_def !~ 'CONFIRM_TEAM_CHANGE_REQUIRED' then
      raise exception 'VERIFY: % perdio el switch con confirmacion de registration_open.', v_fn;
    end if;
  end loop;
  -- leave_championship NO se toca aquí: ya exige registration_open (o pending_publish+owner) → la baja libre
  -- está bloqueada en registration_closed por la definición existente.
  select pg_get_functiondef(to_regprocedure('public.leave_championship(uuid)')) into v_def;
  if v_def !~ 'registration_open' then
    raise exception 'VERIFY: leave_championship no limita la baja a registration_open (deberia bloquear en closed).';
  end if;
  raise notice 'OK: closed → altas nuevas por clave/token/owner-add permitidas; cambio Team A→B bloqueado (TEAM_CHANGE_CLOSED); open conserva switch con confirmacion; baja libre bloqueada en closed por leave_championship. Compras y legacy intactos.';
end $verify$;

commit;
