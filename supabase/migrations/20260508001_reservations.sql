CREATE TABLE IF NOT EXISTS reservations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id),

  unit_price      numeric(10,2) NOT NULL,
  players_count   int           NOT NULL DEFAULT 1,
  promo_code      text,
  promo_discount  numeric(10,2) NOT NULL DEFAULT 0,
  credit_applied  numeric(10,2) NOT NULL DEFAULT 0,
  total_amount    numeric(10,2) NOT NULL,
  payment_method  text CHECK (payment_method IN ('cash', 'credits', 'mixed')),

  reserved_at     timestamptz NOT NULL DEFAULT now()
);
