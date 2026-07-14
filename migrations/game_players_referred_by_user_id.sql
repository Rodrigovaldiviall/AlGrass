-- ============================================================================
-- V6 — game_players.referred_by_user_id (columna diferida, ahora incremental)
-- ============================================================================
-- Registra quién refirió/inscribió al jugador (invitación o link). Nullable:
-- checkout público = NULL. No modifica datos existentes, sin backfill, sin
-- triggers, sin RPC, sin tocar ninguna otra columna.
-- ============================================================================

alter table public.game_players
  add column if not exists referred_by_user_id uuid;

alter table public.game_players
  add constraint game_players_referred_by_user_id_fkey
  foreign key (referred_by_user_id)
  references public.users (id)
  on delete set null;

create index if not exists game_players_referred_by_user_id_idx
  on public.game_players (referred_by_user_id);
