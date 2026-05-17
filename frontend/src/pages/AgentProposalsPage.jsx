import React, { useEffect, useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { fmtDate, fmtIDR } from '../api';
import { AuthCtx } from '../App.jsx';

export default function AgentProposalsPage() {
  const user = useContext(AuthCtx);
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/agent-proposals', { params: { status } })
      .then(r => setItems(r.data?.rows || []))
      .finally(() => setLoading(false));
  };
  useEffect(load, [status]);

  const decide = async (id, decision, notes) => {
    setBusy(id);
    try {
      await api.post(`/agent-proposals/${id}/decide`, { decision, notes });
      load();
    } catch (e) {
      alert(e.response?.data?.error || e.message || 'Gagal');
    } finally {
      setBusy(null);
    }
  };

  const convertToCorrection = (p) => {
    // Pre-fill correction form via query params (CorrectionFormPage can read these)
    const seed = encodeURIComponent(JSON.stringify({
      reason: `Agent proposal #${p.id} — ${p.memo || ''} (debit ${p.debit_account}, credit ${p.credit_account}, Rp ${p.amount})`,
      entries: [
        { original_type: 'DEBIT',  original_amount: 0, corrected_type: 'DEBIT',  corrected_amount: Number(p.amount), corrected_account_code: p.debit_account, corrected_notes: p.memo || '' },
        { original_type: 'CREDIT', original_amount: 0, corrected_type: 'CREDIT', corrected_amount: Number(p.amount), corrected_account_code: p.credit_account, corrected_notes: p.memo || '' },
      ],
    }));
    nav(`/corrections/new?seed=${seed}&from_proposal=${p.id}`);
  };

  const canDecide = user && ['maker', 'approver', 'admin'].includes(user.role);
  const canConvert = user && ['maker', 'admin'].includes(user.role);

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:flex-wrap">
        <h2 className="text-lg font-semibold sm:flex-1">🤖 Agent Proposals</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <select className="input w-auto flex-1 sm:flex-none" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="pending">Pending</option>
            <option value="posted">Posted</option>
            <option value="rejected">Rejected</option>
          </select>
          <button className="btn-ghost" onClick={load}>↻ Refresh</button>
        </div>
      </div>

      {loading && <p className="text-sm opacity-60">Loading…</p>}
      {!loading && items.length === 0 && <p className="text-sm opacity-60">Tidak ada proposal {status}.</p>}

      <div className="space-y-2">
        {items.map(p => (
          <div key={p.id} className="card p-4">
            <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
              <div className="flex items-baseline gap-2 flex-wrap min-w-0">
                <span className="text-xs opacity-60">#{p.id}</span>
                <span className="text-sm font-semibold truncate">{p.agent_slug}</span>
                <span className="text-xs opacity-60">· {fmtDate(p.created_at)}</span>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded font-semibold ${
                p.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                p.status === 'posted'  ? 'bg-emerald-100 text-emerald-800' :
                'bg-rose-100 text-rose-800'
              }`}>{p.status}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-3 text-sm mb-3">
              <div><span className="opacity-60 text-xs">Debit: </span><code className="font-mono">{p.debit_account}</code></div>
              <div><span className="opacity-60 text-xs">Credit: </span><code className="font-mono">{p.credit_account}</code></div>
              <div><span className="opacity-60 text-xs">Amount: </span><b className="font-mono">{fmtIDR(p.amount)}</b></div>
            </div>

            {p.memo && <p className="text-sm mb-3 opacity-90 break-words"><span className="opacity-60 text-xs">Memo: </span>{p.memo}</p>}

            {p.status === 'pending' && (canDecide || canConvert) && (
              <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
                {canConvert && (
                  <button
                    disabled={busy === p.id}
                    onClick={() => convertToCorrection(p)}
                    className="btn-primary justify-center">
                    → Convert to Correction
                  </button>
                )}
                {canDecide && (
                  <>
                    <button
                      disabled={busy === p.id}
                      onClick={() => decide(p.id, 'posted', 'manually posted outside system')}
                      className="btn-success justify-center">
                      ✓ Mark posted (manual)
                    </button>
                    <button
                      disabled={busy === p.id}
                      onClick={() => {
                        const r = prompt('Reason for reject?');
                        if (r === null) return;
                        decide(p.id, 'rejected', r || 'rejected');
                      }}
                      className="btn-danger justify-center">
                      ✗ Reject
                    </button>
                  </>
                )}
              </div>
            )}
            {p.status === 'pending' && !canDecide && !canConvert && (
              <p className="text-xs text-prestisa-500 italic">Role Anda tidak memiliki akses untuk action.</p>
            )}

            {p.status === 'posted' && p.posted_at && (
              <p className="text-xs opacity-60">Posted: {fmtDate(p.posted_at)} by user #{p.posted_by}</p>
            )}
            {p.status === 'rejected' && p.rejected_reason && (
              <p className="text-xs opacity-60">Rejected: {p.rejected_reason}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
