-- ============================================================================
-- Campeonatos PÚBLICOS · El criterio de "público" incluye public_team_price
-- ============================================================================
-- HOLE DE SEGURIDAD: el criterio estructural de "público de AlGrass" era
--   order_id IS NULL AND public_individual_price IS NOT NULL
-- Un campeonato público SOLO-EQUIPO (public_team_price fijado, public_individual_price
-- NULL) NO cumplía ese criterio → (a) get_championship_public_pricing.is_public = false
-- → el FRONTEND lo trataba como privado y mostraba el "Únete al equipo" GRATIS legacy; y
-- (b) los 3 gates de equipo (create/join/save) NO disparaban PUBLIC_CHAMPIONSHIP_TEAM_
-- PAYMENT_REQUIRED → un usuario podía UNIRSE/CREAR equipo GRATIS, sin clave.
--
-- Esta migración reemite 5 objetos cambiando SOLO el criterio a:
--   order_id IS NULL AND (public_individual_price IS NOT NULL OR public_team_price IS NOT NULL)
-- Todo lo demás byte-idéntico a su origen (championships_public_individual_registration.sql y,
-- para _championship_is_algrass_public, 20261105120000_admin_create_championship_public.sql).
-- Con esto, TODOS los criterios estructurales de "público de AlGrass" usados por este bloque
-- (get_championship_public_pricing, los 3 gates de equipo y _championship_is_algrass_public que
-- usa admin_cancel_championship) quedan ALINEADOS: un público solo-equipo ya no se trata como privado.
--
-- NO cambia la inscripción INDIVIDUAL (create_championship_registration_order /
-- join_championship_without_team siguen exigiendo public_individual_price: sin precio
-- individual no hay inscripción sin-equipo). NO toca Match/Rental, privados
-- (order_id no nulo o sin precios públicos → criterio false → idénticos), pagos ni triggers.
-- ============================================================================

begin;

do $pre$
declare v_fn text;
begin
  foreach v_fn in array array[
    'public.get_championship_public_pricing(uuid)',
    'public._championship_is_algrass_public(uuid)',
    'public.create_championship_team(uuid, text, text, text)',
    'public.join_championship_team(uuid, uuid)',
    'public.save_championship_team(uuid, uuid, text, text, text)'
  ] loop
    if to_regprocedure(v_fn) is null then
      raise exception 'Abortado: falta % (aplica antes championships_public_individual_registration.sql).', v_fn;
    end if;
  end loop;
end $pre$;

-- ── get_championship_public_pricing · is_public con AMBOS precios ──────────────
create or replace function public.get_championship_public_pricing(p_championship_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'championship_id',        c.id,
    'is_public',              (c.order_id is null and (c.public_individual_price is not null or c.public_team_price is not null)),
    'public_individual_price', c.public_individual_price,
    'public_team_price',      c.public_team_price
  )
  from public.championships c
  where c.id = p_championship_id;
$$;
revoke all on function public.get_championship_public_pricing(uuid) from public;
grant execute on function public.get_championship_public_pricing(uuid) to anon, authenticated;


-- ── _championship_is_algrass_public · mismo criterio (lo usa admin_cancel_championship) ───────
-- Byte-idéntico a 20261105120000 salvo el criterio. Mantiene firma, language sql, stable,
-- security definer y search_path. Sin tocar callers ni admin_cancel_championship. Así un
-- público SOLO-EQUIPO (sin precio individual) ya NO se clasifica como privado/B2B.
create or replace function public._championship_is_algrass_public(p_championship_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select c.order_id is null and (c.public_individual_price is not null or c.public_team_price is not null)
      from public.championships c where c.id = p_championship_id
  ), false)
$$;
revoke all on function public._championship_is_algrass_public(uuid) from public, anon, authenticated;


-- ── create_championship_team · gate con AMBOS precios ─────────────────────────
create or replace function public.create_championship_team(
  p_championship_id uuid,
  p_name            text,
  p_color           text default null,
  p_design          text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
  v_cap   int; v_count int; v_team_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_name is null then raise exception 'INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.order_id is null and (v_champ.public_individual_price is not null or v_champ.public_team_price is not null)
     and not public._is_algrass_staff(v_actor) then
    raise exception 'PUBLIC_CHAMPIONSHIP_TEAM_PAYMENT_REQUIRED';
  end if;
  if v_champ.status <> 'registration_open' then raise exception 'NOT_OPEN'; end if;

  v_cap := public._championship_team_capacity(v_champ.format_config);
  select count(*) into v_count from public.championship_teams where championship_id = p_championship_id;
  if v_count >= v_cap then raise exception 'CAPACITY_FULL'; end if;

  insert into public.championship_teams (championship_id, name, color, design, created_by_user_id)
    values (p_championship_id, v_name, nullif(btrim(coalesce(p_color, '')), ''), nullif(btrim(coalesce(p_design, '')), ''), v_actor)
    returning id into v_team_id;

  return jsonb_build_object('team_id', v_team_id, 'name', v_name);
end; $$;


-- ── join_championship_team · gate con AMBOS precios (CIERRA la entrada sin clave) ──
create or replace function public.join_championship_team(
  p_championship_id uuid,
  p_team_id         uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_is_owner boolean;
  v_is_host  boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  if v_champ.order_id is null and (v_champ.public_individual_price is not null or v_champ.public_team_price is not null)
     and not public._is_algrass_staff(v_actor) then
    raise exception 'PUBLIC_CHAMPIONSHIP_TEAM_PAYMENT_REQUIRED';
  end if;

  v_is_owner := (v_champ.owner_user_id = v_actor);
  v_is_host  := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  if v_is_host then raise exception 'NOT_AUTHORIZED'; end if;

  if not (
       v_champ.status = 'registration_open'
       or v_champ.status = 'registration_closed'
       or (v_champ.status = 'in_progress' and v_champ.live_started_at is null)
       or (v_champ.status = 'in_progress' and v_champ.live_started_at is not null and v_is_owner)
       or (v_champ.status = 'pending_publish' and v_is_owner)
     ) then
    raise exception 'NOT_OPEN';
  end if;
  if not exists (select 1 from public.championship_teams where id = p_team_id and championship_id = p_championship_id) then
    raise exception 'TEAM_NOT_FOUND';
  end if;

  insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, v_actor, p_team_id)
  on conflict (championship_id, user_id) do update set team_id = excluded.team_id;

  return jsonb_build_object('championship_id', p_championship_id, 'team_id', p_team_id);
end; $$;


-- ── save_championship_team · gate CREATE con AMBOS precios ─────────────────────
create or replace function public.save_championship_team(
  p_championship_id uuid,
  p_team_id         uuid,
  p_name            text,
  p_color           text default null,
  p_design          text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor   uuid := auth.uid();
  v_champ   public.championships%rowtype;
  v_team    public.championship_teams%rowtype;
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_color   text := nullif(btrim(coalesce(p_color, '')), '');
  v_design  text := nullif(btrim(coalesce(p_design, '')), '');
  v_is_owner   boolean;
  v_is_host    boolean;
  v_is_algrass boolean;
  v_is_creator boolean;
  v_creator_priv boolean;
  v_captain    uuid;
  v_is_captain boolean;
  v_can_full   boolean;
  v_can_create boolean;
  v_can_edit   boolean;
  v_can_rename boolean;
  v_cap int; v_count int; v_team_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_name is null then raise exception 'INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  v_is_owner   := (v_champ.owner_user_id = v_actor);
  v_is_host    := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  v_is_algrass := public._is_algrass_staff(v_actor);

  if p_team_id is null then
    if v_champ.order_id is null and (v_champ.public_individual_price is not null or v_champ.public_team_price is not null) and not v_is_algrass then
      raise exception 'PUBLIC_CHAMPIONSHIP_TEAM_PAYMENT_REQUIRED';
    end if;
    v_can_create := public._champ_can_manage_roster(p_championship_id, v_actor, 'create_team');
    if not (v_can_create or v_champ.status = 'registration_open') then
      raise exception 'NOT_OPEN';
    end if;
    v_cap := public._championship_team_capacity(v_champ.format_config);
    select count(*) into v_count from public.championship_teams where championship_id = p_championship_id;
    if v_count >= v_cap then raise exception 'CAPACITY_FULL'; end if;

    insert into public.championship_teams (championship_id, name, color, design, created_by_user_id)
      values (p_championship_id, v_name, v_color, v_design, v_actor)
      returning id into v_team_id;
    return jsonb_build_object('team_id', v_team_id, 'name', v_name);
  end if;

  select * into v_team from public.championship_teams
   where id = p_team_id and championship_id = p_championship_id for update;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  v_is_creator := (v_team.created_by_user_id = v_actor);
  v_creator_priv := (v_team.created_by_user_id = v_champ.owner_user_id)
                    or public._is_algrass_staff(v_team.created_by_user_id);

  select count(*) into v_count from public.championship_players where team_id = p_team_id;
  select user_id into v_captain from public.championship_players
   where team_id = p_team_id order by joined_at asc, user_id asc limit 1;
  v_is_captain := (v_captain is not null and v_captain = v_actor);

  v_can_full := (v_count = 0 and (not v_creator_priv or v_is_owner or v_is_algrass))
                or (v_count >= 1 and v_is_captain);
  v_can_edit := public._champ_can_manage_roster(p_championship_id, v_actor, 'edit_team');
  v_can_rename := (v_is_owner or v_is_host or v_is_algrass) and v_champ.status <> 'canceled';

  if not (v_can_edit or v_can_full or v_can_rename) then raise exception 'NOT_AUTHORIZED'; end if;
  if v_can_edit or (v_can_full and v_champ.status = 'registration_open') then
    update public.championship_teams
       set name = v_name, color = v_color, design = v_design, updated_at = now()
     where id = p_team_id;
  elsif v_can_rename then
    update public.championship_teams
       set name = v_name, updated_at = now()
     where id = p_team_id;
  else
    raise exception 'NOT_OPEN';
  end if;

  return jsonb_build_object('team_id', p_team_id, 'name', v_name);
end; $$;


do $verify$
declare v_def text; v_fn text;
begin
  select pg_get_functiondef(to_regprocedure('public.get_championship_public_pricing(uuid)')) into v_def;
  if v_def !~ 'public_individual_price is not null or c\.public_team_price is not null' then
    raise exception 'VERIFY: is_public no incluye public_team_price.';
  end if;
  select pg_get_functiondef(to_regprocedure('public._championship_is_algrass_public(uuid)')) into v_def;
  if v_def !~ 'public_individual_price is not null or c\.public_team_price is not null' then
    raise exception 'VERIFY: _championship_is_algrass_public no incluye public_team_price.';
  end if;
  foreach v_fn in array array[
    'public.create_championship_team(uuid, text, text, text)',
    'public.join_championship_team(uuid, uuid)',
    'public.save_championship_team(uuid, uuid, text, text, text)'
  ] loop
    select pg_get_functiondef(v_fn::regprocedure) into v_def;
    if v_def !~ 'public_individual_price is not null or v_champ\.public_team_price is not null' then
      raise exception 'VERIFY: % no amplio el criterio a public_team_price.', v_fn;
    end if;
    if v_def !~ 'PUBLIC_CHAMPIONSHIP_TEAM_PAYMENT_REQUIRED' then
      raise exception 'VERIFY: % perdio el gate de pago de equipo.', v_fn;
    end if;
  end loop;
  raise notice 'OK: criterio publico alineado en get_championship_public_pricing, los 3 gates de equipo y _championship_is_algrass_public = order_id null AND (precio individual OR precio equipo). Cerrada la entrada/creacion gratis de equipo en publicos solo-equipo; admin_cancel_championship ya los ve como publicos. Individual intacto. Privados intactos.';
end $verify$;

commit;
