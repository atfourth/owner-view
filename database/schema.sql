-- Consolidated IronPulse Gym SaaS schema. For fresh Docker databases only.

-- 001_initial_schema.sql
-- Migration 001: Core Users, Membership Plans, Member Subscriptions, and Trainers
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(64) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_code VARCHAR(20) UNIQUE NOT NULL,
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(180) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    phone VARCHAR(30),
    role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'staff', 'trainer', 'member')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'expired', 'inactive')),
    date_of_birth DATE,
    gender VARCHAR(20),
    emergency_contact_name VARCHAR(120),
    emergency_contact_phone VARCHAR(30),
    fitness_goal TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS membership_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT NOT NULL,
    duration_days INTEGER NOT NULL CHECK (duration_days > 0),
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    max_classes_per_week INTEGER,
    includes_personal_training BOOLEAN NOT NULL DEFAULT FALSE,
    features JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS member_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES membership_plans(id) ON DELETE RESTRICT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'expired', 'cancelled')),
    auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON member_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON member_subscriptions(status);

CREATE TABLE IF NOT EXISTS trainers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    specialty VARCHAR(120) NOT NULL,
    certifications TEXT[] NOT NULL DEFAULT '{}',
    experience_years INTEGER NOT NULL DEFAULT 1 CHECK (experience_years >= 0),
    hourly_rate NUMERIC(10, 2) NOT NULL DEFAULT 50.00,
    bio TEXT,
    availability_schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_accepting_clients BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 002_classes_and_bookings.sql
-- Migration 002: Fitness Classes and Class Bookings

CREATE TABLE IF NOT EXISTS fitness_classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(140) NOT NULL,
    description TEXT,
    category VARCHAR(60) NOT NULL DEFAULT 'Strength',
    trainer_id UUID REFERENCES trainers(id) ON DELETE SET NULL,
    room VARCHAR(80) NOT NULL DEFAULT 'Main Studio',
    day_of_week VARCHAR(15) NOT NULL CHECK (day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    scheduled_date DATE,
    capacity INTEGER NOT NULL DEFAULT 20 CHECK (capacity > 0),
    difficulty_level VARCHAR(20) NOT NULL DEFAULT 'All Levels' CHECK (difficulty_level IN ('Beginner', 'Intermediate', 'Advanced', 'All Levels')),
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled', 'completed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_classes_day ON fitness_classes(day_of_week);
CREATE INDEX IF NOT EXISTS idx_classes_trainer ON fitness_classes(trainer_id);

CREATE TABLE IF NOT EXISTS class_bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID NOT NULL REFERENCES fitness_classes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    booking_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'waitlisted', 'cancelled', 'attended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (class_id, user_id, booking_date)
);

CREATE INDEX IF NOT EXISTS idx_bookings_class ON class_bookings(class_id);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON class_bookings(user_id);

-- 003_attendance_payments_equipment.sql
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

-- 004_saas_foundation.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS gyms (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(160) NOT NULL, slug VARCHAR(100) NOT NULL UNIQUE,
 owner_email VARCHAR(180) NOT NULL, phone VARCHAR(30), timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
 currency VARCHAR(3) NOT NULL DEFAULT 'INR', status VARCHAR(20) NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS gym_id UUID REFERENCES gyms(id) ON DELETE CASCADE;
ALTER TABLE membership_plans ADD COLUMN IF NOT EXISTS gym_id UUID REFERENCES gyms(id) ON DELETE CASCADE;
ALTER TABLE member_subscriptions ADD COLUMN IF NOT EXISTS gym_id UUID REFERENCES gyms(id) ON DELETE CASCADE;
ALTER TABLE trainers ADD COLUMN IF NOT EXISTS gym_id UUID REFERENCES gyms(id) ON DELETE CASCADE;
ALTER TABLE fitness_classes ADD COLUMN IF NOT EXISTS gym_id UUID REFERENCES gyms(id) ON DELETE CASCADE;
ALTER TABLE class_bookings ADD COLUMN IF NOT EXISTS gym_id UUID REFERENCES gyms(id) ON DELETE CASCADE;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS gym_id UUID REFERENCES gyms(id) ON DELETE CASCADE;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS attendance_date DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS gym_id UUID REFERENCES gyms(id) ON DELETE CASCADE;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS gym_id UUID REFERENCES gyms(id) ON DELETE CASCADE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at TIMESTAMPTZ;
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_member_code_key;
ALTER TABLE membership_plans DROP CONSTRAINT IF EXISTS membership_plans_name_key;
ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_asset_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_gym_email ON users(gym_id,lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_gym_member_code ON users(gym_id,member_code);
CREATE INDEX IF NOT EXISTS idx_users_gym ON users(gym_id);
CREATE INDEX IF NOT EXISTS idx_plans_gym ON membership_plans(gym_id);
CREATE INDEX IF NOT EXISTS idx_subs_gym ON member_subscriptions(gym_id);
CREATE INDEX IF NOT EXISTS idx_attendance_gym_date ON attendance_logs(gym_id,check_in_time DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_daily_unique ON attendance_logs(gym_id,user_id,attendance_date);
CREATE INDEX IF NOT EXISTS idx_payments_gym_date ON payments(gym_id,created_at DESC);
CREATE TABLE IF NOT EXISTS gym_settings(gym_id UUID PRIMARY KEY REFERENCES gyms(id) ON DELETE CASCADE, settings JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS gym_modules(gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE, module_key VARCHAR(50) NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE, PRIMARY KEY(gym_id,module_key));
CREATE TABLE IF NOT EXISTS gym_integrations(gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE, provider VARCHAR(40) NOT NULL, config_encrypted TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(gym_id,provider));
CREATE TABLE IF NOT EXISTS expenses(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE, category VARCHAR(60) NOT NULL, description TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL CHECK(amount>0), expense_date DATE NOT NULL DEFAULT CURRENT_DATE, status VARCHAR(20) NOT NULL DEFAULT 'paid', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS trial_visitors(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE, full_name VARCHAR(120) NOT NULL, phone VARCHAR(30) NOT NULL, email VARCHAR(180), start_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), end_at TIMESTAMPTZ NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'active', notes TEXT, converted_member_id UUID REFERENCES users(id) ON DELETE SET NULL, reminder_sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE trial_visitors ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE trial_visitors ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at TIMESTAMPTZ;
ALTER TABLE trial_visitors ADD COLUMN IF NOT EXISTS interested_plan_id UUID REFERENCES membership_plans(id) ON DELETE SET NULL;
ALTER TABLE payments ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS trial_visitor_id UUID REFERENCES trial_visitors(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS notification_logs(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE, recipient VARCHAR(30) NOT NULL, kind VARCHAR(40) NOT NULL, reference_id UUID, provider_message_id TEXT, status VARCHAR(20) NOT NULL, error TEXT, sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(gym_id,kind,reference_id));
CREATE TABLE IF NOT EXISTS otp_challenges(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE, phone VARCHAR(30) NOT NULL, code_hash TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, consumed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_challenges(gym_id,phone,created_at DESC);
CREATE TABLE IF NOT EXISTS payment_orders(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE, payment_id UUID REFERENCES payments(id) ON DELETE SET NULL, provider_order_id TEXT NOT NULL, amount_paise BIGINT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'created', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(gym_id,provider_order_id));
DROP VIEW IF EXISTS v_active_memberships;
CREATE VIEW v_active_memberships AS SELECT u.gym_id,u.id AS user_id,u.member_code,u.full_name,u.email,u.phone,u.status AS member_status,ms.id AS subscription_id,mp.name AS plan_name,mp.price AS plan_price,ms.start_date,ms.end_date,(ms.end_date-CURRENT_DATE) AS days_remaining FROM users u JOIN member_subscriptions ms ON ms.user_id=u.id AND ms.gym_id=u.gym_id JOIN membership_plans mp ON mp.id=ms.plan_id AND mp.gym_id=ms.gym_id WHERE ms.status='active';
DROP VIEW IF EXISTS v_monthly_revenue;
CREATE VIEW v_monthly_revenue AS SELECT gym_id,DATE_TRUNC('month',paid_at) revenue_month,COUNT(*) transaction_count,SUM(total_amount) gross_revenue FROM payments WHERE status='paid' GROUP BY gym_id,DATE_TRUNC('month',paid_at) ORDER BY revenue_month DESC;
CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_email_unique ON users(lower(email)) WHERE role='admin';
CREATE UNIQUE INDEX IF NOT EXISTS idx_gym_member_phone ON users(gym_id,phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gym_plan_name ON membership_plans(gym_id,lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS idx_gym_equipment_asset ON equipment(gym_id,asset_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gym_invoice ON payments(gym_id,invoice_number);
INSERT INTO gym_modules(gym_id,module_key,enabled)
SELECT g.id,m.key,m.enabled FROM gyms g CROSS JOIN (VALUES ('members',true),('memberships',true),('attendance',true),('payments',true),('finance',true),('trials',true),('trainers',true),('classes',false),('equipment',false),('whatsapp',false),('online_payments',false)) m(key,enabled)
ON CONFLICT DO NOTHING;
