import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { fmtIDR } from '../api';
import PageHelp from '../components/PageHelp.jsx';

const BANK_OPTIONS = [
  { value: '',        label: 'Template Generic (Excel/CSV)' },
  { value: 'bca',     label: 'BCA — Mutasi Rekening (.csv)' },
  { value: 'bni',     label: 'BNI — Mutasi Rekening (.csv)' },
  { value: 'bri',     label: 'BRI — Mutasi Rekening (.csv)' },
  { value: 'mandiri', label: 'Mandiri — MCM Statement (.csv)' },
];

export default function IrisStatementBulkUploadPage() {
  const nav = useNavigate();
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [bank, setBank] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/iris-accounts').then(r => setAccounts(r.data || [])).catch(() => {});
  }, []);

  const downloadTemplate = async () => {
    try {
      const r = await api.get('/iris-statements/template/xlsx', { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'iris_statements_template.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { alert('Gagal download template: ' + e.message); }
  };

  const needAccount = !!bank; // bank mode requires account_id
  const canPreview = !!file && (!needAccount || !!accountId);

  const doUpload = async (commit) => {
    if (!file) { setErr('Pilih file dulu'); return; }
    if (needAccount && !accountId) { setErr('Pilih bank account dulu'); return; }
    setErr(''); setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (bank) fd.append('bank', bank);
      if (accountId) fd.append('account_id', accountId);
      const r = await api.post('/iris-statements/bulk-upload' + (commit ? '?commit=1' : ''), fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (commit && r.data.commit) {
        alert(`Berhasil insert ${r.data.inserted} baris`);
        nav('/iris-statements');
        return;
      }
      setPreview(r.data);
    } catch (e) { setErr(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="card p-4 flex items-center gap-3 flex-wrap">
        <Link to="/iris-statements" className="btn-ghost">← Kembali</Link>
        <h2 className="text-lg font-semibold flex-1">⤴ Bulk Upload Statements</h2>
        <PageHelp title="Bulk Upload" items={[
          'Upload banyak baris statement sekaligus dari file Excel/CSV — atau langsung dari CSV bank.',
          'Pilih Bank Account dulu (wajib bila format = CSV bank). Semua baris akan masuk ke akun ini.',
          'Pilih Format File: Generic (template Excel/CSV) atau salah satu bank (BCA/BNI/BRI/Mandiri).',
          'Mode bank: upload file mutasi rekening langsung dari internet banking — parser otomatis menyesuaikan header & format tanggal.',
          'Klik Preview untuk validasi (50 baris pertama tampil, semua error dicek).',
          'Bila tidak ada error → klik "Upload & Simpan" untuk insert (transactional).',
        ]} />
        <button onClick={downloadTemplate} className="btn-ghost">📥 Template Generic</button>
      </div>

      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">
              Bank Account {needAccount && <span className="text-rose-600">*</span>}
            </label>
            <select className="input" value={accountId}
              onChange={e => { setAccountId(e.target.value); setPreview(null); }}>
              <option value="">— pilih akun —</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.account_number ? `[${a.account_number}] ` : ''}{a.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-prestisa-500 mt-1">
              {needAccount
                ? 'Semua baris di CSV akan dimasukkan ke akun ini.'
                : 'Opsional untuk template generic; jika diisi akan override kolom account_id di file.'}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Format File</label>
            <select className="input" value={bank}
              onChange={e => { setBank(e.target.value); setPreview(null); }}>
              {BANK_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <p className="text-xs text-prestisa-500 mt-1">
              {bank
                ? `Parser akan mengikuti format CSV ${bank.toUpperCase()}.`
                : 'Pakai template Excel/CSV standar (lihat tombol Template Generic).'}
            </p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">File</label>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); }}
            className="block w-full text-sm"
          />
        </div>

        {err && <div className="text-sm text-rose-700">{err}</div>}

        <div className="flex justify-end gap-2">
          <button onClick={() => doUpload(false)} className="btn-ghost" disabled={!canPreview || busy}>
            {busy ? 'Memproses…' : 'Preview'}
          </button>
          <button onClick={() => doUpload(true)} className="btn-primary"
            disabled={!canPreview || busy || (preview && preview.errors?.length > 0)}>
            {busy ? 'Menyimpan…' : 'Upload & Simpan'}
          </button>
        </div>
      </div>

      {preview && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="font-semibold">Preview</h3>
            <span className="text-sm">Total baris: <b>{preview.total}</b></span>
            {preview.errors?.length > 0
              ? <span className="text-sm text-rose-700">Error: <b>{preview.errors.length}</b></span>
              : <span className="text-sm text-emerald-700">Semua valid ✓</span>}
          </div>

          {preview.errors?.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded p-3 max-h-48 overflow-auto text-sm">
              <p className="font-semibold mb-1 text-rose-800">Perbaiki dulu error berikut sebelum menyimpan:</p>
              <ul className="list-disc pl-5 space-y-0.5 text-rose-700">
                {preview.errors.slice(0, 50).map((e, i) => (
                  <li key={i}>Baris {e.row}: {e.errors.join(', ')}</li>
                ))}
                {preview.errors.length > 50 && <li>… dan {preview.errors.length - 50} error lainnya</li>}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-prestisa-50 text-prestisa-700">
                <tr>
                  <th className="text-left px-2 py-1">#</th>
                  <th className="text-left px-2 py-1">account_id</th>
                  <th className="text-left px-2 py-1">transaction_date</th>
                  <th className="text-left px-2 py-1">description</th>
                  <th className="text-right px-2 py-1">received</th>
                  <th className="text-right px-2 py-1">spent</th>
                  <th className="text-center px-2 py-1">recon</th>
                </tr>
              </thead>
              <tbody>
                {(preview.preview || []).map((r, i) => (
                  <tr key={i} className="border-t border-prestisa-50">
                    <td className="px-2 py-1">{i + 2}</td>
                    <td className="px-2 py-1">{r.account_id || <span className="text-rose-600">—</span>}</td>
                    <td className="px-2 py-1">{r.transaction_date || <span className="text-rose-600">—</span>}</td>
                    <td className="px-2 py-1 max-w-xs truncate" title={r.description}>{r.description}</td>
                    <td className="px-2 py-1 text-right">{r.received ? fmtIDR(r.received) : ''}</td>
                    <td className="px-2 py-1 text-right">{r.spent ? fmtIDR(r.spent) : ''}</td>
                    <td className="px-2 py-1 text-center">{r.reconciled ? '✓' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.total > 50 && <p className="text-xs text-prestisa-500 mt-2">Hanya 50 baris pertama yang ditampilkan; semua akan disimpan saat klik Upload &amp; Simpan.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
