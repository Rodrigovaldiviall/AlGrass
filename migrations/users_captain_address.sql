-- Domicilio del usuario para la solicitud de Capitán (Fase 1).
-- Aditiva y NO destructiva: solo agrega dos columnas nullable a public.users.
-- No modifica filas existentes (quedan en NULL), no borra ni cambia datos.
-- El domicilio del Capitán es INDEPENDIENTE de users.city (ciudad operativa del
-- jugador, que se usa para filtros/búsqueda y puede cambiar sin mudarse). Por eso
-- el domicilio usa su propia columna address_city, NO reutiliza users.city.
-- Domicilio = address_city + address_line + district.
--
-- RLS: no requiere policies nuevas. Las policies de public.users son a nivel de
-- FILA (id = auth.uid()); las columnas nuevas quedan cubiertas por la policy de
-- UPDATE self existente (la misma que usa el guardado de perfil). El rol
-- 'authenticated' ya tiene los grants de tabla; las columnas nuevas los heredan.
-- No se añaden a la vista public.users_public (permanecen privadas).

alter table public.users
  add column if not exists address_city text;

alter table public.users
  add column if not exists address_line text;

alter table public.users
  add column if not exists district text;
