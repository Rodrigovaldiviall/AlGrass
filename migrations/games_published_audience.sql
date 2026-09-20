-- ============================================================================
-- games.published_audience — audiencia de un game PUBLICADO ('public' | 'captain')
-- ============================================================================
-- UNA sola columna persistente. SOLO determina audiencia cuando status='published':
--   published + public   → visible para todos (comportamiento actual)
--   published + captain  → visible SOLO para captain/captain_gold (UX; NO es RLS)
-- En cualquier otro status NO cambia el comportamiento. reserved SIEMPRE es público
-- (la columna NO se usa para ocultar reserved). NO se modifica automáticamente en las
-- transiciones de status: persiste, así reserved→published recupera su audiencia sola.
--
-- ADITIVA. NO añade RLS ni cambia GRANTs de games. NO crea segundas columnas
-- (visibility/original_visibility/...). Filas existentes → 'public' por el DEFAULT.
-- ============================================================================

-- 1) Columna: NOT NULL DEFAULT 'public' (idempotente).
alter table public.games
  add column if not exists published_audience text not null default 'public';

-- 2) Constraint de valores permitidos (idempotente).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'games_published_audience_check') then
    alter table public.games
      add constraint games_published_audience_check
      check (published_audience in ('public', 'captain'));
  end if;
end $$;


-- 3) create_double_out — permite fijar la audiencia del GEMELO creado (default 'public').
-- CREATE OR REPLACE partiendo EXACTAMENTE de double_out_phase1.sql. ÚNICO cambio: nuevo
-- parámetro OPCIONAL p_twin_audience (default 'public' → callers actuales intactos) que se
-- persiste en published_audience del gemelo insertado. La audiencia del ORIGEN NO se toca
-- (ya la tiene de su propia creación) → cada gemelo conserva SU audiencia, independientes.
-- Se elimina la firma antigua de 2 args: el 3-args con DEFAULT resuelve también las llamadas
-- create_double_out(id, price) → queda UNA sola definición, retro-compatible.
drop function if exists public.create_double_out(uuid, numeric);
create or replace function public.create_double_out(
  p_source_id     uuid,
  p_price         numeric,
  p_twin_audience text default 'public'
)
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
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.user_roles
     where user_id = v_actor and role in ('algrass_admin', 'algrass_staff')
  ) then raise exception 'NOT_AUTHORIZED'; end if;

  if p_twin_audience not in ('public', 'captain') then raise exception 'INVALID_AUDIENCE'; end if;

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
    alternative_game_id, overlap_group, published_audience
  ) values (
    v_src.field_id, v_twin_type, 'published', v_src.format,
    v_players, v_src.duration_min,
    v_src.date_key, v_src.time, v_src.host_user_id,
    case when v_twin_type = 'match'  then p_price else null end,
    case when v_twin_type = 'rental' then p_price else null end,
    v_src.id, v_src.id, p_twin_audience
  )
  returning id into v_twin_id;

  update public.games
     set alternative_game_id = v_twin_id,
         overlap_group       = v_src.id
   where id = v_src.id;

  return v_twin_id;
end;
$$;

grant execute on function public.create_double_out(uuid, numeric, text) to authenticated;
