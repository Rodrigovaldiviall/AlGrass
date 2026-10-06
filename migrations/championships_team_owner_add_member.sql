-- ============================================================================
-- Campeonatos PÚBLICOS · Equipo · el OWNER agrega jugadores a SU equipo (gratis)
-- ============================================================================
-- AUDITORÍA: manage_championship_player (gestión de roster host/owner/AlGrass) RECHAZA al
-- creador del equipo — su gate exige owner(champ)/host/algrass (NOT_AUTHORIZED). Por eso el
-- owner de un equipo PÚBLICO pagado no puede agregar miembros con la RPC existente. Esta es
-- la solución mínima: una RPC DEDICADA para que el CREATOR del equipo agregue usuarios reales
-- a SU propio equipo, GRATIS (la inscripción del equipo ya la pagó). No cambia
-- manage_championship_player (privados intactos).
--
-- Reglas: authenticated; actor = championship_teams.created_by_user_id; campeonato PÚBLICO
-- (order_id NULL + algún precio público) y SOLO registration_open; target = usuario real; host
-- nunca como jugador. Respeta la política de participación (reutiliza _championship_participation):
--   · target 'none' / 'free_individual' → se inserta/mueve a este equipo (no saca de ningún equipo);
--   · target ya en ESTE equipo → idempotente;
--   · target 'paid_individual'/'team_owner' → ALREADY_ENROLLED (debe cancelar);
--   · target 'free_member' de OTRO equipo → ALREADY_IN_OTHER_TEAM (no se le arrastra sin su consentimiento).
-- NO cobra, NO crea order, NO toca wallet/reward. NO toca Match/Rental ni privados.
-- ============================================================================

begin;

do $pre$
begin
  if to_regprocedure('public._championship_participation(uuid, uuid)') is null then
    raise exception 'Abortado: falta _championship_participation (aplica antes championships_public_individual_itemized.sql).';
  end if;
end $pre$;

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
  if v_team.created_by_user_id is distinct from v_actor then raise exception 'NOT_AUTHORIZED'; end if;  -- solo el owner del equipo

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || v_team.championship_id::text)::bigint);

  select * into v_champ from public.championships where id = v_team.championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if not (v_champ.order_id is null and (v_champ.public_individual_price is not null or v_champ.public_team_price is not null)) then
    raise exception 'NOT_PUBLIC';
  end if;
  if v_champ.status <> 'registration_open' then raise exception 'NOT_OPEN'; end if;

  if p_user_id is null or not exists (select 1 from public.users_public where id = p_user_id) then
    raise exception 'INVALID_INPUT';
  end if;
  if v_champ.host_user_id is not null and v_champ.host_user_id = p_user_id then
    raise exception 'NOT_AUTHORIZED';   -- el host nunca como jugador
  end if;

  v_part := public._championship_participation(v_team.championship_id, p_user_id);
  select true, cp.team_id into v_has, v_cur
    from public.championship_players cp
   where cp.championship_id = v_team.championship_id and cp.user_id = p_user_id;

  if coalesce(v_has, false) and v_cur = p_team_id then
    return jsonb_build_object('team_id', p_team_id, 'user_id', p_user_id, 'already', true);   -- ya en ESTE equipo
  end if;
  if v_part in ('paid_individual','team_owner') then raise exception 'ALREADY_ENROLLED'; end if;      -- pagado → cancelar primero
  if v_part = 'free_member' then raise exception 'ALREADY_IN_OTHER_TEAM'; end if;                     -- en otro equipo → no arrastrar

  -- 'none' (nuevo) o 'free_individual' (sin equipo gratis) → se incorpora a este equipo. Sin pago.
  insert into public.championship_players (championship_id, user_id, team_id)
    values (v_team.championship_id, p_user_id, p_team_id)
  on conflict (championship_id, user_id) do update set team_id = excluded.team_id;

  return jsonb_build_object('team_id', p_team_id, 'user_id', p_user_id, 'already', false);
end $$;
revoke all on function public.add_championship_team_member(uuid, uuid) from public, anon;
grant execute on function public.add_championship_team_member(uuid, uuid) to authenticated;

do $verify$
declare v_def text;
begin
  select pg_get_functiondef(to_regprocedure('public.add_championship_team_member(uuid, uuid)')) into v_def;
  if v_def !~ 'created_by_user_id is distinct from v_actor' then raise exception 'VERIFY: no restringe al owner del equipo.'; end if;
  if v_def !~ '_championship_participation' then raise exception 'VERIFY: no respeta la politica de participacion.'; end if;
  if v_def !~ 'ALREADY_ENROLLED' or v_def !~ 'ALREADY_IN_OTHER_TEAM' then raise exception 'VERIFY: no bloquea pagados / miembros de otro equipo.'; end if;
  if v_def !~ 'status <> ''registration_open''' then raise exception 'VERIFY: no limita a registration_open.'; end if;
  raise notice 'OK: add_championship_team_member owner-only, publico, registration_open; agrega gratis respetando participacion; no cobra.';
end $verify$;

commit;
