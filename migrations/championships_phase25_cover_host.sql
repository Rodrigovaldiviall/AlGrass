-- ============================================================================
-- Campeonatos · Fase 25 — Editar PORTADA: autorizar también a Host y AlGrass (no solo owner)
-- ============================================================================
-- update_championship_cover (Fase 8) exigía owner EXCLUSIVO (NOT_OWNER). Se amplía la autorización a:
--   owner  (championships.owner_user_id)
--   host   (championships.host_user_id)  ← NUEVO
--   AlGrass staff/admin (_is_algrass_staff)
-- El jugador normal sigue SIN poder. Todo lo demás IDÉNTICO (INVALID_STATE en canceled/completed, validación
-- del path {actor}/{championship}/, campos actualizados). Cuerpo reescrito solo en el gate de autorización.
-- host_user_id sigue siendo la ÚNICA fuente del Host. No toca lifecycle/roster/resultados.
-- ============================================================================

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
  -- Autorización AMPLIADA: owner, host o AlGrass. (Antes: owner exclusivo.)
  if not (v_champ.owner_user_id = v_actor
          or (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor)
          or public._is_algrass_staff(v_actor)) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if v_champ.status in ('canceled', 'completed') then raise exception 'INVALID_STATE'; end if;

  -- Path de la foto (si se fija y no es NULL): debe estar bajo {actor}/{championship}/ (el uploader es el actor).
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
