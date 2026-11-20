import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

const classSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  category: z.string().default('Strength'),
  trainer_id: z.string().uuid().nullable().optional(),
  room: z.string().default('Main Studio'),
  day_of_week: z.enum(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']),
  start_time: z.string().min(4),
  end_time: z.string().min(4),
  capacity: z.coerce.number().int().positive().default(20),
  difficulty_level: z.enum(['Beginner', 'Intermediate', 'Advanced', 'All Levels']).default('All Levels'),
});

// Public schedule view with booking counts
router.get('/', async (_req, res, next) => {
  try {
    const result = await query(`
      SELECT
        fc.*,
        u.full_name AS trainer_name,
        t.specialty AS trainer_specialty,
        COUNT(cb.id) FILTER (WHERE cb.status = 'confirmed') AS booked_count
      FROM fitness_classes fc
      LEFT JOIN trainers t ON t.id = fc.trainer_id
      LEFT JOIN users u ON u.id = t.user_id
      LEFT JOIN class_bookings cb ON cb.class_id = fc.id AND cb.booking_date = CURRENT_DATE
      GROUP BY fc.id, u.full_name, t.specialty
      ORDER BY
        CASE fc.day_of_week
          WHEN 'Monday' THEN 1
          WHEN 'Tuesday' THEN 2
          WHEN 'Wednesday' THEN 3
          WHEN 'Thursday' THEN 4
          WHEN 'Friday' THEN 5
          WHEN 'Saturday' THEN 6
          WHEN 'Sunday' THEN 7
        END,
        fc.start_time ASC
    `);
    return res.json({ classes: result.rows });
  } catch (err) {
    return next(err);
  }
});

router.get('/my-bookings', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT cb.*, fc.title, fc.day_of_week, fc.start_time, fc.end_time, fc.room, u.full_name AS trainer_name
       FROM class_bookings cb
       JOIN fitness_classes fc ON fc.id = cb.class_id
       LEFT JOIN trainers t ON t.id = fc.trainer_id
       LEFT JOIN users u ON u.id = t.user_id
       WHERE cb.user_id = $1 AND cb.status != 'cancelled'
       ORDER BY cb.created_at DESC`,
      [req.user.id]
    );
    return res.json({ bookings: result.rows });
  } catch (err) {
    return next(err);
  }
});

router.post('/', authenticate, authorize('admin', 'staff', 'trainer'), validateBody(classSchema), async (req, res, next) => {
  try {
    const d = req.validatedBody;
    const result = await query(
      `INSERT INTO fitness_classes (
        title, description, category, trainer_id, room,
        day_of_week, start_time, end_time, capacity, difficulty_level
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        d.title,
        d.description || null,
        d.category,
        d.trainer_id || null,
        d.room,
        d.day_of_week,
        d.start_time,
        d.end_time,
        d.capacity,
        d.difficulty_level,
      ]
    );
    return res.status(201).json({ fitnessClass: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/book', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const targetUserId = req.body.user_id && ['admin', 'staff'].includes(req.user.role)
      ? req.body.user_id
      : req.user.id;

    const classRes = await query('SELECT * FROM fitness_classes WHERE id = $1', [id]);
    if (classRes.rowCount === 0) {
      return res.status(404).json({ message: 'Fitness class not found' });
    }
    const cls = classRes.rows[0];

    const countRes = await query(
      `SELECT COUNT(*) AS cnt FROM class_bookings
       WHERE class_id = $1 AND booking_date = CURRENT_DATE AND status = 'confirmed'`,
      [id]
    );
    const currentBooked = Number(countRes.rows[0].cnt);
    const bookingStatus = currentBooked >= cls.capacity ? 'waitlisted' : 'confirmed';

    const result = await query(
      `INSERT INTO class_bookings (class_id, user_id, booking_date, status)
       VALUES ($1, $2, CURRENT_DATE, $3)
       ON CONFLICT (class_id, user_id, booking_date)
       DO UPDATE SET status = EXCLUDED.status
       RETURNING *`,
      [id, targetUserId, bookingStatus]
    );

    return res.status(201).json({ booking: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id/book', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `UPDATE class_bookings
       SET status = 'cancelled'
       WHERE class_id = $1 AND user_id = $2 AND booking_date = CURRENT_DATE
       RETURNING *`,
      [id, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Active booking not found for today' });
    }
    return res.json({ booking: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

export default router;
