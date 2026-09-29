-- ============================================================================
-- Campeonatos · Fase 13 — Organizadores (owner + host) en el estado de inscripción
-- ============================================================================
-- Un campeonato lo paga alguien (owner_user_id) y, a veces, lo dirige otra
-- persona. Esta fase abre sitio para esa segunda figura —`host_user_id`— y hace
-- que la pantalla de inscripción sepa quiénes son, con la MISMA proyección
-- pública que ya usa el roster: id, nombre, avatar y tono.
--
-- Lo que esta fase NO hace, a propósito:
--   · NO asigna host. No hay RPC, ni UI, ni backfill: la columna nace nula y
--     nula se queda hasta que exista una fase que la escriba.
--   · NO crea RPC nueva ni tabla nueva. Se amplía el retorno de la RPC que ya
--     lee ese estado, `get_championship_registration_state`.
--   · NO toca permisos, RLS, ni el flujo de inscripción. El gate de lectura, el
--     capitán dinámico y los conteos quedan EXACTAMENTE como estaban.
-- ============================================================================

-- ── 1) championships.host_user_id — referencia LÓGICA, sin FK ────────────────
-- Mismo patrón que el resto del módulo: `owner_user_id` («referencia LÓGICA,
-- sin FK, igual que orders.payer_user_id»), `venue_id` («sin FK a propósito») y
-- `order_id` («Sin FK»). Las únicas FK de Campeonatos son internas
-- (championship_id, team_id), donde el borrado en cascada SÍ es lo que se
-- quiere. Hacia usuarios no se declara ninguna: borrar una cuenta no puede
-- arrastrar ni bloquear un campeonato ya pagado, y el proyecto resuelve el
-- nombre por consulta, no por integridad referencial.
alter table public.championships
  add column if not exists host_user_id uuid;

comment on column public.championships.host_user_id is
  'Organizador que dirige el campeonato, si no es el que pagó. Referencia LOGICA a users (sin FK, como owner_user_id). NULL = solo hay owner. La asignacion no esta implementada todavia.';


-- ── 2) get_championship_registration_state — ahora devuelve `organizers` ─────
-- Misma firma, mismo gate, mismo cuerpo: lo ÚNICO que cambia es una clave más
-- en el jsonb de salida. El frontend que no la lea sigue funcionando igual.
create or replace function public.get_championship_registration_state(p_championship_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_teams jsonb; v_players jsonb; v_me jsonb; v_pcount int;
  v_is_algrass boolean := public._is_algrass_staff(v_actor);
  v_owner jsonb; v_host jsonb;
begin
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  -- Legible en estados públicos, o si el actor es el owner, o AlGrass (para gestión pre-publicación).
  if not (v_champ.status in ('registration_open','registration_closed','in_progress','completed')
          or v_champ.owner_user_id = v_actor or v_is_algrass) then
    raise exception 'CHAMPIONSHIP_NOT_FOUND';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'name', t.name, 'color', t.color, 'design', t.design,
           'created_by_user_id', t.created_by_user_id,
           -- creator_is_privileged: el team lo creó el owner o un AlGrass → DELETE protegido (solo owner/AlGrass).
           'creator_is_privileged', (t.created_by_user_id = v_champ.owner_user_id
                                      or public._is_algrass_staff(t.created_by_user_id)),
           'player_count', (select count(*) from public.championship_players p where p.team_id = t.id)
         ) order by t.created_at), '[]'::jsonb)
    into v_teams
    from public.championship_teams t where t.championship_id = p_championship_id;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by (x.user_id = v_actor) desc, lower(x.full_name)), '[]'::jsonb)
    into v_players
    from (
      -- is_captain: por equipo, el miembro con joined_at más antiguo (capitán DINÁMICO, sin columna nueva).
      select p.user_id, u.full_name, u.avatar_path, u.avatar_hue, p.team_id, t.name as team_name,
             (p.team_id is not null and p.user_id = (
                select cp.user_id from public.championship_players cp
                 where cp.team_id = p.team_id order by cp.joined_at asc, cp.user_id asc limit 1
             )) as is_captain
        from public.championship_players p
        left join public.users_public u on u.id = p.user_id
        left join public.championship_teams t on t.id = p.team_id
       where p.championship_id = p_championship_id
    ) x;

  select count(*) into v_pcount from public.championship_players where championship_id = p_championship_id;

  select case when p.user_id is null then null
              else jsonb_build_object('user_id', p.user_id, 'team_id', p.team_id) end
    into v_me
    from (select * from public.championship_players where championship_id = p_championship_id and user_id = v_actor) p;

  -- ── Organizadores ──────────────────────────────────────────────────────────
  -- MISMA proyección pública que el roster (user_id, full_name, avatar_path,
  -- avatar_hue) y desde la MISMA fuente, `users_public`: la vista ya filtra las
  -- cuentas borradas y es la única superficie de usuarios que el frontend lee.
  -- Aquí no se toca `public.users`.
  --
  -- El owner viaja SIEMPRE, incluso si su fila no se resuelve —cuenta borrada—:
  -- el LEFT JOIN sobre una fila sintética garantiza el objeto con su `user_id`
  -- y el resto en null. Devolver `organizers.owner = null` habría dejado un
  -- campeonato aparentemente sin dueño, que es peor que un nombre vacío.
  select jsonb_build_object(
           'user_id',     v_champ.owner_user_id,
           'full_name',   u.full_name,
           'avatar_path', u.avatar_path,
           'avatar_hue',  u.avatar_hue)
    into v_owner
    from (select 1) s
    left join public.users_public u on u.id = v_champ.owner_user_id;

  -- El host solo existe si está puesto Y es alguien DISTINTO del owner: una
  -- misma persona en los dos papeles se enseñaría dos veces en la misma tarjeta.
  -- `is distinct from` y no `<>` porque con nulos `<>` no decide nada.
  if v_champ.host_user_id is not null
     and v_champ.host_user_id is distinct from v_champ.owner_user_id then
    select jsonb_build_object(
             'user_id',     v_champ.host_user_id,
             'full_name',   u.full_name,
             'avatar_path', u.avatar_path,
             'avatar_hue',  u.avatar_hue)
      into v_host
      from (select 1) s
      left join public.users_public u on u.id = v_champ.host_user_id;
  end if;

  return jsonb_build_object(
    'teams', v_teams,
    'players', v_players,
    'current_user_membership', v_me,
    'owner_user_id', v_champ.owner_user_id,
    'is_algrass', v_is_algrass,
    'team_count', (select count(*) from public.championship_teams where championship_id = p_championship_id),
    'player_count', v_pcount,
    -- `host` a null cuando no hay: la clave existe siempre, el valor no.
    'organizers', jsonb_build_object('owner', v_owner, 'host', v_host)
  );
end; $$;
revoke all on function public.get_championship_registration_state(uuid) from public, anon;
grant execute on function public.get_championship_registration_state(uuid) to authenticated;


-- ── Verificación ─────────────────────────────────────────────────────────────
do $verify$
declare
  v_def text;
  v_oid oid;
  v_conname text;
begin
  -- La columna existe, es uuid y es nullable.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'championships'
       and column_name = 'host_user_id' and data_type = 'uuid'
  ) then
    raise exception 'VERIFY: falta championships.host_user_id uuid';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'championships'
       and column_name = 'host_user_id' and is_nullable = 'NO'
  ) then
    raise exception 'VERIFY: host_user_id debe ser nullable';
  end if;

  -- Referencia LOGICA: ninguna FK sobre esa columna (mismo patron que owner_user_id).
  select c.conname into v_conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.championships'::regclass
     and c.contype = 'f' and a.attname = 'host_user_id'
   limit 1;
  if v_conname is not null then
    raise exception 'VERIFY: host_user_id no debe tener FK (referencia logica), hay %', v_conname;
  end if;

  select p.oid, pg_get_functiondef(p.oid) into v_oid, v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_championship_registration_state'
   limit 1;

  if v_def is null then
    raise exception 'VERIFY: falta get_championship_registration_state';
  end if;
  if v_def !~ 'SECURITY DEFINER' then
    raise exception 'VERIFY: la RPC debe seguir siendo security definer';
  end if;
  if v_def !~ 'organizers' then
    raise exception 'VERIFY: la RPC debe devolver organizers';
  end if;
  -- Los usuarios se leen por la vista publica, nunca por la tabla.
  if v_def ~ 'from public\.users\y' then
    raise exception 'VERIFY: la RPC no puede leer la tabla de usuarios directamente';
  end if;
  if v_def !~ 'users_public' then
    raise exception 'VERIFY: la proyeccion publica debe salir de users_public';
  end if;
  -- El gate de lectura no se ha tocado.
  if v_def !~ '_is_algrass_staff' or v_def !~ 'CHAMPIONSHIP_NOT_FOUND' then
    raise exception 'VERIFY: el gate de lectura de la RPC ha cambiado';
  end if;
  if has_function_privilege('anon', v_oid, 'execute') then
    raise exception 'VERIFY: anon no puede ejecutar la RPC';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception 'VERIFY: authenticated debe poder ejecutar la RPC';
  end if;

  raise notice 'OK: host_user_id (sin FK) y organizers.owner/host en el estado de inscripcion.';
end $verify$;
