-- ============================================================================
-- Campeonatos PÚBLICOS · Equipo · cambiar la CLAVE (owner del equipo)
-- ============================================================================
-- La clave original NO es recuperable (solo existe join_secret_hash, bcrypt). Esta RPC
-- permite al OWNER/creator del equipo fijar una NUEVA clave: recibe texto plano, lo hashea
-- con _championship_hash_secret y reemplaza join_secret_hash. JAMÁS devuelve el hash.
--
-- Autoridad: SOLO championship_teams.created_by_user_id = auth.uid(). Campeonato PÚBLICO
-- (order_id NULL y algún precio público) y SOLO en registration_open. Mínimo 4 caracteres
-- (consistente con el frontend). Idempotente de facto (reescribe el hash).
-- NO toca Match/Rental, privados, pagos ni roster. Reutiliza el helper existente.
-- ============================================================================

begin;

do $pre$
begin
  if to_regprocedure('public._championship_hash_secret(text)') is null then
    raise exception 'Abortado: falta _championship_hash_secret (aplica antes championships_public_team_registration.sql).';
  end if;
end $pre$;

create or replace function public.update_championship_team_secret(
  p_team_id uuid,
  p_secret  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_team   public.championship_teams%rowtype;
  v_champ  public.championships%rowtype;
  v_secret text := nullif(btrim(coalesce(p_secret, '')), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_secret is null or length(v_secret) < 4 then raise exception 'TEAM_SECRET_REQUIRED'; end if;

  select * into v_team from public.championship_teams where id = p_team_id;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  if v_team.created_by_user_id is distinct from v_actor then raise exception 'NOT_AUTHORIZED'; end if;

  select * into v_champ from public.championships where id = v_team.championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if not (v_champ.order_id is null and (v_champ.public_individual_price is not null or v_champ.public_team_price is not null)) then
    raise exception 'NOT_PUBLIC';
  end if;
  if v_champ.status <> 'registration_open' then raise exception 'NOT_OPEN'; end if;

  update public.championship_teams
     set join_secret_hash = public._championship_hash_secret(v_secret), updated_at = now()
   where id = p_team_id;

  return jsonb_build_object('team_id', p_team_id, 'status', 'ok');   -- NUNCA devuelve el hash
end $$;
revoke all on function public.update_championship_team_secret(uuid, text) from public, anon;
grant execute on function public.update_championship_team_secret(uuid, text) to authenticated;

do $verify$
declare v_def text;
begin
  select pg_get_functiondef(to_regprocedure('public.update_championship_team_secret(uuid, text)')) into v_def;
  if v_def !~ 'created_by_user_id is distinct from v_actor' then raise exception 'VERIFY: no restringe al owner del equipo.'; end if;
  if v_def !~ '_championship_hash_secret' then raise exception 'VERIFY: no hashea la nueva clave.'; end if;
  -- El retorno NO expone el hash (solo team_id + status).
  if v_def !~ 'jsonb_build_object\(''team_id'', p_team_id, ''status'', ''ok''\)' then raise exception 'VERIFY: el retorno no es {team_id,status} (podria filtrar el hash).'; end if;
  if v_def !~ 'status <> ''registration_open''' then raise exception 'VERIFY: no limita a registration_open.'; end if;
  raise notice 'OK: update_championship_team_secret owner-only, publico, registration_open; guarda solo el hash.';
end $verify$;

commit;
