import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { fmtIDR } from '../api';

function StepIndicator({ step }) {
  const steps = ['Lookup Journal', 'Edit Entries', 'Review & Submit'];
  return (
    <div className="flex items-center gap-2 mb-4 md:mb-6">
      {steps.map((s, i) => {
        const active = i + 1 === step;
        const done = i + 1 < step;
        return (
          <React.Fragment key={s}>
            <div className={`flex items-center gap-2 px-3 md:px-4 py-2 rounded-full text-sm font-medium ${active ? 'bg-prestisa text-white shadow-sm' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-prestisa-50 text-prestisa-500'}`}>
              <span className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-bold ${active ? 'bg-white text-prestisa' : done ? 'bg-emerald-500 text-white' : 'bg-white text-prestisa-400'}`}>
                {done ? '✓' : i + 1}
              </span>
              <span className={active ? 'inline' : 'hidden md:inline'}>{s}</span>
            </div>
            {i < steps.length - 1 && <div className="flex-1 h-px bg-prestisa-100" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function balanceOf(entries, typeKey, amtKey) {
  const d = entries.filter(e => (e[typeKey] || '').toLowerCase() === 'debit').reduce((s, e) => s + Number(e[amtKey] || 0), 0);
  const c = entries.filter(e => (e[typeKey] || '').toLowerCase() === 'credit').reduce((s, e) => s + Number(e[amtKey] || 0), 0);
  return { d, c, ok: Math.abs(d - c) < 0.01 };
}

function blankAddEntry(journalInfo) {
  return {
    source_journal_entry_id: null,
    corrected_type: 'Debit',
    corrected_amount: 0,
    corrected_account_id: null,
    corrected_account_code: '',
    corrected_account_name: '',
    corrected_notes: '',
    corrected_transaction_date: journalInfo?.transaction_date || null,
    corrected_company_code: journalInfo?.company_code || '',
  };
}

export default function CorrectionFormPage() {
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState('CORRECTION'); // CORRECTION | ADD_ENTRIES
  const [lookupId, setLookupId] = useState('');
  const [lookupMode, setLookupMode] = useState('journal'); // journal | entry
  const [journalInfo, setJournalInfo] = useState(null);
  const [entries, setEntries] = useState([]);
  const [reason, setReason] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [acctSearch, setAcctSearch] = useState({});
  const [acctOptions, setAcctOptions] = useState({});

  const isAdd = mode === 'ADD_ENTRIES';

  const lookup = async () => {
    setErr(''); setBusy(true);
    try {
      let raw, header;
      if (lookupMode === 'journal') {
        const { data } = await api.get(`/journal/${lookupId}/entries`);
        raw = data;
        header = {
          journal_id: data[0].journal_id, journal_entry_id: data[0].journal_entry_id,
          order_number: data[0].order_number, pr_finance_id: data[0].pr_finance_id,
          journal_description: data[0].journal_description,
          transaction_date: data[0].transaction_date ? data[0].transaction_date.slice(0, 10) : null,
          company_code: data[0].company_code,
        };
      } else {
        const { data } = await api.get(`/journal-entries/${lookupId}`);
        const { data: all } = await api.get(`/journal/${data.journal_id}/entries`);
        raw = all;
        header = {
          journal_id: data.journal_id, journal_entry_id: data.journal_entry_id,
          order_number: data.order_number, pr_finance_id: data.pr_finance_id,
          journal_description: data.journal_description,
          transaction_date: data.transaction_date ? data.transaction_date.slice(0, 10) : null,
          company_code: data.company_code,
        };
      }
      setJournalInfo(header);
      if (isAdd) {
        // Start with 2 blank rows (debit + credit) — user fills both
        const blank = blankAddEntry(header);
        setEntries([{ ...blank, corrected_type: 'Debit' }, { ...blank, corrected_type: 'Credit' }]);
      } else {
        const mapped = raw.map(e => ({
          source_journal_entry_id: e.id,
          original_type: e.type, original_amount: Number(e.amount),
          original_account_id: e.account_id, original_account_code: e.account_code, original_account_name: e.account_name,
          original_notes: e.notes || '',
          original_transaction_date: e.transaction_date ? e.transaction_date.slice(0, 10) : null,
          original_company_code: e.company_code,
          corrected_type: e.type, corrected_amount: Number(e.amount),
          corrected_account_id: e.account_id, corrected_account_code: e.account_code, corrected_account_name: e.account_name,
          corrected_notes: e.notes || '',
          corrected_transaction_date: e.transaction_date ? e.transaction_date.slice(0, 10) : null,
          corrected_company_code: e.company_code,
        }));
        setEntries(mapped);
      }
      setStep(2);
    } catch (e) { setErr(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };

  const updateEntry = (i, patch) => setEntries(es => es.map((e, j) => j === i ? { ...e, ...patch } : e));
  const removeEntry = (i) => setEntries(es => es.filter((_, j) => j !== i));
  const addBlankEntry = () => setEntries(es => [...es, blankAddEntry(journalInfo)]);

  const searchAccount = async (i, q) => {
    setAcctSearch(s => ({ ...s, [i]: q }));
    if (q.length < 2) return setAcctOptions(o => ({ ...o, [i]: [] }));
    const { data } = await api.get('/accounts', { params: { q } });
    setAcctOptions(o => ({ ...o, [i]: data }));
  };
  const pickAccount = (i, acct) => {
    updateEntry(i, { corrected_account_id: acct.id, corrected_account_code: acct.code, corrected_account_name: acct.name });
    setAcctSearch(s => ({ ...s, [i]: '' }));
    setAcctOptions(o => ({ ...o, [i]: [] }));
  };

  const origBal = balanceOf(entries, 'original_type', 'original_amount');
  const corrBal = balanceOf(entries, 'corrected_type', 'corrected_amount');

  const allAccountsPicked = entries.every(e => e.corrected_account_id);
  const canProceed3 = entries.length >= 2
    && (isAdd || origBal.ok)
    && corrBal.ok
    && reason.trim().length >= 10
    && allAccountsPicked
    && entries.every(e => Number(e.corrected_amount) > 0);

  const submit = async (action) => {
    setErr(''); setBusy(true);
    try {
      const payload = {
        mode,
        reason: reason.trim(),
        source_journal_id: journalInfo.journal_id,
        source_journal_entry_id: isAdd ? null : journalInfo.journal_entry_id,
        entries,
      };
      const { data } = await api.post('/corrections', payload);
      if (files.length > 0) {
        const fd = new FormData();
        for (const f of files) fd.append('files', f);
        await api.post(`/corrections/${data.id}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      if (action === 'submit') await api.post(`/corrections/${data.id}/submit`);
      nav(`/corrections/${data.id}`);
    } catch (e) { setErr(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <StepIndicator step={step} />
      {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-3 py-2">{err}</div>}

      {step === 1 && (
        <div className="card p-5 md:p-8 max-w-4xl">
          <h2 className="text-lg md:text-xl font-bold text-prestisa-800 mb-1">Buat Koreksi Journal</h2>
          <p className="text-sm text-prestisa-500 mb-4">Pilih mode dan masukkan ID journal/entry dari sistem produksi.</p>

          <div className="mb-5">
            <div className="label mb-2">Mode</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className={`cursor-pointer border rounded-lg px-3 py-3 text-sm flex gap-3 items-start ${mode === 'CORRECTION' ? 'border-prestisa bg-prestisa-50/40' : 'border-prestisa-100'}`}>
                <input type="radio" className="mt-1" checked={mode === 'CORRECTION'} onChange={() => setMode('CORRECTION')} />
                <div>
                  <div className="font-semibold text-prestisa-800">Koreksi Entry Existing</div>
                  <div className="text-xs text-prestisa-500">Replace value entry yang sudah ada (workflow standar).</div>
                </div>
              </label>
              <label className={`cursor-pointer border rounded-lg px-3 py-3 text-sm flex gap-3 items-start ${mode === 'ADD_ENTRIES' ? 'border-prestisa bg-prestisa-50/40' : 'border-prestisa-100'}`}>
                <input type="radio" className="mt-1" checked={mode === 'ADD_ENTRIES'} onChange={() => setMode('ADD_ENTRIES')} />
                <div>
                  <div className="font-semibold text-prestisa-800">Tambah Entry Baru</div>
                  <div className="text-xs text-prestisa-500">Append entry baru ke parent journal (debit/credit harus balance).</div>
                </div>
              </label>
            </div>
          </div>

          <div className="flex flex-col md:grid md:grid-cols-12 gap-3 mb-3">
            <select className="input md:col-span-3" value={lookupMode} onChange={e => setLookupMode(e.target.value)}>
              <option value="journal">Journal ID</option>
              <option value="entry">Journal Entry ID</option>
            </select>
            <input
              className="input md:col-span-7 text-base"
              inputMode="numeric"
              placeholder={lookupMode === 'journal' ? 'cth: 339281' : 'cth: 4102223'}
              value={lookupId}
              onChange={e => setLookupId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && lookupId && !busy && lookup()}
              autoFocus
            />
            <button onClick={lookup} disabled={!lookupId || busy} className="btn-primary md:col-span-2 justify-center">
              {busy ? 'Mencari…' : 'Lookup →'}
            </button>
          </div>
          <div className="text-xs text-prestisa-500 bg-prestisa-50 rounded-lg px-3 py-2">
            💡 {isAdd
              ? 'ADD mode: lookup hanya untuk validasi parent journal. Entries di-input dari kosong.'
              : 'Lookup membaca DB MySQL produksi (read-only). Snapshot original akan di-freeze ke koreksi ini.'}
          </div>
        </div>
      )}

      {step === 2 && (
        <>
          <div className="card p-4 md:p-5 bg-prestisa-50/40">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4 text-sm">
              <div><div className="label">Mode</div><div className="font-semibold">{isAdd ? 'ADD_ENTRIES' : 'CORRECTION'}</div></div>
              <div><div className="label">Journal ID</div><div className="font-mono font-semibold">#{journalInfo.journal_id}</div></div>
              <div><div className="label">Entry ID</div><div className="font-mono">{journalInfo.journal_entry_id}</div></div>
              <div><div className="label">Order Number</div><div className="font-mono">{journalInfo.order_number || '—'}</div></div>
              <div className="col-span-2 md:col-span-1"><div className="label">Description</div><div className="truncate" title={journalInfo.journal_description}>{journalInfo.journal_description}</div></div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="px-4 md:px-5 py-3 border-b border-prestisa-100 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <h3 className="font-semibold text-prestisa-800">{isAdd ? 'Entries Baru — Input dari kosong' : 'Entries — Edit nilai koreksi'}</h3>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs md:text-sm">
                {!isAdd && (
                  <span>Original: <span className={origBal.ok ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>{origBal.ok ? 'BALANCED' : 'NOT BALANCED'}</span></span>
                )}
                <span>{isAdd ? 'Total' : 'Corrected'}: <span className={corrBal.ok ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>{corrBal.ok ? 'BALANCED' : `Δ ${fmtIDR(corrBal.d - corrBal.c)}`}</span></span>
              </div>
            </div>

            {/* Mobile: card per entry */}
            <div className="md:hidden divide-y divide-prestisa-100">
              {entries.map((e, i) => (
                <div key={i} className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-prestisa-400">Entry #{i + 1}</div>
                    {isAdd && entries.length > 2 && (
                      <button onClick={() => removeEntry(i)} className="text-rose-600 text-xs hover:underline">Hapus</button>
                    )}
                  </div>

                  {!isAdd && (
                    <div className="bg-slate-50 rounded-lg p-3 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-prestisa-500 uppercase text-[10px] font-bold">Original</span>
                        <span className={`pill ${e.original_type.toLowerCase() === 'debit' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>{e.original_type.toUpperCase()}</span>
                      </div>
                      <div><span className="text-prestisa-400">Akun: </span><span className="font-mono">{e.original_account_code}</span> · {e.original_account_name}</div>
                      <div><span className="text-prestisa-400">Amount: </span><span className="font-mono font-semibold">{fmtIDR(e.original_amount)}</span></div>
                      {e.original_notes && <div><span className="text-prestisa-400">Notes: </span>{e.original_notes}</div>}
                    </div>
                  )}

                  <div className="bg-amber-50/60 rounded-lg p-3 space-y-2">
                    <div className="text-prestisa-700 uppercase text-[10px] font-bold">{isAdd ? 'New Entry' : 'Corrected'}</div>
                    <div>
                      <label className="label">Type</label>
                      <select className="input" value={e.corrected_type} onChange={ev => updateEntry(i, { corrected_type: ev.target.value })}>
                        <option>Debit</option><option>Credit</option>
                      </select>
                    </div>
                    <div className="relative">
                      <label className="label">Account</label>
                      {e.corrected_account_id && (
                        <div className="text-xs mb-1"><span className="font-mono">{e.corrected_account_code}</span> · <span className="text-prestisa-500">{e.corrected_account_name}</span></div>
                      )}
                      <input className="input" placeholder="cari akun…" value={acctSearch[i] || ''} onChange={ev => searchAccount(i, ev.target.value)} />
                      {acctOptions[i] && acctOptions[i].length > 0 && (
                        <div className="absolute z-10 mt-1 left-0 right-0 bg-white border border-prestisa-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                          {acctOptions[i].map(a => (
                            <button key={a.id} type="button" onClick={() => pickAccount(i, a)} className="w-full text-left px-3 py-2 hover:bg-prestisa-50 text-sm border-b border-prestisa-50 last:border-0">
                              <span className="font-mono text-xs">{a.code}</span> · {a.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="label">Amount</label>
                      <input type="number" inputMode="decimal" className="input text-right font-mono" value={e.corrected_amount} onChange={ev => updateEntry(i, { corrected_amount: parseFloat(ev.target.value) || 0 })} />
                    </div>
                    <div>
                      <label className="label">Notes</label>
                      <input className="input" value={e.corrected_notes} onChange={ev => updateEntry(i, { corrected_notes: ev.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="label">Date</label>
                        <input type="date" className="input" value={e.corrected_transaction_date || ''} onChange={ev => updateEntry(i, { corrected_transaction_date: ev.target.value })} />
                      </div>
                      <div>
                        <label className="label">Co.</label>
                        <input className="input" value={e.corrected_company_code || ''} onChange={ev => updateEntry(i, { corrected_company_code: ev.target.value })} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {isAdd && (
                <div className="p-4">
                  <button onClick={addBlankEntry} className="btn-ghost w-full justify-center">+ Tambah Entry</button>
                </div>
              )}
            </div>

            {/* Desktop: table */}
            <div className="hidden md:block table-wrap">
              <table className={`data ${isAdd ? 'min-w-[800px]' : 'min-w-[1000px]'}`}>
                <thead>
                  {!isAdd && (
                    <tr>
                      <th colSpan={4} className="text-center bg-slate-100">ORIGINAL (snapshot — read-only)</th>
                      <th colSpan={6} className="text-center bg-amber-50">CORRECTED (edit di sini)</th>
                    </tr>
                  )}
                  <tr>
                    {!isAdd && <><th>Type</th><th>Account</th><th className="text-right">Amount</th><th>Notes</th></>}
                    <th>{isAdd ? '#' : 'Type'}</th>
                    {isAdd && <th>Type</th>}
                    <th>Account</th><th className="text-right">Amount</th><th>Notes</th><th>Date</th><th>Co.</th>
                    {isAdd && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => (
                    <tr key={i}>
                      {!isAdd && (
                        <>
                          <td><span className={`pill ${e.original_type.toLowerCase() === 'debit' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>{e.original_type.toUpperCase()}</span></td>
                          <td className="text-xs"><div className="font-mono">{e.original_account_code}</div><div className="text-prestisa-500">{e.original_account_name}</div></td>
                          <td className="text-right font-mono">{fmtIDR(e.original_amount)}</td>
                          <td className="text-xs max-w-[180px] truncate" title={e.original_notes}>{e.original_notes}</td>
                        </>
                      )}
                      {isAdd && <td className="text-xs text-prestisa-400">{i + 1}</td>}
                      <td>
                        <select className="input !py-1 !text-xs" value={e.corrected_type} onChange={ev => updateEntry(i, { corrected_type: ev.target.value })}>
                          <option>Debit</option><option>Credit</option>
                        </select>
                      </td>
                      <td className="relative">
                        {e.corrected_account_id && (
                          <div className="text-xs"><div className="font-mono">{e.corrected_account_code}</div><div className="text-prestisa-500">{e.corrected_account_name}</div></div>
                        )}
                        <input className="input !py-1 !text-xs mt-1" placeholder="cari akun…" value={acctSearch[i] || ''} onChange={ev => searchAccount(i, ev.target.value)} />
                        {acctOptions[i] && acctOptions[i].length > 0 && (
                          <div className="absolute z-10 mt-1 w-72 bg-white border border-prestisa-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                            {acctOptions[i].map(a => (
                              <button key={a.id} type="button" onClick={() => pickAccount(i, a)} className="w-full text-left px-3 py-1.5 hover:bg-prestisa-50 text-xs">
                                <span className="font-mono">{a.code}</span> · {a.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td><input type="number" className="input !py-1 text-right font-mono" value={e.corrected_amount} onChange={ev => updateEntry(i, { corrected_amount: parseFloat(ev.target.value) || 0 })} /></td>
                      <td><input className="input !py-1 !text-xs" value={e.corrected_notes} onChange={ev => updateEntry(i, { corrected_notes: ev.target.value })} /></td>
                      <td><input type="date" className="input !py-1 !text-xs" value={e.corrected_transaction_date || ''} onChange={ev => updateEntry(i, { corrected_transaction_date: ev.target.value })} /></td>
                      <td><input className="input !py-1 !text-xs w-20" value={e.corrected_company_code || ''} onChange={ev => updateEntry(i, { corrected_company_code: ev.target.value })} /></td>
                      {isAdd && (
                        <td>
                          {entries.length > 2 && (
                            <button onClick={() => removeEntry(i)} className="text-rose-600 text-xs hover:underline">×</button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {isAdd && (
                <div className="p-3 border-t border-prestisa-100">
                  <button onClick={addBlankEntry} className="btn-ghost">+ Tambah Entry</button>
                </div>
              )}
            </div>
          </div>

          <div className="card p-4 md:p-5">
            <label className="label">Alasan {isAdd ? 'Penambahan Entry' : 'Koreksi'} (wajib, min 10 karakter)</label>
            <textarea className="input min-h-[80px]" value={reason} onChange={e => setReason(e.target.value)}
                      placeholder={isAdd ? 'Jelaskan kenapa entry ini perlu ditambahkan…' : 'Jelaskan apa yang salah dan kenapa perlu dikoreksi…'} />
            <div className="text-xs text-prestisa-400 mt-1">{reason.length} / 10+ karakter</div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2">
            <button onClick={() => setStep(1)} className="btn-ghost justify-center">← Kembali</button>
            <button onClick={() => setStep(3)} disabled={!canProceed3} className="btn-primary justify-center">Lanjut Review →</button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <div className="card p-4 md:p-6">
            <h3 className="font-bold text-prestisa-800 mb-4">Review & Submit</h3>
            <div className="grid md:grid-cols-2 gap-4 md:gap-6">
              <div>
                <div className="label">Mode</div>
                <div className="font-semibold">{isAdd ? 'ADD_ENTRIES (tambah entry baru)' : 'CORRECTION (replace entries)'}</div>
                <div className="label mt-3">Source Journal</div>
                <div className="font-mono text-sm">#{journalInfo.journal_id} · {journalInfo.journal_entry_id}</div>
                <div className="label mt-3">Order / PR</div>
                <div className="text-sm">{journalInfo.order_number || '—'} · {journalInfo.pr_finance_id || '—'}</div>
                <div className="label mt-3">Description</div>
                <div className="text-sm">{journalInfo.journal_description}</div>
              </div>
              <div>
                <div className="label">Alasan</div>
                <div className="text-sm bg-prestisa-50/60 rounded-lg px-3 py-2">{reason}</div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div className="bg-emerald-50 rounded-lg px-3 py-2">
                    <div className="text-xs text-emerald-700">Total Debit</div>
                    <div className="font-mono font-bold text-emerald-800">{fmtIDR(corrBal.d)}</div>
                  </div>
                  <div className="bg-emerald-50 rounded-lg px-3 py-2">
                    <div className="text-xs text-emerald-700">Total Credit</div>
                    <div className="font-mono font-bold text-emerald-800">{fmtIDR(corrBal.c)}</div>
                  </div>
                </div>
                <div className="text-xs text-prestisa-500 mt-2">{entries.length} entries</div>
              </div>
            </div>

            <div className="mt-6">
              <div className="label">Lampiran (opsional, max 5 file × 5MB)</div>
              <input type="file" multiple onChange={e => setFiles(Array.from(e.target.files || []))}
                     accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.docx,.doc"
                     className="block text-sm text-prestisa-700 file:mr-3 file:px-3 file:py-1.5 file:bg-prestisa-50 file:text-prestisa-700 file:font-medium file:rounded file:border-0 hover:file:bg-prestisa-100" />
              {files.length > 0 && <ul className="text-xs text-prestisa-600 mt-2">{files.map((f, i) => <li key={i}>📎 {f.name} ({(f.size / 1024).toFixed(0)} KB)</li>)}</ul>}
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2">
            <button onClick={() => setStep(2)} className="btn-ghost justify-center">← Edit lagi</button>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <button onClick={() => submit('draft')} disabled={busy} className="btn-ghost justify-center">💾 Save as Draft</button>
              <button onClick={() => submit('submit')} disabled={busy} className="btn-primary justify-center">📤 Submit untuk Approval</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
