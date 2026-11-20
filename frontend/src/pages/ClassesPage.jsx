import React, { useEffect, useState } from 'react';
import { Calendar, Clock, MapPin, Plus, Users } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/Modal';

export default function ClassesPage() {
  const { user, isStaffOrAdmin } = useAuth();
  const [classes, setClasses] = useState([]);
  const [myBookings, setMyBookings] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'Strength',
    trainer_id: '',
    room: 'Studio A',
    day_of_week: 'Monday',
    start_time: '09:00',
    end_time: '10:00',
    capacity: 20,
    difficulty_level: 'All Levels',
  });

  async function loadAll() {
    try {
      const [cRes, bRes, tRes] = await Promise.all([
        api.getClasses(),
        api.getMyBookings(),
        api.getTrainers(),
      ]);
      setClasses(cRes.classes);
      setMyBookings(bRes.bookings);
      setTrainers(tRes.trainers);
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const bookedClassIds = new Set(myBookings.map((b) => b.class_id));

  async function handleBook(classId) {
    try {
      await api.bookClass(classId);
      loadAll();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleCancel(classId) {
    try {
      await api.cancelClassBooking(classId);
      loadAll();
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleCreateClass(e) {
    e.preventDefault();
    try {
      const payload = { ...form };
      if (!payload.trainer_id) delete payload.trainer_id;
      await api.createClass(payload);
      setIsOpen(false);
      loadAll();
    } catch (err) {
      alert(err.message);
    }
  }

  const canCreate = isStaffOrAdmin || user?.role === 'trainer';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Group Classes & Weekly Schedule</h1>
          <p className="text-sm text-slate-400">Reserve a spot in upcoming sessions or manage studio timetables</p>
        </div>
        {canCreate && (
          <button onClick={() => setIsOpen(true)} className="btn-primary">
            <Plus className="w-4 h-4" />
            Add Class
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {classes.map((cls) => {
          const isBooked = bookedClassIds.has(cls.id);
          const spotsLeft = Math.max(0, Number(cls.capacity) - Number(cls.booked_count || 0));

          return (
            <div key={cls.id} className="card p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="px-2.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                    {cls.day_of_week}
                  </span>
                  <span className="text-slate-400">{cls.difficulty_level}</span>
                </div>

                <h2 className="mt-3 text-lg font-bold text-white">{cls.title}</h2>
                <p className="mt-1 text-sm text-slate-400 line-clamp-2">{cls.description}</p>

                <div className="mt-4 space-y-1.5 text-xs text-slate-300">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    <span>
                      {cls.start_time?.slice(0, 5)} – {cls.end_time?.slice(0, 5)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-slate-500" />
                    <span>
                      {cls.room} &bull; Coach {cls.trainer_name || 'Staff'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="w-3.5 h-3.5 text-slate-500" />
                    <span>
                      {cls.booked_count || 0} / {cls.capacity} booked ({spotsLeft} spots left)
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-slate-800">
                {user?.role === 'member' ? (isBooked ? (
                  <button onClick={() => handleCancel(cls.id)} className="btn-secondary w-full text-rose-300">
                    Cancel Reservation
                  </button>
                ) : (
                  <button onClick={() => handleBook(cls.id)} className="btn-primary w-full">
                    <Calendar className="w-4 h-4" />
                    {spotsLeft === 0 ? 'Join Waitlist' : 'Book Spot'}
                  </button>
                )) : <p className="text-center text-xs text-slate-500">Scheduled class · {cls.capacity} spaces</p>}
              </div>
            </div>
          );
        })}
      </div>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Schedule New Fitness Class">
        <form onSubmit={handleCreateClass} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Class Title</label>
            <input
              type="text"
              required
              className="input-field"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Day of Week</label>
              <select
                className="input-field"
                value={form.day_of_week}
                onChange={(e) => setForm({ ...form, day_of_week: e.target.value })}
              >
                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Coach</label>
              <select
                className="input-field"
                value={form.trainer_id}
                onChange={(e) => setForm({ ...form, trainer_id: e.target.value })}
              >
                <option value="">-- Select Coach --</option>
                {trainers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name} ({t.specialty})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Start</label>
              <input
                type="time"
                required
                className="input-field"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">End</label>
              <input
                type="time"
                required
                className="input-field"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Capacity</label>
              <input
                type="number"
                required
                min={1}
                className="input-field"
                value={form.capacity}
                onChange={(e) => setForm({ ...form, capacity: e.target.value })}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setIsOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Publish Class
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
