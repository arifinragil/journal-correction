import React, { useEffect, useState, useContext } from 'react';
import { Link } from 'react-router-dom';
import api, { fmtDate, fmtIDR, statusPill } from '../api';
import { AuthCtx } from '../App.jsx';
import PageHelp from '../components/PageHelp.jsx';

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
      <div className="card p-3 flex items-center gap-2">
        <h2 className="text-lg font-semibold flex-1">📋 Koreksi Journal</h2>
        <PageHelp title="Koreksi Journal" items={[
          'Daftar request koreksi journal MySQL. Status: DRAFT → PENDING → APPROVED/REJECTED.',
          'Maker: bikin request (+ Koreksi Baru), edit selama masih DRAFT, lalu submit jadi PENDING.',
          'Approver/admin: review request PENDING dan approve/reject (tidak bisa approve sendiri).',
          'Filter pakai search box (ID/alasan), select status, dan checkbox "Milik saya".',
          'Mode CORRECTION mengubah entry existing. Mode ADD_ENTRIES menambahkan entry baru ke journal yang sama.',
        ]} />
      </div>
      <div className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:flex-wrap">
        <input className="input flex-1 sm:min-w-[200px]" placeholder="Cari ID atau alasan…" value={q}
               onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
        <div className="flex items-center gap-3 flex-wrap">
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
        </div>
        {(user.role === 'maker' || user.role === 'admin') && (
          <Link to="/corrections/new" className="btn-primary sm:ml-auto w-full sm:w-auto justify-center">+ Koreksi Baru</Link>
        )}
      </div>

      {/* Mobile: card list */}
      <div className="md:hidden space-y-2">
        {loading && <div className="card p-6 text-center text-prestisa-400">Memuat…</div>}
        {!loading && items.length === 0 && <div className="card p-6 text-center text-prestisa-400">Tidak ada koreksi.</div>}
        {!loading && items.map(it => (
          <Link key={it.id} to={`/corrections/${it.id}`} className="card block p-4 active:bg-prestisa-50/50">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="font-semibold text-prestisa-700 text-sm">{it.correction_journal_id}</span>
              <span className={statusPill(it.status)}>{it.status}</span>
            </div>
            <div className="text-sm text-prestisa-700 line-clamp-2 mb-2">{it.reason}</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <div><span className="text-prestisa-400">Maker:</span> {it.created_by_name}</div>
              <div><span className="text-prestisa-400">Approver:</span> {it.reviewed_by_name || '—'}</div>
              <div><span className="text-prestisa-400">Entries:</span> {it.entry_count}</div>
              <div className="text-right font-mono">{fmtIDR(it.total_debit)}</div>
              <div className="col-span-2 text-prestisa-500">{fmtDate(it.created_at)}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block card overflow-hidden">
        <div className="table-wrap">
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
    </div>
  );
}
