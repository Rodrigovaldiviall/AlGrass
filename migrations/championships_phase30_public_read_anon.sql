-- ============================================================================
-- Campeonatos · Fase 30 — Lectura PÚBLICA (anónima) de roster y competición en estados publicados
-- ============================================================================
-- get_championship_public YA está concedida a anon (Fase 22). Pero get_championship_registration_state (Fase 13)
-- y get_championship_competition (Fase 16) estaban concedidas SOLO a authenticated, así que un visitante sin
-- login no podía ver equipos/jugadores ni Calendario/Resultados en NINGUNA fase.
--
-- Sus READ-GATES internos YA permiten leer en los 4 estados publicados (registration_open, registration_closed,
-- in_progress, completed) a cualquiera; el único bloqueo era el GRANT. Esta migración concede EXECUTE a anon.
-- No se modifican los cuerpos ni los gates: pending_publish/payment_validation/canceled siguen exigiendo
-- owner/AlGrass (auth.uid()), y como anónimo esos actores nunca coinciden → sigue devolviendo NOT_FOUND.
--
-- NO cambia reglas de clave (privacy/registration_key nunca fueron gate de estas lecturas: era una cortina de
-- FRONTEND), NO cambia results_public (no es gate aquí), NO cambia permisos de edición/roster/results/lifecycle.
-- Solo amplía QUIÉN puede EJECUTAR la lectura pública ya existente.
-- ============================================================================

-- Roster público (equipos + jugadores + organizadores) en estados publicados.
grant execute on function public.get_championship_registration_state(uuid) to anon;

-- Competición pública (matches + standings + scorers) en in_progress/completed (y open/closed si hay fixture).
grant execute on function public.get_championship_competition(uuid) to anon;
