-- Gross subtotal before credits/discounts (unit_price * players_count)
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS subtotal_amount numeric(10,2);
