ALTER TABLE reservations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_players         ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions  ENABLE ROW LEVEL SECURITY;

-- ── reservations ─────────────────────────────────────────────────────────────
CREATE POLICY "reservations_select_own"
  ON reservations FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "reservations_insert_own"
  ON reservations FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- UPDATE / DELETE: nadie (append-only)

-- ── game_players ──────────────────────────────────────────────────────────────
CREATE POLICY "game_players_select_if_in_game"
  ON game_players FOR SELECT
  USING (
    game_id IN (
      SELECT game_id FROM game_players WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "game_players_insert_own_or_invited"
  ON game_players FOR INSERT
  WITH CHECK (
    -- Inscripción propia
    (user_id = auth.uid() AND invited_by IS NULL)
    OR
    -- Agregar invitado: tú eres el invitador y la reservation que cubre el slot es tuya
    (invited_by = auth.uid()
     AND reservation_id IN (
       SELECT id FROM reservations WHERE user_id = auth.uid()
     ))
  );

CREATE POLICY "game_players_update_own_or_invited"
  ON game_players FOR UPDATE
  USING (
    user_id    = auth.uid()
    OR
    invited_by = auth.uid()
  );

-- UPDATE / DELETE para admin: usar service_role (bypassa RLS)

-- ── wallet_transactions ───────────────────────────────────────────────────────
CREATE POLICY "wallet_select_own"
  ON wallet_transactions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "wallet_insert_own"
  ON wallet_transactions FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- UPDATE / DELETE: nadie (inmutable)
