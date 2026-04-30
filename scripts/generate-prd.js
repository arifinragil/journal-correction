// Generate PRD .docx in Bahasa Indonesia, with embedded screenshots.
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, HeadingLevel, AlignmentType,
  TextRun, Table, TableRow, TableCell, WidthType, ShadingType, ImageRun,
  PageBreak, Footer, Header, PageNumber,
} = require('docx');

const ASSETS = path.resolve(__dirname, '..', 'assets');
const SHOTS  = path.join(ASSETS, 'screenshots');
const OUT    = path.resolve(__dirname, '..', 'PRD');
fs.mkdirSync(OUT, { recursive: true });

const PURPLE = '7B1FA2';
const PURPLE_DARK = '4F116B';
const GREY = '666666';
const GREY_LIGHT = 'F0F0F0';

const T = (text, opts = {}) => new TextRun({ text, ...opts });
const H1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 },
  children: [T(text, { bold: true, size: 32, color: PURPLE_DARK })],
});
const H2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 160 },
  children: [T(text, { bold: true, size: 26, color: PURPLE })],
});
const H3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 },
  children: [T(text, { bold: true, size: 22, color: PURPLE_DARK })],
});
const para = (text) => new Paragraph({ children: [T(text, { size: 22 })], spacing: { after: 140 } });
const bullet = (text) => new Paragraph({
  children: [T(text, { size: 22 })], bullet: { level: 0 }, spacing: { after: 80 },
});
const codeBlock = (text) => new Paragraph({
  children: [T(text, { font: 'Consolas', size: 18 })],
  shading: { type: ShadingType.SOLID, color: GREY_LIGHT, fill: GREY_LIGHT },
  spacing: { before: 80, after: 120 },
});
const cell = (text, opts = {}) => new TableCell({
  width: opts.width || { size: 25, type: WidthType.PERCENTAGE },
  shading: opts.fill ? { type: ShadingType.SOLID, color: opts.fill, fill: opts.fill } : undefined,
  children: [new Paragraph({
    children: [T(String(text), { size: 20, bold: opts.bold, color: opts.color })],
    alignment: opts.align || AlignmentType.LEFT,
  })],
});
const tableSimple = (headers, rows) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [
    new TableRow({ tableHeader: true, children: headers.map(h => cell(h, { fill: PURPLE, color: 'FFFFFF', bold: true })) }),
    ...rows.map(r => new TableRow({ children: r.map(c => cell(c)) })),
  ],
});
function image(filename, opts = {}) {
  const fp = path.join(SHOTS, filename);
  if (!fs.existsSync(fp)) return para('[gambar tidak ditemukan: ' + filename + ']');
  return new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 120, after: 80 },
    children: [new ImageRun({
      data: fs.readFileSync(fp),
      transformation: { width: opts.width || 580, height: opts.height || 365 },
    })],
  });
}
const caption = (text) => new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 240 },
  children: [T(text, { italics: true, size: 18, color: GREY })],
});

const cover = [
  new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 1200, after: 600 },
    children: [new ImageRun({
      data: fs.readFileSync(path.join(ASSETS, 'logo-color.png')),
      transformation: { width: 220, height: 64 },
    })],
  }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [T('PRODUCT REQUIREMENTS DOCUMENT', { size: 22, color: PURPLE, bold: true })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 },
    children: [T('Correction Journals', { size: 56, bold: true, color: PURPLE_DARK })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 },
    children: [T('Sistem Pengajuan & Persetujuan Koreksi Jurnal', { size: 26, italics: true, color: GREY })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 },
    children: [T('Domain: ', { size: 22, color: GREY }), T('journal.prestisa.net', { size: 22, bold: true, color: PURPLE })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 },
    children: [T('Versi 1.0  ·  28 April 2026', { size: 20, color: GREY })] }),
  new Paragraph({ alignment: AlignmentType.CENTER,
    children: [T('Status: ', { size: 20, color: GREY }), T('Mockup — siap untuk review stakeholder', { size: 20, italics: true, color: PURPLE })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1800 },
    children: [T('Prestisa Group  ·  Connected With Excellence', { size: 18, color: GREY })] }),
  new Paragraph({ children: [new PageBreak()] }),
];

const sec1 = [
  H1('1. Ringkasan Eksekutif'),
  para('Correction Journals adalah aplikasi web internal Prestisa untuk mengajukan dan menyetujui koreksi atas baris jurnal akuntansi (journal_entries) yang salah-input. Aplikasi ini menyediakan workflow Maker–Approver yang dilengkapi audit trail penuh, validasi balance debit-credit otomatis, lookup data jurnal langsung dari sistem POS produksi, dan dukungan lampiran dokumen pendukung.'),
  para('Aplikasi diakses melalui domain journal.prestisa.net dengan otentikasi berbasis user-role: Maker (membuat koreksi), Approver (menyetujui/menolak), dan Admin (manajemen pengguna + semua hak). Database produksi MySQL (lavender_lavenderPOS) diakses secara read-only untuk lookup; semua data milik aplikasi koreksi disimpan di PostgreSQL lokal yang terpisah.'),
  H3('Tujuan dokumen'),
  bullet('Mendokumentasikan ruang lingkup mockup yang sudah dibangun.'),
  bullet('Menjadi acuan validasi stakeholder sebelum integrasi tulis-balik ke MySQL produksi.'),
  bullet('Menjadi titik awal pembahasan future scope (multi-level approval, notifikasi, dll).'),
];

const sec2 = [
  H1('2. Tujuan & Manfaat'),
  H3('Tujuan utama'),
  bullet('Menyediakan saluran resmi dan terdokumentasi untuk koreksi jurnal yang salah-input.'),
  bullet('Menerapkan segregation of duty: pembuat koreksi tidak dapat menyetujui koreksinya sendiri.'),
  bullet('Menyimpan riwayat lengkap setiap perubahan (siapa, kapan, apa yang diubah) sebagai audit trail.'),
  bullet('Menjamin integritas akuntansi: setiap koreksi harus berpasangan debit–credit dan balanced.'),
  H3('Manfaat bisnis'),
  bullet('Mengurangi risiko kesalahan posting yang tidak terlacak.'),
  bullet('Mempercepat proses koreksi karena terstandar (tidak lagi ad-hoc via SQL atau request manual ke DBA).'),
  bullet('Mendukung kepatuhan audit internal & eksternal.'),
];

const sec3 = [
  H1('3. Personas & Peran'),
  para('Aplikasi mendukung 3 peran utama, dengan kontrol akses yang dienforce di backend.'),
  tableSimple(
    ['Peran', 'Deskripsi', 'Hak Akses'],
    [
      ['Maker',    'Staf Finance/Accounting yang menemukan kesalahan jurnal dan mengajukan koreksi.',    'Buat & edit draft, submit, lihat semua koreksinya sendiri.'],
      ['Approver', 'Senior Finance / Manager yang me-review dan memutuskan koreksi.',                    'Lihat semua PENDING/APPROVED/REJECTED, approve/reject dengan note.'],
      ['Admin',    'IT/Finance Lead yang mengelola pengguna sistem.',                                    'Semua hak Maker + Approver + manajemen user.'],
    ]
  ),
  H3('Aturan Segregation of Duty'),
  bullet('Maker tidak bisa me-review koreksi yang ia buat sendiri (dienforce di backend).'),
  bullet('Tombol Approve/Reject tidak ditampilkan untuk koreksi milik user yang sedang login.'),
];

const sec4 = [
  H1('4. User Stories'),
  H3('Sebagai Maker'),
  bullet('Saya dapat mencari journal_entry_id atau journal_id dari sistem POS untuk dikoreksi.'),
  bullet('Saya dapat mengedit nilai koreksi (type, amount, account, notes, transaction_date, company_code) per baris entry.'),
  bullet('Saya dapat melampirkan dokumen pendukung (PDF/Excel/Word/Image, max 5 file × 5MB).'),
  bullet('Saya melihat live indicator apakah balance debit=credit sudah benar sebelum submit.'),
  bullet('Saya dapat menyimpan sebagai draft dan submit kapan saja.'),
  H3('Sebagai Approver'),
  bullet('Saya melihat antrian koreksi PENDING yang menunggu review.'),
  bullet('Saya dapat melihat side-by-side perbandingan original vs corrected dengan diff highlight.'),
  bullet('Saya dapat approve dengan note opsional, atau reject dengan note wajib.'),
  bullet('Saya tidak melihat tombol approve untuk koreksi yang saya buat sendiri.'),
  H3('Sebagai Admin'),
  bullet('Saya dapat membuat user baru dengan role yang sesuai.'),
  bullet('Saya dapat menonaktifkan akun user.'),
  bullet('Saya memiliki semua hak Maker dan Approver.'),
];

const sec5 = [
  H1('5. Kebutuhan Fungsional'),

  H2('5.1 Login & Otentikasi'),
  bullet('Login dengan username & password, session-based (cookie httpOnly, max 8 jam).'),
  bullet('Password disimpan sebagai bcrypt hash (cost 10).'),
  bullet('Logout menghapus session di server-side.'),
  image('01-login.png'), caption('Gambar 1. Halaman Login dengan branding Prestisa.'),

  H2('5.2 Dashboard'),
  bullet('Menampilkan counter koreksi per status: Draft, Pending, Approved, Rejected.'),
  bullet('Tabel 6 koreksi terbaru dengan link ke detail.'),
  bullet('Tombol "Koreksi Baru" untuk Maker/Admin.'),
  image('02-dashboard-maker.png'), caption('Gambar 2. Dashboard view untuk Maker.'),

  H2('5.3 Daftar Koreksi'),
  bullet('Filter status, search ID/alasan, toggle "Milik saya".'),
  bullet('Kolom: ID, Status, Maker, Approver, Alasan, Jumlah entries, Total Debit, tanggal create/submit/review.'),
  image('03-corrections-list.png'), caption('Gambar 3. Halaman daftar koreksi dengan filter.'),

  H2('5.4 Form Koreksi Baru (3-step wizard)'),
  H3('Step 1 — Lookup Journal'),
  bullet('Input mode: Journal ID atau Journal Entry ID.'),
  bullet('Sistem fetch dari MySQL produksi (read-only) dan menampilkan kartu info journal: order_number, pr_finance_id, description.'),
  bullet('Semua entry milik journal otomatis ter-import sebagai snapshot.'),
  image('04-form-step1-lookup.png'), caption('Gambar 4. Form Step 1 — Lookup journal_id.'),
  H3('Step 2 — Edit Correction'),
  bullet('Tabel side-by-side: kolom ORIGINAL (read-only) dan CORRECTED (editable).'),
  bullet('Field yang dapat dikoreksi: type (debit/credit), amount, account_id (autocomplete dari /accounts), notes, transaction_date, company_code.'),
  bullet('Indikator balance live di header tabel (BALANCED/NOT BALANCED dengan delta).'),
  bullet('Field "Alasan Koreksi" wajib minimal 10 karakter.'),
  image('05-form-step2-edit.png'), caption('Gambar 5. Form Step 2 — Edit nilai koreksi.'),
  H3('Step 3 — Review & Submit'),
  bullet('Ringkasan koreksi: source journal, alasan, total debit & credit.'),
  bullet('Upload lampiran (multi-file, max 5 × 5MB).'),
  bullet('Dua aksi: Save as Draft atau Submit untuk Approval.'),
  image('06-form-step3-review.png'), caption('Gambar 6. Form Step 3 — Review & Submit.'),

  H2('5.5 Detail Koreksi'),
  bullet('Header: correction_journal_id, status pill, alasan, info maker/approver, tanggal create/submit/review.'),
  bullet('Reviewer note ditampilkan sebagai banner kontekstual (hijau untuk approved, merah untuk rejected).'),
  bullet('Tabel side-by-side original ↔ corrected dengan diff cell highlight (kuning) pada cell yang berubah.'),
  bullet('Footer tabel: total debit & credit kedua sisi + status balance.'),
  bullet('Timeline log: CREATED → SUBMITTED → APPROVED/REJECTED dengan actor & timestamp.'),
  bullet('Daftar lampiran (download).'),
  bullet('Aksi kontekstual: Submit/Re-submit (jika DRAFT/REJECTED & milik user), Approve/Reject (jika PENDING & user adalah approver/admin & bukan creator).'),
  image('07-detail-draft.png'), caption('Gambar 7. Detail koreksi status DRAFT (Maker view).'),
  image('08-detail-pending-approver.png'), caption('Gambar 8. Detail koreksi status PENDING (Approver view) — tombol Approve/Reject muncul.'),
  image('10-detail-approved.png'), caption('Gambar 9. Detail koreksi status APPROVED dengan diff highlight pada Account.'),

  H2('5.6 Manajemen User (Admin)'),
  bullet('CRUD user: username, full_name, password, role (maker/approver/admin), status aktif.'),
  bullet('Form sebelah kanan untuk tambah user.'),
  image('09-users-admin.png'), caption('Gambar 10. Halaman User Management (Admin).'),
];

const sec6 = [
  H1('6. Kebutuhan Non-Fungsional'),
  tableSimple(
    ['Aspek', 'Spesifikasi'],
    [
      ['Keamanan',     'Session cookie httpOnly · password bcrypt cost 10 · upload di luar webroot · file type whitelist'],
      ['Availability', 'PM2 auto-restart · Caddy reverse proxy dengan TLS otomatis (Let\'s Encrypt)'],
      ['Performance',  'Postgres pool max 10 · MySQL pool max 5 · query lookup di-index pada journal_id, account_id'],
      ['Scalability',  'Stateless backend (kecuali session) · dapat di-scale horizontal di belakang load balancer'],
      ['Audit',        'Setiap aksi (create/edit/submit/approve/reject) disimpan di tabel correction_logs dengan payload JSON'],
      ['Browser',      'Chrome 100+, Firefox 100+, Edge 100+ (responsive untuk desktop & tablet)'],
    ]
  ),
];

const sec7 = [
  H1('7. Workflow Koreksi'),
  para('State machine status koreksi:'),
  codeBlock(`
  ┌──────┐  submit   ┌─────────┐  approve   ┌──────────┐
  │ DRAFT├──────────►│ PENDING ├───────────►│ APPROVED │ (terminal)
  └──┬───┘           └────┬────┘            └──────────┘
     │                    │ reject
     │                    ▼
     │              ┌──────────┐
     │              │ REJECTED │
     │              └────┬─────┘
     │                   │ resubmit
     └───────────────────┘
  `),
  H3('Aturan transisi'),
  bullet('DRAFT → PENDING: hanya creator (atau admin) dapat submit.'),
  bullet('PENDING → APPROVED/REJECTED: hanya approver/admin yang BUKAN creator.'),
  bullet('REJECTED → DRAFT: dapat di-edit ulang lalu re-submit.'),
  bullet('APPROVED: terminal, tidak dapat diubah lagi.'),
];

const sec8 = [
  H1('8. Data Model'),
  para('Aplikasi menyimpan data milik sendiri di PostgreSQL lokal (DB: journal_correction). MySQL produksi (lavender_lavenderPOS) hanya diakses read-only untuk lookup.'),
  H2('8.1 Tabel users'),
  codeBlock(`users (id, username UNIQUE, password_hash, full_name,
        role CHECK IN ('maker','approver','admin'),
        is_active, created_at)`),
  H2('8.2 Tabel correction_journals (header)'),
  codeBlock(`correction_journals (
  id, correction_journal_id UNIQUE,  -- format: CJ-YYYYMM-NNNN
  status CHECK IN ('DRAFT','PENDING','APPROVED','REJECTED'),
  reason, source_journal_id, source_journal_entry_id,
  created_by FK users, created_at, submitted_at,
  reviewed_by FK users, reviewed_at, review_note
)`),
  H2('8.3 Tabel correction_journal_entries (detail)'),
  para('Menyimpan snapshot nilai original (frozen saat lookup) + nilai corrected.'),
  codeBlock(`correction_journal_entries (
  id, correction_journal_id FK, source_journal_entry_id,
  -- ORIGINAL (snapshot):
  original_type, original_amount, original_account_id,
  original_account_code, original_account_name,
  original_notes, original_transaction_date, original_company_code,
  -- CORRECTED:
  corrected_type, corrected_amount, corrected_account_id,
  corrected_account_code, corrected_account_name,
  corrected_notes, corrected_transaction_date, corrected_company_code
)`),
  H2('8.4 Tabel correction_attachments'),
  codeBlock(`correction_attachments (
  id, correction_journal_id FK, filename (uuid),
  original_name, mime_type, size_bytes,
  uploaded_by FK users, uploaded_at
)`),
  H2('8.5 Tabel correction_logs (audit trail)'),
  codeBlock(`correction_logs (
  id, correction_journal_id FK, action, actor_user_id FK,
  payload_json JSONB, created_at
)`),
  H3('ID Generation'),
  para('correction_journal_id digenerate sebagai CJ-YYYYMM-NNNN (mis. CJ-202604-0001), dengan sequence per bulan zero-padded 4 digit. Generated server-side dalam transaksi dengan row lock.'),
];

const sec9 = [
  H1('9. Spesifikasi API'),
  para('Semua endpoint di-prefix dengan /api. Otentikasi via session cookie. Response berupa JSON.'),
  H3('9.1 Authentication'),
  tableSimple(
    ['Method', 'Path', 'Akses', 'Deskripsi'],
    [
      ['POST', '/api/login',  'Public', 'Login dengan username & password'],
      ['POST', '/api/logout', 'Auth',   'Hapus session'],
      ['GET',  '/api/me',     'Auth',   'Info user yang sedang login'],
    ]
  ),
  H3('9.2 Lookups (read-only ke MySQL)'),
  tableSimple(
    ['Method', 'Path', 'Akses', 'Deskripsi'],
    [
      ['GET', '/api/journal-entries/:id',     'Auth', 'Detail satu entry + info journal & account'],
      ['GET', '/api/journal/:id/entries',     'Auth', 'Semua entries milik 1 journal'],
      ['GET', '/api/accounts?q=',             'Auth', 'Search akun GL (autocomplete)'],
    ]
  ),
  H3('9.3 Corrections'),
  tableSimple(
    ['Method', 'Path', 'Akses', 'Deskripsi'],
    [
      ['GET',    '/api/corrections',                'Auth',          'List dengan filter status, q, mine=1'],
      ['POST',   '/api/corrections',                'Maker, Admin',  'Buat draft baru'],
      ['GET',    '/api/corrections/:id',            'Auth',          'Detail lengkap (header, entries, attachments, logs)'],
      ['POST',   '/api/corrections/:id/submit',     'Creator/Admin', 'DRAFT/REJECTED → PENDING'],
      ['POST',   '/api/corrections/:id/approve',    'Approver/Admin (≠creator)', 'PENDING → APPROVED'],
      ['POST',   '/api/corrections/:id/reject',     'Approver/Admin (≠creator)', 'PENDING → REJECTED (note wajib)'],
    ]
  ),
  H3('9.4 Attachments'),
  tableSimple(
    ['Method', 'Path', 'Akses', 'Deskripsi'],
    [
      ['POST',   '/api/corrections/:id/attachments',         'Creator (DRAFT)', 'Multipart upload, max 5 file × 5MB'],
      ['GET',    '/api/corrections/:id/attachments/:fid',    'Auth',            'Download lampiran'],
    ]
  ),
  H3('9.5 Users (admin)'),
  tableSimple(
    ['Method', 'Path', 'Akses', 'Deskripsi'],
    [
      ['GET',  '/api/users', 'Admin', 'List semua user'],
      ['POST', '/api/users', 'Admin', 'Buat user baru'],
    ]
  ),
];

const sec10 = [
  H1('10. Aturan Validasi'),
  bullet('Setiap koreksi minimal harus memiliki 2 entries (1 debit + 1 credit).'),
  bullet('Entries ORIGINAL harus balanced: Σ debit = Σ credit. Jika tidak, koreksi single-journal tidak applicable.'),
  bullet('Entries CORRECTED harus balanced: Σ corrected_amount(debit) = Σ corrected_amount(credit).'),
  bullet('Field "Alasan Koreksi" wajib minimal 10 karakter.'),
  bullet('Approver tidak boleh sama dengan creator (dicheck di backend).'),
  bullet('Reject wajib menyertakan note (alasan penolakan).'),
  bullet('Lampiran: hanya tipe pdf, png, jpg, jpeg, xlsx, xls, docx, doc.'),
  bullet('Status APPROVED bersifat terminal (tidak dapat diubah).'),
];

const sec11 = [
  H1('11. Acceptance Criteria'),
  bullet('User dapat login sebagai maker/approver/admin dengan kredensial yang berlaku.'),
  bullet('Maker dapat membuat draft dengan minimal 2 entries dari journal_entry_id valid; balance check muncul live di UI.'),
  bullet('Submit draft yang tidak balanced ditolak server dengan pesan jelas.'),
  bullet('Approver melihat list PENDING tetapi tidak melihat tombol approve untuk koreksi yang ia buat sendiri.'),
  bullet('Approve memindahkan status ke APPROVED dan mencatat reviewed_by + reviewed_at.'),
  bullet('Setiap aksi tercatat di correction_logs dan tampil di timeline detail page.'),
  bullet('Lampiran dapat di-upload (max 5 × 5MB) dan didownload kembali via API.'),
  bullet('Aplikasi accessible via https://journal.prestisa.net dengan TLS otomatis dari Caddy.'),
];

const sec12 = [
  H1('12. Di Luar Lingkup Mockup Ini'),
  bullet('Tulis-balik (UPDATE) ke MySQL produksi pada saat APPROVED — perlu diskusi dengan tim DBA terkait privilege dan strategi posting.'),
  bullet('Notifikasi email/WhatsApp ke approver saat ada PENDING baru.'),
  bullet('Multi-level approval (saat ini single-level).'),
  bullet('Real-time updates (WebSocket).'),
  bullet('Mobile native app.'),
  bullet('SSO dengan Google Workspace / Azure AD.'),
];

const sec13 = [
  H1('13. Pertanyaan Terbuka'),
  bullet('Strategi tulis-balik MySQL: modify-in-place vs reversing entries vs supersede flag — mana yang disetujui finance & DBA?'),
  bullet('Apakah multi-level approval diperlukan untuk amount di atas threshold tertentu? Berapa thresholdnya?'),
  bullet('Bagaimana penanganan koreksi pada periode yang sudah closing? Perlu posting period berbeda?'),
  bullet('Siapa yang berhak menjadi approver final? Apakah cukup Senior Finance, atau perlu Finance Director?'),
  bullet('Periode retensi data: apakah koreksi yang sudah APPROVED >2 tahun perlu di-archive?'),
  bullet('Notifikasi: channel mana yang preferred — email, WhatsApp, atau in-app saja?'),
];

const sec14 = [
  H1('14. Deployment'),
  H3('Topology'),
  bullet('Backend Node.js Express berjalan di 127.0.0.1:5180 di-manage oleh PM2.'),
  bullet('Frontend React SPA di-build menjadi static files di /home/krttpt/journal/frontend/dist.'),
  bullet('Caddy reverse proxy menerima request di journal.prestisa.net dengan TLS otomatis dari Let\'s Encrypt.'),
  bullet('PostgreSQL lokal (port 5432) menyimpan data app.'),
  bullet('MySQL produksi (host & port dikonfigurasi via .env) hanya diakses read-only untuk lookup.'),
  H3('Caddyfile (block journal.prestisa.net)'),
  codeBlock(`journal.prestisa.net {
    handle /api/* {
        reverse_proxy 127.0.0.1:5180
    }
    handle /uploads/* {
        reverse_proxy 127.0.0.1:5180
    }
    handle {
        root * /home/krttpt/journal/frontend/dist
        try_files {path} /index.html
        file_server
    }
}`),
  H3('PM2 ecosystem'),
  codeBlock(`module.exports = {
  apps: [{
    name: 'journal-correction-backend',
    cwd: '/home/krttpt/journal/backend',
    script: 'index.js',
    env: { NODE_ENV: 'production', PORT: 5180 }
  }]
};`),
  H3('Akun Demo (mockup)'),
  tableSimple(
    ['Username', 'Password', 'Role', 'Nama'],
    [
      ['maker1',    'password123', 'Maker',    'Andi Saputra'],
      ['approver1', 'password123', 'Approver', 'Budi Santoso'],
      ['admin',     'admin123',    'Admin',    'Citra Lestari'],
    ]
  ),
];

const sec15 = [
  H1('15. Lampiran — Galeri Screenshot Lengkap'),
  para('Berikut adalah seluruh screenshot mockup yang sudah dibangun dan dapat diakses langsung di https://journal.prestisa.net.'),
  ...[
    ['01-login.png', 'Halaman Login'],
    ['02-dashboard-maker.png', 'Dashboard (Maker)'],
    ['03-corrections-list.png', 'Daftar Koreksi'],
    ['04-form-step1-lookup.png', 'Form Koreksi Baru — Step 1: Lookup'],
    ['05-form-step2-edit.png', 'Form Koreksi Baru — Step 2: Edit'],
    ['06-form-step3-review.png', 'Form Koreksi Baru — Step 3: Review & Submit'],
    ['07-detail-draft.png', 'Detail Koreksi — DRAFT (Maker view)'],
    ['08-detail-pending-approver.png', 'Detail Koreksi — PENDING (Approver view, ada tombol Approve/Reject)'],
    ['09-users-admin.png', 'Manajemen User (Admin)'],
    ['10-detail-approved.png', 'Detail Koreksi — APPROVED dengan diff highlight pada Account'],
  ].flatMap(([f, c]) => [image(f), caption(c)]),
];

const doc = new Document({
  creator: 'Prestisa Group',
  title: 'PRD — Correction Journals',
  description: 'Product Requirements Document untuk aplikasi Correction Journals Prestisa',
  styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
  sections: [{
    properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
    headers: {
      default: new Header({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [T('PRD — Correction Journals · Prestisa Group', { size: 16, color: GREY, italics: true })],
      })] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [T('Halaman ', { size: 16, color: GREY }),
                   new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GREY }),
                   T(' dari ', { size: 16, color: GREY }),
                   new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: GREY })],
      })] }),
    },
    children: [
      ...cover, ...sec1, ...sec2, ...sec3, ...sec4, ...sec5, ...sec6,
      ...sec7, ...sec8, ...sec9, ...sec10, ...sec11, ...sec12, ...sec13, ...sec14, ...sec15,
    ],
  }],
});

(async () => {
  const buffer = await Packer.toBuffer(doc);
  const outFile = path.join(OUT, 'Correction-Journals-PRD.docx');
  fs.writeFileSync(outFile, buffer);
  console.log('PRD generated:', outFile);
  console.log('Size:', (fs.statSync(outFile).size / 1024).toFixed(0), 'KB');
})();
