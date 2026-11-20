-- Migration 003: Attendance Logs, Payments, Equipment Inventory, Triggers & Reporting Views

CREATE TABLE IF NOT EXISTS attendance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    check_in_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    check_out_time TIMESTAMPTZ,
    check_in_method VARCHAR(30) NOT NULL DEFAULT 'front_desk' CHECK (check_in_method IN ('front_desk', 'qr_code', 'member_code', 'mobile_app')),
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_checkin ON attendance_logs(check_in_time DESC);

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(32) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES member_subscriptions(id) ON DELETE SET NULL,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
    tax_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(10, 2) NOT NULL CHECK (total_amount >= 0),
    payment_method VARCHAR(30) NOT NULL DEFAULT 'card' CHECK (payment_method IN ('card', 'cash', 'bank_transfer', 'upi', 'online')),
    status VARCHAR(20) NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'pending', 'failed', 'refunded')),
    paid_at TIMESTAMPTZ DEFAULT NOW(),
    due_date DATE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments(paid_at DESC);

CREATE TABLE IF NOT EXISTS equipment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_code VARCHAR(30) UNIQUE NOT NULL,
    name VARCHAR(120) NOT NULL,
    category VARCHAR(60) NOT NULL,
    brand VARCHAR(80),
    model VARCHAR(80),
    zone VARCHAR(80) NOT NULL DEFAULT 'Main Floor',
    purchase_date DATE,
    last_maintenance_date DATE,
    next_maintenance_date DATE,
    status VARCHAR(25) NOT NULL DEFAULT 'operational' CHECK (status IN ('operational', 'maintenance_needed', 'out_of_order')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Automatic updated_at trigger function
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_plans_updated_at ON membership_plans;
CREATE TRIGGER trg_plans_updated_at BEFORE UPDATE ON membership_plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON member_subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON member_subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_trainers_updated_at ON trainers;
CREATE TRIGGER trg_trainers_updated_at BEFORE UPDATE ON trainers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_classes_updated_at ON fitness_classes;
CREATE TRIGGER trg_classes_updated_at BEFORE UPDATE ON fitness_classes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_equipment_updated_at ON equipment;
CREATE TRIGGER trg_equipment_updated_at BEFORE UPDATE ON equipment FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Reporting Views
CREATE OR REPLACE VIEW v_active_memberships AS
SELECT
    u.id AS user_id,
    u.member_code,
    u.full_name,
    u.email,
    u.phone,
    u.status AS member_status,
    ms.id AS subscription_id,
    mp.name AS plan_name,
    mp.price AS plan_price,
    ms.start_date,
    ms.end_date,
    (ms.end_date - CURRENT_DATE) AS days_remaining
FROM users u
JOIN member_subscriptions ms ON ms.user_id = u.id
JOIN membership_plans mp ON mp.id = ms.plan_id
WHERE ms.status = 'active';

CREATE OR REPLACE VIEW v_monthly_revenue AS
SELECT
    DATE_TRUNC('month', paid_at) AS revenue_month,
    COUNT(*) AS transaction_count,
    SUM(total_amount) AS gross_revenue
FROM payments
WHERE status = 'paid'
GROUP BY DATE_TRUNC('month', paid_at)
ORDER BY revenue_month DESC;
