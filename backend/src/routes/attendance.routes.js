import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

const checkInSchema = z.object({
  identifier: z.string().min(1, 'Member code, email, or user ID is required'),
  check_in_method: z.enum(['front_desk', 'qr_code', 'member_code', 'mobile_app']).default('front_desk'),
  notes: z.string().optional(),
});

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { activeOnly = 'false' } = req.query;
    const whereClause = activeOnly === 'true' ? 'WHERE a.check_out_time IS NULL' : '';

    const result = await query(`
      SELECT
        a.id, a.user_id, a.check_in_time, a.check_out_time, a.check_in_method, a.notes,
        u.full_name, u.member_code, u.email, u.status AS member_status,
        mp.name AS plan_name
      FROM attendance_logs a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN LATERAL (
        SELECT plan_id FROM member_subscriptions WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1
      ) ms ON TRUE
      LEFT JOIN membership_plans mp ON mp.id = ms.plan_id
      ${whereClause}
      ORDER BY a.check_in_time DESC
      LIMIT 100
    `);
    return res.json({ logs: result.rows });
  } catch (err) {
    return next(err);
  }
});

router.post('/check-in', authenticate, authorize('admin', 'staff', 'trainer'), validateBody(checkInSchema), async (req, res, next) => {
  try {
    const { identifier, check_in_method, notes } = req.validatedBody;
    const cleanId = identifier.trim();

    const userRes = await query(
      `SELECT id, member_code, full_name, email, status
       FROM users
       WHERE LOWER(member_code) = LOWER($1)
          OR LOWER(email) = LOWER($1)
          OR id::text = $1`,
      [cleanId]
    );

    if (userRes.rowCount === 0) {
      return res.status(404).json({ message: `No member found matching "${cleanId}"` });
    }

    const member = userRes.rows[0];
    if (member.status === 'frozen' || member.status === 'expired') {
      return res.status(403).json({
        message: `Check-in blocked: ${member.full_name} (${member.member_code}) membership is currently ${member.status.toUpperCase()}.`,
        member,
      });
    }

    const openVisit = await query(
      `SELECT id FROM attendance_logs WHERE user_id = $1 AND check_out_time IS NULL`,
      [member.id]
    );
    if (openVisit.rowCount > 0) {
      return res.status(409).json({
        message: `${member.full_name} is already checked in.`,
      });
    }

    const logRes = await query(
      `INSERT INTO attendance_logs (user_id, check_in_method, verified_by, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [member.id, check_in_method, req.user.id, notes || null]
    );

    return res.status(201).json({
      log: {
        ...logRes.rows[0],
        full_name: member.full_name,
        member_code: member.member_code,
        email: member.email,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id/check-out', authenticate, authorize('admin', 'staff', 'trainer'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `UPDATE attendance_logs
       SET check_out_time = NOW()
       WHERE id = $1 AND check_out_time IS NULL
       RETURNING *`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Active check-in session not found' });
    }
    return res.json({ log: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

export default router;
