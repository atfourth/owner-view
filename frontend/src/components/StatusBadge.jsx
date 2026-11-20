import React from 'react';

const STYLES = {
  active: 'bg-emerald-500/15 text-emerald-800 border-emerald-500/30',
  operational: 'bg-emerald-500/15 text-emerald-800 border-emerald-500/30',
  paid: 'bg-emerald-500/15 text-emerald-800 border-emerald-500/30',
  confirmed: 'bg-emerald-500/15 text-emerald-800 border-emerald-500/30',
  scheduled: 'bg-sky-500/15 text-sky-800 border-sky-500/30',
  frozen: 'bg-sky-500/15 text-sky-800 border-sky-500/30',
  pending: 'bg-amber-500/15 text-amber-800 border-amber-500/30',
  waitlisted: 'bg-amber-500/15 text-amber-800 border-amber-500/30',
  maintenance_needed: 'bg-amber-500/15 text-amber-800 border-amber-500/30',
  expired: 'bg-rose-500/15 text-rose-800 border-rose-500/30',
  out_of_order: 'bg-rose-500/15 text-rose-800 border-rose-500/30',
  cancelled: 'bg-rose-500/15 text-rose-800 border-rose-500/30',
  failed: 'bg-rose-500/15 text-rose-800 border-rose-500/30',
};

export default function StatusBadge({ status }) {
  const key = String(status || '').toLowerCase();
  const label = key.replace(/_/g, ' ');
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border capitalize ${
        STYLES[key] || 'bg-slate-800 text-slate-300 border-slate-700'
      }`}
    >
      {label}
    </span>
  );
}
