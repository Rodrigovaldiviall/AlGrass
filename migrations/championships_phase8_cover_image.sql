-- ============================================================================
-- Campeonatos · Fase 8 — Portada con FOTO opcional (cover_image_path) + bucket público
-- ============================================================================
-- Regla de producto: cover_theme SIEMPRE existe (identidad/fallback). La foto es OPCIONAL y solo se usa
-- en el DETALLE (ChampionshipView). /championships y Profile SIEMPRE pintan el color (no cargan la foto).
--
-- Contiene:
--   1) columna championships.cover_image_path (path del Storage; NUNCA URL completa)
--   2) bucket PÚBLICO championship-covers (lectura pública; escritura solo owner en su prefijo)
--   3) update_championship_cover extendida (nombre + cover_theme + cover_image_path opcional, owner-only)
--   4) get_championship_public devuelve cover_image_path (la portada es pública → seguro)
--
-- ADITIVA. NO reabre SELECT directo sobre championships. NO toca registration_key, privacy, publish,
-- checkout, pagos, Admin, inscripciones/fixture/resultados. list_public/list_my NO devuelven la foto.
-- ============================================================================

-- ── 1) Columna: solo el PATH del objeto en Storage (no URL pública). cover_theme queda intacto. ──────
alter table public.championships add column if not exists cover_image_path text;


-- ── 2) Bucket PÚBLICO de portadas. Lectura pública (la portada no es privada); escritura protegida. ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('championship-covers', 'championship-covers', true, 8388608,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 8388608,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- READ: público (cualquiera puede ver la portada).
drop policy if exists "champ_covers_public_read" on storage.objects;
create policy "champ_covers_public_read"
  on storage.objects for select
  using (bucket_id = 'championship-covers');

-- INSERT: solo authenticated, y SOLO bajo su propio prefijo {auth.uid()}/...
drop policy if exists "champ_covers_owner_insert" on storage.objects;
create policy "champ_covers_owner_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'championship-covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE: solo authenticated sobre su propio prefijo (limpieza de foto anterior).
drop policy if exists "champ_covers_owner_delete" on storage.objects;
create policy "champ_covers_owner_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'championship-covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
-- Sin policy de UPDATE: cada cambio sube un objeto con uuid nuevo (no se sobrescribe).


-- ── 3) update_championship_cover — nombre + cover_theme + cover_image_path (owner-only) ──────────────
-- p_set_cover_image=false (default) → NO toca la foto (lo usa "Guardar" de nombre/color).
-- p_set_cover_image=true → aplica p_cover_image_path (path nuevo, o NULL para volver a solo color).
-- El path debe pertenecer al prefijo {owner}/{championship}/... (defensa; no acepta rutas ajenas/externas).
-- Return de MÍNIMA superficie (Fase 7): jsonb SOLO con id/name/cover_theme/cover_image_path.
-- NO se devuelve la fila completa (evita exponer registration_key/pagos, aunque sea al owner).
drop function if exists public.update_championship_cover(uuid, text, text);
drop function if exists public.update_championship_cover(uuid, text, text, text, boolean);
create or replace function public.update_championship_cover(
  p_championship_id uuid,
  p_name            text,
  p_cover_theme     text,
  p_cover_image_path text default null,
  p_set_cover_image  boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
  v_cover text := nullif(btrim(coalesce(p_cover_theme, '')), '');
  v_img   text := nullif(btrim(coalesce(p_cover_image_path, '')), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_name is null then raise exception 'INVALID_INPUT'; end if;
  if v_cover is not null and v_cover !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'INVALID_INPUT'; end if;

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.owner_user_id is distinct from v_actor then raise exception 'NOT_OWNER'; end if;
  if v_champ.status in ('canceled', 'completed') then raise exception 'INVALID_STATE'; end if;

  -- Validar el path de la foto (si se está fijando y no es NULL): debe estar bajo {owner}/{championship}/.
  if p_set_cover_image and v_img is not null
     and v_img not like (v_actor::text || '/' || p_championship_id::text || '/%') then
    raise exception 'INVALID_INPUT';
  end if;

  update public.championships
     set name             = v_name,
         cover_theme      = coalesce(v_cover, cover_theme),
         cover_image_path = case when p_set_cover_image then v_img else cover_image_path end,
         updated_at       = now()
   where id = p_championship_id
  returning * into v_champ;

  return jsonb_build_object(
    'id', v_champ.id,
    'name', v_champ.name,
    'cover_theme', v_champ.cover_theme,
    'cover_image_path', v_champ.cover_image_path
  );
end;
$$;
revoke all on function public.update_championship_cover(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.update_championship_cover(uuid, text, text, text, boolean) to authenticated;


-- ── 4) get_championship_public — añadir cover_image_path (portada pública; sigue SIN registration_key) ─
create or replace function public.get_championship_public(p_championship_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_champ public.championships%rowtype;
begin
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if not (v_champ.status in ('registration_open', 'registration_closed', 'in_progress', 'completed')
          or v_champ.owner_user_id = auth.uid()) then
    raise exception 'CHAMPIONSHIP_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'id', v_champ.id, 'status', v_champ.status, 'name', v_champ.name,
    'cover_theme', v_champ.cover_theme, 'cover_image_path', v_champ.cover_image_path,
    'event_date', v_champ.event_date, 'start_time', v_champ.start_time, 'end_time', v_champ.end_time,
    'venue_id', v_champ.venue_id, 'format_config', v_champ.format_config,
    'registration_closes_at', v_champ.registration_closes_at, 'published_at', v_champ.published_at,
    'privacy', v_champ.privacy, 'results_public', v_champ.results_public,
    'owner_user_id', v_champ.owner_user_id,
    'has_registration_key', (nullif(btrim(coalesce(v_champ.registration_key, '')), '') is not null)
  );
end;
$$;
revoke all on function public.get_championship_public(uuid) from public;
grant execute on function public.get_championship_public(uuid) to anon, authenticated;
