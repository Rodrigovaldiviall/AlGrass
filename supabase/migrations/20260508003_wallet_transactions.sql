CREATE TABLE IF NOT EXISTS wallet_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),

  -- refund:     positivo (créditos emitidos por cancelación)
  -- spend:      negativo (créditos consumidos al pagar)
  -- adjustment: ±X (ajuste admin futuro)
  type            text NOT NULL
                  CHECK (type IN ('refund', 'spend', 'adjustment')),
  amount          numeric(10,2) NOT NULL,

  game_id         uuid REFERENCES games(id)        ON DELETE SET NULL,
  reservation_id  uuid REFERENCES reservations(id) ON DELETE SET NULL,
  description     text,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON wallet_transactions(user_id, created_at DESC);

CREATE VIEW wallet_summary AS
SELECT
  user_id,
  SUM(amount)                             AS credit_balance,
  COUNT(*) FILTER (WHERE type = 'refund') AS total_refunds,
  COUNT(*) FILTER (WHERE type = 'spend')  AS total_spends
FROM wallet_transactions
GROUP BY user_id;
