import { Router } from 'express';
import { query } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/stats', authenticate, async (req, res, next) => {
  try {
    const [
      membersRes,
      revenueRes,
      checkinsRes,
      classesRes,
      expiringRes,
      recentCheckinsRes,
      recentPaymentsRes,
    ] = await Promise.all([
      query(`
        SELECT
          COUNT(*) FILTER (WHERE role = 'member') AS total_members,
          COUNT(*) FILTER (WHERE role = 'member' AND status = 'active') AS active_members,
          COUNT(*) FILTER (WHERE role = 'member' AND status = 'frozen') AS frozen_members,
          COUNT(*) FILTER (WHERE role = 'member' AND status = 'expired') AS expired_members
        FROM users
      `),
      query(`
        SELECT
          COALESCE(SUM(total_amount) FILTER (WHERE status = 'paid' AND DATE_TRUNC('month', paid_at) = DATE_TRUNC('month', CURRENT_DATE)), 0) AS monthly_revenue,
          COALESCE(SUM(total_amount) FILTER (WHERE status = 'paid'), 0) AS total_revenue,
          COUNT(*) FILTER (WHERE status = 'pending') AS pending_invoices
        FROM payments
      `),
      query(`
        SELECT
          COUNT(*) FILTER (WHERE check_in_time::date = CURRENT_DATE) AS today_checkins,
          COUNT(*) FILTER (WHERE check_out_time IS NULL AND check_in_time >= NOW() - INTERVAL '12 hours') AS currently_in_gym
        FROM attendance_logs
      `),
      query(`
        SELECT COUNT(*) AS active_classes
        FROM fitness_classes
        WHERE status = 'scheduled'
      `),
      query(`
        SELECT
          u.id, u.member_code, u.full_name, u.email,
          mp.name AS plan_name, ms.end_date,
          (ms.end_date - CURRENT_DATE) AS days_left
        FROM member_subscriptions ms
        JOIN users u ON u.id = ms.user_id
        JOIN membership_plans mp ON mp.id = ms.plan_id
        WHERE ms.status = 'active'
          AND ms.end_date <= CURRENT_DATE + INTERVAL '14 days'
        ORDER BY ms.end_date ASC
        LIMIT 5
      `),
      query(`
        SELECT a.id, a.check_in_time, a.check_out_time, a.check_in_method,
               u.full_name, u.member_code
        FROM attendance_logs a
        JOIN users u ON u.id = a.user_id
        ORDER BY a.check_in_time DESC
        LIMIT 6
      `),
      query(`
        SELECT p.id, p.invoice_number, p.total_amount, p.payment_method, p.status, p.paid_at,
               u.full_name, u.member_code
        FROM payments p
        JOIN users u ON u.id = p.user_id
        ORDER BY p.created_at DESC
        LIMIT 6
      `),
    ]);

    return res.json({
      kpis: {
        totalMembers: Number(membersRes.rows[0].total_members),
        activeMembers: Number(membersRes.rows[0].active_members),
        frozenMembers: Number(membersRes.rows[0].frozen_members),
        expiredMembers: Number(membersRes.rows[0].expired_members),
        monthlyRevenue: Number(revenueRes.rows[0].monthly_revenue),
        totalRevenue: Number(revenueRes.rows[0].total_revenue),
        pendingInvoices: Number(revenueRes.rows[0].pending_invoices),
        todayCheckins: Number(checkinsRes.rows[0].today_checkins),
        currentlyInGym: Number(checkinsRes.rows[0].currently_in_gym),
        activeClasses: Number(classesRes.rows[0].active_classes),
      },
      expiringSubscriptions: expiringRes.rows,
      recentCheckins: recentCheckinsRes.rows,
      recentPayments: recentPaymentsRes.rows,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
