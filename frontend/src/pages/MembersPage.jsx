import React, { useEffect, useState } from 'react';
import { Plus, Search, RefreshCw, CalendarCheck, Receipt } from 'lucide-react';
import { api } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';

export default function MembersPage() {
  const [members, setMembers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [renewMember, setRenewMember] = useState(null);
  const [attendanceMember,setAttendanceMember]=useState(null);
  const [attendanceRows,setAttendanceRows]=useState([]);
  const [paymentMember,setPaymentMember]=useState(null);
  const [paymentRows,setPaymentRows]=useState([]);
  const [newMember, setNewMember] = useState({
    full_name: '',
    email: '',
    phone: '',
    fitness_goal: '',
    plan_id: '',
    payment_method: 'cash',
    whatsapp_opt_in: false,
  });
  const [renewForm, setRenewForm] = useState({ plan_id: '', payment_method: 'cash' });
  const [error, setError] = useState('');

  async function loadData() {
    setLoading(true);
    try {
      const [mRes, pRes] = await Promise.all([
        api.getMembers({ search, status: statusFilter }),
        api.getPlans(),
      ]);
      setMembers(mRes.members);
      setPlans(pRes.plans.filter((p) => p.is_active));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [search, statusFilter]);

  async function handleCreateMember(e) {
    e.preventDefault();
    setError('');
    try {
      const payload = { ...newMember };
      if (!payload.plan_id) delete payload.plan_id;
      await api.createMember(payload);
      setIsAddOpen(false);
      setNewMember({ full_name: '', email: '', phone: '', fitness_goal: '', plan_id: '', payment_method: 'cash', whatsapp_opt_in: false });
      loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleWhatsapp(member){try{await api.updateMember(member.id,{whatsapp_opt_in:!member.whatsapp_opt_in});loadData();}catch(e){setError(e.message);}}
  async function showPayments(member){setPaymentMember(member);try{const r=await api.getMemberPayments(member.id);setPaymentRows(r.payments||[]);}catch(e){setError(e.message);}}
  async function showAttendance(member){setAttendanceMember(member);try{const r=await api.getMemberAttendance(member.id);setAttendanceRows(r.attendance||[]);}catch(e){setError(e.message);}}

  async function handleStatusToggle(member, nextStatus) {
    try {
      await api.updateMember(member.id, { status: nextStatus });
      loadData();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleRenewSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      await api.assignSubscription(renewMember.id, renewForm);
      setRenewMember(null);
      loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Members Directory</h1>
          <p className="text-sm text-slate-400">Manage member profiles, subscriptions, freezes, and renewals</p>
        </div>
        <button onClick={() => setIsAddOpen(true)} className="btn-primary">
          <Plus className="w-4 h-4" />
          Register Member
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Search by name, email, or member code (e.g. MEM-1001)..."
            className="input-field pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input-field sm:w-48"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="frozen">Frozen</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {/* Members Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 border-b border-slate-800 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3.5">Member</th>
                <th className="px-5 py-3.5">Active Plan</th>
                <th className="px-5 py-3.5">Expiry Date</th>
                <th className="px-5 py-3.5">Paid / Due</th>
                <th className="px-5 py-3.5">WhatsApp</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {members.map((m) => (
                <tr key={m.id} className="hover:bg-slate-800/40">
                  <td className="px-5 py-4">
                    <p className="font-semibold text-white">{m.full_name}</p>
                    <p className="text-xs text-slate-400">
                      <span className="font-mono text-emerald-700">{m.member_code}</span> &bull; {m.phone} {m.email?` · ${m.email}`:''}
                    </p>
                  </td>
                  <td className="px-5 py-4 text-slate-300">{m.plan_name || 'No active plan'}</td>
                  <td className="px-5 py-4 text-slate-400">
                    {m.end_date ? new Date(m.end_date).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap"><p className="font-semibold text-emerald-700">₹{Number(m.total_paid||0).toLocaleString('en-IN')}</p>{Number(m.pending_amount||0)>0&&<p className="text-xs text-amber-700">₹{Number(m.pending_amount).toLocaleString('en-IN')} due</p>}</td>
                  <td className="px-5 py-4"><button className="text-xs font-medium text-emerald-700" onClick={()=>toggleWhatsapp(m)}>{m.whatsapp_opt_in?'Opted in · Turn off':'Not opted in · Turn on'}</button></td>
                  <td className="px-5 py-4">
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="px-5 py-4 text-right space-x-2">
                    <button onClick={()=>showPayments(m)} className="btn-secondary py-1.5 px-3 text-xs"><Receipt className="w-3.5 h-3.5"/>Payments</button>
                    <button onClick={()=>showAttendance(m)} className="btn-secondary py-1.5 px-3 text-xs"><CalendarCheck className="w-3.5 h-3.5"/>Attendance</button>
                    <button
                      onClick={() => {
                        setRenewMember(m);
                        setRenewForm({ plan_id: m.plan_id || plans[0]?.id || '', payment_method: 'cash' });
                      }}
                      className="btn-secondary py-1.5 px-3 text-xs"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Assign / Renew
                    </button>
                    {m.status === 'active' ? (
                      <button
                        onClick={() => handleStatusToggle(m, 'frozen')}
                        className="btn-secondary py-1.5 px-3 text-xs text-sky-300"
                      >
                        Freeze
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStatusToggle(m, 'active')}
                        className="btn-secondary py-1.5 px-3 text-xs text-emerald-300"
                      >
                        Activate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && members.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-slate-500">
                    No members match your current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={!!attendanceMember} onClose={()=>setAttendanceMember(null)} title={`Attendance — ${attendanceMember?.full_name||''}`}>
        <div className="space-y-2 max-h-96 overflow-y-auto">{attendanceRows.length?attendanceRows.map(row=><div key={row.id} className="flex items-center justify-between border-b py-3 text-sm"><div><p className="font-medium">{new Date(row.check_in_time).toLocaleDateString()}</p><p className="text-xs text-slate-500">{row.check_in_method?.replace('_',' ')}</p></div><div className="text-right"><p>In: {new Date(row.check_in_time).toLocaleTimeString()}</p><p className="text-xs text-slate-500">Out: {row.check_out_time?new Date(row.check_out_time).toLocaleTimeString():'Still in gym'}</p></div></div>):<p className="py-8 text-center text-sm text-slate-500">No attendance recorded for this member yet.</p>}</div>
      </Modal>

      <Modal isOpen={!!paymentMember} onClose={()=>setPaymentMember(null)} title={`Payment history — ${paymentMember?.full_name||''}`}><div className="max-h-96 space-y-2 overflow-y-auto">{paymentRows.length?paymentRows.map(row=><div key={row.id} className="flex items-center justify-between border-b py-3 text-sm"><div><p className="font-medium">{row.description||row.invoice_number}</p><p className="text-xs text-slate-500">{row.invoice_number} · {row.paid_at?new Date(row.paid_at).toLocaleDateString():'Unpaid'}</p></div><div className="text-right"><p className="font-semibold">₹{Number(row.total_amount).toLocaleString('en-IN')}</p><StatusBadge status={row.status}/></div></div>):<p className="py-8 text-center text-sm text-slate-500">No payment history recorded.</p>}</div></Modal>

      {/* Add Member Modal */}
      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} title="Register New Gym Member">
        {error && <p className="mb-3 text-sm text-rose-400">{error}</p>}
        <form onSubmit={handleCreateMember} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Full Name</label>
            <input
              type="text"
              required
              className="input-field"
              value={newMember.full_name}
              onChange={(e) => setNewMember({ ...newMember, full_name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Email</label>
              <input
                type="email"
                className="input-field"
                value={newMember.email}
                onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Phone</label>
              <input
                type="tel"
                required
                className="input-field"
                value={newMember.phone}
                onChange={(e) => setNewMember({ ...newMember, phone: e.target.value })}
              />
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-600"><input type="checkbox" className="mt-1 accent-emerald-600" checked={newMember.whatsapp_opt_in} onChange={e=>setNewMember({...newMember,whatsapp_opt_in:e.target.checked})}/><span>Member has explicitly agreed to receive gym updates and renewal reminders on WhatsApp.</span></label>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Initial Membership Plan</label>
            <select
              className="input-field"
              value={newMember.plan_id}
              onChange={(e) => setNewMember({ ...newMember, plan_id: e.target.value })}
            >
              <option value="">-- None (Assign later) --</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} - ₹{Number(p.price).toLocaleString('en-IN')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Payment Method</label>
            <select
              className="input-field"
              value={newMember.payment_method}
              onChange={(e) => setNewMember({ ...newMember, payment_method: e.target.value })}
            >
              <option value="card">Credit / Debit Card</option>
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="upi">UPI / Digital Wallet</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setIsAddOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Create Member
            </button>
          </div>
        </form>
      </Modal>

      {/* Renew / Assign Subscription Modal */}
      <Modal
        isOpen={Boolean(renewMember)}
        onClose={() => setRenewMember(null)}
        title={`Assign Plan — ${renewMember?.full_name || ''}`}
      >
        {error && <p className="mb-3 text-sm text-rose-400">{error}</p>}
        <form onSubmit={handleRenewSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Membership Tier</label>
            <select
              required
              className="input-field"
              value={renewForm.plan_id}
              onChange={(e) => setRenewForm({ ...renewForm, plan_id: e.target.value })}
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (₹{Number(p.price).toLocaleString('en-IN')} / {p.duration_days} days)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Payment Method</label>
            <select
              className="input-field"
              value={renewForm.payment_method}
              onChange={(e) => setRenewForm({ ...renewForm, payment_method: e.target.value })}
            >
              <option value="card">Card</option>
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="upi">UPI</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setRenewMember(null)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Confirm & Record Payment
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
