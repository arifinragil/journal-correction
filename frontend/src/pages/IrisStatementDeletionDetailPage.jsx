import React, { useEffect, useState, useContext } from 'react';
import { Link, useParams } from 'react-router-dom';
import api, { fmtIDR, fmtDate, fmtDateOnly } from '../api';
import { AuthCtx } from '../App.jsx';

export default function IrisStatementDeletionDetailPage() {
  const { id } = useParams();
  const user = useContext(AuthCtx);
  const canDecide = ['approver', 'admin'].includes(user?.role);

  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get(`/iris-statement-deletions/${id}`)
      .then(r => setData(r.data))
      .catch(e => setErr(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [id]);

  const decide = async (action) => {
    const notes = prompt(`${action === 'approve' ? 'Approve' : 'Reject'} request #${id}. Catatan (opsional):`);
    if (notes === null) return;
    try {
      await api.post(`/iris-statement-deletions/${id}/${action}`, { notes });
      load();
    } catch (e) { alert('Gagal: ' + (e.response?.data?.error || e.message)); }
  };

  if (loading) return <p className="text-sm opacity-60">Loading…</p>;
  if (err) return <div className="card p-3 bg-rose-50 text-rose-800 text-sm">{err}</div>;
  if (!data) return null;

  const r = data.request;
  const snap = r.snapshot || {};
  return (
    <div className="space-y-4 max-w-4xl">
      <div className="card p-4 flex items-center gap-3 flex-wrap">
        <Link to="/iris-statement-deletions" className="btn-ghost">← Kembali</Link>
        <h2 className="text-lg font-semibold flex-1">Request Hapus #{r.id}</h2>
        <span className={`px-2 py-1 text-xs rounded ${
          r.status === 'PENDING' ? 'bg-amber-100 text-amber-800' :
          r.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' :
          'bg-rose-100 text-rose-800'
        }`}>{r.status}</span>
        {canDecide && r.status === 'PENDING' && (
          <>
            <button onClick={() => decide('approve')} className="btn-primary">Approve</button>
            <button onClick={() => decide('reject')} className="btn-ghost">Reject</button>
          </>
        )}
      </div>

      <div className="card p-4 space-y-2 text-sm">
        <h3 className="font-semibold mb-2">Snapshot Statement</h3>
        <div className="grid grid-cols-2 gap-2">
          <div><span className="opacity-60">MySQL ID:</span> <span className="font-mono">{r.mysql_statement_id}</span></div>
          <div><span className="opacity-60">Tanggal Trx:</span> {snap.transaction_date ? fmtDateOnly(snap.transaction_date) : '-'}</div>
          <div><span className="opacity-60">Akun:</span> {snap.account_number ? `[${snap.account_number}] ` : ''}{snap.account_name || `#${snap.account_id}`}</div>
          <div><span className="opacity-60">Reconciled:</span> {snap.reconciled ? '✓' : '⏳'}</div>
          <div className="col-span-2"><span className="opacity-60">Deskripsi:</span> {snap.description || '-'}</div>
          <div><span className="opacity-60 text-emerald-700">Masuk:</span> {Number(snap.received) > 0 ? fmtIDR(snap.received) : '-'}</div>
          <div><span className="opacity-60 text-rose-700">Keluar:</span> {Number(snap.spent) > 0 ? fmtIDR(snap.spent) : '-'}</div>
          <div><span className="opacity-60">Close Balance:</span> {snap.close_balance != null ? fmtIDR(snap.close_balance) : '-'}</div>
          <div><span className="opacity-60">Captured:</span> {snap.captured_at ? fmtDate(snap.captured_at) : '-'}</div>
        </div>
      </div>

      <div className="card p-4 space-y-2 text-sm">
        <h3 className="font-semibold mb-1">Alasan & Keputusan</h3>
        <div><span className="opacity-60">Maker:</span> {r.created_by_name || r.created_by_username} ({fmtDate(r.created_at)})</div>
        <div><span className="opacity-60">Alasan:</span> {r.reason}</div>
        {r.decided_at && (
          <>
            <div><span className="opacity-60">Decider:</span> {r.decided_by_name || r.decided_by_username} ({fmtDate(r.decided_at)})</div>
            <div><span className="opacity-60">Catatan:</span> {r.decision_notes || '-'}</div>
          </>
        )}
        {r.executed_at && <div><span className="opacity-60">Eksekusi (soft-delete MySQL):</span> {fmtDate(r.executed_at)}</div>}
      </div>

      <div className="card p-4">
        <h3 className="font-semibold mb-2 text-sm">Audit Log</h3>
        <table className="min-w-full text-xs">
          <thead className="bg-prestisa-50 text-prestisa-700">
            <tr>
              <th className="text-left px-2 py-1">#</th>
              <th className="text-left px-2 py-1">Action</th>
              <th className="text-left px-2 py-1">Aktor</th>
              <th className="text-left px-2 py-1">Detail</th>
              <th className="text-left px-2 py-1">Waktu</th>
            </tr>
          </thead>
          <tbody>
            {(data.logs || []).map(l => (
              <tr key={l.id} className="border-t border-prestisa-50">
                <td className="px-2 py-1 font-mono">{l.id}</td>
                <td className="px-2 py-1 font-semibold">{l.action}</td>
                <td className="px-2 py-1">{l.actor_name || l.actor_username}</td>
                <td className="px-2 py-1 font-mono text-[10px] max-w-md truncate" title={JSON.stringify(l.details)}>
                  {l.details ? JSON.stringify(l.details) : '-'}
                </td>
                <td className="px-2 py-1 whitespace-nowrap">{fmtDate(l.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
