import React, { useEffect, useState } from 'react';
import { Award, Plus, Mail, Briefcase } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/Modal';

export default function TrainersPage() {
  const { isAdmin } = useAuth();
  const [trainers, setTrainers] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    specialty: '',
    certificationsText: 'NASM-CPT, CPR/AED',
    experience_years: 3,
    hourly_rate: 65,
    bio: '',
  });

  function loadTrainers() {
    api.getTrainers().then((r) => setTrainers(r.trainers)).catch(console.error);
  }

  useEffect(() => {
    loadTrainers();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    try {
      await api.createTrainer({
        full_name: form.full_name,
        email: form.email,
        phone: form.phone,
        specialty: form.specialty,
        certifications: form.certificationsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        experience_years: Number(form.experience_years),
        hourly_rate: Number(form.hourly_rate),
        bio: form.bio,
      });
      setIsOpen(false);
      loadTrainers();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Coaching & Personal Trainers</h1>
          <p className="text-sm text-slate-400">Certified instructors, specializations, and class assignments</p>
        </div>
        {isAdmin && (
          <button onClick={() => setIsOpen(true)} className="btn-primary">
            <Plus className="w-4 h-4" />
            Add Trainer
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {trainers.map((t) => (
          <div key={t.id} className="card p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-emerald-50 text-emerald-700">
                  <Award className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="font-bold text-white">{t.full_name}</h2>
                  <p className="text-xs font-medium text-emerald-700">{t.specialty}</p>
                </div>
              </div>
              <span className="text-xs font-semibold text-slate-300 bg-slate-800 px-2.5 py-1 rounded">
                ₹{Number(t.hourly_rate).toFixed(0)}/hr
              </span>
            </div>

            <p className="text-sm text-slate-400">{t.bio || 'Dedicated IronPulse performance specialist.'}</p>

            <div className="flex items-center gap-4 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1">
                <Briefcase className="w-3.5 h-3.5" />
                {t.experience_years} yrs exp
              </span>
              <span className="inline-flex items-center gap-1">
                <Mail className="w-3.5 h-3.5" />
                {t.email}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-800">
              {(t.certifications || []).map((c) => (
                <span key={c} className="px-2 py-0.5 text-xs rounded bg-slate-800 text-slate-300">
                  {c}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Onboard New Trainer">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Full Name</label>
              <input
                type="text"
                required
                className="input-field"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Email</label>
              <input
                type="email"
                required
                className="input-field"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Specialty</label>
            <input
              type="text"
              required
              placeholder="e.g., Olympic Weightlifting & Mobility"
              className="input-field"
              value={form.specialty}
              onChange={(e) => setForm({ ...form, specialty: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Certifications (comma-separated)</label>
            <input
              type="text"
              className="input-field"
              value={form.certificationsText}
              onChange={(e) => setForm({ ...form, certificationsText: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Short Bio</label>
            <textarea
              rows={3}
              className="input-field"
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setIsOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Add Trainer
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
