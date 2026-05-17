import React, { useState } from 'react';
import api from '../api';

export default function LoginPage({ onLoggedIn }) {
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const { data } = await api.post('/login', { username, password });
      onLoggedIn(data);
    } catch (e) {
      setErr(e.response?.data?.error || 'Login gagal');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-full flex">
      <div className="hidden md:flex md:w-1/2 bg-gradient-to-br from-prestisa-600 to-prestisa-900 text-white p-12 flex-col justify-between">
        <div>
          <img src="/logo-white.png" className="h-12 mb-10" alt="Prestisa" />
          <h2 className="text-3xl font-extrabold leading-tight">Correction Journals</h2>
          <p className="mt-3 text-prestisa-100 max-w-sm">
            Sistem pengajuan dan persetujuan koreksi jurnal akuntansi Prestisa Group.
            Audit-trail lengkap, segregation of duty, dan integrasi langsung ke data jurnal produksi.
          </p>
        </div>
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-sm text-prestisa-100">
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">✓</div>
            Maker / Approver workflow dengan log lengkap
          </div>
          <div className="flex items-center gap-3 text-sm text-prestisa-100">
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">✓</div>
            Validasi balance debit = credit otomatis
          </div>
          <div className="flex items-center gap-3 text-sm text-prestisa-100">
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">✓</div>
            Lampiran dokumen pendukung
          </div>
          <div className="text-xs text-prestisa-200/70 pt-6 border-t border-white/10">
            Connected With Excellence · journal.prestisa.net
          </div>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-4 md:p-8 bg-prestisa-50/40">
        <form onSubmit={submit} className="card w-full max-w-md p-6 md:p-8">
          <div className="md:hidden text-center mb-5">
            <img src="/logo.png" className="h-12 mx-auto mb-2" alt="Prestisa" />
            <div className="text-[11px] uppercase tracking-widest text-prestisa-500 font-bold">Correction Journals</div>
          </div>
          <h1 className="text-2xl font-bold text-prestisa-800">Masuk</h1>
          <p className="text-sm text-prestisa-500 mb-6">Gunakan akun Finance / Admin Anda.</p>
          {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-3 py-2 mb-3">{err}</div>}
          <div className="mb-3">
            <label className="label" htmlFor="username">Username</label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="input"
              value={username}
              onChange={e => setU(e.target.value)}
              autoFocus
            />
          </div>
          <div className="mb-5">
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              className="input"
              value={password}
              onChange={e => setP(e.target.value)}
            />
          </div>
          <button disabled={busy || !username || !password} className="btn-primary w-full justify-center">{busy ? 'Memproses…' : 'Masuk'}</button>
          <div className="md:hidden text-[11px] text-prestisa-400 text-center mt-6">
            Connected With Excellence · journal.prestisa.net
          </div>
        </form>
      </div>
    </div>
  );
}
