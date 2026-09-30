-- ============================================================================
-- Campeonatos · results_public editable también en in_progress / completed
-- ============================================================================
-- update_championship_privacy (Fase 5) solo permitía cambiar clave + results_public en
-- pending_publish/registration_open/registration_closed. Pero el caso NATURAL de "Resultados públicos" es la
-- fase COMPETITIVA (pre-live/live) y la histórica (completed): el owner quiere abrir/cerrar el acceso público
-- de lectura MIENTRAS el torneo ocurre o cuando ya terminó. Sin esto, el toggle daba INVALID_STATE en esas fases.
--
-- Cambio MÍNIMO: se AMPLÍA la whitelist de estados a in_progress y completed. Todo lo demás IDÉNTICO a Fase 5
-- (owner-only, normalización de clave, misma firma/grants). NO cambia el sistema de clave, ni inscripción, ni
-- lifecycle. En in_progress/completed las inscripciones ya están cerradas, así que la clave es indiferente ahí;
-- lo relevante que se togglea es results_public (autoridad del acceso público de LECTURA en fase competitiva).
-- NO permite payment_validation ni canceled.
-- ============================================================================

create or replace function public.update_championship_privacy(
  p_championship_id  uuid,
  p_registration_key text,
  p_results_public   boolean
)
returns public.championships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_key   text := nullif(btrim(coalesce(p_registration_key, '')), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_results_public is null then raise exception 'INVALID_INPUT'; end if;

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.owner_user_id is distinct from v_actor then raise exception 'NOT_OWNER'; end if;
  if v_champ.status not in ('pending_publish', 'registration_open', 'registration_closed',
                            'in_progress', 'completed') then                 -- + fase competitiva/histórica
    raise exception 'INVALID_STATE';
  end if;

  update public.championships
     set registration_key = v_key,
         results_public    = p_results_public,
         updated_at        = now()
   where id = p_championship_id
  returning * into v_champ;

  return v_champ;
end;
$$;
revoke all on function public.update_championship_privacy(uuid, text, boolean) from public, anon;
grant execute on function public.update_championship_privacy(uuid, text, boolean) to authenticated;

do $$
begin
  raise notice 'OK: update_championship_privacy admite in_progress/completed (toggle de results_public en fase competitiva).';
end $$;
