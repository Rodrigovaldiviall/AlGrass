-- ============================================================================
-- Campeonatos · El OWNER puede agregar jugadores en PRIVADOS — también en la RPC
-- ============================================================================
-- Complemento de championships_owner_add_player_private.sql (ya aplicado en V4),
-- que extendió el helper _champ_can_manage_roster('add_player') para admitir al
-- owner en campeonatos privados. PERO manage_championship_player tiene un gate de
-- ROL PROPIO y ANTERIOR al helper:
--
--   if v_action = 'add_player' and not (v_is_host or v_is_algrass) then
--     raise exception 'NOT_AUTHORIZED';
--   end if;
--
-- Ese gate excluía al owner ANTES de llegar al helper → el owner de un campeonato
-- privado recibía NOT_AUTHORIZED al agregar un jugador, pese al cambio del helper.
--
-- ESTA migración reemite SOLO public.manage_championship_player con el cuerpo
-- EXACTAMENTE igual al vigente (championships_phase20_roster_matrix.sql) salvo
-- ese único gate, que pasa a reflejar la misma regla que el helper:
--   owner permitido en add_player SOLO si championship.privacy = 'private'.
-- La ventana de FASE la sigue decidiendo _champ_can_manage_roster (RO/RC/PRE/LIVE;
-- nunca pending_publish ni completed) — NO se toca el helper.
--
-- No cambia: advisory lock, auth.uid(), validación users_public, cálculo de
-- v_self/v_exists/v_action, TEAM_NOT_FOUND, upsert de championship_players,
-- revoke/grant. No toca self, move_player, ni ninguna otra acción. Idempotente.
-- ============================================================================

create or replace function public.manage_championship_player(
  p_championship_id uuid,
  p_user_id         uuid,
  p_team_id         uuid    default null,
  p_remove          boolean default false
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor      uuid := auth.uid();
  v_champ      public.championships%rowtype;
  v_is_owner   boolean;
  v_is_host    boolean;
  v_is_algrass boolean;
  v_exists     boolean;
  v_self       boolean;
  v_action     text;
  v_deleted    int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  -- MISMA lock key que join/leave/save/delete → serializa todas las mutaciones de roster que compiten.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  v_is_algrass := public._is_algrass_staff(v_actor);
  v_is_owner   := (v_champ.owner_user_id = v_actor);
  v_is_host    := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  if not (v_is_owner or v_is_host or v_is_algrass) then raise exception 'NOT_AUTHORIZED'; end if;

  -- Objetivo: usuario REAL de la app (championship_players.user_id sin FK). Sin invitaciones externas.
  if p_user_id is null
     or not exists (select 1 from public.users_public where id = p_user_id) then
    raise exception 'INVALID_INPUT';
  end if;

  v_self   := (p_user_id = v_actor);
  v_exists := exists (select 1 from public.championship_players
                       where championship_id = p_championship_id and user_id = p_user_id);
  -- Categoría de operación:
  --   self       → target = actor (auto-inscribirse/mover/quedar-sin-equipo/desuscribirse owner/host).
  --   move_player→ target YA inscrito (o remove): mover/asignar/quitar membership existente.
  --   add_player → target NUEVO no inscrito: agregar tercero (host/AlGrass; y owner SOLO en privados).
  if v_self then
    v_action := 'self';
  elsif p_remove or v_exists then
    v_action := 'move_player';
  else
    v_action := 'add_player';
  end if;

  -- Regla de ROL: agregar un tercero nuevo es de host/AlGrass y, en campeonatos PRIVADOS, también del owner
  -- (mismo criterio que _champ_can_manage_roster). Falla de rol → NOT_AUTHORIZED. La ventana de fase la valida
  -- el helper más abajo (owner-privado: RO/RC/PRE/LIVE; nunca pending_publish ni completed).
  if v_action = 'add_player'
     and not (
       v_is_host
       or v_is_algrass
       or (v_is_owner and v_champ.privacy = 'private')
     )
  then
    raise exception 'NOT_AUTHORIZED';
  end if;
  -- Ventana por acción/estado. Privilegiado pero fuera de ventana → NOT_OPEN.
  if not public._champ_can_manage_roster(p_championship_id, v_actor, v_action) then
    raise exception 'NOT_OPEN';
  end if;

  if p_remove then
    delete from public.championship_players
     where championship_id = p_championship_id and user_id = p_user_id;
    get diagnostics v_deleted = row_count;
    return jsonb_build_object('championship_id', p_championship_id, 'user_id', p_user_id,
                              'team_id', null, 'removed', v_deleted > 0);
  end if;

  -- Asignación a team: debe existir Y pertenecer a ESTE campeonato (jamás team de otro campeonato).
  if p_team_id is not null
     and not exists (select 1 from public.championship_teams
                      where id = p_team_id and championship_id = p_championship_id) then
    raise exception 'TEAM_NOT_FOUND';
  end if;

  insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, p_user_id, p_team_id)
  on conflict (championship_id, user_id) do update set team_id = excluded.team_id;

  return jsonb_build_object('championship_id', p_championship_id, 'user_id', p_user_id,
                            'team_id', p_team_id, 'removed', false);
end; $$;
revoke all on function public.manage_championship_player(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.manage_championship_player(uuid, uuid, uuid, boolean) to authenticated;

do $verify$
declare v_def text;
begin
  select pg_get_functiondef(to_regprocedure('public.manage_championship_player(uuid, uuid, uuid, boolean)')) into v_def;
  if v_def is null then raise exception 'VERIFY: no existe manage_championship_player.'; end if;
  if v_def !~ 'v_is_owner and v_champ\.privacy = ''private''' then
    raise exception 'VERIFY: el gate de add_player no admite al owner en privados.';
  end if;
  -- El helper sigue siendo el que pone la ventana de fase (no se tocó aquí).
  if v_def !~ '_champ_can_manage_roster\(p_championship_id, v_actor, v_action\)' then
    raise exception 'VERIFY: se perdió la validación de ventana por helper.';
  end if;
  raise notice 'OK: manage_championship_player permite add_player a host/AlGrass y, en privados, al owner. Ventana por _champ_can_manage_roster intacta.';
end $verify$;
