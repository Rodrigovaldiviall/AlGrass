-- ============================================================================
-- Doble salida · limpieza del superviviente al eliminar un gemelo
-- ============================================================================
-- Posterior a double_out_phase1.sql. Al borrar (DELETE físico) uno de los dos
-- games de una Doble salida, el superviviente debe volver a ser un game singleton
-- normal. La FK games.alternative_game_id (ON DELETE SET NULL) YA limpia
-- alternative_game_id; este trigger limpia ADEMÁS overlap_group y
-- blocked_from_status, EN LA MISMA TRANSACCIÓN del DELETE.
--
-- No existe ningún trigger DELETE previo sobre public.games (los actuales son
-- BEFORE INSERT/UPDATE), así que no hay conflicto ni duplicidad.
--
-- Alcance estricto: NO toca no_field_time_overlap, reservas, game_players, R1,
-- Orders ni Fase 2; no cambia las reglas de DELETE (si una FK/dependencia lo
-- rechaza, la transacción entera revierte y no queda ninguna limpieza); no
-- implementa blocked/reapertura automática.
-- ============================================================================

create or replace function public.clear_double_out_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Solo si el game borrado pertenecía a una pareja. Actualiza EXCLUSIVAMENTE al
  -- gemelo superviviente (OLD.alternative_game_id); no toca type/status/precios/
  -- slot ni ningún otro dato. Idempotente: si ya están en NULL, es un no-op.
  -- alternative_game_id se incluye por robustez (la FK ya lo deja en NULL; aquí
  -- es redundante e inofensivo). Un game normal sin pareja: no hace nada.
  if old.alternative_game_id is not null then
    update public.games
       set alternative_game_id = null,
           overlap_group       = null,
           blocked_from_status = null
     where id = old.alternative_game_id;
  end if;
  return old;  -- AFTER DELETE: el valor de retorno se ignora.
end;
$$;

create or replace trigger trg_clear_double_out_on_delete
  after delete on public.games
  for each row
  execute function public.clear_double_out_on_delete();
