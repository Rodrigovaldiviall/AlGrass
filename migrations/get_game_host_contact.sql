-- ============================================================================
-- get_game_host_contact(p_game_id) — teléfono del HOST de un game (mínimo y seguro)
-- ============================================================================
-- Para el CTA "Comunícate con el organizador" cuando app_settings.organizer_contact_mode
-- = 'host'. Devuelve ÚNICAMENTE el teléfono del host asignado a ESE game; ningún otro
-- dato del host. NO expone users.phone de forma general ni añade phone a users_public.
--
-- AUTORIZACIÓN (restricción mínima razonable, espeja el gating del CTA en la App):
--   se entrega el teléfono SOLO si el que llama tiene legitimidad para contactar al
--   organizador de ESE game, es decir es una de:
--     · el host del game (games.host_user_id);
--     · el que reservó un Rental (games.booked_by_user_id);
--     · un participante CONFIRMADO del game (game_players.status='confirmed' con
--       user_id o payer_id = el que llama).
--   Se omite invited_by_user_id a propósito: en todos los flujos donde se setea es
--   siempre igual a payer_id (invitación gratis host/algrass), así que es redundante
--   y solo añadiría over-grant; payer_id ya cubre a quien invitó/pagó guests.
--   Esto cubre exactamente a quien ve el CTA hoy (isHost/isBooked/isGuest/guestsInRoster
--   en GameDetail; isHost/userBooked en RentalDetail). Un autenticado SIN relación con
--   el game recibe NULL (no se revela nada; la App deshabilita el CTA). Sin esta guarda,
--   cualquier autenticado podría pedir el teléfono de cualquier host por game_id.
--
-- SECURITY DEFINER + search_path fijo. Revocado a public/anon; ejecutable por authenticated.
-- NOTA: users.phone guarda el número LOCAL (sin código de país); la normalización a
-- número WhatsApp-válido se hace en la App (ver src/services/organizerContact.js).
-- ============================================================================

create or replace function public.get_game_host_contact(p_game_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor     uuid := auth.uid();
  v_host      uuid;
  v_booked_by uuid;
  v_phone     text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_game_id is null then raise exception 'INVALID_GAME_ID'; end if;

  select g.host_user_id, g.booked_by_user_id
    into v_host, v_booked_by
    from public.games g
   where g.id = p_game_id;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;

  -- Legitimidad para contactar (mismo criterio que el CTA). Si no la tiene → NULL.
  if not (
       v_host = v_actor
    or v_booked_by = v_actor
    or exists (
         select 1 from public.game_players gp
          where gp.game_id = p_game_id
            and gp.status = 'confirmed'
            and (gp.user_id = v_actor or gp.payer_id = v_actor)
       )
  ) then
    return null;
  end if;

  -- Solo el teléfono del host de ESE game. Nada más se devuelve.
  select u.phone into v_phone from public.users u where u.id = v_host;
  return nullif(btrim(coalesce(v_phone, '')), '');   -- NULL si el host no tiene teléfono
end;
$$;

revoke all on function public.get_game_host_contact(uuid) from public, anon;
grant execute on function public.get_game_host_contact(uuid) to authenticated;
