-- ============================================================================
-- Campeonatos PÚBLICOS · cerrar la ENTRADA GRATIS en públicos "team-only"
-- ============================================================================
-- CONTEXTO: M1 (championships_public_criterion_include_team_price.sql) amplió el
-- criterio estructural de público a (public_individual_price is not null OR
-- public_team_price is not null) en get_championship_public_pricing, los 3 gates de
-- EQUIPO (create/join/save) y _championship_is_algrass_public.
--
-- PERO M1 NO reemitió join_championship_without_team: quedó con el criterio ANTIGUO
-- (solo public_individual_price). Consecuencia REAL: en un público POR EQUIPOS (solo
-- public_team_price, sin precio individual) el gate NO dispara → un usuario normal se
-- inscribe GRATIS "sin equipo". Esta es la vía legacy que M1 no bloquea en ese caso.
--
-- Esta migración reemite join_championship_without_team con el criterio ESTRUCTURAL
-- completo. Reemite también join_championship_team con el MISMO criterio (idéntico a
-- M1) como defensa de orden de aplicación: si otra migración individual se reaplicó
-- después de M1, esto re-asegura el bloqueo del join gratis a equipo en team-only.
--
-- Público INDIVIDUAL y PRIVADOS: comportamiento idéntico (el criterio ya los cubría o
-- los excluye igual). AlGrass staff NO se bloquea en el join a equipo (operación
-- interna), igual que M1. No toca pagos, reward/crédito, cancelaciones, Match/Rental.
-- ============================================================================

begin;

-- ── 1 · join_championship_without_team · criterio estructural COMPLETO ────────
create or replace function public.join_championship_without_team(p_championship_id uuid)
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

  -- Público de AlGrass (criterio estructural: individual O equipos): la inscripción es de PAGO
  -- (individual) o por equipo (crear/unirse con clave/token). La vía gratuita "sin equipo" queda cerrada.
  if v_champ.order_id is null and (v_champ.public_individual_price is not null or v_champ.public_team_price is not null) then
    raise exception 'PUBLIC_CHAMPIONSHIP_PAYMENT_REQUIRED';
  end if;

  v_is_owner := (v_champ.owner_user_id = v_actor);
  v_is_host  := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  if v_is_host then raise exception 'NOT_AUTHORIZED'; end if;   -- Host NUNCA (aunque sea owner)

  -- "Sin equipo" SOLO en registration_open (cualquiera) o pending_publish (SOLO owner). En closed+ no aplica.
  if not (v_champ.status = 'registration_open'
          or (v_champ.status = 'pending_publish' and v_is_owner)) then
    raise exception 'NOT_OPEN';
  end if;

  insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, v_actor, null)
  on conflict (championship_id, user_id) do update set team_id = null;

  return jsonb_build_object('championship_id', p_championship_id, 'team_id', null);
end; $$;


-- ── 2 · join_championship_team · re-asegurar criterio estructural (defensa de orden) ──
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


-- ── 3 · Verificación ──────────────────────────────────────────────────────────
do $verify$
declare v_def text; v_fn text;
begin
  foreach v_fn in array array[
    'public.join_championship_without_team(uuid)',
    'public.join_championship_team(uuid, uuid)'
  ] loop
    select pg_get_functiondef(to_regprocedure(v_fn)) into v_def;
    if v_def !~ 'public_team_price is not null' then
      raise exception 'VERIFY: % no incluye public_team_price en el criterio estructural.', v_fn;
    end if;
  end loop;
  raise notice 'OK: join_championship_without_team y join_championship_team bloquean team-only publico (criterio individual OR equipos).';
end $verify$;

commit;
