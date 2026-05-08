import React, { useEffect, useState, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { fmtDate, fmtDateOnly, fmtIDR, statusPill } from '../api';
import { AuthCtx } from '../App.jsx';

function diffCell(a, b) {
  const same = String(a ?? '') === String(b ?? '');
  return same ? '' : 'diff-cell';
}

const ORIG_BG = 'bg-slate-50';
const CORR_BG = 'bg-amber-50/60';

export default function CorrectionDetailPage() {
  const { id } = useParams();
  const user = useContext(AuthCtx);
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null); // { type: 'success'|'error', msg }

  const load = () => api.get(`/corrections/${id}`).then(r => setData(r.data));
  useEffect(load, [id]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  if (!data) return <div className="text-prestisa-400">Memuat…</div>;
  const { header: h, entries, attachments, logs } = data;

  const isReviewer = (user.role === 'approver' || user.role === 'admin') && user.id !== h.created_by;
  const canReview = isReviewer && h.status === 'PENDING';
  const canSubmit = (h.created_by === user.id || user.role === 'admin') && (h.status === 'DRAFT' || h.status === 'REJECTED');

  const totalOrigD = entries.filter(e => e.original_type.toLowerCase() === 'debit').reduce((s, e) => s + Number(e.original_amount), 0);
  const totalOrigC = entries.filter(e => e.original_type.toLowerCase() === 'credit').reduce((s, e) => s + Number(e.original_amount), 0);
  const totalCorrD = entries.filter(e => e.corrected_type.toLowerCase() === 'debit').reduce((s, e) => s + Number(e.corrected_amount), 0);
  const totalCorrC = entries.filter(e => e.corrected_type.toLowerCase() === 'credit').reduce((s, e) => s + Number(e.corrected_amount), 0);

  const act = async (path, body) => {
    setBusy(true);
    try {
      await api.post(`/corrections/${id}/${path}`, body);
      await load();
      setNote('');
      const msg = path === 'approve'
        ? '✓ Koreksi di-APPROVE & journal_entries di MySQL telah ter-update.'
        : path === 'reject'
        ? '✗ Koreksi di-REJECT. Maker dapat melakukan re-submit.'
        : path === 'submit'
        ? '↗ Koreksi disubmit untuk approval.'
        : '✓ Aksi berhasil.';
      setFlash({ type: 'success', msg });
    } catch (e) {
      setFlash({ type: 'error', msg: e.response?.data?.error || e.message });
    }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {flash && (
        <div className={`fixed top-6 right-6 z-50 max-w-sm rounded-xl shadow-lg border px-4 py-3 text-sm font-medium animate-[slidein_0.2s_ease-out] ${
          flash.type === 'success'
            ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
            : 'bg-rose-50 border-rose-300 text-rose-800'
        }`}>
          <div className="flex items-start justify-between gap-3">
            <div>{flash.msg}</div>
            <button onClick={() => setFlash(null)} className="text-prestisa-400 hover:text-prestisa-700 -mt-0.5">×</button>
          </div>
        </div>
      )}
      <div className="card p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-2xl font-extrabold text-prestisa-900 font-mono">{h.correction_journal_id}</h2>
              <span className={statusPill(h.status)}>{h.status}</span>
            </div>
            <div className="text-sm text-prestisa-600 max-w-2xl">{h.reason}</div>
            {h.review_note && (
              <div className={`mt-2 text-sm rounded-lg px-3 py-2 ${h.status === 'REJECTED' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
                <strong>Reviewer note:</strong> {h.review_note}
              </div>
            )}
          </div>
          <button onClick={() => nav('/corrections')} className="btn-ghost">← Back to list</button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm pt-4 border-t border-prestisa-100">
          <div><div className="label">Maker</div><div>{h.created_by_name}</div><div className="text-xs text-prestisa-500">{fmtDate(h.created_at)}</div></div>
          <div><div className="label">Submitted</div><div>{h.submitted_at ? fmtDate(h.submitted_at) : '—'}</div></div>
          <div><div className="label">Approver</div><div>{h.reviewed_by_name || '—'}</div><div className="text-xs text-prestisa-500">{h.reviewed_at ? fmtDate(h.reviewed_at) : ''}</div></div>
          <div><div className="label">Source Journal</div><div className="font-mono">#{h.source_journal_id}</div><div className="text-xs text-prestisa-500">{h.source_journal_entry_id}</div></div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-prestisa-100 font-semibold text-prestisa-800">
          Detail Entries — {entries.length} baris
        </div>
        <table className="data">
          <thead>
            <tr>
              <th rowSpan={2} className="bg-prestisa-50 text-prestisa-700">Entry ID</th>
              <th colSpan={6} className="text-center bg-slate-200 text-slate-700 border-l-2 border-slate-400">ORIGINAL</th>
              <th colSpan={6} className="text-center bg-amber-200/70 text-amber-900 border-l-2 border-amber-400">CORRECTED</th>
            </tr>
            <tr>
              <th className={`${ORIG_BG} border-l-2 border-slate-400`}>Type</th>
              <th className={ORIG_BG}>Account</th>
              <th className={`text-right ${ORIG_BG}`}>Amount</th>
              <th className={ORIG_BG}>Notes</th>
              <th className={ORIG_BG}>Date</th>
              <th className={ORIG_BG}>Co.</th>
              <th className={`${CORR_BG} border-l-2 border-amber-400`}>Type</th>
              <th className={CORR_BG}>Account</th>
              <th className={`text-right ${CORR_BG}`}>Amount</th>
              <th className={CORR_BG}>Notes</th>
              <th className={CORR_BG}>Date</th>
              <th className={CORR_BG}>Co.</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id}>
                <td className="font-mono text-xs text-prestisa-700 bg-prestisa-50/50">#{e.source_journal_entry_id}</td>
                <td className={`${ORIG_BG} border-l-2 border-slate-300`}><span className={`pill ${e.original_type.toLowerCase() === 'debit' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>{e.original_type.toUpperCase()}</span></td>
                <td className={`text-xs ${ORIG_BG}`}><div className="font-mono">{e.original_account_code}</div><div className="text-prestisa-500">{e.original_account_name}</div></td>
                <td className={`text-right font-mono ${ORIG_BG}`}>{fmtIDR(e.original_amount)}</td>
                <td className={`text-xs max-w-[160px] truncate ${ORIG_BG}`} title={e.original_notes}>{e.original_notes}</td>
                <td className={`text-xs ${ORIG_BG}`}>{fmtDateOnly(e.original_transaction_date)}</td>
                <td className={`text-xs ${ORIG_BG}`}>{e.original_company_code}</td>

                <td className={`${CORR_BG} border-l-2 border-amber-400 ${diffCell(e.original_type, e.corrected_type)}`}><span className={`pill ${e.corrected_type.toLowerCase() === 'debit' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>{e.corrected_type.toUpperCase()}</span></td>
                <td className={`text-xs ${CORR_BG} ${diffCell(e.original_account_id, e.corrected_account_id) || diffCell(e.original_account_name, e.corrected_account_name)}`}>
                  <div className="font-mono">{e.corrected_account_code}</div><div className="text-prestisa-500">{e.corrected_account_name}</div>
                </td>
                <td className={`text-right font-mono ${CORR_BG} ${diffCell(e.original_amount, e.corrected_amount)}`}>{fmtIDR(e.corrected_amount)}</td>
                <td className={`text-xs max-w-[160px] truncate ${CORR_BG} ${diffCell(e.original_notes, e.corrected_notes)}`} title={e.corrected_notes}>{e.corrected_notes}</td>
                <td className={`text-xs ${CORR_BG} ${diffCell(e.original_transaction_date, e.corrected_transaction_date)}`}>{fmtDateOnly(e.corrected_transaction_date)}</td>
                <td className={`text-xs ${CORR_BG} ${diffCell(e.original_company_code, e.corrected_company_code)}`}>{e.corrected_company_code}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td colSpan={7} className="text-right text-xs bg-slate-100 border-l-2 border-slate-400">
                Debit: <span className="font-mono">{fmtIDR(totalOrigD)}</span> · Credit: <span className="font-mono">{fmtIDR(totalOrigC)}</span>
              </td>
              <td colSpan={6} className="text-right text-xs bg-amber-100/70 border-l-2 border-amber-400">
                Debit: <span className="font-mono">{fmtIDR(totalCorrD)}</span> · Credit: <span className="font-mono">{fmtIDR(totalCorrC)}</span>
                {Math.abs(totalCorrD - totalCorrC) < 0.01 ? <span className="ml-2 pill-approved">BALANCED</span> : <span className="ml-2 pill-rejected">NOT BALANCED</span>}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5 lg:col-span-2">
          <h3 className="font-semibold text-prestisa-800 mb-3">Timeline</h3>
          <div className="space-y-3">
            {logs.map(l => (
              <div key={l.id} className="flex gap-3">
                <div className={`w-2 h-2 rounded-full mt-2 ${({CREATED:'bg-slate-400',SUBMITTED:'bg-amber-500',APPROVED:'bg-emerald-500',REJECTED:'bg-rose-500',EDITED:'bg-blue-500'})[l.action] || 'bg-prestisa-300'}`} />
                <div className="flex-1">
                  <div className="text-sm"><strong className="text-prestisa-800">{l.action}</strong> oleh <span className="text-prestisa-700">{l.actor_name}</span> <span className="text-xs text-prestisa-500">({l.actor_role})</span></div>
                  <div className="text-xs text-prestisa-500">{fmtDate(l.created_at)}</div>
                  {l.payload_json?.note && <div className="text-xs italic text-prestisa-600 mt-1">"{l.payload_json.note}"</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <h3 className="font-semibold text-prestisa-800 mb-3">Lampiran</h3>
          {attachments.length === 0 && <div className="text-xs text-prestisa-400">Belum ada lampiran.</div>}
          <ul className="space-y-1 text-sm">
            {attachments.map(a => (
              <li key={a.id} className="flex items-center justify-between py-1">
                <a href={`/api/corrections/${id}/attachments/${a.id}`} target="_blank" rel="noreferrer" className="text-prestisa-700 hover:underline">📎 {a.original_name}</a>
                <span className="text-xs text-prestisa-400">{(a.size_bytes / 1024).toFixed(0)} KB</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {(canReview || canSubmit) && (
        <div className="card p-6 bg-prestisa-50/40 border-prestisa-200">
          <h3 className="font-semibold text-prestisa-800 mb-3">Aksi</h3>
          {canSubmit && (
            <button onClick={() => act('submit')} disabled={busy} className="btn-primary mr-2">
              {h.status === 'REJECTED' ? 'Re-submit' : 'Submit untuk Approval'}
            </button>
          )}
          {canReview && (
            <div className="space-y-3">
              <textarea className="input min-h-[60px]" placeholder="Catatan untuk Approve / wajib untuk Reject"
                        value={note} onChange={e => setNote(e.target.value)} />
              <div className="flex gap-3">
                <button onClick={() => act('approve', { note })} disabled={busy} className="btn-success">✓ Approve</button>
                <button onClick={() => act('reject', { note })} disabled={busy || !note.trim()} className="btn-danger">✗ Reject</button>
              </div>
            </div>
          )}
        </div>
      )}
      {h.status === 'PENDING' && user.id === h.created_by && (
        <div className="card p-4 bg-amber-50 border-amber-200 text-amber-800 text-sm">
          ⏳ Menunggu approval. Anda tidak dapat me-review koreksi yang Anda buat sendiri (segregation of duty).
        </div>
      )}
    </div>
  );
}
