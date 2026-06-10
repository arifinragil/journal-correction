import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { fmtIDR, fmtDate, fmtDateOnly } from '../api';
import PageHelp from '../components/PageHelp.jsx';

export default function CdjeDeletionNewPage() {
  const nav = useNavigate();
  const [je, setJe] = useState('');
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [sugLoading, setSugLoading] = useState(true);

  // Default policy:
  //   1) prefer flagged orphans (is_orphan) as the delete set;
  //   2) if no orphans, fall back to "keep latest cdje_id".
  const defaultSelection = (items) => {
    if (!items || items.length === 0) return new Set();
    const orphans = items.filter(r => r.is_orphan).map(r => r.cdje_id);
    if (orphans.length > 0) return new Set(orphans);
    const maxId = Math.max(...items.map(r => r.cdje_id));
    return new Set(items.filter(r => r.cdje_id !== maxId).map(r => r.cdje_id));
  };
  const selectOrphans = () => setSelected(new Set((rows || []).filter(r => r.is_orphan).map(r => r.cdje_id)));
  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set((rows || []).map(r => r.cdje_id)));
  const selectNone = () => setSelected(new Set());
  const selectKeepLatest = () => setSelected(defaultSelection(rows || []));

  useEffect(() => {
    api.get('/iris-cdje/suggestions', { params: { limit: 100 } })
      .then(r => setSuggestions(r.data.items || []))
      .catch(() => {})
      .finally(() => setSugLoading(false));
  }, []);

  const lookupFor = async (jeId) => {
    setErr(''); setRows(null);
    const n = parseInt(jeId, 10);
    if (!Number.isInteger(n) || n <= 0) { setErr('journal_entry_id harus berupa angka'); return; }
    setJe(String(n));
    setBusy(true);
    try {
      const { data } = await api.get('/iris-cdje/lookup', { params: { journal_entry_id: n } });
      const items = data.items || [];
      setRows(items);
      setSelected(defaultSelection(items));
    } catch (e) { setErr(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };
  const lookup = () => lookupFor(je);

  const submit = async () => {
    setErr('');
    if (reason.trim().length < 5) { setErr('Alasan minimal 5 karakter'); return; }
    if (!rows || rows.length === 0) { setErr('Lakukan lookup dulu — tidak ada baris untuk dihapus'); return; }
    if (selected.size === 0) { setErr('Pilih minimal satu baris untuk dihapus'); return; }
    setBusy(true);
    try {
      const { data } = await api.post('/iris-cdje-deletions', {
        journal_entry_id: parseInt(je, 10),
        reason: reason.trim(),
        cdje_ids: Array.from(selected),
      });
      nav(`/iris-cdje-deletions/${data.id}`);
    } catch (e) { setErr(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="card p-4 flex items-center gap-3 flex-wrap">
        <Link to="/iris-cdje-deletions" className="btn-ghost">← Kembali</Link>
        <h2 className="text-lg font-semibold flex-1 flex items-center gap-2">
          + Request Hapus Link Clearing Document
          <PageHelp title="Request Hapus Link" items={[
            'Masukkan journal_entry_id, klik Lookup untuk preview semua baris junction.',
            'Kolom Pair: ORPHAN = junction nempel ke clearing_document yang bukan CD terbaru untuk statement-nya (sisa recon lama) → direkomendasikan hapus (merah).',
            'PAIRED = junction nempel ke CD terbaru → biasanya jangan dihapus (hijau).',
            'Default seleksi: jika ada orphan, semua orphan dipilih; jika tidak ada, baris dengan cdje_id terbesar dipertahankan.',
            'Tombol cepat: Hanya orphan / Keep latest / Centang semua / Hilangkan semua.',
            'Tabel parent iris_clearing_document & iris_account_statements TIDAK ikut dihapus.',
            'Wajib isi alasan minimal 5 karakter; setelah submit, status PENDING menunggu approver/admin.',
          ]} />
        </h2>
      </div>

      <div className="card p-4 space-y-2">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-semibold text-sm flex-1">Suggestion: journal_entry_id dengan link &gt; 1</h3>
          <span className="text-xs opacity-60">{sugLoading ? 'Loading…' : `${suggestions.length} ditemukan`}</span>
        </div>
        {!sugLoading && suggestions.length === 0 && (
          <p className="text-sm opacity-60">Tidak ada journal_entry_id dengan lebih dari satu baris junction.</p>
        )}
        {suggestions.length > 0 && (
          <div className="overflow-x-auto max-h-64 overflow-y-auto border border-prestisa-100 rounded">
            <table className="min-w-full text-xs">
              <thead className="bg-prestisa-50 text-prestisa-700 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1">JE ID</th>
                  <th className="text-right px-2 py-1">Link</th>
                  <th className="text-left px-2 py-1">Akun</th>
                  <th className="text-left px-2 py-1">JE Type/Amount</th>
                  <th className="text-left px-2 py-1">Stmt IDs</th>
                  <th className="text-left px-2 py-1">Doc Numbers</th>
                  <th className="text-left px-2 py-1">JE Notes</th>
                  <th className="text-right px-2 py-1">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map(s => (
                  <tr key={s.journal_entry_id} className="border-t border-prestisa-50 hover:bg-prestisa-50/40">
                    <td className="px-2 py-1 font-mono">{s.journal_entry_id}</td>
                    <td className="px-2 py-1 text-right font-semibold text-rose-700">{s.link_count}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{s.account_number ? `[${s.account_number}] ` : ''}{s.account_name || '-'}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{s.je_type || '-'} {s.je_amount != null ? fmtIDR(s.je_amount) : ''}</td>
                    <td className="px-2 py-1 font-mono">{s.bank_statement_ids || '-'}</td>
                    <td className="px-2 py-1 font-mono">{s.document_numbers || '-'}</td>
                    <td className="px-2 py-1 max-w-xs truncate" title={s.je_notes}>{s.je_notes || '-'}</td>
                    <td className="px-2 py-1 text-right">
                      <button onClick={() => lookupFor(s.journal_entry_id)} className="text-prestisa-700 hover:underline">Pilih</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">Journal Entry ID</label>
            <input
              type="number"
              className="input"
              value={je}
              onChange={e => { setJe(e.target.value); setRows(null); }}
              placeholder="cth: 1000028412"
            />
          </div>
          <button onClick={lookup} className="btn-primary" disabled={busy || !je}>
            {busy ? 'Loading…' : 'Lookup'}
          </button>
        </div>

        {err && <div className="text-sm text-rose-700">{err}</div>}

        {rows !== null && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span><b>{rows.length}</b> baris junction · <b className="text-rose-700">{selected.size}</b> dipilih untuk dihapus · <b className="text-emerald-700">{rows.length - selected.size}</b> dipertahankan.</span>
              {rows.length > 0 && (
                <span className="ml-auto flex gap-1 flex-wrap">
                  <button type="button" onClick={selectOrphans} className="btn-ghost text-xs">Hanya orphan</button>
                  <button type="button" onClick={selectKeepLatest} className="btn-ghost text-xs">Keep latest</button>
                  <button type="button" onClick={selectAll} className="btn-ghost text-xs">Centang semua</button>
                  <button type="button" onClick={selectNone} className="btn-ghost text-xs">Hilangkan semua</button>
                </span>
              )}
            </div>
            {rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-prestisa-50 text-prestisa-700">
                    <tr>
                      <th className="text-center px-2 py-1">Hapus?</th>
                      <th className="text-left px-2 py-1">Pair</th>
                      <th className="text-left px-2 py-1">cdje_id</th>
                      <th className="text-left px-2 py-1">cd_id</th>
                      <th className="text-left px-2 py-1">Doc Number</th>
                      <th className="text-left px-2 py-1">Journal ↔ Stmt</th>
                      <th className="text-left px-2 py-1">Stmt Tgl</th>
                      <th className="text-left px-2 py-1">Akun</th>
                      <th className="text-left px-2 py-1">JE Type/Amount</th>
                      <th className="text-left px-2 py-1">JE Notes</th>
                      <th className="text-left px-2 py-1">CD Deleted?</th>
                      <th className="text-left px-2 py-1">Junction Dibuat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const isSel = selected.has(r.cdje_id);
                      const orphan = r.is_orphan;
                      const warns = (r.pair_warnings || []).join('; ');
                      const rowCls = orphan
                        ? (isSel ? 'bg-rose-200/70' : 'bg-rose-100/60')
                        : (isSel ? 'bg-amber-50/60' : '');
                      return (
                        <tr key={r.cdje_id} className={`border-t border-prestisa-50 ${rowCls}`}>
                          <td className="px-2 py-1 text-center">
                            <input type="checkbox" checked={isSel} onChange={() => toggle(r.cdje_id)} />
                          </td>
                          <td className="px-2 py-1" title={warns}>
                            {orphan
                              ? <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-600 text-white">ORPHAN</span>
                              : <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-600 text-white">PAIRED</span>}
                          </td>
                          <td className="px-2 py-1 font-mono">{r.cdje_id}</td>
                          <td className="px-2 py-1 font-mono">{r.clearing_document_id}</td>
                          <td className="px-2 py-1 font-mono">{r.document_number || '-'}</td>
                          <td className="px-2 py-1 font-mono text-xs">
                            <div>j={r.je_journal_id || '-'} / je={r.journal_entry_id}</div>
                            <div className="opacity-70">stmt={r.bank_statement_id || '-'}</div>
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap">{r.stmt_date ? fmtDateOnly(r.stmt_date) : '-'}</td>
                          <td className="px-2 py-1">{r.account_number ? `[${r.account_number}] ` : ''}{r.account_name || '-'}</td>
                          <td className="px-2 py-1">{r.je_type} {r.je_amount != null ? fmtIDR(r.je_amount) : ''}</td>
                          <td className="px-2 py-1 max-w-xs truncate" title={r.je_notes}>{r.je_notes || '-'}</td>
                          <td className="px-2 py-1 text-xs">{r.cd_deleted_at ? fmtDate(r.cd_deleted_at) : '-'}</td>
                          <td className="px-2 py-1 text-xs">{r.created_at ? fmtDate(r.created_at) : '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Alasan</label>
          <textarea
            className="input w-full"
            rows={3}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Jelaskan kenapa link ini perlu dihapus (min. 5 karakter)…"
          />
        </div>

        <div className="flex justify-end gap-2">
          <Link to="/iris-cdje-deletions" className="btn-ghost">Batal</Link>
          <button
            onClick={submit}
            className="btn-primary"
            disabled={busy || !rows || rows.length === 0 || selected.size === 0 || reason.trim().length < 5}
          >
            {busy ? 'Memproses…' : `Submit Request (${selected.size} hapus)`}
          </button>
        </div>
      </div>
    </div>
  );
}
