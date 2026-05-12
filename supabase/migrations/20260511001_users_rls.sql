-- Enable RLS on public.users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read any profile (needed for AddPlayers search)
CREATE POLICY "users_select_public"
  ON users FOR SELECT
  USING (true);

-- Users can only update their own row
CREATE POLICY "users_update_own"
  ON users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
