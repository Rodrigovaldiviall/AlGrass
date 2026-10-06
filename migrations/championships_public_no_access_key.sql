-- ============================================================================
-- Campeonatos PÚBLICOS · Publicar SIN clave de acceso
-- ============================================================================
-- `publish_championship` exige hoy una registration_key no vacía para pasar de
-- pending_publish → registration_open (NO_REGISTRATION_KEY). Correcto para PRIVADOS,
-- pero un campeonato PÚBLICO de AlGrass no tiene clave (puede/ debe quedar NULL) y el
-- organizador no puede publicarlo.
--
-- Esta migración reemite publish_championship IDÉNTICA a la vigente
-- (championships_phase5_owner_publish.sql) salvo un único matiz: el corte
-- NO_REGISTRATION_KEY aplica SOLO a privados. Público de AlGrass = criterio estructural
-- vigente (order_id IS NULL AND public_individual_price IS NOT NULL) → se publica con
-- registration_key NULL. PRIVADOS: comportamiento EXACTAMENTE igual.
--
-- No crea tabla ni columna. SÍ limpia championships.registration_key → NULL en los PÚBLICOS de AlGrass
-- (regla: público = sin clave), tanto al publicar desde pending_publish como de forma idempotente si ya
-- estaba registration_open arrastrando una clave vieja. En PRIVADOS no toca la clave. No toca
-- verify_championship_access (los privados la siguen usando), ni pagos/equipos/fixture/Admin. Idempotente.
-- ============================================================================

create or replace function public.publish_championship(p_championship_id uuid)
returns public.championships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.owner_user_id is distinct from v_actor then raise exception 'NOT_OWNER'; end if;

  -- Idempotencia: ya publicado → no-op, SALVO que sea un público de AlGrass que aún arrastre una clave vieja
  -- → se limpia a NULL (regla: público = sin clave). Privado ya publicado: intacto (conserva su clave).
  if v_champ.status = 'registration_open' then
    if v_champ.order_id is null and v_champ.public_individual_price is not null
       and v_champ.registration_key is not null then
      update public.championships
         set registration_key = null, updated_at = now()
       where id = p_championship_id
      returning * into v_champ;
    end if;
    return v_champ;
  end if;
  if v_champ.status <> 'pending_publish' then raise exception 'INVALID_STATE'; end if;

  -- Clave OBLIGATORIA SOLO en PRIVADOS. Público de AlGrass (order_id NULL + precio individual) publica
  -- con registration_key NULL (no tiene clave de acceso). Privados: idéntico a antes.
  if not (v_champ.order_id is null and v_champ.public_individual_price is not null)
     and nullif(btrim(coalesce(v_champ.registration_key, '')), '') is null then
    raise exception 'NO_REGISTRATION_KEY';
  end if;

  -- Público de AlGrass → la clave se limpia a NULL en el MISMO update (regla: público = sin clave, aunque
  -- arrastrara una registration_key previa). Privado → se conserva EXACTAMENTE su clave.
  update public.championships
     set status           = 'registration_open',
         registration_key = case when (v_champ.order_id is null and v_champ.public_individual_price is not null)
                                 then null else v_champ.registration_key end,
         published_at     = now(),
         updated_at       = now()
   where id = p_championship_id
  returning * into v_champ;

  return v_champ;
end;
$$;
revoke all on function public.publish_championship(uuid) from public, anon;
grant execute on function public.publish_championship(uuid) to authenticated;

do $verify$
declare v_def text;
begin
  select pg_get_functiondef(to_regprocedure('public.publish_championship(uuid)')) into v_def;
  if v_def is null then raise exception 'VERIFY: no existe publish_championship.'; end if;
  -- El corte de clave sigue existiendo (privados).
  if v_def !~ 'NO_REGISTRATION_KEY' then
    raise exception 'VERIFY: se perdio la exigencia de clave en privados.';
  end if;
  -- El criterio de público usa AMBAS condiciones: order_id IS NULL AND public_individual_price IS NOT NULL.
  if v_def !~ 'order_id is null and v_champ\.public_individual_price is not null' then
    raise exception 'VERIFY: el criterio de publico no usa ambas condiciones (order_id null + precio individual).';
  end if;
  -- La rama de PUBLICACIÓN (pending_publish → open) limpia la clave a NULL en públicos dentro del propio update.
  if v_def !~ 'registration_key\s*=\s*case when \(v_champ\.order_id is null and v_champ\.public_individual_price is not null\)\s*then null' then
    raise exception 'VERIFY: la rama publica no limpia registration_key a NULL en el update de publicacion.';
  end if;
  -- La rama IDEMPOTENTE (ya registration_open) también limpia la clave vieja en públicos.
  if v_def !~ 'set\s*\n?\s*registration_key = null, updated_at = now\(\)' then
    raise exception 'VERIFY: la rama idempotente (registration_open) no limpia registration_key a NULL en publicos.';
  end if;
  raise notice 'OK: publish_championship exige clave solo en privados (que la conservan); publico de AlGrass queda SIEMPRE con registration_key NULL (al publicar y de forma idempotente si ya estaba open).';
end $verify$;
