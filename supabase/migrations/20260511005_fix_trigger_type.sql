-- Fix: wallet_transactions.type 'credit' → 'refund' (alineado con CHECK constraint)
CREATE OR REPLACE FUNCTION handle_guest_cancellation()
RETURNS TRIGGER AS $$
DECLARE
  v_unit_price numeric;
  v_titular_id uuid;
BEGIN
  IF NEW.status = 'canceled'
     AND OLD.status = 'confirmed'
     AND NEW.invited_by IS NOT NULL
  THEN
    v_titular_id := NEW.invited_by;

    SELECT unit_price INTO v_unit_price
    FROM reservations
    WHERE id = NEW.reservation_id AND user_id = v_titular_id;

    IF v_unit_price IS NOT NULL THEN
      INSERT INTO wallet_transactions (user_id, type, amount, game_id, reservation_id, description)
      VALUES (v_titular_id, 'refund', v_unit_price, NEW.game_id, NEW.reservation_id,
              'Reembolso por cancelación de invitado');

      UPDATE users
      SET credit_balance = COALESCE(credit_balance, 0) + v_unit_price
      WHERE id = v_titular_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
