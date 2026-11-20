import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

const createTrainerSchema = z.object({
  full_name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  specialty: z.string().min(2),
  certifications: z.array(z.string()).default([]),
  experience_years: z.coerce.number().int().nonnegative().default(1),
  hourly_rate: z.coerce.number().nonnegative().default(60),
  bio: z.string().optional(),
});

// Public trainer showcase
router.get('/', async (_req, res, next) => {
  try {
    const result = await query(`
      SELECT
        t.id, t.user_id, t.specialty, t.certifications, t.experience_years,
        t.hourly_rate, t.bio, t.is_accepting_clients, t.created_at,
        u.full_name, u.email, u.phone, u.member_code,
        COUNT(fc.id) AS assigned_classes
      FROM trainers t
      JOIN users u ON u.id = t.user_id
      LEFT JOIN fitness_classes fc ON fc.trainer_id = t.id AND fc.status = 'scheduled'
      GROUP BY t.id, u.id
      ORDER BY t.experience_years DESC
    `);
    return res.json({ trainers: result.rows });
  } catch (err) {
    return next(err);
  }
});

router.post('/', authenticate, authorize('admin'), validateBody(createTrainerSchema), async (req, res, next) => {
  try {
    const d = req.validatedBody;
    const normalizedEmail = d.email.toLowerCase().trim();
    const passwordHash = await bcrypt.hash('Password123!', 10);
    const trainerCode = `TRN-${Math.floor(100 + Math.random() * 900)}`;

    const userRes = await query(
      `INSERT INTO users (member_code, full_name, email, password_hash, phone, role, status)
       VALUES ($1, $2, $3, $4, $5, 'trainer', 'active')
       RETURNING id, full_name, email, phone, member_code`,
      [trainerCode, d.full_name.trim(), normalizedEmail, passwordHash, d.phone || null]
    );
    const user = userRes.rows[0];

    const trainerRes = await query(
      `INSERT INTO trainers (user_id, specialty, certifications, experience_years, hourly_rate, bio)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [user.id, d.specialty, d.certifications, d.experience_years, d.hourly_rate, d.bio || null]
    );

    return res.status(201).json({
      trainer: {
        ...trainerRes.rows[0],
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        member_code: user.member_code,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
