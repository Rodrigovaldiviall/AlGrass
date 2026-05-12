-- Fix: prevent duplicate refunds when titular does a full-reservation cancel.
--
-- Problem: when the titular cancels their entire reservation, the frontend
-- cancels all guest rows after the titular row is canceled. The trigger fired
-- for each guest row and generated per-guest refunds ON TOP of the full refund
-- already recorded by the frontend — triple-counting.
--
-- Fix: check if the titular's game_players row is already 'canceled' before
-- generating a per-guest refund. The frontend now cancels the titular's own
-- game_players row FIRST (awaited), then cancels guest rows, so by the time
-- this trigger fires the titular's game_players.status is already 'canceled'
-- and we skip the per-guest refund.
--
-- This keeps financial state (reservations) and social/roster state (game_players)
-- cleanly separated: cascade detection uses game_players, not reservations.
--
-- Unaffected cases:
--   - Guest self-cancel: titular's game_players row is still 'confirmed' → refund generated ✅
--   - Titular cancels individual guest: titular still 'confirmed' → refund generated ✅
--   - Titular full cancel: titular's game_players row is 'canceled' first → refund skipped ✅

CREATE OR REPLACE FUNCTION handle_guest_cancellation()
RETURNS TRIGGER AS $$
DECLARE
  v_unit_price            numeric;
  v_titular_id            uuid;
  v_titular_player_status text;
BEGIN
  IF NEW.status = 'canceled'
     AND OLD.status = 'confirmed'
     AND NEW.invited_by IS NOT NULL
  THEN
    v_titular_id := NEW.invited_by;

    -- Check if the titular's own game_players row is still active.
    -- If 'canceled': full-cancel cascade in progress; the frontend will create
    -- a single full-amount wallet_transaction — skip per-guest refund here.
    SELECT status INTO v_titular_player_status
    FROM game_players
    WHERE user_id = v_titular_id
      AND game_id = NEW.game_id;

    IF v_titular_player_status = 'canceled' THEN
      RETURN NEW;
    END IF;

    -- Individual guest cancel: titular still on roster → generate refund for titular.
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
