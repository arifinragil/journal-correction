import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../api';

function toDateInput(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return '';
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

export default function IrisStatementFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const nav = useNavigate();

  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState({
    account_id: '', description: '', received: 0, spent: 0,
    reconciled: 0, close_balance: '', transaction_date: '',
  });
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/iris-accounts').then(r => setAccounts(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    api.get(`/iris-statements/${id}`).then(r => {
      const d = r.data;
      setForm({
        account_id: d.account_id || '',
        description: d.description || '',
        received: d.received || 0,
        spent: d.spent || 0,
        reconciled: d.reconciled ? 1 : 0,
        close_balance: d.close_balance == null ? '' : d.close_balance,
        transaction_date: toDateInput(d.transaction_date),
      });
    }).catch(e => setErr(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      const payload = {
        account_id: parseInt(form.account_id, 10),
        description: form.description,
        received: Number(form.received) || 0,
        spent: Number(form.spent) || 0,
        reconciled: form.reconciled ? 1 : 0,
        close_balance: form.close_balance === '' ? null : Number(form.close_balance),
        transaction_date: form.transaction_date,
      };
      if (isEdit) await api.put(`/iris-statements/${id}`, payload);
      else        await api.post('/iris-statements', payload);
      nav('/iris-statements');
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally { setSaving(false); }
  };

  if (loading) return <p className="text-sm opacity-60">Loading…</p>;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="card p-4 flex items-center gap-3">
        <Link to="/iris-statements" className="btn-ghost">← Kembali</Link>
        <h2 className="text-lg font-semibold">{isEdit ? `Edit Statement #${id}` : 'Statement Baru'}</h2>
      </div>

      {err && <div className="card p-3 bg-rose-50 text-rose-800 text-sm">{err}</div>}

      <form onSubmit={submit} className="card p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Akun</label>
          <select className="input" required value={form.account_id}
            onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}>
            <option value="">— pilih akun —</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.id} · {a.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Tanggal Transaksi</label>
          <input type="date" className="input" required value={form.transaction_date}
            onChange={e => setForm(f => ({ ...f, transaction_date: e.target.value }))} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Deskripsi</label>
          <textarea className="input" rows={2} value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1 text-emerald-700">Masuk (Received)</label>
            <input type="number" min="0" step="0.01" className="input" value={form.received}
              onChange={e => setForm(f => ({ ...f, received: e.target.value, spent: e.target.value > 0 ? 0 : f.spent }))} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-rose-700">Keluar (Spent)</label>
            <input type="number" min="0" step="0.01" className="input" value={form.spent}
              onChange={e => setForm(f => ({ ...f, spent: e.target.value, received: e.target.value > 0 ? 0 : f.received }))} />
          </div>
        </div>
        <p className="text-xs text-prestisa-500 -mt-2">Hanya salah satu yang boleh terisi.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Close Balance (opsional)</label>
            <input type="number" step="0.01" className="input" value={form.close_balance}
              onChange={e => setForm(f => ({ ...f, close_balance: e.target.value }))} />
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={!!form.reconciled}
                onChange={e => setForm(f => ({ ...f, reconciled: e.target.checked ? 1 : 0 }))} />
              <span className="text-sm">Reconciled</span>
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link to="/iris-statements" className="btn-ghost">Batal</Link>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Menyimpan…' : (isEdit ? 'Simpan Perubahan' : 'Simpan')}
          </button>
        </div>
      </form>
    </div>
  );
}
