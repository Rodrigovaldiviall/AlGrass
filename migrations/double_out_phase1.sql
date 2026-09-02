-- ============================================================================
-- Doble salida · Fase 1 — MODELO (columnas, estados, solapamiento seguro, RPCs)
-- ============================================================================
-- Un game Match o Rental puede tener UN game alternativo del tipo contrario para
-- el MISMO field/fecha/hora/duración (A ↔ B). En Supabase siguen siendo dos
-- filas; el enlace es games.alternative_game_id (1:1, tipos opuestos).
--
-- Esta fase NO implementa bloqueo automático, locks cross-game, create_order,
-- materialización, R1, crédito/free ni reapertura automática. Solo deja el
-- modelo y las operaciones manuales del Admin listas.
-- ============================================================================

-- ── 1) Columnas nuevas ──────────────────────────────────────────────────────
alter table public.games
  add column if not exists alternative_game_id uuid,
  -- Token compartido SOLO por la pareja, para la restricción de solapamiento.
  -- Singleton: NULL → coalesce(overlap_group, id)=id (único). Pareja: ambos
  -- comparten el id del game "primario", así el par puede solaparse y nadie más.
  add column if not exists overlap_group uuid,
  -- Recuerda el estado MANUAL previo cuando un game pasa a 'blocked' (Fase 2),
  -- para restaurar 'paused' vs 'published' al reabrir. Fase 1 solo lo crea.
  add column if not exists blocked_from_status text;

-- FK self-referencial. on delete set null: si se borra un gemelo, el otro queda
-- des-vinculado (no se arrastra la baja).
alter table public.games
  drop constraint if exists games_alternative_game_id_fkey;
alter table public.games
  add constraint games_alternative_game_id_fkey
  foreign key (alternative_game_id) references public.games(id) on delete set null;

-- ── 2) Estados: añadir 'paused' y 'blocked' ─────────────────────────────────
-- published = disponible; reserved = con compromiso; paused = desactivado
-- manual (reversible); blocked = el alternativo ganó (NO reversible manual);
-- canceled = cancelación real. (draft/completed/expired se conservan.)
alter table public.games drop constraint if exists games_status_check;
alter table public.games add constraint games_status_check
  check (status = any (array[
    'draft','published','reserved','completed','expired','canceled','paused','blocked'
  ]));

-- ── 3) Solapamiento SEGURO — solo la pareja explícita puede solaparse ───────
-- Se sustituye no_field_time_overlap por una versión con un token de grupo:
--   coalesce(overlap_group, id)::text WITH <>
-- Patrón canónico de btree_gist ("mismo hueco solo si mismo grupo"): la
-- restricción RECHAZA cuando field igual + tiempo solapado + token DISTINTO.
--   · Pareja A↔B: comparten token (id del primario) → token NO distinto → OK.
--   · Singleton vs singleton: tokens = sus ids → distintos → RECHAZADO (igual que hoy).
--   · Tercero C sobre A/B: token propio de C ≠ token del par → RECHAZADO.
-- NO usa "alternative_game_id IS NOT NULL → ignora" (eso dejaría entrar terceros).
-- El token va ::text para garantizar soporte del operador <> en gist.
-- WHERE conserva EXACTAMENTE el conjunto actual (draft/published/active).
alter table public.games drop constraint if exists no_field_time_overlap;
alter table public.games add constraint no_field_time_overlap
  exclude using gist (
    field_id with =,
    (coalesce(overlap_group, id)::text) with <>,
    tsrange(
      (date_key + time),
      ((date_key + time) + ((duration_min)::double precision * '00:01:00'::interval)),
      '[)'
    ) with &&
  ) where (status = any (array['draft'::text, 'published'::text, 'active'::text]));

-- ── 4) RPC create_double_out — crea el gemelo del tipo contrario y vincula ──
-- Atómica: inserta el gemelo (mismo slot, token = id del origen), lo enlaza con
-- el origen y devuelve su id. Exige: origen sin pareja previa y publicado.
-- Reutiliza precio del tipo contrario (Match→Rental: price_total; Rental→Match:
-- price_per_person; price_total del match lo calcula el trigger de la base).
create or replace function public.create_double_out(p_source_id uuid, p_price numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_src   public.games%rowtype;
  v_twin_type text;
  v_twin_id   uuid;
  v_players   integer;
begin
  -- Autorización: solo back-office (algrass_admin | algrass_staff). Mismo patrón
  -- que cancel_match/reserve_slots (EXISTS sobre user_roles). SECURITY DEFINER, así
  -- que la validación se hace aquí dentro; un jugador authenticated recibe rechazo.
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.user_roles
     where user_id = v_actor and role in ('algrass_admin', 'algrass_staff')
  ) then raise exception 'NOT_AUTHORIZED'; end if;

  select * into v_src from public.games where id = p_source_id for update;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;
  if v_src.alternative_game_id is not null then raise exception 'ALREADY_PAIRED'; end if;
  if v_src.status <> 'published' then raise exception 'SOURCE_NOT_PUBLISHED'; end if;
  if v_src.type not in ('match','rental') then raise exception 'INVALID_TYPE'; end if;
  if p_price is null or p_price <= 0 then raise exception 'INVALID_PRICE'; end if;

  v_twin_type := case when v_src.type = 'match' then 'rental' else 'match' end;
  v_players   := coalesce(split_part(lower(v_src.format), 'v', 1)::int * 2, 0);

  insert into public.games (
    field_id, type, status, format, total_spots, duration_min,
    date_key, time, host_user_id,
    price_per_person, price_total,
    alternative_game_id, overlap_group
  ) values (
    v_src.field_id, v_twin_type, 'published', v_src.format,
    -- rental usa cupos del formato sin suplentes; match arranca sin suplentes.
    v_players, v_src.duration_min,
    v_src.date_key, v_src.time, v_src.host_user_id,
    case when v_twin_type = 'match'  then p_price else null end,
    case when v_twin_type = 'rental' then p_price else null end,  -- match: lo recalcula el trigger
    v_src.id, v_src.id
  )
  returning id into v_twin_id;

  update public.games
     set alternative_game_id = v_twin_id,
         overlap_group       = v_src.id
   where id = v_src.id;

  return v_twin_id;
end;
$$;

grant execute on function public.create_double_out(uuid, numeric) to authenticated;

-- ── 5) RPC set_double_out_mode — modo manual de la pareja ───────────────────
-- Modos: 'double' (ambos published), 'match_only' (match published/rental paused),
-- 'rental_only' (match paused/rental published). SOLO si ambos están LIBRES
-- (published|paused): reserved/blocked/canceled no se tocan manualmente.
create or replace function public.set_double_out_mode(p_game_id uuid, p_mode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_alt   uuid;
  v_a public.games%rowtype;  -- el game recibido
  v_b public.games%rowtype;  -- su gemelo
  v_match_id  uuid;
  v_rental_id uuid;
begin
  -- Autorización: solo back-office (algrass_admin | algrass_staff). Mismo patrón
  -- que cancel_match/reserve_slots (EXISTS sobre user_roles). SECURITY DEFINER, así
  -- que la validación se hace aquí dentro; un jugador authenticated recibe rechazo.
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.user_roles
     where user_id = v_actor and role in ('algrass_admin', 'algrass_staff')
  ) then raise exception 'NOT_AUTHORIZED'; end if;

  if p_mode not in ('double','match_only','rental_only') then raise exception 'INVALID_MODE'; end if;

  -- Identifica el gemelo y BLOQUEA ambas filas SIEMPRE en orden ascendente por id
  -- (determinista → sin deadlocks entre llamadas desde games opuestos de la pareja).
  select alternative_game_id into v_alt from public.games where id = p_game_id;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;
  if v_alt is null then raise exception 'NOT_PAIRED'; end if;
  perform 1 from public.games where id in (p_game_id, v_alt) order by id for update;

  select * into v_a from public.games where id = p_game_id;
  select * into v_b from public.games where id = v_alt;
  if not found then raise exception 'TWIN_NOT_FOUND'; end if;

  -- Ambos deben estar libres (preferencia manual): published o paused.
  if v_a.status not in ('published','paused') or v_b.status not in ('published','paused') then
    raise exception 'PAIR_NOT_FREE';
  end if;

  if v_a.type = 'match' then v_match_id := v_a.id; v_rental_id := v_b.id;
  else v_match_id := v_b.id; v_rental_id := v_a.id; end if;

  if p_mode = 'double' then
    update public.games set status = 'published' where id in (v_match_id, v_rental_id);
  elsif p_mode = 'match_only' then
    update public.games set status = 'published' where id = v_match_id;
    update public.games set status = 'paused'    where id = v_rental_id;
  else -- rental_only
    update public.games set status = 'paused'    where id = v_match_id;
    update public.games set status = 'published' where id = v_rental_id;
  end if;
end;
$$;

grant execute on function public.set_double_out_mode(uuid, text) to authenticated;
