import React, { useEffect, useState } from 'react';
import { Plus, Wrench } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';

export default function EquipmentPage() {
  const { isStaffOrAdmin } = useAuth();
  const [items, setItems] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({
    asset_code: '',
    name: '',
    category: 'Strength',
    brand: '',
    zone: 'Main Floor',
    notes: '',
  });

  function loadEquipment() {
    api.getEquipment().then((r) => setItems(r.equipment)).catch(console.error);
  }

  useEffect(() => {
    loadEquipment();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    try {
      await api.createEquipment(form);
      setIsOpen(false);
      setForm({ asset_code: '', name: '', category: 'Strength', brand: '', zone: 'Main Floor', notes: '' });
      loadEquipment();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleStatusChange(id, status) {
    try {
      await api.updateEquipment(id, {
        status,
        ...(status === 'operational' ? { last_maintenance_date: new Date().toISOString().slice(0, 10) } : {}),
      });
      loadEquipment();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Facility Equipment & Maintenance</h1>
          <p className="text-sm text-slate-400">Track machine readiness, service schedules, and repair tickets</p>
        </div>
        {isStaffOrAdmin && (
          <button onClick={() => setIsOpen(true)} className="btn-primary">
            <Plus className="w-4 h-4" />
            Add Equipment
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 border-b border-slate-800 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-5 py-3.5">Asset Code</th>
                <th className="px-5 py-3.5">Equipment</th>
                <th className="px-5 py-3.5">Zone</th>
                <th className="px-5 py-3.5">Notes</th>
                <th className="px-5 py-3.5">Status</th>
                {isStaffOrAdmin && <th className="px-5 py-3.5 text-right">Update Status</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-5 py-4 font-mono text-xs text-emerald-700">{item.asset_code}</td>
                  <td className="px-5 py-4">
                    <p className="font-semibold text-white">{item.name}</p>
                    <p className="text-xs text-slate-400">
                      {item.brand} {item.model} &bull; {item.category}
                    </p>
                  </td>
                  <td className="px-5 py-4 text-slate-300">{item.zone}</td>
                  <td className="px-5 py-4 text-slate-400 text-xs max-w-xs">{item.notes || '—'}</td>
                  <td className="px-5 py-4">
                    <StatusBadge status={item.status} />
                  </td>
                  {isStaffOrAdmin && (
                    <td className="px-5 py-4 text-right space-x-1.5">
                      <button
                        onClick={() => handleStatusChange(item.id, 'operational')}
                        className="btn-secondary py-1 px-2.5 text-xs text-emerald-300"
                      >
                        Operational
                      </button>
                      <button
                        onClick={() => handleStatusChange(item.id, 'maintenance_needed')}
                        className="btn-secondary py-1 px-2.5 text-xs text-amber-300"
                      >
                        <Wrench className="w-3 h-3" />
                        Service
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Register Facility Equipment">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Asset Code</label>
              <input
                type="text"
                required
                placeholder="EQ-105"
                className="input-field"
                value={form.asset_code}
                onChange={(e) => setForm({ ...form, asset_code: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Category</label>
              <input
                type="text"
                required
                className="input-field"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Equipment Name</label>
            <input
              type="text"
              required
              className="input-field"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Brand</label>
              <input
                type="text"
                className="input-field"
                value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Floor Zone</label>
              <input
                type="text"
                className="input-field"
                value={form.zone}
                onChange={(e) => setForm({ ...form, zone: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Maintenance Notes</label>
            <input
              type="text"
              className="input-field"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setIsOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Save Asset
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
