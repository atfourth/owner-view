import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

const createMemberSchema = z.object({
  full_name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  gender: z.string().optional(),
  fitness_goal: z.string().optional(),
  emergency_contact_name: z.string().optional(),
  emergency_contact_phone: z.string().optional(),
  plan_id: z.string().uuid().optional(),
  payment_method: z.enum(['card', 'cash', 'bank_transfer', 'upi', 'online']).optional(),
});

const updateMemberSchema = z.object({
  full_name: z.string().min(2).optional(),
  phone: z.string().optional(),
  status: z.enum(['active', 'frozen', 'expired', 'inactive']).optional(),
  fitness_goal: z.string().optional(),
  emergency_contact_name: z.string().optional(),
  emergency_contact_phone: z.string().optional(),
});

const assignPlanSchema = z.object({
  plan_id: z.string().uuid(),
  start_date: z.string().optional(),
  auto_renew: z.boolean().optional(),
  payment_method: z.enum(['card', 'cash', 'bank_transfer', 'upi', 'online']).default('card'),
});

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { search = '', status = '' } = req.query;
    const conditions = ["u.role = 'member'"];
    const params = [];

    if (search) {
      params.push(`%${search.trim()}%`);
      conditions.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.member_code ILIKE $${params.length})`);
    }
    if (status && status !== 'all') {
      params.push(status);
      conditions.push(`u.status = $${params.length}`);
    }

    const sql = `
      SELECT
        u.id, u.member_code, u.full_name, u.email, u.phone, u.status,
        u.gender, u.fitness_goal, u.emergency_contact_name, u.emergency_contact_phone, u.created_at,
        ms.id AS subscription_id, ms.start_date, ms.end_date, ms.status AS subscription_status, ms.auto_renew,
        mp.id AS plan_id, mp.name AS plan_name, mp.price AS plan_price
      FROM users u
      LEFT JOIN LATERAL (
        SELECT *
        FROM member_subscriptions
        WHERE user_id = u.id
        ORDER BY created_at DESC
        LIMIT 1
      ) ms ON TRUE
      LEFT JOIN membership_plans mp ON mp.id = ms.plan_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY u.created_at DESC
    `;

    const result = await query(sql, params);
    return res.json({ members: result.rows });
  } catch (err) {
    return next(err);
  }
});

router.post('/', authenticate, authorize('admin', 'staff'), validateBody(createMemberSchema), async (req, res, next) => {
  try {
    const data = req.validatedBody;
    const normalizedEmail = data.email.toLowerCase().trim();
    const defaultPasswordHash = await bcrypt.hash('Password123!', 10);
    const memberCode = `MEM-${Math.floor(1000 + Math.random() * 9000)}`;

    const userRes = await query(
      `INSERT INTO users (
        member_code, full_name, email, password_hash, phone, role, status,
        gender, fitness_goal, emergency_contact_name, emergency_contact_phone
      )
      VALUES ($1, $2, $3, $4, $5, 'member', 'active', $6, $7, $8, $9)
      RETURNING id, member_code, full_name, email, phone, status, gender, fitness_goal, created_at`,
      [
        memberCode,
        data.full_name.trim(),
        normalizedEmail,
        defaultPasswordHash,
        data.phone || null,
        data.gender || null,
        data.fitness_goal || null,
        data.emergency_contact_name || null,
        data.emergency_contact_phone || null,
      ]
    );
    const member = userRes.rows[0];

    if (data.plan_id) {
      const planRes = await query('SELECT * FROM membership_plans WHERE id = $1', [data.plan_id]);
      if (planRes.rowCount > 0) {
        const plan = planRes.rows[0];
        const subRes = await query(
          `INSERT INTO member_subscriptions (user_id, plan_id, start_date, end_date, status, auto_renew)
           VALUES ($1, $2, CURRENT_DATE, CURRENT_DATE + ($3 || ' days')::interval, 'active', FALSE)
           RETURNING id`,
          [member.id, plan.id, String(plan.duration_days)]
        );
        const invoiceNum = `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
        await query(
          `INSERT INTO payments (invoice_number, user_id, subscription_id, amount, tax_amount, total_amount, payment_method, status, description)
           VALUES ($1, $2, $3, $4, 0, $4, $5, 'paid', $6)`,
          [
            invoiceNum,
            member.id,
            subRes.rows[0].id,
            plan.price,
            data.payment_method || 'card',
            `${plan.name} - New Member Registration`,
          ]
        );
      }
    }

    return res.status(201).json({ member });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', authenticate, authorize('admin', 'staff'), validateBody(updateMemberSchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.validatedBody;
    const fields = [];
    const values = [];

    Object.entries(updates).forEach(([key, val]) => {
      if (val !== undefined) {
        values.push(val);
        fields.push(`${key} = $${values.length}`);
      }
    });

    if (fields.length === 0) {
      return res.status(400).json({ message: 'No fields provided to update' });
    }

    values.push(id);
    const result = await query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${values.length} AND role = 'member'
       RETURNING id, member_code, full_name, email, phone, status, fitness_goal, updated_at`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Member not found' });
    }

    if (updates.status) {
      await query(
        `UPDATE member_subscriptions SET status = $1
         WHERE id = (
           SELECT id FROM member_subscriptions WHERE user_id = $2 ORDER BY created_at DESC LIMIT 1
         )`,
        [updates.status === 'active' ? 'active' : updates.status === 'frozen' ? 'frozen' : 'expired', id]
      );
    }

    return res.json({ member: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/subscriptions', authenticate, authorize('admin', 'staff'), validateBody(assignPlanSchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { plan_id, start_date, auto_renew, payment_method } = req.validatedBody;

    const planRes = await query('SELECT * FROM membership_plans WHERE id = $1', [plan_id]);
    if (planRes.rowCount === 0) {
      return res.status(404).json({ message: 'Membership plan not found' });
    }
    const plan = planRes.rows[0];

    await query(
      `UPDATE member_subscriptions SET status = 'expired' WHERE user_id = $1 AND status = 'active'`,
      [id]
    );

    const effectiveStart = start_date || new Date().toISOString().slice(0, 10);
    const subRes = await query(
      `INSERT INTO member_subscriptions (user_id, plan_id, start_date, end_date, status, auto_renew)
       VALUES ($1, $2, $3::date, $3::date + ($4 || ' days')::interval, 'active', $5)
       RETURNING *`,
      [id, plan.id, effectiveStart, String(plan.duration_days), Boolean(auto_renew)]
    );

    await query(`UPDATE users SET status = 'active' WHERE id = $1`, [id]);

    const invoiceNum = `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const payRes = await query(
      `INSERT INTO payments (invoice_number, user_id, subscription_id, amount, tax_amount, total_amount, payment_method, status, description)
       VALUES ($1, $2, $3, $4, 0, $4, $5, 'paid', $6)
       RETURNING *`,
      [invoiceNum, id, subRes.rows[0].id, plan.price, payment_method, `${plan.name} - Membership Renewal`]
    );

    return res.status(201).json({
      subscription: subRes.rows[0],
      payment: payRes.rows[0],
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
