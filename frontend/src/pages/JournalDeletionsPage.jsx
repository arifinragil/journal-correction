import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { fmtDate } from '../api';
import PageHelp from '../components/PageHelp.jsx';

const STATUS_CLASS = {
  PENDING:  'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-800',
};

export default function JournalDeletionsPage() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('PENDING');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/journal-deletions', { params: { status } })
      .then(r => setRows(r.data?.rows || []))
      .finally(() => setLoading(false));
  };
  useEffect(load, [status]);

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:flex-wrap">
        <h2 className="text-lg font-semibold sm:flex-1 flex items-center gap-2">
          🗑 Hapus Journal
          <PageHelp title="Hapus Journal" items={[
            'Daftar request penghapusan journal/entry di MySQL.',
            'Scope JOURNAL → hapus journal beserta semua entry-nya. Scope ENTRY → hanya entry tertentu.',
            'Maker membuat request via "+ Request Baru". Approver/admin approve/reject.',
            'Approve menjalankan soft-delete (deleted_at = NOW) di MySQL secara transaksional dengan separation of duty.',
            'Audit log tercatat per-request: CREATE / APPROVE / REJECT / EXECUTE / EXECUTE_FAILED.',
          ]} />
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <select className="input w-auto" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
          <button className="btn-ghost" onClick={load}>↻ Refresh</button>
          <Link to="/journal-deletions/new" className="btn-primary">+ Request Baru</Link>
        </div>
      </div>

      {loading && <p className="text-sm opacity-60">Loading…</p>}
      {!loading && rows.length === 0 && <p className="text-sm opacity-60">Tidak ada request {status.toLowerCase()}.</p>}

      <div className="card overflow-hidden">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>ID</th><th>Scope</th><th>Journal</th><th>Maker</th>
                <th>Alasan</th><th>Status</th><th>Tanggal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td><Link to={`/journal-deletions/${r.id}`} className="font-semibold text-prestisa-700 hover:underline">#{r.id}</Link></td>
                  <td><span className="pill bg-slate-100 text-slate-700">{r.scope}</span></td>
                  <td>
                    <div className="text-sm">#{r.mysql_journal_id}</div>
                    <div className="text-[11px] text-prestisa-500">{r.journal_entry_id || ''} {r.order_number ? `· ${r.order_number}` : ''}</div>
                  </td>
                  <td>{r.created_by_name}</td>
                  <td className="max-w-xs truncate" title={r.reason}>{r.reason}</td>
                  <td><span className={`pill ${STATUS_CLASS[r.status] || ''}`}>{r.status}</span></td>
                  <td className="text-xs text-prestisa-500">{fmtDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
