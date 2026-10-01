-- ============================================================================
-- Campeonatos · Lecturas de LISTADO — paridad App/Admin (SOLO LECTURA, aditiva)
-- ============================================================================
-- Perfil ("Mis campeonatos") y el menu Campeonatos derivaban el texto secundario (sede, cantidad de equipos,
-- formato) EXCLUSIVAMENTE de format_config.summary. Los campeonatos creados desde AlGrass-Admin escriben un
-- format_config.summary minimo, por lo que esas superficies solo mostraban el nombre.
--
-- Esta migracion AÑADE a las dos RPC de listado campos AUTORITATIVOS ya existentes (los mismos que usa
-- get_championship_public), para que el frontend tenga respaldo cuando summary este vacio:
--   · list_my_championships()        → + team_capacity, venue_name, city, first_date, last_date   (5 claves)
--   · list_public_championships(text) → + team_capacity, venue_name, city                          (3 claves)
--
-- BASES EXACTAS de cada funcion (ultima version instalada conocida):
--   · list_my_championships()        = Fase 37 (owner + host + participante; excluye el estado de pago abortado;
--                                               conserva host_user_id e is_participant).
--   · list_public_championships(text) = version por CIUDAD (gate de estados publicados + filtro por venue.city;
--                                               NO forma parte de su contrato live_started_at → no se añade).
--
-- ADITIVA y COMPATIBLE: conserva EXACTAMENTE firma, claves previas, orden, filtros (WHERE), privacidad,
-- SECURITY DEFINER, search_path y grants de cada funcion. No crea tablas/columnas. No toca creacion/pagos/
-- inscripcion/publicacion ni el repo Admin. No inventa formato (aqui no se deriva ningun formato nuevo).
-- ============================================================================

-- ── STEP 0 — Snapshot de las versiones ACTUALMENTE instaladas (para comparar tras el reemplazo) ──
do $$
declare v_my text; v_pub text;
begin
  select pg_get_functiondef(p.oid) into v_my
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'list_my_championships' and p.pronargs = 0;
  select pg_get_functiondef(p.oid) into v_pub
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'list_public_championships'
     and pg_get_function_identity_arguments(p.oid) = 'p_city text';
  create temporary table if not exists _champ_reads_audit(fn text primary key, src text);
  delete from _champ_reads_audit;
  insert into _champ_reads_audit values ('my', v_my), ('pub', v_pub);
end $$;


-- ── 1) list_my_championships() — BASE Fase 37 + 5 claves (team_capacity, venue_name, city, first/last_date) ──
create or replace function public.list_my_championships()
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id, 'status', c.status, 'name', c.name, 'cover_theme', c.cover_theme,
    'event_date', c.event_date, 'start_time', c.start_time, 'format_config', c.format_config,
    'registration_closes_at', c.registration_closes_at, 'created_at', c.created_at,
    'live_started_at', c.live_started_at,
    'host_user_id', c.host_user_id,
    'is_participant', exists (
      select 1 from public.championship_players cp
       where cp.championship_id = c.id and cp.user_id = auth.uid()
    ),
    -- AÑADIDO (lectura autoritativa): capacidad real + sede/ciudad del venue principal + rango fisico.
    'team_capacity', public._championship_team_capacity(c.format_config),
    'venue_name', (select v.name from public.venues v where v.id = c.venue_id),
    'city',       (select v.city from public.venues v where v.id = c.venue_id),
    'first_date', (select min(g.date_key) from public.championship_reservation_games crg
                     join public.games g on g.id = crg.game_id where crg.championship_id = c.id),
    'last_date',  (select max(g.date_key) from public.championship_reservation_games crg
                     join public.games g on g.id = crg.game_id where crg.championship_id = c.id)
  )
  from public.championships c
  where (
      (c.owner_user_id = auth.uid()
       and c.status in ('payment_validation', 'pending_publish', 'registration_open',
                        'registration_closed', 'in_progress', 'completed'))
      or
      (c.host_user_id is not null and c.host_user_id = auth.uid()
       and c.status in ('payment_validation', 'pending_publish', 'registration_open',
                        'registration_closed', 'in_progress', 'completed'))
      or
      (exists (select 1 from public.championship_players cp
                where cp.championship_id = c.id and cp.user_id = auth.uid())
       and c.status in ('registration_open', 'registration_closed',
                        'in_progress', 'completed'))
    )
  order by c.event_date asc;
$$;
revoke all on function public.list_my_championships() from public, anon;
grant execute on function public.list_my_championships() to authenticated;


-- ── 2) list_public_championships(p_city text) — BASE version por ciudad + 3 claves (team_capacity/venue_name/city) ──
create or replace function public.list_public_championships(p_city text)
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'cover_theme', c.cover_theme, 'status', c.status,
    'privacy', c.privacy, 'results_public', c.results_public,
    'event_date', c.event_date, 'start_time', c.start_time, 'end_time', c.end_time,
    'venue_id', c.venue_id, 'format_config', c.format_config,
    'registration_closes_at', c.registration_closes_at, 'published_at', c.published_at,
    'first_date', (select min(g.date_key) from public.championship_reservation_games crg
                     join public.games g on g.id = crg.game_id where crg.championship_id = c.id),
    'last_date',  (select max(g.date_key) from public.championship_reservation_games crg
                     join public.games g on g.id = crg.game_id where crg.championship_id = c.id),
    -- AÑADIDO (lectura autoritativa): capacidad real + sede/ciudad del venue principal.
    'team_capacity', public._championship_team_capacity(c.format_config),
    'venue_name', (select v.name from public.venues v where v.id = c.venue_id),
    'city',       (select v.city from public.venues v where v.id = c.venue_id)
  )
  from public.championships c
  where c.status in ('registration_open', 'registration_closed', 'in_progress', 'completed')
    and nullif(btrim(coalesce(p_city, '')), '') is not null
    and exists (select 1 from public.venues v where v.id = c.venue_id and v.city = p_city)
  order by c.event_date asc;
$$;
revoke all on function public.list_public_championships(text) from public;
grant execute on function public.list_public_championships(text) to anon, authenticated;


-- ── HARNESS — compara instalada vs propuesta y aborta la migracion si algo no cuadra ──
do $$
declare
  v_my_old   text; v_pub_old  text;
  v_my_new   text; v_pub_new  text;
  k text;
  existing_my  text[] := array['id','status','name','cover_theme','event_date','start_time','format_config',
                               'registration_closes_at','created_at','live_started_at','host_user_id','is_participant'];
  added_my     text[] := array['team_capacity','venue_name','city','first_date','last_date'];
  existing_pub text[] := array['id','name','cover_theme','status','privacy','results_public','event_date',
                               'start_time','end_time','venue_id','format_config','registration_closes_at',
                               'published_at','first_date','last_date'];
  added_pub    text[] := array['team_capacity','venue_name','city'];
  qk text;   -- clave entrecomillada 'clave'
begin
  select src into v_my_old  from _champ_reads_audit where fn = 'my';
  select src into v_pub_old from _champ_reads_audit where fn = 'pub';
  select pg_get_functiondef(p.oid) into v_my_new
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'list_my_championships' and p.pronargs = 0;
  select pg_get_functiondef(p.oid) into v_pub_new
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'list_public_championships'
     and pg_get_function_identity_arguments(p.oid) = 'p_city text';

  -- (A) Ninguna clave existente desaparece (debe seguir presente como literal 'clave' en el nuevo cuerpo).
  foreach k in array existing_my loop
    qk := '''' || k || '''';
    if position(qk in v_my_new) = 0 then raise exception 'FALLA(A) list_my: desaparecio la clave existente %', k; end if;
    if v_my_old is not null and position(qk in v_my_old) = 0 then
      raise notice 'AVISO: la instalada de list_my no tenia la clave % (base distinta a la esperada)', k; end if;
  end loop;
  foreach k in array existing_pub loop
    qk := '''' || k || '''';
    if position(qk in v_pub_new) = 0 then raise exception 'FALLA(A) list_public: desaparecio la clave existente %', k; end if;
    if v_pub_old is not null and position(qk in v_pub_old) = 0 then
      raise notice 'AVISO: la instalada de list_public no tenia la clave % (base distinta a la esperada)', k; end if;
  end loop;

  -- (B) Claves nuevas presentes en la propuesta y ausentes en la instalada (prueba de que son realmente nuevas).
  foreach k in array added_my loop
    qk := '''' || k || '''';
    if position(qk in v_my_new) = 0 then raise exception 'FALLA(B) list_my: no se añadio %', k; end if;
    if v_my_old is not null and position(qk in v_my_old) > 0 then
      raise exception 'FALLA(B) list_my: % ya existia en la instalada (no es una clave nueva)', k; end if;
  end loop;
  foreach k in array added_pub loop
    qk := '''' || k || '''';
    if position(qk in v_pub_new) = 0 then raise exception 'FALLA(B) list_public: no se añadio %', k; end if;
    if v_pub_old is not null and position(qk in v_pub_old) > 0 then
      raise exception 'FALLA(B) list_public: % ya existia en la instalada (no es una clave nueva)', k; end if;
  end loop;

  -- (C) live_started_at: contrato de cada sobrecarga. Debe seguir en my; NO debe estar en public(text), y
  --     tampoco debia estar antes (si estuviera en la instalada, quitarlo seria perder una clave existente).
  if position('live_started_at' in v_my_new) = 0 then raise exception 'FALLA(C) list_my: falta live_started_at'; end if;
  if position('live_started_at' in v_pub_new) > 0 then raise exception 'FALLA(C) list_public(text): no debe exponer live_started_at'; end if;
  if v_pub_old is not null and position('live_started_at' in v_pub_old) > 0 then
    raise exception 'FALLA(C) list_public(text): la instalada SI tenia live_started_at; quitarlo rompe el contrato'; end if;

  -- (D) WHERE de list_my intacto: las TRES ramas de visibilidad presentes y el estado de pago abortado excluido.
  if position('owner_user_id = auth.uid()' in v_my_new) = 0 then raise exception 'FALLA(D) list_my: falta la rama owner'; end if;
  if position('host_user_id = auth.uid()'  in v_my_new) = 0 then raise exception 'FALLA(D) list_my: falta la rama host (los host no verian sus campeonatos)'; end if;
  if position('championship_players'       in v_my_new) = 0 then raise exception 'FALLA(D) list_my: falta la rama participante'; end if;
  if position('''canceled'''               in v_my_new) > 0 then raise exception 'FALLA(D) list_my: reintrodujo el estado canceled'; end if;

  -- (E) Lectura publica: MISMO gate de estados publicados + filtro por ciudad; sin exponer estados no publicados.
  if position('v.city = p_city' in v_pub_new) = 0 then raise exception 'FALLA(E) list_public: perdio el filtro por ciudad'; end if;
  if position('''registration_open'''   in v_pub_new) = 0
     or position('''registration_closed''' in v_pub_new) = 0
     or position('''in_progress'''      in v_pub_new) = 0
     or position('''completed'''        in v_pub_new) = 0
     then raise exception 'FALLA(E) list_public: cambio el gate de estados publicados'; end if;
  if position('''payment_validation''' in v_pub_new) > 0 or position('''pending_publish''' in v_pub_new) > 0
     then raise exception 'FALLA(E) list_public: expondria estados NO publicados (campeonatos adicionales)'; end if;

  -- (F) ORDER BY intacto en ambas.
  if position('order by c.event_date asc' in v_my_new)  = 0 then raise exception 'FALLA(F) list_my: cambio el ORDER BY'; end if;
  if position('order by c.event_date asc' in v_pub_new) = 0 then raise exception 'FALLA(F) list_public: cambio el ORDER BY'; end if;

  -- (G) SECURITY DEFINER + grants intactos.
  if (select not p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='list_my_championships' and p.pronargs=0)
     then raise exception 'FALLA(G) list_my: dejo de ser SECURITY DEFINER'; end if;
  if (select not p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='list_public_championships'
         and pg_get_function_identity_arguments(p.oid)='p_city text')
     then raise exception 'FALLA(G) list_public: dejo de ser SECURITY DEFINER'; end if;
  if not has_function_privilege('authenticated','public.list_my_championships()','execute')
     then raise exception 'FALLA(G) list_my: authenticated sin EXECUTE'; end if;
  if has_function_privilege('anon','public.list_my_championships()','execute')
     then raise exception 'FALLA(G) list_my: anon NO debe ejecutar (owner-scoped)'; end if;
  if not has_function_privilege('anon','public.list_public_championships(text)','execute')
     then raise exception 'FALLA(G) list_public: anon sin EXECUTE'; end if;
  if not has_function_privilege('authenticated','public.list_public_championships(text)','execute')
     then raise exception 'FALLA(G) list_public: authenticated sin EXECUTE'; end if;

  drop table if exists _champ_reads_audit;
  raise notice 'OK harness: list_my (+5) y list_public(text) (+3). Claves existentes intactas; nuevas verificadas; WHERE/ORDER BY/SECURITY DEFINER/grants sin cambios; rama host presente; canceled excluido; sin exposicion publica adicional.';
end $$;
