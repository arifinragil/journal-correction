import React, { useEffect, useState, useContext } from 'react';
import { Link } from 'react-router-dom';
import api, { fmtIDR, fmtDateOnly } from '../api';
import { AuthCtx } from '../App.jsx';

export default function IrisStatementsPage() {
  const user = useContext(AuthCtx);
  const canDelete = ['admin', 'approver'].includes(user?.role);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    account_id: '', from: '', to: '', q: '', reconciled: '', limit: 100, offset: 0,
  });
  const [accounts, setAccounts] = useState([]);

  useEffect(() => {
    api.get('/iris-accounts').then(r => setAccounts(r.data || [])).catch(() => {});
  }, []);

  const load = () => {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v !== '' && v != null) params[k] = v; });
    api.get('/iris-statements', { params })
      .then(r => { setItems(r.data.items || []); setTotal(r.data.total || 0); })
      .finally(() => setLoading(false));
  };
  useEffect(load, [filters.limit, filters.offset]);

  const onApplyFilters = (e) => { e.preventDefault(); setFilters(f => ({ ...f, offset: 0 })); load(); };

  const onDelete = async (id) => {
    if (!confirm(`Hapus statement #${id}? (soft delete)`)) return;
    try {
      await api.delete(`/iris-statements/${id}`);
      load();
    } catch (e) { alert('Gagal hapus: ' + (e.response?.data?.error || e.message)); }
  };

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:flex-wrap mb-3">
          <h2 className="text-lg font-semibold sm:flex-1">💳 Account Statements</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <Link to="/iris-statements/bulk-upload" className="btn-ghost">⤴ Bulk Upload Excel</Link>
            <Link to="/iris-statements/new" className="btn-primary">+ Statement Baru</Link>
          </div>
        </div>
        <form className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-2" onSubmit={onApplyFilters}>
          <select
            className="input"
            value={filters.account_id}
            onChange={e => setFilters(f => ({ ...f, account_id: e.target.value }))}
          >
            <option value="">Semua akun</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.account_number ? `[${a.account_number}] ` : ''}{a.name}</option>)}
          </select>
          <input className="input" type="date" value={filters.from}
            onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} placeholder="Dari" />
          <input className="input" type="date" value={filters.to}
            onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} placeholder="Sampai" />
          <select className="input" value={filters.reconciled}
            onChange={e => setFilters(f => ({ ...f, reconciled: e.target.value }))}>
            <option value="">Semua status</option>
            <option value="1">Reconciled</option>
            <option value="0">Belum</option>
          </select>
          <input className="input md:col-span-1" placeholder="Cari deskripsi…" value={filters.q}
            onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} />
          <button className="btn-primary" type="submit">Filter</button>
        </form>
      </div>

      <div className="card p-0 overflow-x-auto">
        {loading && <p className="p-4 text-sm opacity-60">Loading…</p>}
        {!loading && items.length === 0 && <p className="p-4 text-sm opacity-60">Tidak ada data.</p>}
        {!loading && items.length > 0 && (
          <table className="min-w-full text-sm">
            <thead className="bg-prestisa-50 text-prestisa-700">
              <tr>
                <th className="text-left px-3 py-2">ID</th>
                <th className="text-left px-3 py-2">Tanggal</th>
                <th className="text-left px-3 py-2">No. Akun</th>
                <th className="text-left px-3 py-2">Akun</th>
                <th className="text-left px-3 py-2">Deskripsi</th>
                <th className="text-right px-3 py-2">Masuk</th>
                <th className="text-right px-3 py-2">Keluar</th>
                <th className="text-center px-3 py-2">Recon</th>
                <th className="text-right px-3 py-2">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {items.map(r => (
                <tr key={r.id} className="border-t border-prestisa-50 hover:bg-prestisa-50/40">
                  <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDateOnly(r.transaction_date)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.account_number || '-'}</td>
                  <td className="px-3 py-2">{r.account_name || `#${r.account_id}`}</td>
                  <td className="px-3 py-2 max-w-md truncate" title={r.description}>{r.description || '-'}</td>
                  <td className="px-3 py-2 text-right text-emerald-700">{r.received > 0 ? fmtIDR(r.received) : '-'}</td>
                  <td className="px-3 py-2 text-right text-rose-700">{r.spent > 0 ? fmtIDR(r.spent) : '-'}</td>
                  <td className="px-3 py-2 text-center">
                    {r.reconciled ? <span className="inline-block px-2 py-0.5 text-xs rounded bg-emerald-100 text-emerald-800">✓</span>
                                  : <span className="inline-block px-2 py-0.5 text-xs rounded bg-amber-100 text-amber-800">⏳</span>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link to={`/iris-statements/${r.id}`} className="text-prestisa-700 hover:underline">Edit</Link>
                    {canDelete && (
                      <>
                        {' · '}
                        <button onClick={() => onDelete(r.id)} className="text-rose-700 hover:underline">Hapus</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-prestisa-600">
        <span>Total: {total.toLocaleString('id-ID')}</span>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" disabled={filters.offset === 0}
            onClick={() => setFilters(f => ({ ...f, offset: Math.max(0, f.offset - f.limit) }))}>← Prev</button>
          <span>{filters.offset + 1}–{Math.min(filters.offset + filters.limit, total)}</span>
          <button className="btn-ghost" disabled={filters.offset + filters.limit >= total}
            onClick={() => setFilters(f => ({ ...f, offset: f.offset + f.limit }))}>Next →</button>
        </div>
      </div>
    </div>
  );
}
