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
