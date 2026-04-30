---
project: Correction Journals
domain: journal.prestisa.net
date: 2026-04-28
status: approved (brainstorming)
---

# Correction Journals — Design Spec

## 1. Purpose

Web app untuk Prestisa Finance team mengajukan dan menyetujui koreksi atas baris `journal_entries` yang salah-input. Mendukung dua peran inti — **Maker** (input koreksi) dan **Approver** (review & setuju) — dengan log lengkap dan lampiran opsional. Output dari proyek ini adalah **mockup fungsional + PRD `.docx`** untuk validasi stakeholder sebelum integrasi tulis-balik ke MySQL produksi.

## 2. Constraints

- **MySQL `lavender_lavenderPOS` read-only.** Aplikasi hanya `SELECT` dari `journal`, `journal_entries`, `accounts`. Tidak `UPDATE` / `INSERT`.
- Semua data milik aplikasi koreksi (users, correction headers, snapshots, logs, attachment metadata) disimpan di **PostgreSQL lokal** — DB baru `journal_correction`.
- Strategi posting: **modify-in-place (konseptual)** — di mockup, status `APPROVED` adalah tujuan akhir tanpa benar-benar mengubah `journal_entries`. Integrasi tulis-balik = future scope.

## 3. Stack

| Layer | Tech |
|---|---|
| Backend | Node.js + Express, `pg`, `mysql2/promise`, `multer`, `bcrypt`, `express-session` |
| Frontend | React 18 + Vite + Tailwind + axios + react-router |
| DB (write) | PostgreSQL 15 lokal — DB `journal_correction` |
| DB (read) | MySQL 8 prod — DB `lavender_lavenderPOS` |
| Files | Filesystem `backend/uploads/` |
| Reverse proxy | Caddy → `journal.prestisa.net` |
| Process | PM2 (ecosystem.config.js) |

## 4. Roles

| Role | Permissions |
|---|---|
| `maker` | Create draft, edit own draft, submit, view own + all status `APPROVED` |
| `approver` | View all `PENDING`+`APPROVED`+`REJECTED`, approve/reject with note |
| `admin` | Semua hak di atas + manage users |

Segregation of duty: maker tidak bisa approve koreksi yang ia buat sendiri (cek di backend).

## 5. Data Model — PostgreSQL `journal_correction`

```sql
CREATE TABLE users (
  id              SERIAL PRIMARY KEY,
  username        VARCHAR(64) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  full_name       VARCHAR(128) NOT NULL,
  role            VARCHAR(16) NOT NULL CHECK (role IN ('maker','approver','admin')),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE correction_journals (
  id                       SERIAL PRIMARY KEY,
  correction_journal_id    VARCHAR(32) UNIQUE NOT NULL,   -- CJ-YYYYMM-0001
  status                   VARCHAR(16) NOT NULL DEFAULT 'DRAFT'
                             CHECK (status IN ('DRAFT','PENDING','APPROVED','REJECTED')),
  reason                   TEXT NOT NULL,
  source_journal_id        INT,                            -- FK → MySQL journal.id (logical)
  source_journal_entry_id  VARCHAR(64),                    -- info display
  created_by               INT NOT NULL REFERENCES users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at             TIMESTAMPTZ,
  reviewed_by              INT REFERENCES users(id),
  reviewed_at              TIMESTAMPTZ,
  review_note              TEXT
);

CREATE TABLE correction_journal_entries (
  id                          SERIAL PRIMARY KEY,
  correction_journal_id       INT NOT NULL REFERENCES correction_journals(id) ON DELETE CASCADE,
  source_journal_entry_id     INT NOT NULL,                -- ref ke MySQL journal_entries.id
  -- snapshot ASLI (frozen saat lookup):
  original_type               VARCHAR(8)  NOT NULL,
  original_amount             NUMERIC(18,2) NOT NULL,
  original_account_id         INT NOT NULL,
  original_account_code       VARCHAR(32),
  original_account_name       VARCHAR(128),
  original_notes              TEXT,
  original_transaction_date   DATE,
  original_company_code       VARCHAR(32),
  -- nilai KOREKSI:
  corrected_type              VARCHAR(8)  NOT NULL,
  corrected_amount            NUMERIC(18,2) NOT NULL,
  corrected_account_id        INT NOT NULL,
  corrected_account_code      VARCHAR(32),
  corrected_account_name      VARCHAR(128),
  corrected_notes             TEXT,
  corrected_transaction_date  DATE,
  corrected_company_code      VARCHAR(32)
);

CREATE TABLE correction_attachments (
  id                       SERIAL PRIMARY KEY,
  correction_journal_id    INT NOT NULL REFERENCES correction_journals(id) ON DELETE CASCADE,
  filename                 VARCHAR(255) NOT NULL,           -- stored name (uuid)
  original_name            VARCHAR(255) NOT NULL,
  mime_type                VARCHAR(64) NOT NULL,
  size_bytes               BIGINT NOT NULL,
  uploaded_by              INT NOT NULL REFERENCES users(id),
  uploaded_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE correction_logs (
  id                       SERIAL PRIMARY KEY,
  correction_journal_id    INT NOT NULL REFERENCES correction_journals(id) ON DELETE CASCADE,
  action                   VARCHAR(16) NOT NULL,            -- CREATED, EDITED, SUBMITTED, APPROVED, REJECTED
  actor_user_id            INT NOT NULL REFERENCES users(id),
  payload_json             JSONB,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cj_status ON correction_journals(status);
CREATE INDEX idx_cj_created_by ON correction_journals(created_by);
CREATE INDEX idx_cje_cj ON correction_journal_entries(correction_journal_id);
CREATE INDEX idx_cl_cj ON correction_logs(correction_journal_id);
```

### ID Generation

`correction_journal_id` = `CJ-YYYYMM-NNNN` di mana NNNN = sequence per bulan, zero-padded 4 digit. Generated server-side dalam transaksi (SELECT MAX + 1 dengan row lock).

## 6. Validation Rules

Semua dicek di backend (frontend juga, untuk UX):

1. **Min 2 entries** per koreksi.
2. **Original balance:** Σ amount(type=debit) = Σ amount(type=credit) — dari snapshot original. Bila tidak balance, tolak (data sumber sudah salah, koreksi single-journal tidak applicable).
3. **Corrected balance:** Σ corrected_amount(type=debit) = Σ corrected_amount(type=credit).
4. **Reason wajib diisi** (min 10 karakter).
5. **Approval guard:** `reviewed_by` ≠ `created_by`.
6. **State machine:**
   - `DRAFT` → `PENDING` (action: SUBMIT, oleh creator)
   - `PENDING` → `APPROVED` | `REJECTED` (oleh approver/admin, bukan creator)
   - `REJECTED` → `DRAFT` (boleh re-submit setelah edit)
   - `APPROVED` = terminal.

## 7. Lookup Flow (Read-only ke MySQL)

```
GET /api/journal-entries/:id
  → SELECT je.*, j.entry_id, j.order_number, j.pr_finance_id, j.description,
           a.code AS account_code, a.name AS account_name
    FROM journal_entries je
    JOIN journal j ON j.id = je.journal_id
    LEFT JOIN accounts a ON a.id = je.account_id
    WHERE je.id = ? AND je.deleted_at IS NULL

GET /api/journal/:id/entries
  → SELECT semua entries milik 1 journal (untuk tombol "import all entries")

GET /api/accounts?q=cash
  → SELECT id, code, name FROM accounts WHERE name ILIKE ? OR code ILIKE ? LIMIT 50
```

Note: schema `accounts` belum diverifikasi saat spec ditulis — saat scaffolding, jika nama kolom berbeda (`code` vs `account_code`), sesuaikan query, bukan asumsi.

## 8. API Endpoints

```
POST   /api/login                              Public — username, password
POST   /api/logout                             Auth
GET    /api/me                                 Auth — current user info

# Lookups (read MySQL)
GET    /api/journal-entries/:id                Auth — single entry + journal info
GET    /api/journal/:journal_id/entries        Auth — all entries of a journal
GET    /api/accounts?q=                        Auth — search GL accounts

# Corrections
GET    /api/corrections                        Auth — list with filters: status, q, mine=1
POST   /api/corrections                        maker|admin — create DRAFT
GET    /api/corrections/:id                    Auth — full detail (header, entries, attachments, logs)
PUT    /api/corrections/:id                    creator only, while DRAFT — full replace entries
DELETE /api/corrections/:id                    creator only, while DRAFT
POST   /api/corrections/:id/submit             creator — DRAFT → PENDING
POST   /api/corrections/:id/approve            approver|admin (≠creator) — body: {note?} → APPROVED
POST   /api/corrections/:id/reject             approver|admin (≠creator) — body: {note} → REJECTED

# Attachments
POST   /api/corrections/:id/attachments        creator while DRAFT — multipart, max 5 files, 5MB each
GET    /api/corrections/:id/attachments/:fid   Auth — download
DELETE /api/corrections/:id/attachments/:fid   creator while DRAFT

# Users (admin only)
GET    /api/users
POST   /api/users
PUT    /api/users/:id
```

## 9. Frontend Pages

| Path | Komponen | Akses |
|---|---|---|
| `/login` | LoginPage | public |
| `/` | DashboardPage (counter + recent) | auth |
| `/corrections` | CorrectionListPage | auth |
| `/corrections/new` | CorrectionFormPage (3-step) | maker, admin |
| `/corrections/:id` | CorrectionDetailPage | auth |
| `/corrections/:id/edit` | CorrectionFormPage (edit) | creator while DRAFT |
| `/users` | UserAdminPage | admin |

**Form 3-step (`/corrections/new`):**
1. **Lookup** — input journal_entry_id (atau journal_id untuk import semua entry-nya), tampilkan kartu info journal (entry_id, order_number, pr_finance_id, description), tabel entries yang akan di-koreksi. Indikator balance original.
2. **Edit** — tabel side-by-side: kolom Original (read-only, abu-abu) vs Corrected (input). Field per row: type (toggle DR/CR), amount, account (autocomplete dari /accounts), notes, transaction_date, company_code. Banner balance check live. Reason koreksi (textarea wajib).
3. **Review & Attach** — preview ringkasan, upload lampiran, tombol Save Draft / Submit.

**Detail page (`/corrections/:id`):**
- Header: `correction_journal_id`, status pill, dibuat oleh, tanggal create/submit/review.
- Tabel side-by-side original ↔ corrected dengan diff highlight (cell yang berubah ditandai kuning).
- Blok lampiran (download).
- Timeline log (created → submitted → approved/rejected).
- Aksi kondisional: jika status `PENDING` & user adalah approver/admin & bukan creator → tombol Approve / Reject (modal note).

## 10. Branding

- Logo: `assets/logo-color.png` (header) + `assets/logo-white.png` (login bg).
- Favicon: `assets/favicon.png`.
- Hero (login page): `assets/hero.png`.
- Tagline: "Connected With Excellence".
- Color: extract dari logo (deep purple/magenta accent + white).

## 11. Deployment

```caddyfile
journal.prestisa.net {
  encode gzip
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
}
```

PM2:
```js
module.exports = {
  apps: [{
    name: 'journal-correction-backend',
    cwd: '/home/krttpt/journal/backend',
    script: 'index.js',
    env: { NODE_ENV: 'production', PORT: 5180 }
  }]
};
```

Backend listens on `127.0.0.1:5180`. DNS A record `journal.prestisa.net` → VPS IP harus diatur manual oleh user (akan diingatkan di output akhir).

## 12. Mockup → PRD Pipeline

### Seed (single SQL script `seed.sql`)
- 3 users:
  - `maker1` / `password123` (Maker — Andi Saputra)
  - `approver1` / `password123` (Approver — Budi Santoso)
  - `admin` / `admin123` (Admin — Citra Lestari)
- 3 sample corrections menggunakan `journal_entry_id` nyata dari MySQL prod (dipilih runtime saat seed dijalankan):
  - 1 DRAFT (oleh maker1)
  - 1 PENDING (submitted by maker1)
  - 1 APPROVED (approved by approver1)

### Screenshot pipeline
- Install `playwright` (Chromium only) sebagai dev dependency di root project.
- Script `scripts/capture.js`:
  1. Login as `maker1`, screenshot: Login, Dashboard, List, Form Step 1, Form Step 2, Form Step 3.
  2. Login as `approver1`, screenshot: Detail page (PENDING dengan tombol Approve/Reject).
  3. Login as `admin`, screenshot: User Management.
- Output: `assets/screenshots/01-login.png` ... `09-users.png` (1280×800).

### PRD generator
- Script `scripts/generate-prd.js` pakai `docx` npm package.
- File output: `Correction-Journals-PRD.docx` di `/home/krttpt/journal/PRD/`.
- Sections: Cover (logo + title + date) → TOC → 1. Executive Summary → 2. Objectives → 3. Personas & Roles → 4. User Stories → 5. Functional Requirements → 6. Non-Functional Requirements → 7. Workflow → 8. Data Model → 9. API Spec → 10. Acceptance Criteria → 11. Open Questions → 12. Appendix: Screenshots (semua gambar di-embed).

## 13. Acceptance Criteria

1. User dapat login sebagai 3 peran berbeda (maker/approver/admin) dengan kredensial seed.
2. Maker dapat membuat draft dengan minimal 2 entries dari journal_entry_id valid; balance check muncul live.
3. Submit draft yang tidak balance ditolak server dengan pesan jelas.
4. Approver dapat melihat list PENDING tetapi tidak melihat tombol approve untuk koreksi yang ia buat sendiri.
5. Approve memindahkan status ke APPROVED dan mencatat `reviewed_by`/`reviewed_at`.
6. Setiap aksi tercatat di `correction_logs` dan tampil di timeline detail.
7. Lampiran dapat di-upload (max 5 file, 5MB each) dan didownload kembali.
8. Aplikasi accessible via `https://journal.prestisa.net` dengan TLS otomatis dari Caddy.
9. PRD `.docx` ter-generate dengan minimal 8 screenshot embedded dan dapat dibuka di Microsoft Word / Google Docs / LibreOffice.

## 14. Non-Functional

- Session cookie httpOnly, max 8 jam.
- Password disimpan sebagai bcrypt hash (cost 10).
- Upload directory di luar webroot, akses via API yang cek session.
- File type whitelist: `pdf, png, jpg, jpeg, xlsx, xls, docx, doc`.
- Backend log ke stdout (PM2 capture).
- Postgres pool max 10 connections.

## 15. Open Questions / Future Scope

1. **Tulis-balik MySQL** — strategi modify-in-place butuh ALTER privilege di prod DB; perlu diskusi dengan tim DBA. Alternatif: generate SQL patch file untuk eksekusi manual.
2. **Multi-level approval** — saat ini single-level. Future: threshold by amount / company_code.
3. **Email/WA notification** ke approver saat ada PENDING baru.
4. **Audit trail export** — CSV/Excel laporan koreksi per periode.
5. **Reverse-by-period** — ledger period closing → koreksi setelah closing perlu posting period berbeda.
6. **SSO** dengan Google Workspace Prestisa.

## 16. Out of Scope (mockup ini)

- Real write back to MySQL.
- Email notifications.
- Multi-tenant / multi-company beyond `company_code` field passthrough.
- Mobile app.
- Real-time updates (WebSocket).

---

**Spec status:** ready for implementation plan.
