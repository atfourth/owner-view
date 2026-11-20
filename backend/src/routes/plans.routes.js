import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

const planSchema = z.object({
  name: z.string().min(2),
  description: z.string().min(5),
  duration_days: z.coerce.number().int().positive(),
  price: z.coerce.number().nonnegative(),
  currency: z.string().default('USD'),
  max_classes_per_week: z.coerce.number().int().positive().nullable().optional(),
  includes_personal_training: z.boolean().default(false),
  features: z.array(z.string()).default([]),
  is_active: z.boolean().default(true),
});

// Public endpoint so the landing page can display plans
router.get('/', async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT mp.*,
              COUNT(ms.id) FILTER (WHERE ms.status = 'active') AS active_subscribers
       FROM membership_plans mp
       LEFT JOIN member_subscriptions ms ON ms.plan_id = mp.id
       GROUP BY mp.id
       ORDER BY mp.price ASC`
    );
    return res.json({ plans: result.rows });
  } catch (err) {
    return next(err);
  }
});

router.post('/', authenticate, authorize('admin'), validateBody(planSchema), async (req, res, next) => {
  try {
    const d = req.validatedBody;
    const result = await query(
      `INSERT INTO membership_plans (
        name, description, duration_days, price, currency,
        max_classes_per_week, includes_personal_training, features, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
      RETURNING *`,
      [
        d.name,
        d.description,
        d.duration_days,
        d.price,
        d.currency,
        d.max_classes_per_week ?? null,
        d.includes_personal_training,
        JSON.stringify(d.features),
        d.is_active,
      ]
    );
    return res.status(201).json({ plan: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', authenticate, authorize('admin'), validateBody(planSchema.partial()), async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.validatedBody;
    const fields = [];
    const values = [];

    Object.entries(updates).forEach(([key, val]) => {
      if (val !== undefined) {
        if (key === 'features') {
          values.push(JSON.stringify(val));
          fields.push(`features = $${values.length}::jsonb`);
        } else {
          values.push(val);
          fields.push(`${key} = $${values.length}`);
        }
      }
    });

    if (fields.length === 0) {
      return res.status(400).json({ message: 'No updates provided' });
    }

    values.push(id);
    const result = await query(
      `UPDATE membership_plans SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Membership plan not found' });
    }
    return res.json({ plan: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

export default router;
