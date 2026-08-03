-- Persistencia de la confirmación visual del correo, ligada a la CUENTA (no al dispositivo).
-- Reemplaza el antiguo flag en localStorage ('algr_email_reviewed').
--
-- Regla: la app considera el correo confirmado únicamente cuando
--        users.confirmed_email = users.email
-- Si el usuario cambia su correo en el futuro, confirmed_email deja de coincidir
-- y el aviso de revisión reaparece automáticamente, sin tocar ningún otro campo.
--
-- No requiere policies nuevas: la escritura reutiliza la RLS self existente
-- (UPDATE de la propia fila con id = auth.uid()), la misma que usa el guardado de perfil.
-- No se añade a la vista public.users_public (permanece privado, no visible por otros jugadores).

alter table public.users
  add column if not exists confirmed_email text;
