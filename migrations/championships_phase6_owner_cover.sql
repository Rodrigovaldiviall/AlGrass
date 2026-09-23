-- ============================================================================
-- Campeonatos · Fase 6 — Portada del OWNER: guardar nombre + cover_theme en DB
-- ============================================================================
-- Cierra el último punto que quedaba local/CV en ChampionshipView: editar la PORTADA (nombre + color)
-- de un campeonato REAL persiste ahora en championships.name / championships.cover_theme.
--
-- Mismo patrón que Fase 5 (privacidad/publish): SECURITY DEFINER, auth.uid(), lock FOR UPDATE,
-- ownership por owner_user_id (NO admin), guarda de status, grants a authenticated.
--
-- cover_theme se guarda como HEX CRUDO seleccionado (el remap visual coverColor() vive en frontend).
-- ADITIVA. NO toca update_championship_privacy, publish_championship, payment/order, checkout, Admin.
-- NO crea status nuevo. NO usa service_role.
-- ============================================================================

create or replace function public.update_championship_cover(
  p_championship_id uuid,
  p_name            text,
  p_cover_theme     text
)
returns public.championships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
  v_cover text := nullif(btrim(coalesce(p_cover_theme, '')), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_name is null then raise exception 'INVALID_INPUT'; end if;                 -- nombre obligatorio
  if v_cover is not null and v_cover !~ '^#[0-9A-Fa-f]{6}$' then                  -- hex válido si viene
    raise exception 'INVALID_INPUT';
  end if;

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.owner_user_id is distinct from v_actor then raise exception 'NOT_OWNER'; end if;
  -- Editable mientras el campeonato lo gestiona el owner; NO en terminales.
  if v_champ.status in ('canceled', 'completed') then raise exception 'INVALID_STATE'; end if;

  update public.championships
     set name        = v_name,
         cover_theme = coalesce(v_cover, cover_theme),   -- si no viene color, conserva el actual
         updated_at  = now()
   where id = p_championship_id
  returning * into v_champ;

  return v_champ;
end;
$$;
revoke all on function public.update_championship_cover(uuid, text, text) from public, anon;
grant execute on function public.update_championship_cover(uuid, text, text) to authenticated;
