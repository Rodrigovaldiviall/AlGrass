-- ============================================================================
-- Campeonatos · Fase 5 — Operaciones del OWNER: guardar privacidad + publicar
-- ============================================================================
-- Cierra los dos puntos que quedaban frontend/mock en ChampionshipView:
--   · update_championship_privacy → persiste registration_key + results_public (owner, DB).
--   · publish_championship        → pending_publish → registration_open + published_at (owner, DB).
--
-- Mismo patrón que Fase 4 (approve/reject): SECURITY DEFINER, auth.uid(), lock FOR UPDATE,
-- ownership por owner_user_id (NO admin), guardas de status, idempotencia, grants a authenticated.
--
-- ADITIVA. NO toca payment/order, create/confirm/approve/reject, pricing, quote, availability,
-- ni el flujo Match/Rental / double-out. NO crea status nuevo. NO usa service_role.
-- ============================================================================


-- ── 1) update_championship_privacy — el owner configura clave + visibilidad de resultados ────────
-- Editable mientras el campeonato lo gestiona el owner (pending_publish y ya publicado). NUNCA en
-- payment_validation (aún validando el pago) ni estados terminales. registration_key se normaliza:
-- vacío/espacios → NULL (jamás una clave de ejemplo). No auto-genera nada.
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
  if v_champ.status not in ('pending_publish', 'registration_open', 'registration_closed') then
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


-- ── 2) publish_championship — el owner publica (abre inscripciones) ───────────────────────────────
-- Precondición: status pending_publish + registration_key real (no vacío). Acción: registration_open
-- + published_at = now(). NO toca payment/order. Idempotente: 2º clic (ya registration_open) → no-op.
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

  -- Idempotencia: ya publicado → no-op (mismo campeonato de vuelta). Sin clave real → error explícito.
  if v_champ.status = 'registration_open' then return v_champ; end if;
  if v_champ.status <> 'pending_publish' then raise exception 'INVALID_STATE'; end if;
  if nullif(btrim(coalesce(v_champ.registration_key, '')), '') is null then
    raise exception 'NO_REGISTRATION_KEY';
  end if;

  update public.championships
     set status       = 'registration_open',
         published_at  = now(),
         updated_at    = now()
   where id = p_championship_id
  returning * into v_champ;

  return v_champ;
end;
$$;
revoke all on function public.publish_championship(uuid) from public, anon;
grant execute on function public.publish_championship(uuid) to authenticated;
