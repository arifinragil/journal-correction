import React, { useEffect, useState, useContext } from 'react';
import { Link } from 'react-router-dom';
import api, { fmtDate, fmtIDR, statusPill } from '../api';
import { AuthCtx } from '../App.jsx';

export default function CorrectionListPage() {
  const user = useContext(AuthCtx);
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    const params = {};
    if (status) params.status = status;
    if (q) params.q = q;
    if (mine) params.mine = '1';
    api.get('/corrections', { params })
      .then(r => setItems(r.data))
      .finally(() => setLoading(false));
  };
  useEffect(load, [status, mine]);

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-center gap-3 flex-wrap">
        <input className="input flex-1 min-w-[200px]" placeholder="Cari ID atau alasan…" value={q}
               onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
        <select className="input w-auto" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">Semua status</option>
          <option value="DRAFT">Draft</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-prestisa-700">
          <input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> Milik saya
        </label>
        <button onClick={load} className="btn-ghost">Cari</button>
        {(user.role === 'maker' || user.role === 'admin') && (
          <Link to="/corrections/new" className="btn-primary ml-auto">+ Koreksi Baru</Link>
        )}
      </div>

      <div className="card overflow-hidden">
        <table className="data">
          <thead>
            <tr>
              <th>ID Koreksi</th><th>Status</th><th>Maker</th><th>Approver</th>
              <th>Alasan</th><th className="text-right">Entries</th><th className="text-right">Total Debit</th>
              <th>Dibuat</th><th>Submit</th><th>Reviewed</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="text-center py-10 text-prestisa-400">Memuat data koreksi…</td></tr>}
            {!loading && items.map(it => (
              <tr key={it.id}>
                <td><Link to={`/corrections/${it.id}`} className="font-semibold text-prestisa-700 hover:underline">{it.correction_journal_id}</Link></td>
                <td><span className={statusPill(it.status)}>{it.status}</span></td>
                <td>{it.created_by_name}</td>
                <td className="text-prestisa-500">{it.reviewed_by_name || '—'}</td>
                <td className="max-w-xs truncate" title={it.reason}>{it.reason}</td>
                <td className="text-right">{it.entry_count}</td>
                <td className="text-right font-mono">{fmtIDR(it.total_debit)}</td>
                <td className="text-xs text-prestisa-500">{fmtDate(it.created_at)}</td>
                <td className="text-xs text-prestisa-500">{it.submitted_at ? fmtDate(it.submitted_at) : '—'}</td>
                <td className="text-xs text-prestisa-500">{it.reviewed_at ? fmtDate(it.reviewed_at) : '—'}</td>
              </tr>
            ))}
            {!loading && items.length === 0 && <tr><td colSpan={10} className="text-center py-10 text-prestisa-400">Tidak ada koreksi.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
