import React, { useEffect, useState, useContext, useRef } from 'react';
import { Link } from 'react-router-dom';
import api, { fmtIDR, fmtDateOnly } from '../api';
import { AuthCtx } from '../App.jsx';

function AccountMultiSelect({ accounts, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const boxRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = accounts.filter(a => {
    if (!q) return true;
    const s = q.toLowerCase();
    return String(a.account_number || '').toLowerCase().includes(s)
        || String(a.name || '').toLowerCase().includes(s)
        || String(a.id) === q.trim();
  });
  const toggle = (id) => {
    onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  };
  const label = value.length === 0
    ? 'Semua akun'
    : value.length === 1
      ? (() => { const a = accounts.find(x => x.id === value[0]); return a ? `[${a.account_number || a.id}] ${a.name}` : `#${value[0]}`; })()
      : `${value.length} akun dipilih`;

  return (
    <div className="relative" ref={boxRef}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="input w-full text-left flex items-center justify-between gap-2">
        <span className="truncate">{label}</span>
        <span className="text-xs opacity-50">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-80 max-w-[90vw] bg-white border border-prestisa-200 rounded-lg shadow-lg p-2">
          <input autoFocus type="text" className="input w-full mb-2" placeholder="Cari no akun / nama…"
            value={q} onChange={e => setQ(e.target.value)} />
          <div className="flex items-center justify-between text-xs mb-1 px-1">
            <span className="text-prestisa-500">{filtered.length} akun</span>
            {value.length > 0 && (
              <button type="button" className="text-rose-700 hover:underline" onClick={() => onChange([])}>
                Clear ({value.length})
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 && <p className="text-xs text-prestisa-500 p-2">Tidak ada.</p>}
            {filtered.map(a => (
              <label key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-prestisa-50 cursor-pointer text-sm">
                <input type="checkbox" checked={value.includes(a.id)} onChange={() => toggle(a.id)} />
                <span className="font-mono text-xs text-prestisa-600 w-12 flex-shrink-0">{a.account_number || '-'}</span>
                <span className="truncate">{a.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function IrisStatementsPage() {
  const user = useContext(AuthCtx);
  const canDelete = ['admin', 'approver'].includes(user?.role);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    account_ids: [], from: '', to: '', q: '', reconciled: '', limit: 100, offset: 0,
  });
  const [accounts, setAccounts] = useState([]);

  useEffect(() => {
    api.get('/iris-accounts').then(r => setAccounts(r.data || [])).catch(() => {});
  }, []);

  const load = () => {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => {
      if (k === 'account_ids') {
        if (Array.isArray(v) && v.length > 0) params.account_ids = v.join(',');
      } else if (v !== '' && v != null) params[k] = v;
    });
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
          <div className="md:col-span-2">
            <AccountMultiSelect
              accounts={accounts}
              value={filters.account_ids}
              onChange={(ids) => setFilters(f => ({ ...f, account_ids: ids }))}
            />
          </div>
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
