import React, { useEffect, useState, useContext } from 'react';
import { Link, useParams } from 'react-router-dom';
import api, { fmtIDR, fmtDate, fmtDateOnly } from '../api';
import { AuthCtx } from '../App.jsx';
import PageHelp from '../components/PageHelp.jsx';

export default function CdjeDeletionDetailPage() {
  const { id } = useParams();
  const user = useContext(AuthCtx);
  const canDecide = ['approver', 'admin'].includes(user?.role);

  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get(`/iris-cdje-deletions/${id}`)
      .then(r => setData(r.data))
      .catch(e => setErr(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [id]);

  const decide = async (action) => {
    const notes = prompt(`${action === 'approve' ? 'Approve' : 'Reject'} request #${id}. Catatan (opsional):`);
    if (notes === null) return;
    try {
      await api.post(`/iris-cdje-deletions/${id}/${action}`, { notes });
      load();
    } catch (e) { alert('Gagal: ' + (e.response?.data?.error || e.message)); }
  };

  if (loading) return <p className="text-sm opacity-60">Loading…</p>;
  if (err) return <div className="card p-3 bg-rose-50 text-rose-800 text-sm">{err}</div>;
  if (!data) return null;

  const r = data.request;
  const snap = r.snapshot || {};
  const snapRows = snap.rows || [];
  const keepRows = snap.keep_rows || [];
  return (
    <div className="space-y-4 max-w-5xl">
      <div className="card p-4 flex items-center gap-3 flex-wrap">
        <Link to="/iris-cdje-deletions" className="btn-ghost">← Kembali</Link>
        <h2 className="text-lg font-semibold flex-1 flex items-center gap-2">
          Request Hapus Link #{r.id}
          <PageHelp title="Detail Request" items={[
            'Snapshot menyimpan kondisi semua baris junction saat request dibuat.',
            'Audit Log mencatat seluruh aksi beserta aktor dan waktu.',
            'Status PENDING → bisa Approve / Reject (hanya approver/admin, dan bukan maker sendiri).',
            'Status APPROVED → DELETE di MySQL sudah dijalankan (lihat executed_at).',
            'Status REJECTED → tidak ada perubahan di MySQL.',
          ]} />
        </h2>
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
        <h3 className="font-semibold mb-1">Snapshot Junction Rows</h3>
        <div className="grid grid-cols-2 gap-2">
          <div><span className="opacity-60">Journal Entry ID:</span> <span className="font-mono">{r.mysql_journal_entry_id}</span></div>
          <div><span className="opacity-60">Akan dihapus:</span> <b className="text-rose-700">{snapRows.length}</b> · <span className="opacity-60">Dipertahankan:</span> <b className="text-emerald-700">{keepRows.length}</b></div>
          <div><span className="opacity-60">Captured:</span> {snap.captured_at ? fmtDate(snap.captured_at) : '-'}</div>
        </div>
        {[
          { title: 'Akan Dihapus', items: snapRows, rowClass: 'bg-rose-50/40' },
          { title: 'Dipertahankan', items: keepRows, rowClass: 'bg-emerald-50/40' },
        ].map(group => group.items.length > 0 && (
          <div key={group.title} className="mt-3">
            <p className="text-xs font-semibold opacity-70 mb-1">{group.title} ({group.items.length})</p>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-prestisa-50 text-prestisa-700">
                  <tr>
                    <th className="text-left px-2 py-1">cdje_id</th>
                    <th className="text-left px-2 py-1">cd_id</th>
                    <th className="text-left px-2 py-1">Doc Number</th>
                    <th className="text-left px-2 py-1">Stmt ID</th>
                    <th className="text-left px-2 py-1">Stmt Tgl</th>
                    <th className="text-left px-2 py-1">Akun</th>
                    <th className="text-left px-2 py-1">JE Type/Amount</th>
                    <th className="text-left px-2 py-1">JE Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map(x => (
                    <tr key={x.cdje_id} className={`border-t border-prestisa-50 ${group.rowClass}`}>
                      <td className="px-2 py-1 font-mono">{x.cdje_id}</td>
                      <td className="px-2 py-1 font-mono">{x.clearing_document_id}</td>
                      <td className="px-2 py-1 font-mono">{x.document_number || '-'}</td>
                      <td className="px-2 py-1 font-mono">{x.bank_statement_id || '-'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{x.stmt_date ? fmtDateOnly(x.stmt_date) : '-'}</td>
                      <td className="px-2 py-1">{x.account_number ? `[${x.account_number}] ` : ''}{x.account_name || '-'}</td>
                      <td className="px-2 py-1">{x.je_type} {x.je_amount != null ? fmtIDR(x.je_amount) : ''}</td>
                      <td className="px-2 py-1 max-w-xs truncate" title={x.je_notes}>{x.je_notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
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
        {r.executed_at && <div><span className="opacity-60">Eksekusi (DELETE MySQL):</span> {fmtDate(r.executed_at)}</div>}
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
