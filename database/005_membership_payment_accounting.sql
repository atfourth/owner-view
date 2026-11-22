
-- 005_membership_payment_accounting.sql
-- Preserve original membership prices and distinguish actual payments
-- from legacy outstanding-balance records.

ALTER TABLE member_subscriptions
ADD COLUMN IF NOT EXISTS total_amount NUMERIC(10,2);

-- Recover historical membership prices using existing payment records.
-- Fall back to the plan's current price where no payment records exist.
UPDATE member_subscriptions ms
SET total_amount = COALESCE(
    (
        SELECT SUM(p.total_amount)
        FROM payments p
        WHERE p.subscription_id = ms.id
    ),
    (
        SELECT mp.price
        FROM membership_plans mp
        WHERE mp.id = ms.plan_id
          AND mp.gym_id = ms.gym_id
    ),
    0
)
WHERE ms.total_amount IS NULL;

ALTER TABLE member_subscriptions
ALTER COLUMN total_amount SET DEFAULT 0;

ALTER TABLE member_subscriptions
ALTER COLUMN total_amount SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'member_subscriptions_total_amount_check'
    ) THEN
        ALTER TABLE member_subscriptions
        ADD CONSTRAINT member_subscriptions_total_amount_check
        CHECK (total_amount >= 0);
    END IF;
END $$;

-- Distinguish actual payment transactions from old pending balance rows.
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS entry_type VARCHAR(20) NOT NULL DEFAULT 'payment';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'payments_entry_type_check'
    ) THEN
        ALTER TABLE payments
        ADD CONSTRAINT payments_entry_type_check
        CHECK (entry_type IN ('payment', 'balance'));
    END IF;
END $$;

-- Older registration routes created pending rows to represent dues.
UPDATE payments
SET entry_type = 'balance'
WHERE subscription_id IS NOT NULL
  AND status = 'pending';

-- Track the staff/admin account that recorded each actual payment.
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS recorded_by UUID
REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_subscription_type
ON payments(subscription_id, entry_type, status);
