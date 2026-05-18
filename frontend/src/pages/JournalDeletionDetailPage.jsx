import React, { useContext, useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api, { fmtDate, fmtIDR } from '../api';
import { AuthCtx } from '../App.jsx';

const STATUS_CLASS = {
  PENDING:  'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-800',
};

export default function JournalDeletionDetailPage() {
  const { id } = useParams();
  const user = useContext(AuthCtx);
  const nav = useNavigate();
  const [r, setR] = useState(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = () => api.get(`/journal-deletions/${id}`).then(res => setR(res.data));
  useEffect(() => { load(); }, [id]);

  if (!r) return <p className="text-sm opacity-60">Loading…</p>;

  const snap = r.snapshot || {};
  const journal = snap.journal || {};
  const entries = snap.entries || [];
  const deletedSet = new Set(r.mysql_entry_ids || []);
  const isApprover = ['approver', 'admin'].includes(user.role);
  const isOwn = user.id === r.created_by;
  const canDecide = r.status === 'PENDING' && isApprover && !isOwn;

  const decide = async (action) => {
    setErr(''); setBusy(true);
    try {
      await api.post(`/journal-deletions/${id}/${action}`, { notes });
      await load();
    } catch (e) {
      setErr(e.response?.data?.error || 'Gagal');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-start justify-between flex-wrap gap-2">
        <div>
          <Link to="/journal-deletions" className="text-sm text-prestisa-500 hover:underline">← Kembali</Link>
          <h2 className="text-lg font-semibold mt-1">
            Request #{r.id}
            <span className="ml-2 pill bg-slate-100 text-slate-700">{r.scope}</span>
            <span className={`ml-2 pill ${STATUS_CLASS[r.status]}`}>{r.status}</span>
          </h2>
        </div>
      </div>

      {r.has_correction_reference && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2">
          ⚠ Journal ini sudah pernah dikoreksi di sistem koreksi.
        </div>
      )}

      <div className="card p-4">
        <div className="text-xs text-prestisa-500 mb-1">Snapshot Journal (MySQL #{r.mysql_journal_id})</div>
        <div className="font-semibold">{journal.entry_id} — {journal.description}</div>
        <div className="text-sm text-prestisa-500">
          {journal.order_number ? `Order ${journal.order_number} · ` : ''}
          {journal.transaction_date?.slice?.(0, 10)}
        </div>

        <div className="table-wrap mt-3">
          <table className="data data-compact">
            <thead>
              <tr><th>ID</th><th>Type</th><th>Account</th><th>Notes</th><th className="text-right">Amount</th></tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} className={r.scope === 'ENTRY' && deletedSet.has(e.id) ? 'bg-rose-50' : ''}>
                  <td className="font-mono">{e.id}</td>
                  <td>{e.type}</td>
                  <td><span className="font-mono">{e.account_code}</span> {e.account_name}</td>
                  <td className="max-w-xs truncate" title={e.notes}>{e.notes}</td>
                  <td className="text-right font-mono">{fmtIDR(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {r.balance_after && (
          <div className={`mt-3 text-sm rounded-lg px-3 py-2 border ${
            Number(r.balance_after.imbalance) === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}>
            Setelah eksekusi: Debit <b className="font-mono">{fmtIDR(r.balance_after.debit)}</b> ·
            Credit <b className="font-mono">{fmtIDR(r.balance_after.credit)}</b> ·
            <b className="font-mono"> Selisih {fmtIDR(r.balance_after.imbalance)}</b>
          </div>
        )}
      </div>

      <div className="card p-4">
        <div className="text-xs text-prestisa-500 mb-1">Maker</div>
        <div className="font-semibold">{r.created_by_name}</div>
        <div className="text-xs text-prestisa-500">{fmtDate(r.created_at)}</div>
        <div className="mt-2 text-sm whitespace-pre-wrap">{r.reason}</div>
      </div>

      <div className="card p-4 space-y-3">
        <div className="text-xs text-prestisa-500">Approval</div>
        {r.status === 'PENDING' && isOwn && (
          <p className="text-sm italic text-prestisa-500">
            Anda yang mengajukan request ini — approver lain harus mereview.
          </p>
        )}
        {r.status === 'PENDING' && !isApprover && (
          <p className="text-sm italic text-prestisa-500">Menunggu approver.</p>
        )}
        {canDecide && (
          <>
            <textarea className="input min-h-[80px]" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Catatan (opsional)" />
            {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-3 py-2">{err}</div>}
            <div className="flex flex-col sm:flex-row gap-2 justify-end">
              <button className="btn-danger" disabled={busy} onClick={() => decide('reject')}>✗ Reject</button>
              <button className="btn-success" disabled={busy} onClick={() => decide('approve')}>✓ Approve & Execute</button>
            </div>
          </>
        )}
        {r.status !== 'PENDING' && (
          <div className="text-sm">
            <div><b>{r.status}</b> oleh {r.decided_by_name} · {fmtDate(r.decided_at)}</div>
            {r.decision_notes && <div className="mt-1 italic">"{r.decision_notes}"</div>}
            {r.executed_at && <div className="text-xs text-prestisa-500 mt-1">Executed: {fmtDate(r.executed_at)}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
