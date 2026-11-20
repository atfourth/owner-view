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
