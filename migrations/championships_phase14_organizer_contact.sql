-- ============================================================================
-- Campeonatos · Fase 14 — Contacto seguro del organizador (owner-gated)
-- ============================================================================
-- CTA "Comunícate con el organizador" en ChampionshipView, con la MISMA política global que match/rental
-- (app_settings.organizer_contact_mode + algrass_operational_phone), pero:
--   · SOLO el pagador/owner del campeonato obtiene el teléfono (gating REAL en la RPC, no solo en la UI);
--   · en modo 'host' usa championships.host_user_id (Fase 13) y lee su teléfono EXACTAMENTE como
--     get_game_host_contact (users.phone crudo; la normalización WhatsApp vive en la App).
--
-- Política de resolución (tras el owner-gating):
--   'algrass'                          → algrass_operational_phone.
--   'host' con host y teléfono válido  → teléfono del host.
--   'host' sin host / sin teléfono     → FALLBACK a algrass_operational_phone (el CTA no queda inutilizado).
--   NULL / modo inesperado             → NULL (SIN fallback).
-- Devuelve NULL solo cuando el actor no es owner, o el modo no es válido, o (modo host) tampoco hay teléfono
-- AlGrass configurado. NO crea columnas (host_user_id ya existe, Fase 13). NO toca get_game_host_contact, ni
-- RLS, ni el flujo de inscripción. Una sola RPC nueva.
-- ============================================================================

create or replace function public.get_championship_organizer_contact(p_championship_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_champ   public.championships%rowtype;
  v_mode    text;
  v_algrass text;
  v_phone   text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_championship_id is null then raise exception 'INVALID_INPUT'; end if;

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- OWNER-GATING estricto: el ÚNICO interlocutor es el pagador/owner. Cualquier otro actor (jugador
  -- inscrito, capitán, miembro de equipo, incluso AlGrass no-owner) → NULL: no se revela ningún teléfono.
  -- Espeja el `return null` de get_game_host_contact para "sin legitimidad" (no lanza excepción por rol).
  if v_champ.owner_user_id is distinct from v_actor then
    return null;
  end if;

  -- Config GLOBAL (misma fuente/fila que match/rental). Sin fila legible → NULL (CTA deshabilitado).
  select organizer_contact_mode, algrass_operational_phone
    into v_mode, v_algrass
    from public.app_settings where id = 1;

  -- Resolución EXPLÍCITA: solo 'algrass' y 'host' son válidos. NULL, sin fila app_settings, o cualquier
  -- valor inesperado → NULL (nunca cae por defecto a la rama host).
  if v_mode = 'algrass' then
    -- Teléfono operativo de AlGrass (Admin lo guarda ya con código de país).
    return nullif(btrim(coalesce(v_algrass, '')), '');
  elsif v_mode = 'host' then
    -- Teléfono del HOST operativo del campeonato (users.phone crudo; la App normaliza a WhatsApp-válido).
    -- FALLBACK a AlGrass cuando no hay host asignado, el host no existe o no tiene teléfono → el CTA nunca
    -- queda inutilizado si AlGrass sí tiene número. El fallback SOLO ocurre en modo 'host'.
    if v_champ.host_user_id is not null then
      select u.phone into v_phone from public.users u where u.id = v_champ.host_user_id;
      v_phone := nullif(btrim(coalesce(v_phone, '')), '');
      if v_phone is not null then return v_phone; end if;
    end if;
    return nullif(btrim(coalesce(v_algrass, '')), '');   -- fallback AlGrass (host ausente/sin teléfono)
  else
    return null;   -- NULL o modo no reconocido → no se entrega teléfono (SIN fallback)
  end if;
end;
$$;

revoke all on function public.get_championship_organizer_contact(uuid) from public, anon;
grant execute on function public.get_championship_organizer_contact(uuid) to authenticated;
