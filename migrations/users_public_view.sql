-- users_public: proyección segura de public.users para lectura de TERCEROS.
-- Vista DEFINER (NO usar security_invoker) para saltar la RLS de users.
-- profile_private solo protege edad/sexo en el frontend; posición siempre pública.
-- NO toca la policy users_select_public (se cierra en una migración posterior).

CREATE OR REPLACE VIEW public.users_public AS
SELECT
  id,
  full_name,
  full_name_search,
  user_code,
  avatar_hue,
  avatar_path,
  avatar_updated_at,
  city,
  preferred_position,
  sex,
  EXTRACT(YEAR FROM age(birth_date))::int AS age,
  profile_private,
  (
    coalesce(array_length(preferred_position, 1), 0) > 0
    AND birth_date IS NOT NULL
    AND coalesce(phone, '')       <> ''
    AND coalesce(nationality, '') <> ''
    AND coalesce(occupation, '')  <> ''
  ) AS profile_complete
FROM public.users
WHERE deleted_at IS NULL;

GRANT SELECT ON public.users_public TO authenticated;
-- GRANT SELECT ON public.users_public TO anon;  -- habilitar solo si hay navegación sin login
