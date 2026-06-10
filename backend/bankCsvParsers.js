// Bank statement CSV parsers — output common shape:
// { transaction_date: 'YYYY-MM-DD HH:MM:SS', description, received, spent, close_balance, reconciled }
// `account_id` is filled in by the caller from the form field.

function splitCsvLine(line, delim = ',') {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === delim && !inQ) {
      out.push(cur); cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function toNum(s) {
  if (s == null) return 0;
  const cleaned = String(s).replace(/[, ]/g, '').replace(/[A-Za-z]+$/, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

const ID_MONTHS = {
  januari:1, februari:2, maret:3, april:4, mei:5, juni:6,
  juli:7, agustus:8, september:9, oktober:10, november:11, desember:12,
  jan:1, feb:2, mar:3, apr:4, jun:6, jul:7, agu:8, ags:8, sep:9, okt:10, nov:11, des:12,
};

function pad(n) { return String(n).padStart(2, '0'); }

// ─── BCA ─────────────────────────────────────────────────────────────────────
// Preamble (5 lines metadata incl. "Periode : 01/04/2026 - 30/04/2026"), then
// header "Tanggal Transaksi","Keterangan","Cabang","Jumlah","Saldo"
// Rows: "DD/MM", desc, branch, "amount CR|DB", balance
function parseBCA(text) {
  const lines = text.split(/\r?\n/);
  let periodYear = new Date().getFullYear();
  let periodStart = null, periodEnd = null;
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const mP = l.match(/Periode\s*:\s*(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    if (mP) {
      periodStart = { d:+mP[1], m:+mP[2], y:+mP[3] };
      periodEnd   = { d:+mP[4], m:+mP[5], y:+mP[6] };
      periodYear = periodStart.y;
    }
    if (/Tanggal Transaksi/i.test(l) && /Keterangan/i.test(l)) { headerIdx = i; break; }
  }
  if (headerIdx === -1) throw new Error('Header BCA tidak ditemukan (cari "Tanggal Transaksi","Keterangan",...)');
  const out = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const cols = splitCsvLine(raw, ',');
    if (cols.length < 4) continue;
    const tgl = cols[0];
    if (!/^\d{2}\/\d{2}$/.test(tgl)) continue;
    const keterangan = cols[1] || '';
    const jumlah = cols[3] || '';
    const m = jumlah.match(/^([\d.,]+)\s*(CR|DB)$/i);
    if (!m) continue;
    const amount = toNum(m[1]);
    const dir = m[2].toUpperCase();
    const [dd, mm] = tgl.split('/').map(s => parseInt(s, 10));
    // Year handling: if period crosses year-end, infer by month
    let y = periodYear;
    if (periodStart && periodEnd && periodStart.y !== periodEnd.y) {
      y = (mm >= periodStart.m) ? periodStart.y : periodEnd.y;
    }
    const close = toNum(cols[4]);
    out.push({
      transaction_date: `${y}-${pad(mm)}-${pad(dd)} 00:00:00`,
      description: keterangan.replace(/\s+/g, ' ').trim(),
      received: dir === 'CR' ? amount : 0,
      spent:    dir === 'DB' ? amount : 0,
      close_balance: close || null,
      reconciled: 0,
    });
  }
  return out;
}

// ─── BNI ─────────────────────────────────────────────────────────────────────
// Headers: Post Date,Value Date,Branch,Journal No.,Description,Debit,Credit,
// Date: DD/MM/YY HH.MM.SS
function parseBNI(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0], ',').map(s => s.toLowerCase());
  const idx = {
    date: header.findIndex(h => /^post\s*date$/.test(h)),
    desc: header.findIndex(h => /description/.test(h)),
    debit: header.findIndex(h => /^debit$/.test(h)),
    credit: header.findIndex(h => /^credit$/.test(h)),
  };
  if (idx.date < 0 || idx.debit < 0 || idx.credit < 0) {
    throw new Error('Header BNI tidak cocok (butuh Post Date / Debit / Credit)');
  }
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], ',');
    if (cols.length < 5) continue;
    const dt = cols[idx.date];
    const m = dt.match(/^(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{1,2})[.:](\d{2})[.:](\d{2})/);
    if (!m) continue;
    let y = +m[3]; if (y < 100) y += 2000;
    const debit = toNum(cols[idx.debit]);
    const credit = toNum(cols[idx.credit]);
    if (debit === 0 && credit === 0) continue;
    out.push({
      transaction_date: `${y}-${pad(+m[2])}-${pad(+m[1])} ${pad(+m[4])}:${m[5]}:${m[6]}`,
      description: (cols[idx.desc] || '').replace(/\s*\|\s*/g, ' | ').replace(/\s+/g, ' ').trim(),
      received: credit,
      spent: debit,
      close_balance: null,
      reconciled: 0,
    });
  }
  return out;
}

// ─── BRI ─────────────────────────────────────────────────────────────────────
// Headers include: TGL_TRAN, DESK_TRAN, MUTASI_DEBET, MUTASI_KREDIT, SALDO_AKHIR_MUTASI, REMARK_CUSTOM
function parseBRI(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0], ',').map(s => s.replace(/"/g, '').toLowerCase());
  const find = (re) => header.findIndex(h => re.test(h));
  const idx = {
    date:   find(/^tgl_tran$/),
    desc:   find(/^desk_tran$/),
    debit:  find(/^mutasi_debet$/),
    credit: find(/^mutasi_kredit$/),
    saldo:  find(/^saldo_akhir_mutasi$/),
    remark: find(/^remark_custom$/),
  };
  if (idx.date < 0 || idx.debit < 0 || idx.credit < 0) {
    throw new Error('Header BRI tidak cocok (butuh TGL_TRAN, MUTASI_DEBET, MUTASI_KREDIT)');
  }
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], ',');
    if (cols.length < 5) continue;
    const dt = cols[idx.date];
    const m = dt.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (!m) continue;
    const debit = toNum(cols[idx.debit]);
    const credit = toNum(cols[idx.credit]);
    if (debit === 0 && credit === 0) continue;
    const desc = (idx.remark >= 0 && cols[idx.remark]) ? cols[idx.remark] : (cols[idx.desc] || '');
    out.push({
      transaction_date: `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`,
      description: desc.replace(/\s+/g, ' ').trim(),
      received: credit,
      spent: debit,
      close_balance: idx.saldo >= 0 ? (toNum(cols[idx.saldo]) || null) : null,
      reconciled: 0,
    });
  }
  return out;
}

// ─── Mandiri ─────────────────────────────────────────────────────────────────
// Semicolon-delimited.
// AccountNo;Ccy;PostDate;Remarks;AdditionalDesc;Credit Amount;Debit Amount;Close Balance
// Date: "01 April 2026 07:40:58"
function parseMandiri(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0], ';').map(s => s.toLowerCase());
  const find = (re) => header.findIndex(h => re.test(h));
  const idx = {
    date:   find(/^postdate$/),
    remarks: find(/^remarks$/),
    addl:   find(/^additionaldesc$/),
    credit: find(/^credit amount$/),
    debit:  find(/^debit amount$/),
    close:  find(/^close balance$/),
  };
  if (idx.date < 0 || idx.credit < 0 || idx.debit < 0) {
    throw new Error('Header Mandiri tidak cocok (butuh PostDate / Credit Amount / Debit Amount, semicolon-delimited)');
  }
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], ';');
    if (cols.length < 5) continue;
    const dt = cols[idx.date];
    const m = dt.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
    if (!m) continue;
    const monKey = m[2].toLowerCase();
    const mon = ID_MONTHS[monKey];
    if (!mon) continue;
    const debit = toNum(cols[idx.debit]);
    const credit = toNum(cols[idx.credit]);
    if (debit === 0 && credit === 0) continue;
    const a = (cols[idx.addl] || '').trim();
    const r = (cols[idx.remarks] || '').trim();
    const desc = a && r && a !== r ? `${a} | ${r}` : (a || r);
    out.push({
      transaction_date: `${m[3]}-${pad(mon)}-${pad(+m[1])} ${pad(+m[4])}:${m[5]}:${m[6]}`,
      description: desc.replace(/\s+/g, ' ').trim(),
      received: credit,
      spent: debit,
      close_balance: idx.close >= 0 ? (toNum(cols[idx.close]) || null) : null,
      reconciled: 0,
    });
  }
  return out;
}

function parseBankCsv(bank, buffer) {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const b = String(bank || '').toLowerCase();
  if (b === 'bca') return parseBCA(text);
  if (b === 'bni') return parseBNI(text);
  if (b === 'bri') return parseBRI(text);
  if (b === 'mandiri') return parseMandiri(text);
  throw new Error(`Bank tidak didukung: ${bank}. Pilihan: bca, bni, bri, mandiri.`);
}

module.exports = { parseBankCsv, SUPPORTED_BANKS: ['bca', 'bni', 'bri', 'mandiri'] };
