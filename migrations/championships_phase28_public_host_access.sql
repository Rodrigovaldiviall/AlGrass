-- ============================================================================
-- Campeonatos · Fase 28 — Acceso del HOST asignado a get_championship_public (sin clave)
-- ============================================================================
-- El Host operativo (championships.host_user_id) debe poder ABRIR el campeonato como el owner: sin clave y
-- también en estados pre-publicados. Base: Fase 22. Dos cambios MÍNIMOS en la MISMA RPC, misma fuente de verdad:
--   (1) Read-gate: el host pasa igual que el owner (antes: solo owner en estados no públicos → el host recibía
--       CHAMPIONSHIP_NOT_FOUND en pending_publish/payment_validation).
--   (2) Payload: nuevo `is_host` (espejo de `is_member`) → el frontend saltea el gate de clave con dato
--       autoritativo del backend (no un bypass solo visual).
-- NO cambia claves para usuarios normales, owner, participantes, lifecycle, permisos de edición, roster ni
-- resultados. host_user_id sigue siendo la ÚNICA fuente del Host. No crea tabla ni rol.
-- ============================================================================

create or replace function public.get_championship_public(p_championship_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_champ public.championships%rowtype;
begin
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  -- Legible en estados públicos, o si el actor es el owner, o el HOST asignado (Fase 28). Estados pre-publicados
  -- (payment_validation/pending_publish/canceled) solo owner/host; el resto, cualquiera.
  if not (v_champ.status in ('registration_open','registration_closed','in_progress','completed')
          or v_champ.owner_user_id = auth.uid()
          or (v_champ.host_user_id is not null and v_champ.host_user_id = auth.uid())) then
    raise exception 'CHAMPIONSHIP_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'id', v_champ.id, 'status', v_champ.status, 'name', v_champ.name,
    'cover_theme', v_champ.cover_theme, 'cover_image_path', v_champ.cover_image_path,
    'event_date', v_champ.event_date, 'start_time', v_champ.start_time, 'end_time', v_champ.end_time,
    'venue_id', v_champ.venue_id, 'format_config', v_champ.format_config,
    'registration_closes_at', v_champ.registration_closes_at, 'published_at', v_champ.published_at,
    'fixture_published_at', v_champ.fixture_published_at,
    'live_started_at', v_champ.live_started_at,   -- Fase 21: NULL=pre-live · NOT NULL=en vivo
    'privacy', v_champ.privacy, 'results_public', v_champ.results_public,
    'owner_user_id', v_champ.owner_user_id,
    -- Fase 28: el Host asignado saltea el gate de clave, igual que is_member. Fuente: championships.host_user_id.
    'is_host', (auth.uid() is not null and v_champ.host_user_id is not null and v_champ.host_user_id = auth.uid()),
    'has_registration_key', (nullif(btrim(coalesce(v_champ.registration_key, '')), '') is not null),
    'is_member', (auth.uid() is not null and exists (
        select 1 from public.championship_players where championship_id = p_championship_id and user_id = auth.uid()
      ))
  );
end; $$;
revoke all on function public.get_championship_public(uuid) from public;
grant execute on function public.get_championship_public(uuid) to anon, authenticated;
