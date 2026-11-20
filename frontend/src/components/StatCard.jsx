import React from 'react';

export default function StatCard({ title, value, subtitle, icon: Icon, accent = 'orange' }) {
  const accentClasses = {
    orange: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    sky: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  };

  return (
    <div className="card p-5 flex items-start justify-between">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{title}</p>
        <p className="mt-2 text-2xl font-bold text-white">{value}</p>
        {subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}
      </div>
      {Icon && (
        <div className={`p-3 rounded-xl border ${accentClasses[accent] || accentClasses.orange}`}>
          <Icon className="w-5 h-5" />
        </div>
      )}
    </div>
  );
}
