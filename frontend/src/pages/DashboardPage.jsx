import React, { useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { fmtDate, fmtIDR, statusPill } from '../api';
import { AuthCtx } from '../App.jsx';

export default function DashboardPage() {
  const user = useContext(AuthCtx);
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0, draft: 0 });

  useEffect(() => {
    api.get('/corrections').then(r => {
      setItems(r.data);
      const s = { pending: 0, approved: 0, rejected: 0, draft: 0 };
      r.data.forEach(it => { s[it.status.toLowerCase()] = (s[it.status.toLowerCase()] || 0) + 1; });
      setStats(s);
    });
  }, []);

  const stat = (label, val, color) => (
    <div className="card p-3 md:p-5">
      <div className={`text-[10px] md:text-xs font-semibold uppercase tracking-wider ${color}`}>{label}</div>
      <div className="text-2xl md:text-3xl font-extrabold text-prestisa-900 mt-1">{val}</div>
    </div>
  );

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="card p-4 md:p-6 bg-gradient-to-r from-prestisa-600 to-prestisa-800 text-white">
        <div className="flex items-start md:items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[10px] md:text-xs uppercase tracking-widest text-prestisa-200">Selamat datang kembali,</div>
            <h2 className="text-xl md:text-2xl font-bold mt-1 truncate">{user.full_name}</h2>
            <div className="text-prestisa-100 text-sm mt-1 capitalize">Role: {user.role}</div>
          </div>
          {(user.role === 'maker' || user.role === 'admin') && (
            <Link to="/corrections/new" className="btn bg-white text-prestisa-700 hover:bg-prestisa-50 w-full sm:w-auto justify-center">+ Koreksi Baru</Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {stat('Draft',     stats.draft,     'text-slate-500')}
        {stat('Pending',   stats.pending,   'text-amber-600')}
        {stat('Approved',  stats.approved,  'text-emerald-600')}
        {stat('Rejected',  stats.rejected,  'text-rose-600')}
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 md:px-5 py-3 md:py-4 border-b border-prestisa-100 flex items-center justify-between">
          <h3 className="font-semibold text-prestisa-800">Koreksi Terbaru</h3>
          <Link to="/corrections" className="text-sm text-prestisa-600 hover:underline whitespace-nowrap">Lihat semua →</Link>
        </div>

        {/* Mobile: card list */}
        <div className="md:hidden divide-y divide-prestisa-100">
          {items.slice(0, 6).map(it => (
            <Link key={it.id} to={`/corrections/${it.id}`} className="block p-4 active:bg-prestisa-50/50">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-semibold text-prestisa-700 text-sm">{it.correction_journal_id}</span>
                <span className={statusPill(it.status)}>{it.status}</span>
              </div>
              <div className="text-sm text-prestisa-700 line-clamp-2 mb-1">{it.reason}</div>
              <div className="flex items-center justify-between text-xs text-prestisa-500">
                <span>{it.created_by_name}</span>
                <span className="font-mono">{fmtIDR(it.total_debit)}</span>
              </div>
              <div className="text-[11px] text-prestisa-400 mt-1">{fmtDate(it.created_at)}</div>
            </Link>
          ))}
          {items.length === 0 && <div className="p-8 text-center text-prestisa-400 text-sm">Belum ada koreksi.</div>}
        </div>

        {/* Desktop: table */}
        <div className="hidden md:block table-wrap">
          <table className="data">
            <thead>
              <tr><th>ID</th><th>Status</th><th>Maker</th><th>Alasan</th><th className="text-right">Total Debit</th><th>Dibuat</th></tr>
            </thead>
            <tbody>
              {items.slice(0, 6).map(it => (
                <tr key={it.id}>
                  <td><Link to={`/corrections/${it.id}`} className="font-semibold text-prestisa-700 hover:underline">{it.correction_journal_id}</Link></td>
                  <td><span className={statusPill(it.status)}>{it.status}</span></td>
                  <td>{it.created_by_name}</td>
                  <td className="max-w-xs truncate" title={it.reason}>{it.reason}</td>
                  <td className="text-right font-mono">{fmtIDR(it.total_debit)}</td>
                  <td className="text-xs text-prestisa-500">{fmtDate(it.created_at)}</td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-prestisa-400">Belum ada koreksi.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
