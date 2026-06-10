import React, { useState, useContext } from 'react';
import { Link } from 'react-router-dom';
import api, { fmtIDR } from '../api';
import { AuthCtx } from '../App.jsx';
import PageHelp from '../components/PageHelp.jsx';

const firstOfYear = () => `${new Date().getFullYear()}-01-01`;
const today = () => new Date().toISOString().slice(0, 10);

export default function CompanyCodeMismatchPage() {
  const user = useContext(AuthCtx);
  const canMake = user.role === 'maker' || user.role === 'admin';

  const [dateFrom, setDateFrom] = useState(firstOfYear());
  const [dateTo, setDateTo] = useState(today());
  const [safe, setSafe] = useState([]);
  const [complex, setComplex] = useState([]);
  const [sel, setSel] = useState({});          // bank_entry_id -> bool
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState([]);  // { ok, id, correction_journal_id, error, account_number }

  const load = async () => {
    setLoading(true); setErr(''); setResults([]);
    try {
      const { data } = await api.get('/company-code-mismatch', { params: { dateFrom, dateTo } });
      setSafe(data.safe || []);
      setComplex(data.complex || []);
      setSel(Object.fromEntries((data.safe || []).map(s => [s.bank_entry_id, true])));
      setLoaded(true);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  };

  const selectedPairs = safe.filter(s => sel[s.bank_entry_id]);
  const toggle = (id) => setSel(s => ({ ...s, [id]: !s[id] }));
  const allChecked = safe.length > 0 && safe.every(s => sel[s.bank_entry_id]);
  const toggleAll = () => {
    const v = !allChecked;
    setSel(Object.fromEntries(safe.map(s => [s.bank_entry_id, v])));
  };

  const submit = async () => {
    if (selectedPairs.length === 0) return;
    if (!window.confirm(`Buat ${selectedPairs.length} DRAFT koreksi? Status DRAFT — masih perlu Submit & Approve.`)) return;
    setBusy(true); setErr(''); setResults([]);
    const out = [];
    for (const p of selectedPairs) {
      try {
        const { data } = await api.post('/corrections', p.payload);
        out.push({ ok: true, id: data.id, correction_journal_id: data.correction_journal_id, account_number: p.account_number });
      } catch (e) {
        out.push({ ok: false, error: e.response?.data?.error || e.message, account_number: p.account_number, bank_entry_id: p.bank_entry_id });
      }
      setResults([...out]);
    }
    setBusy(false);
    await load(); // refresh — created ones may now be excluded if data shifts
  };

  return (
    <div className="space-y-4">
      <div className="card p-3 flex items-center gap-2">
        <h2 className="text-lg font-semibold flex-1">🏷️ Company Code Mismatch</h2>
        <PageHelp title="Company Code Mismatch" items={[
          'Daftar journal entry di akun BANK yang company_code-nya beda dari company_code master akun.',
          'Penyebab selisih saldo bank: transaksi company lain dibayar lewat rekening company ini.',
          'Tiap pasangan (entry bank + lawannya) di-retag ke company_code pemilik rekening bank.',
          'Klik "Buat DRAFT Koreksi" → muncul di Corrections sebagai DRAFT → Submit → Approve (push ke MySQL).',
          'Pasangan yang tidak unik tampil di bagian "Perlu Cek Manual" dan tidak bisa auto-koreksi.',
        ]} />
      </div>

      <div className="card p-4 flex flex-col sm:flex-row sm:items-end gap-3 sm:flex-wrap">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-prestisa-500">Dari</label>
          <input type="date" className="input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-prestisa-500">Sampai</label>
          <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        <button onClick={load} disabled={loading} className="btn-primary">{loading ? 'Memuat…' : 'Tampilkan'}</button>
        {loaded && (
          <div className="sm:ml-auto text-sm text-prestisa-500">
            {safe.length} pasangan aman · {complex.length} perlu cek manual
          </div>
        )}
      </div>

      {err && <div className="card p-3 text-sm text-red-600 bg-red-50 border border-red-200">{err}</div>}

      {results.length > 0 && (
        <div className="card p-4 space-y-2">
          <h3 className="font-semibold text-sm">Hasil pembuatan DRAFT</h3>
          {results.map((r, i) => (
            <div key={i} className="text-sm flex items-center gap-2">
              {r.ok
                ? <><span className="text-green-600">✓</span> <Link className="text-prestisa-700 underline" to={`/corrections/${r.id}`}>{r.correction_journal_id}</Link> <span className="text-prestisa-400">(acct {r.account_number})</span></>
                : <><span className="text-red-600">✗</span> <span className="text-red-600">acct {r.account_number} entry {r.bank_entry_id}: {r.error}</span></>}
            </div>
          ))}
        </div>
      )}

      {loaded && safe.length > 0 && (
        <div className="card overflow-hidden">
          <div className="p-3 border-b border-prestisa-100 flex items-center gap-3 flex-wrap">
            <h3 className="font-semibold text-sm flex-1">Pasangan Aman ({safe.length})</h3>
            {canMake && (
              <button onClick={submit} disabled={busy || selectedPairs.length === 0} className="btn-primary">
                {busy ? 'Membuat…' : `Buat DRAFT Koreksi (${selectedPairs.length})`}
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-prestisa-50 text-prestisa-500 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left"><input type="checkbox" checked={allChecked} onChange={toggleAll} /></th>
                  <th className="px-3 py-2 text-left">Akun Bank</th>
                  <th className="px-3 py-2 text-left">Master CC</th>
                  <th className="px-3 py-2 text-left">Entry CC</th>
                  <th className="px-3 py-2 text-left">→ Target</th>
                  <th className="px-3 py-2 text-left">Tgl</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-right">Entry / Contra</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-prestisa-100">
                {safe.map(s => (
                  <tr key={s.bank_entry_id} className="hover:bg-prestisa-50/50">
                    <td className="px-3 py-2"><input type="checkbox" checked={!!sel[s.bank_entry_id]} onChange={() => toggle(s.bank_entry_id)} /></td>
                    <td className="px-3 py-2 whitespace-nowrap">{s.account_number} — {s.account_name}</td>
                    <td className="px-3 py-2 text-prestisa-500">{s.master_company_code}</td>
                    <td className="px-3 py-2"><span className="inline-flex rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-medium">{s.entry_company_code}</span></td>
                    <td className="px-3 py-2"><span className="inline-flex rounded-full bg-green-100 text-green-800 px-2 py-0.5 text-xs font-medium">{s.target_company_code}</span></td>
                    <td className="px-3 py-2 whitespace-nowrap">{s.transaction_date}</td>
                    <td className="px-3 py-2">{s.type}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtIDR(s.amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-prestisa-500">{s.bank_entry_id} / {s.contra_entry_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loaded && complex.length > 0 && (
        <div className="card overflow-hidden">
          <div className="p-3 border-b border-prestisa-100">
            <h3 className="font-semibold text-sm">Perlu Cek Manual ({complex.length})</h3>
            <p className="text-xs text-prestisa-400 mt-1">Tidak ada pasangan contra yang unik (kemungkinan intercompany / batch). Koreksi manual via Koreksi Baru.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-prestisa-50 text-prestisa-500 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Akun Bank</th>
                  <th className="px-3 py-2 text-left">Master CC</th>
                  <th className="px-3 py-2 text-left">Entry CC</th>
                  <th className="px-3 py-2 text-left">Tgl</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-right">Entry ID</th>
                  <th className="px-3 py-2 text-right">Kandidat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-prestisa-100">
                {complex.map(c => (
                  <tr key={c.bank_entry_id} className="hover:bg-prestisa-50/50">
                    <td className="px-3 py-2 whitespace-nowrap">{c.account_number} — {c.account_name}</td>
                    <td className="px-3 py-2 text-prestisa-500">{c.master_company_code}</td>
                    <td className="px-3 py-2">{c.entry_company_code}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{c.transaction_date}</td>
                    <td className="px-3 py-2">{c.type}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtIDR(c.amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.bank_entry_id}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.contra_candidates}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loaded && safe.length === 0 && complex.length === 0 && (
        <div className="card p-8 text-center text-sm text-green-700">✓ Tidak ada mismatch company code pada rentang ini.</div>
      )}
    </div>
  );
}
