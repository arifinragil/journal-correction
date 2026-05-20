import React, { useEffect, useState } from 'react';
import api, { fmtDate } from '../api';
import PageHelp from '../components/PageHelp.jsx';

const ROLE_PILL = {
  maker: 'bg-blue-100 text-blue-700',
  approver: 'bg-emerald-100 text-emerald-700',
  admin: 'bg-prestisa-100 text-prestisa-700',
};

function EditUserRow({ u, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState(u.role);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setErr('');
    const body = {};
    if (role !== u.role) body.role = role;
    if (password.trim() !== '') body.password = password;
    if (Object.keys(body).length === 0) { setEditing(false); return; }
    setBusy(true);
    try {
      await api.patch(`/users/${u.id}`, body);
      setPassword('');
      setEditing(false);
      onSaved();
    } catch (e) { setErr(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };

  const cancel = () => { setRole(u.role); setPassword(''); setErr(''); setEditing(false); };

  if (!editing) {
    return (
      <tr>
        <td className="font-mono">{u.id}</td>
        <td className="font-semibold text-prestisa-700">@{u.username}</td>
        <td>{u.full_name}</td>
        <td><span className={`pill capitalize ${ROLE_PILL[u.role]}`}>{u.role}</span></td>
        <td>{u.is_active ? '✓' : '—'}</td>
        <td className="text-xs text-prestisa-500">{fmtDate(u.created_at)}</td>
        <td className="text-right">
          <button onClick={() => setEditing(true)} className="btn-ghost text-xs">Edit</button>
        </td>
      </tr>
    );
  }
  return (
    <tr className="bg-prestisa-50/40">
      <td className="font-mono">{u.id}</td>
      <td className="font-semibold text-prestisa-700">@{u.username}</td>
      <td>{u.full_name}</td>
      <td>
        <select className="input py-1 text-sm" value={role} onChange={e => setRole(e.target.value)} disabled={busy}>
          <option value="maker">Maker</option>
          <option value="approver">Approver</option>
          <option value="admin">Admin</option>
        </select>
      </td>
      <td colSpan={2}>
        <input
          type="password"
          className="input py-1 text-sm"
          placeholder="Password baru (kosong = tidak diubah)"
          value={password}
          onChange={e => setPassword(e.target.value)}
          disabled={busy}
        />
        {err && <div className="text-xs text-rose-600 mt-1">{err}</div>}
      </td>
      <td className="text-right whitespace-nowrap">
        <button onClick={save} disabled={busy} className="btn-primary text-xs px-2 py-1 mr-1">Simpan</button>
        <button onClick={cancel} disabled={busy} className="btn-ghost text-xs px-2 py-1">Batal</button>
      </td>
    </tr>
  );
}

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
          <div className="px-5 py-3 border-b border-prestisa-100 font-semibold text-prestisa-800 flex items-center gap-2">
            <span className="flex-1">Users — {users.length}</span>
            <PageHelp title="User Admin" items={[
              'Kelola user aplikasi: tambah, edit role, aktif/nonaktifkan.',
              'Role: maker (bikin koreksi/request), approver (approve/reject), admin (semua + kelola user).',
              'Untuk reset password user: edit baris user → set password baru.',
              'Setelah toggle Active = false, user tidak bisa login lagi sampai diaktifkan ulang.',
              'Form di kanan untuk tambah user baru.',
            ]} />
          </div>
          <div className="table-wrap"><table className="data min-w-[700px]">
            <thead><tr><th>ID</th><th>Username</th><th>Nama</th><th>Role</th><th>Active</th><th>Dibuat</th><th></th></tr></thead>
            <tbody>
              {users.map(u => (
                <EditUserRow key={u.id} u={u} onSaved={load} />
              ))}
            </tbody>
          </table></div>
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
