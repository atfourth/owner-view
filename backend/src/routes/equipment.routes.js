import { Router } from 'express';
import { z } from 'zod';
import { query } from '../config/db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

const createEquipmentSchema = z.object({
  asset_code: z.string().min(2),
  name: z.string().min(2),
  category: z.string().min(2),
  brand: z.string().optional(),
  model: z.string().optional(),
  zone: z.string().default('Main Floor'),
  next_maintenance_date: z.string().optional(),
  status: z.enum(['operational', 'maintenance_needed', 'out_of_order']).default('operational'),
  notes: z.string().optional(),
});

const updateEquipmentSchema = z.object({
  status: z.enum(['operational', 'maintenance_needed', 'out_of_order']).optional(),
  last_maintenance_date: z.string().optional(),
  next_maintenance_date: z.string().optional(),
  notes: z.string().optional(),
});

router.get('/', authenticate, async (_req, res, next) => {
  try {
    const result = await query('SELECT * FROM equipment ORDER BY asset_code ASC');
    return res.json({ equipment: result.rows });
  } catch (err) {
    return next(err);
  }
});

router.post('/', authenticate, authorize('admin', 'staff'), validateBody(createEquipmentSchema), async (req, res, next) => {
  try {
    const d = req.validatedBody;
    const result = await query(
      `INSERT INTO equipment (
        asset_code, name, category, brand, model, zone,
        last_maintenance_date, next_maintenance_date, status, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE, $7, $8, $9)
      RETURNING *`,
      [
        d.asset_code.toUpperCase().trim(),
        d.name,
        d.category,
        d.brand || null,
        d.model || null,
        d.zone,
        d.next_maintenance_date || null,
        d.status,
        d.notes || null,
      ]
    );
    return res.status(201).json({ item: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', authenticate, authorize('admin', 'staff'), validateBody(updateEquipmentSchema), async (req, res, next) => {
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
      `UPDATE equipment SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Equipment item not found' });
    }
    return res.json({ item: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

export default router;
