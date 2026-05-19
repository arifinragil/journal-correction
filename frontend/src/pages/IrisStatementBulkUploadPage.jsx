import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { fmtIDR } from '../api';

export default function IrisStatementBulkUploadPage() {
  const nav = useNavigate();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

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

  const doUpload = async (commit) => {
    if (!file) { setErr('Pilih file dulu'); return; }
    setErr(''); setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
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
        <h2 className="text-lg font-semibold flex-1">⤴ Bulk Upload Statements (Excel)</h2>
        <button onClick={downloadTemplate} className="btn-ghost">📥 Download Template</button>
      </div>

      <div className="card p-4 space-y-3">
        <p className="text-sm text-prestisa-700">
          Unggah file <code>.xlsx</code> / <code>.xls</code> / <code>.csv</code>. Sheet pertama akan dibaca.
          Kolom wajib: <code>account_id</code>, <code>transaction_date</code>, dan salah satu dari <code>received</code> atau <code>spent</code>.
          Download template di kanan atas untuk format yang benar.
        </p>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); }}
          className="block w-full text-sm"
        />
        {err && <div className="text-sm text-rose-700">{err}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={() => doUpload(false)} className="btn-ghost" disabled={!file || busy}>
            {busy ? 'Memproses…' : 'Preview'}
          </button>
          <button onClick={() => doUpload(true)} className="btn-primary"
            disabled={!file || busy || (preview && preview.errors?.length > 0)}>
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
