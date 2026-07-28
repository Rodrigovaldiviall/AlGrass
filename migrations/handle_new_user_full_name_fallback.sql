-- ============================================================================
-- handle_new_user — fallback de full_name para que TODOS los proveedores dejen
-- public.users.full_name NO vacío.
-- ============================================================================
-- Único cambio respecto del original: la expresión de `full_name`. Antes:
--   coalesce(new.raw_user_meta_data->>'full_name', '')
--
-- Con proveedores OAuth (Google, Facebook, Apple y futuros) el nombre puede
-- venir bajo claves distintas de `full_name`, dejando full_name = '' → el
-- algoritmo cliente de user_code (ensureUserCode, gateado por full_name) no se
-- ejecuta. Ahora se resuelve el nombre desde la MISMA metadata que ya recibimos,
-- probando las claves habituales de los proveedores OAuth, con prioridad:
--
--   1) full_name              (email/password y la mayoría de OAuth)
--   2) name                   (Google, Facebook)
--   3) given_name + family_name  (cuando el proveedor no envía full_name/name)
--   4) prefijo del email      (último recurso; p. ej. Apple que a veces no manda nombre)
--
-- Todo con trim()+nullif() para descartar valores compuestos solo por espacios.
-- No cambia columnas, permisos ni ninguna otra lógica. El flujo email/password
-- queda idéntico (si viene `full_name`, se usa tal cual). Único algoritmo de
-- user_code para todos los proveedores.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (
    id,
    full_name,
    email,
    role,
    organizer_status,
    credit_balance
  )
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(new.raw_user_meta_data->>'name'), ''),
      nullif(trim(concat_ws(' ',
        nullif(trim(new.raw_user_meta_data->>'given_name'), ''),
        nullif(trim(new.raw_user_meta_data->>'family_name'), ''))), ''),
      nullif(trim(split_part(new.email, '@', 1)), ''),
      ''
    ),
    new.email,
    'player',
    'none',
    0
  );

  return new;
end;
$$;

-- Backfill OPCIONAL para usuarios OAuth ya creados con full_name vacío
-- (el trigger solo aplica a inserts nuevos). Tras esto, su user_code se genera
-- en el siguiente login por el mismo ensureUserCode existente:
--
-- update public.users u
--    set full_name = coalesce(
--          nullif(trim(a.raw_user_meta_data->>'full_name'), ''),
--          nullif(trim(a.raw_user_meta_data->>'name'), ''),
--          nullif(trim(concat_ws(' ',
--            nullif(trim(a.raw_user_meta_data->>'given_name'), ''),
--            nullif(trim(a.raw_user_meta_data->>'family_name'), ''))), ''),
--          nullif(trim(split_part(u.email, '@', 1)), ''),
--          '')
--   from auth.users a
--  where a.id = u.id
--    and coalesce(trim(u.full_name), '') = '';
