CREATE TABLE IF NOT EXISTS game_players (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id),
  reservation_id  uuid NOT NULL REFERENCES reservations(id),
  invited_by      uuid          REFERENCES users(id),

  status          text NOT NULL DEFAULT 'confirmed'
                  CHECK (status IN ('confirmed', 'canceled')),
  joined_at       timestamptz NOT NULL DEFAULT now(),
  canceled_at     timestamptz,

  UNIQUE(game_id, user_id)
);

CREATE INDEX ON game_players(game_id, status);
CREATE INDEX ON game_players(game_id, invited_by);
CREATE INDEX ON game_players(user_id);
