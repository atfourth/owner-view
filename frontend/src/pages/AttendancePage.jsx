import React, { useEffect, useState } from 'react';
import { UserCheck, LogOut, QrCode, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api } from '../api/client';
import StatusBadge from '../components/StatusBadge';

export default function AttendancePage() {
  const [logs, setLogs] = useState([]);
  const [identifier, setIdentifier] = useState('');
  const [method, setMethod] = useState('member_code');
  const [feedback, setFeedback] = useState(null);

  function loadLogs() {
    api.getAttendance(false).then((r) => setLogs(r.logs)).catch(console.error);
  }

  useEffect(() => {
    loadLogs();
  }, []);

  async function handleCheckIn(e) {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await api.checkInMember({ identifier, check_in_method: method });
      setFeedback({
        type: 'success',
        text: `Checked in ${res.log.full_name} (${res.log.member_code})`,
      });
      setIdentifier('');
      loadLogs();
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    }
  }

  async function handleCheckOut(logId) {
    try {
      await api.checkOutMember(logId);
      loadLogs();
    } catch (err) {
      alert(err.message);
    }
  }

  const activeCount = logs.filter((l) => !l.check_out_time).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Front-Desk Check-In Terminal</h1>
          <p className="text-sm text-slate-400">
            Verify member status via member code, QR scan, or email &bull; {activeCount} currently on floor
          </p>
        </div>
      </div>

      {/* Quick Check-in Box */}
      <div className="card p-6">
        <form onSubmit={handleCheckIn} className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <QrCode className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              required
              placeholder="Enter Member Code (e.g. MEM-1003) or Email..."
              className="input-field pl-10"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </div>
          <select
            className="input-field md:w-48"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="member_code">Member Code</option>
            <option value="qr_code">QR Scan</option>
            <option value="front_desk">Front Desk Lookup</option>
          </select>
          <button type="submit" className="btn-primary">
            <UserCheck className="w-4 h-4" />
            Check In Member
          </button>
        </form>

        {feedback && (
          <div
            className={`mt-4 p-3 rounded-lg border text-sm flex items-center gap-2 ${
              feedback.type === 'success'
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}
      </div>

      {/* Attendance Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 border-b border-slate-800 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3.5">Member</th>
                <th className="px-5 py-3.5">Plan</th>
                <th className="px-5 py-3.5">Check-In</th>
                <th className="px-5 py-3.5">Check-Out</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="px-5 py-4">
                    <p className="font-semibold text-white">{log.full_name}</p>
                    <p className="text-xs text-slate-400">{log.member_code}</p>
                  </td>
                  <td className="px-5 py-4 text-slate-300">{log.plan_name || 'Standard'}</td>
                  <td className="px-5 py-4 text-slate-300">
                    {new Date(log.check_in_time).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-5 py-4 text-slate-400">
                    {log.check_out_time
                      ? new Date(log.check_out_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : 'On Floor'}
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge status={log.check_out_time ? 'completed' : 'active'} />
                  </td>
                  <td className="px-5 py-4 text-right">
                    {!log.check_out_time && (
                      <button
                        onClick={() => handleCheckOut(log.id)}
                        className="btn-secondary py-1.5 px-3 text-xs"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        Check Out
                      </button>
                    )}
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
