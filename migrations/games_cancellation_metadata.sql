-- ============================================================================
-- games — metadatos de cancelación administrativa (Bloque 0 de cancel_match)
-- ============================================================================
-- Migración ADITIVA: añade a public.games las 4 columnas que escribe el Bloque 9
-- de cancel_match(). Todas nullable (se pueblan solo al cancelar). Sin índices,
-- sin constraints adicionales, sin lógica.
-- ============================================================================

alter table public.games
  add column if not exists cancel_reason        text,
  add column if not exists cancel_reason_detail text,
  add column if not exists cancelled_by_user_id uuid references public.users(id),
  add column if not exists cancelled_at         timestamptz;
