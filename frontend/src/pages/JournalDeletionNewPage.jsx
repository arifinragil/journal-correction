import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { fmtIDR } from '../api';
import PageHelp from '../components/PageHelp.jsx';

export default function JournalDeletionNewPage() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null); // {journal, entries, has_correction_reference}
  const [scope, setScope] = useState('JOURNAL');
  const [checked, setChecked] = useState(new Set());
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  const search = async (e) => {
    e?.preventDefault();
    setErr(''); setSearching(true);
    try {
      const { data } = await api.get('/journal-deletions/search', { params: { q } });
      setResults(data.results || []);
      if ((data.results || []).length === 1) pick(data.results[0]);
    } catch (e) {
      setErr(e.response?.data?.error || 'Search gagal');
    } finally { setSearching(false); }
  };

  const pick = (r) => {
    setSelected(r);
    setScope('JOURNAL');
    setChecked(new Set());
    setReason('');
  };

  const toggle = (id) => {
    const next = new Set(checked);
    next.has(id) ? next.delete(id) : next.add(id);
    setChecked(next);
  };

  const balance = useMemo(() => {
    if (!selected || scope !== 'ENTRY') return null;
    let d = 0, c = 0;
    for (const e of selected.entries) {
      if (checked.has(e.id)) continue;
      const a = Number(e.amount);
      if (e.type === 'DEBIT') d += a; else if (e.type === 'CREDIT') c += a;
    }
    return { debit: d, credit: c, imbalance: d - c };
  }, [selected, scope, checked]);

  const submit = async () => {
    setErr('');
    if (!reason.trim()) { setErr('Alasan wajib diisi'); return; }
    if (scope === 'ENTRY' && checked.size === 0) { setErr('Pilih minimal 1 entry'); return; }
    setSubmitting(true);
    try {
      const body = {
        scope,
        mysql_journal_id: selected.journal.id,
        reason,
        ...(scope === 'ENTRY' ? { mysql_entry_ids: [...checked] } : {}),
      };
      const { data } = await api.post('/journal-deletions', body);
      nav(`/journal-deletions/${data.id}`);
    } catch (e) {
      setErr(e.response?.data?.error || 'Gagal submit');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-lg font-semibold flex-1">🗑 Request Hapus Journal</h2>
          <PageHelp title="Request Hapus Journal" items={[
            'Step 1: cari journal berdasarkan Journal ID, Entry ID, atau Order Number.',
            'Step 2: pilih scope — JOURNAL (hapus semua) atau ENTRY (pilih entry tertentu).',
            'Untuk scope ENTRY, sistem menghitung balance setelah hapus (debit vs credit) — periksa imbalance!',
            'Wajib isi alasan. Sistem akan flag jika journal sudah pernah dijadikan sumber correction.',
            'Submit → request status PENDING menunggu approver/admin (bukan diri sendiri).',
          ]} />
        </div>
        <form onSubmit={search} className="flex flex-col sm:flex-row gap-2">
          <input className="input sm:flex-1" placeholder="Cari (ID / Entry ID / Order Number)"
                 value={q} onChange={e => setQ(e.target.value)} autoFocus />
          <button className="btn-primary" disabled={!q.trim() || searching}>
            {searching ? 'Mencari…' : '🔍 Cari'}
          </button>
        </form>
        {err && <div className="mt-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-3 py-2">{err}</div>}
      </div>

      {results.length > 1 && !selected && (
        <div className="card p-4 space-y-2">
          <div className="text-sm font-semibold mb-1">{results.length} journal ditemukan — pilih satu:</div>
          {results.map(r => (
            <button key={r.journal.id} onClick={() => pick(r)} className="w-full text-left p-3 rounded-lg border border-prestisa-100 hover:bg-prestisa-50">
              <div className="font-semibold text-sm">#{r.journal.id} · {r.journal.entry_id}</div>
              <div className="text-xs text-prestisa-500">{r.journal.order_number} — {r.journal.description}</div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <>
          <div className="card p-4">
            <div className="flex items-start justify-between flex-wrap gap-2 mb-3">
              <div>
                <div className="text-xs text-prestisa-500">Journal MySQL</div>
                <div className="font-semibold">#{selected.journal.id} · {selected.journal.entry_id}</div>
                <div className="text-sm text-prestisa-700">{selected.journal.description}</div>
                <div className="text-xs text-prestisa-500 mt-1">
                  {selected.journal.order_number ? `Order ${selected.journal.order_number} · ` : ''}
                  {selected.journal.transaction_date?.slice?.(0, 10)}
                </div>
              </div>
              <button onClick={() => { setSelected(null); setResults([]); }} className="btn-ghost">← Ganti</button>
            </div>

            {selected.has_correction_reference && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2 mb-3">
                ⚠ Journal ini sudah pernah dikoreksi di sistem koreksi. Pastikan reviewer aware.
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 mb-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={scope === 'JOURNAL'} onChange={() => setScope('JOURNAL')} />
                Hapus seluruh journal
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={scope === 'ENTRY'} onChange={() => setScope('ENTRY')} />
                Hapus entry tertentu
              </label>
            </div>

            <div className="table-wrap">
              <table className="data data-compact">
                <thead>
                  <tr>
                    {scope === 'ENTRY' && <th>✓</th>}
                    <th>ID</th><th>Type</th><th>Account</th><th>Notes</th><th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.entries.map(e => (
                    <tr key={e.id} className={scope === 'ENTRY' && checked.has(e.id) ? 'bg-rose-50' : ''}>
                      {scope === 'ENTRY' && (
                        <td><input type="checkbox" checked={checked.has(e.id)} onChange={() => toggle(e.id)} /></td>
                      )}
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

            {scope === 'ENTRY' && balance && (
              <div className={`mt-3 text-sm rounded-lg px-3 py-2 border ${
                balance.imbalance === 0
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}>
                Setelah hapus: Debit <b className="font-mono">{fmtIDR(balance.debit)}</b> ·
                Credit <b className="font-mono">{fmtIDR(balance.credit)}</b> ·
                <b className="font-mono"> Selisih {fmtIDR(balance.imbalance)}</b>
                {balance.imbalance !== 0 && ' (akan tidak balance)'}
              </div>
            )}
          </div>

          <div className="card p-4 space-y-3">
            <label className="label">Alasan</label>
            <textarea className="input min-h-[100px]" value={reason} onChange={e => setReason(e.target.value)}
                      placeholder="Cth: Duplikat dari journal #12300, sudah ada entry yang benar di JV-2025-0099" />
            <div className="flex justify-end">
              <button className="btn-primary" disabled={submitting} onClick={submit}>
                {submitting ? 'Submitting…' : 'Submit Request'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
