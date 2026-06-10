import React, { useEffect, useState, useContext } from 'react';
import { Link } from 'react-router-dom';
import api, { fmtDate } from '../api';
import { AuthCtx } from '../App.jsx';
import PageHelp from '../components/PageHelp.jsx';

const STATUS_PILL = {
  PENDING:  'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-800',
};

export default function CdjeDeletionsPage() {
  const user = useContext(AuthCtx);
  const canDecide = ['approver', 'admin'].includes(user?.role);

  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('PENDING');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/iris-cdje-deletions', { params: status ? { status } : {} })
      .then(r => setItems(r.data.items || []))
      .finally(() => setLoading(false));
  };
  useEffect(load, [status]);

  const decide = async (id, action) => {
    const label = action === 'approve' ? 'Approve' : 'Reject';
    const notes = prompt(`${label} request #${id}. Catatan (opsional):`);
    if (notes === null) return;
    try {
      await api.post(`/iris-cdje-deletions/${id}/${action}`, { notes });
      load();
    } catch (e) { alert(`Gagal ${label}: ` + (e.response?.data?.error || e.message)); }
  };

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-semibold flex-1 flex items-center gap-2">
          🔗 Hapus Link Clearing Document
          <PageHelp title="Hapus Link Clearing Document" items={[
            'Daftar request penghapusan baris iris_clearing_document_journal_entries (junction antara clearing document & journal entry).',
            'Search by journal_entry_id — semua baris link dengan je_id tersebut akan dihapus.',
            'Maker membuat request dengan alasan; data MySQL belum dihapus sampai disetujui.',
            'Approver/admin meng-approve atau reject — separation of duty: maker tidak boleh approve sendiri.',
            'Approve menjalankan HARD DELETE (junction table tidak punya soft-delete) secara transaksional.',
            'Semua aksi (CREATE, APPROVE, REJECT, EXECUTE, EXECUTE_FAILED) tercatat di audit log.',
          ]} />
        </h2>
        <Link to="/iris-cdje-deletions/new" className="btn-primary">+ Request Hapus Link</Link>
        <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">Semua status</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>

      <div className="card p-0 overflow-x-auto">
        {loading && <p className="p-4 text-sm opacity-60">Loading…</p>}
        {!loading && items.length === 0 && <p className="p-4 text-sm opacity-60">Tidak ada request.</p>}
        {!loading && items.length > 0 && (
          <table className="min-w-full text-sm">
            <thead className="bg-prestisa-50 text-prestisa-700">
              <tr>
                <th className="text-left px-3 py-2">#</th>
                <th className="text-left px-3 py-2">Journal Entry ID</th>
                <th className="text-right px-3 py-2">Link Rows</th>
                <th className="text-left px-3 py-2">Alasan</th>
                <th className="text-left px-3 py-2">Maker</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Dibuat</th>
                <th className="text-right px-3 py-2">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {items.map(r => (
                <tr key={r.id} className="border-t border-prestisa-50 hover:bg-prestisa-50/40">
                  <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.mysql_journal_entry_id}</td>
                  <td className="px-3 py-2 text-right">{r.row_count}</td>
                  <td className="px-3 py-2 max-w-xs truncate" title={r.reason}>{r.reason}</td>
                  <td className="px-3 py-2 text-xs">{r.created_by_name || r.created_by_username}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 text-xs rounded ${STATUS_PILL[r.status] || ''}`}>{r.status}</span>
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{fmtDate(r.created_at)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link to={`/iris-cdje-deletions/${r.id}`} className="text-prestisa-700 hover:underline">Detail</Link>
                    {canDecide && r.status === 'PENDING' && (
                      <>
                        {' · '}
                        <button onClick={() => decide(r.id, 'approve')} className="text-emerald-700 hover:underline">Approve</button>
                        {' · '}
                        <button onClick={() => decide(r.id, 'reject')} className="text-rose-700 hover:underline">Reject</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
