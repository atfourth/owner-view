import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { authenticate } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

const registerSchema = z.object({
  full_name: z.string().min(2, 'Full name is required'),
  email: z.string().email('Valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phone: z.string().optional(),
  fitness_goal: z.string().optional(),
  plan_id: z.string().uuid().optional(),
});

const loginSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      full_name: user.full_name,
      member_code: user.member_code,
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

router.post('/register', validateBody(registerSchema), async (req, res, next) => {
  try {
    const { full_name, email, password, phone, fitness_goal, plan_id } = req.validatedBody;
    const normalizedEmail = email.toLowerCase().trim();

    const existing = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ message: 'Email address is already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const memberCode = `MEM-${Math.floor(1000 + Math.random() * 9000)}`;

    const userRes = await query(
      `INSERT INTO users (member_code, full_name, email, password_hash, phone, role, status, fitness_goal)
       VALUES ($1, $2, $3, $4, $5, 'member', 'active', $6)
       RETURNING id, member_code, full_name, email, phone, role, status, fitness_goal, created_at`,
      [memberCode, full_name.trim(), normalizedEmail, passwordHash, phone || null, fitness_goal || null]
    );
    const user = userRes.rows[0];

    if (plan_id) {
      const planRes = await query(
        'SELECT id, name, duration_days, price FROM membership_plans WHERE id = $1 AND is_active = TRUE',
        [plan_id]
      );
      if (planRes.rowCount > 0) {
        const plan = planRes.rows[0];
        const subRes = await query(
          `INSERT INTO member_subscriptions (user_id, plan_id, start_date, end_date, status, auto_renew)
           VALUES ($1, $2, CURRENT_DATE, CURRENT_DATE + ($3 || ' days')::interval, 'active', FALSE)
           RETURNING id`,
          [user.id, plan.id, String(plan.duration_days)]
        );
        const invoiceNum = `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
        await query(
          `INSERT INTO payments (invoice_number, user_id, subscription_id, amount, tax_amount, total_amount, payment_method, status, description)
           VALUES ($1, $2, $3, $4, 0, $4, 'online', 'paid', $5)`,
          [invoiceNum, user.id, subRes.rows[0].id, plan.price, `${plan.name} - Initial Enrollment`]
        );
      }
    }

    const token = signToken(user);
    return res.status(201).json({ token, user });
  } catch (err) {
    return next(err);
  }
});

router.post('/login', validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.validatedBody;
    const normalizedEmail = email.toLowerCase().trim();

    const result = await query(
      `SELECT id, member_code, full_name, email, password_hash, phone, role, status, fitness_goal, created_at
       FROM users WHERE email = $1`,
      [normalizedEmail]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const userRow = result.rows[0];
    const valid = await bcrypt.compare(password, userRow.password_hash);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const { password_hash: _ignored, ...user } = userRow;
    const token = signToken(user);
    return res.json({ token, user });
  } catch (err) {
    return next(err);
  }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.member_code, u.full_name, u.email, u.phone, u.role, u.status, u.fitness_goal, u.created_at,
              mp.name AS active_plan_name, ms.end_date AS subscription_end_date, ms.status AS subscription_status
       FROM users u
       LEFT JOIN LATERAL (
         SELECT plan_id, end_date, status
         FROM member_subscriptions
         WHERE user_id = u.id
         ORDER BY created_at DESC
         LIMIT 1
       ) ms ON TRUE
       LEFT JOIN membership_plans mp ON mp.id = ms.plan_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'User profile not found' });
    }
    return res.json({ user: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

export default router;
