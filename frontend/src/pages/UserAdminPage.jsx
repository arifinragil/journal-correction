import React, { useEffect, useState } from 'react';
import api, { fmtDate } from '../api';

export default function UserAdminPage() {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ username: '', password: '', full_name: '', role: 'maker' });
  const [err, setErr] = useState('');

  const load = () => api.get('/users').then(r => setUsers(r.data));
  useEffect(load, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api.post('/users', form);
      setForm({ username: '', password: '', full_name: '', role: 'maker' });
      load();
    } catch (e) { setErr(e.response?.data?.error || e.message); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2">
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-prestisa-100 font-semibold text-prestisa-800">
            Users — {users.length}
          </div>
          <table className="data">
            <thead><tr><th>ID</th><th>Username</th><th>Nama</th><th>Role</th><th>Active</th><th>Dibuat</th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td className="font-mono">{u.id}</td>
                  <td className="font-semibold text-prestisa-700">@{u.username}</td>
                  <td>{u.full_name}</td>
                  <td><span className={`pill capitalize ${({maker:'bg-blue-100 text-blue-700',approver:'bg-emerald-100 text-emerald-700',admin:'bg-prestisa-100 text-prestisa-700'})[u.role]}`}>{u.role}</span></td>
                  <td>{u.is_active ? '✓' : '—'}</td>
                  <td className="text-xs text-prestisa-500">{fmtDate(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <form onSubmit={submit} className="card p-5 space-y-3 h-fit">
        <h3 className="font-bold text-prestisa-800">Tambah User</h3>
        {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-3 py-2">{err}</div>}
        <div><label className="label">Username</label><input className="input" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} /></div>
        <div><label className="label">Nama Lengkap</label><input className="input" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} /></div>
        <div><label className="label">Password</label><input type="password" className="input" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} /></div>
        <div><label className="label">Role</label>
          <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
            <option value="maker">Maker</option>
            <option value="approver">Approver</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button className="btn-primary w-full">+ Buat User</button>
      </form>
    </div>
  );
}
