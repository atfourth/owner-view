import React, { useEffect, useState } from 'react';
import { Users, DollarSign, UserCheck, Wallet, AlertTriangle } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import StatCard from '../components/StatCard';
import StatusBadge from '../components/StatusBadge';

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getDashboardStats()
      .then((res) => setData(res))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-slate-400">Loading gym metrics...</div>;
  }

  const kpis = data?.kpis || {};

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Welcome back, {user?.full_name}</h1>
        <p className="text-sm text-slate-400 mt-1">
          Live facility overview, member activity, and revenue performance
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Active Members"
          value={kpis.activeMembers ?? 0}
          subtitle={`${kpis.totalMembers ?? 0} total members`}
          icon={Users}
          accent="orange"
        />
        <StatCard
          title="Monthly Revenue"
          value={`₹${Number(kpis.monthlyRevenue || 0).toLocaleString('en-IN')}`}
          subtitle={`₹${Number(kpis.totalRevenue || 0).toLocaleString('en-IN')} lifetime • ${kpis.pendingInvoices ?? 0} pending`}
          icon={DollarSign}
          accent="emerald"
        />
        <StatCard
          title="Currently In Gym"
          value={kpis.currentlyInGym ?? 0}
          subtitle={`${kpis.todayCheckins ?? 0} total check-ins today`}
          icon={UserCheck}
          accent="sky"
        />
        <StatCard
          title="Net after expenses"
          value={`₹${Number(kpis.netMonth || 0).toLocaleString('en-IN')}`}
          subtitle={`Monthly expenses ₹${Number(kpis.monthExpenses || 0).toLocaleString('en-IN')}`}
          icon={Wallet}
          accent="amber"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Check-ins */}
        <div className="card p-5">
          <h2 className="text-base font-semibold text-white mb-4">Recent Floor Check-Ins</h2>
          <div className="space-y-3">
            {(data?.recentCheckins || []).map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between py-2 border-b border-slate-800/80 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium text-white">{c.full_name}</p>
                  <p className="text-xs text-slate-400">
                    {c.member_code} &bull; via {c.check_in_method.replace('_', ' ')}
                  </p>
                </div>
                <div className="text-right">
                  <StatusBadge status={c.check_out_time ? 'completed' : 'active'} />
                  <p className="text-xs text-slate-400 mt-1">
                    {new Date(c.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
            {(!data?.recentCheckins || data.recentCheckins.length === 0) && (
              <p className="text-sm text-slate-500">No recent check-ins recorded.</p>
            )}
          </div>
        </div>

        {/* Expiring Soon */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h2 className="text-base font-semibold text-white">Expiring Within 7 Days</h2>
          </div>
          <div className="space-y-3">
            {(data?.expiringSubscriptions || []).map((sub) => (
              <div
                key={sub.id}
                className="flex items-center justify-between py-2 border-b border-slate-800/80 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium text-white">{sub.full_name}</p>
                  <p className="text-xs text-slate-400">
                    {sub.plan_name} ({sub.member_code})
                  </p>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-amber-500/15 text-amber-300">
                  {sub.days_left} days left
                </span>
              </div>
            ))}
            {(!data?.expiringSubscriptions || data.expiringSubscriptions.length === 0) && (
              <p className="text-sm text-slate-500">No active subscriptions expiring in the next 7 days.</p>
            )}
          </div>
        </div>
      </div>

      {/* Recent Invoices */}
      <div className="card p-5">
        <h2 className="text-base font-semibold text-white mb-4">Recent Billing Transactions</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase text-slate-400">
                <th className="pb-3">Invoice</th>
                <th className="pb-3">Member</th>
                <th className="pb-3">Method</th>
                <th className="pb-3">Amount</th>
                <th className="pb-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {(data?.recentPayments || []).map((p) => (
                <tr key={p.id}>
                  <td className="py-3 font-mono text-xs text-slate-300">{p.invoice_number}</td>
                  <td className="py-3 font-medium text-white">{p.full_name}</td>
                  <td className="py-3 capitalize text-slate-400">{p.payment_method.replace('_', ' ')}</td>
                  <td className="py-3 font-semibold text-white">₹{Number(p.total_amount).toFixed(2)}</td>
                  <td className="py-3">
                    <StatusBadge status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
