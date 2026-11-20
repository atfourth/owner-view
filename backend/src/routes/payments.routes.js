import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

const createPaymentSchema = z.object({
  user_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  tax_amount: z.coerce.number().nonnegative().default(0),
  payment_method: z.enum(['card', 'cash', 'bank_transfer', 'upi', 'online']).default('card'),
  status: z.enum(['paid', 'pending']).default('paid'),
  description: z.string().min(2),
});

router.get('/', authenticate, async (req, res, next) => {
  try {
    const isMemberOnly = req.user.role === 'member';
    const params = [];
    let whereClause = '';

    if (isMemberOnly) {
      params.push(req.user.id);
      whereClause = 'WHERE p.user_id = $1';
    }

    const result = await query(
      `SELECT
        p.*,
        u.full_name, u.member_code, u.email
       FROM payments p
       JOIN users u ON u.id = p.user_id
       ${whereClause}
       ORDER BY p.created_at DESC`,
      params
    );

    return res.json({ payments: result.rows });
  } catch (err) {
    return next(err);
  }
});

router.post('/', authenticate, authorize('admin', 'staff'), validateBody(createPaymentSchema), async (req, res, next) => {
  try {
    const d = req.validatedBody;
    const totalAmount = Number(d.amount) + Number(d.tax_amount || 0);
    const invoiceNumber = `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const result = await query(
      `INSERT INTO payments (
        invoice_number, user_id, amount, tax_amount, total_amount,
        payment_method, status, paid_at, description
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        invoiceNumber,
        d.user_id,
        d.amount,
        d.tax_amount,
        totalAmount,
        d.payment_method,
        d.status,
        d.status === 'paid' ? new Date() : null,
        d.description,
      ]
    );

    return res.status(201).json({ payment: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id/mark-paid', authenticate, authorize('admin', 'staff'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const paymentMethod = req.body.payment_method || 'card';
    const result = await query(
      `UPDATE payments
       SET status = 'paid', paid_at = NOW(), payment_method = $2
       WHERE id = $1
       RETURNING *`,
      [id, paymentMethod]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    return res.json({ payment: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

export default router;
