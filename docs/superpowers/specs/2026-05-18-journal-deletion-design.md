# Journal Deletion Feature — Design

**Date:** 2026-05-18
**Status:** Approved (design)
**Author:** brainstormed with maker (finance.parselia@gmail.com)

## Purpose

Memberi cara terkontrol untuk menghapus jurnal duplicate di MySQL production database (`journal` dan `journal_entries`) melalui app journal correction, dengan workflow maker–approver yang sama dengan correction journals. Mendukung dua scope:

1. **JOURNAL** — soft-delete satu journal beserta seluruh entries-nya.
2. **ENTRY** — soft-delete satu atau beberapa entry dalam satu parent journal (parent journal tetap aktif).

Kebutuhan ini muncul karena ada kasus jurnal/entry yang ke-input dobel di sistem upstream dan butuh dihapus tanpa modifikasi langsung ke MySQL.

## Non-Goals

- Hard delete row. Selalu soft delete (`deleted_at = NOW()`).
- Restore/undelete via UI. Untuk sekarang admin lakukan via DB direct kalau perlu.
- Hapus tabel/data turunan selain `journal_entries` (payment, ledger, dsb).
- Auto-detect duplicate. User identifikasi target secara manual via search.
- Bulk delete lintas journal dalam satu request.

## Roles & Permissions

- **Maker, Approver, Admin**: boleh ajukan request.
- **Approver, Admin**: boleh approve/reject request.
- **Strict separation of duty**: approver `≠` `created_by` apa pun rolenya, termasuk admin. Server enforce.

## Data Model

Tabel baru di Postgres:

```sql
CREATE TABLE journal_deletion_requests (
  id                       SERIAL PRIMARY KEY,
  scope                    VARCHAR(16) NOT NULL CHECK (scope IN ('JOURNAL','ENTRY')),
  mysql_journal_id         INTEGER NOT NULL,                       -- always set; for ENTRY = parent journal
  mysql_entry_ids          INTEGER[] NULL,                          -- non-null & non-empty if scope='ENTRY'
  snapshot                 JSONB NOT NULL,                          -- frozen view of journal + entries at request time
  balance_after            JSONB NULL,                              -- {debit, credit, imbalance} for ENTRY scope only
  has_correction_reference BOOLEAN NOT NULL DEFAULT false,          -- true if journal is referenced in correction_journals.source_journal_id
  reason                   TEXT NOT NULL,
  status                   VARCHAR(16) NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  created_by               INTEGER NOT NULL REFERENCES users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by               INTEGER NULL REFERENCES users(id),
  decided_at               TIMESTAMPTZ NULL,
  decision_notes           TEXT NULL,
  executed_at              TIMESTAMPTZ NULL                          -- set when soft-delete actually run in MySQL
);

CREATE INDEX idx_jdr_status_created ON journal_deletion_requests (status, created_at DESC);
CREATE INDEX idx_jdr_mysql_journal ON journal_deletion_requests (mysql_journal_id);
```

### `snapshot` JSONB shape

```json
{
  "journal": {
    "id": 12345,
    "entry_id": "JV-2025-0001",
    "order_number": "ORD-9999",
    "pr_finance_id": "PR-77",
    "description": "Pembayaran vendor X",
    "transaction_date": "2025-11-20",
    "company_code": "PRESTISA",
    "captured_at": "2026-05-18T..."
  },
  "entries": [
    { "id": 88812, "type": "DEBIT",  "amount": "1000000.00", "account_code": "5100", "account_name": "Beban …", "notes": "…" },
    { "id": 88813, "type": "CREDIT", "amount": "1000000.00", "account_code": "1100", "account_name": "Kas",     "notes": "…" }
  ]
}
```

### `balance_after` JSONB shape (scope=ENTRY only)

```json
{ "debit": "500000.00", "credit": "1000000.00", "imbalance": "500000.00" }
```

## API

All endpoints under `/api`. Session auth required.

### `GET /api/journal-deletions/search?q=<term>`

Roles: maker / approver / admin.

Cari MySQL journal dengan satu input yang fleksibel:
- numeric → coba match `journal.id` exact dan `journal_entries.id` exact (group by parent journal)
- string → cari `journal.entry_id` dan `journal.order_number` (LIKE `%q%`, limit 20)

Response:
```json
{
  "results": [
    {
      "journal": { "id": 12345, "entry_id": "JV-2025-0001", "order_number": "ORD-9999", "description": "…", "transaction_date": "2025-11-20" },
      "entries": [ { "id": 88812, "type": "DEBIT", "amount": "1000000.00", "account_code": "5100", "account_name": "Beban …" }, … ],
      "has_correction_reference": true
    }
  ]
}
```

Hanya journal yang `deleted_at IS NULL` di MySQL yang muncul.

### `POST /api/journal-deletions`

Roles: maker / approver / admin.

Body:
```json
{
  "scope": "JOURNAL" | "ENTRY",
  "mysql_journal_id": 12345,
  "mysql_entry_ids": [88812],          // required & non-empty if scope='ENTRY'; must all belong to mysql_journal_id
  "reason": "Duplikat dari journal #12300"
}
```

Server logic:
1. Validasi: `reason` non-empty; jika ENTRY, `mysql_entry_ids` non-empty array dan semua benar-benar milik `mysql_journal_id` dan masih `deleted_at IS NULL`.
2. Tarik snapshot lengkap dari MySQL (journal header + semua entries aktif).
3. Hitung `has_correction_reference` = `EXISTS(SELECT 1 FROM correction_journals WHERE source_journal_id = $1)`.
4. Jika scope=ENTRY: hitung `balance_after` = total debit/credit dari entries yang **tidak** ada di `mysql_entry_ids`.
5. INSERT `status='PENDING'`. Return record.

### `GET /api/journal-deletions?status=pending|approved|rejected&limit=50`

Roles: maker / approver / admin. List dengan join ke `users` untuk nama maker/approver.

### `GET /api/journal-deletions/:id`

Detail lengkap termasuk snapshot, balance_after, has_correction_reference, maker, decider.

### `POST /api/journal-deletions/:id/approve`

Roles: approver / admin. Body: `{ notes?: string }`.

Server logic (cross-DB, order penting karena Postgres dan MySQL terpisah — Postgres jadi system of record dan harus commit terakhir):

1. **Postgres txn BEGIN.** SELECT request `FOR UPDATE`; tolak (409) jika status ≠ `PENDING`.
2. Tolak (403) jika `req.session.userId === created_by`.
3. **MySQL txn BEGIN.** Jalankan UPDATE:
   - scope=JOURNAL: `UPDATE journal SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL`, lalu `UPDATE journal_entries SET deleted_at=NOW() WHERE journal_id=? AND deleted_at IS NULL`.
   - scope=ENTRY: `UPDATE journal_entries SET deleted_at=NOW() WHERE id IN (?) AND deleted_at IS NULL`.
4. Jika MySQL UPDATE error atau affected rows 0 (sudah ke-delete duluan), MySQL ROLLBACK + Postgres ROLLBACK + insert audit log `EXECUTE_FAILED` (di koneksi audit baru) → return 500/409.
5. **MySQL COMMIT** dulu (titik tidak bisa diundo).
6. UPDATE Postgres: status='APPROVED', decided_by, decided_at, decision_notes, executed_at=NOW().
7. **Postgres COMMIT.**

Catatan: kalau MySQL commit sukses tapi Postgres commit gagal (jarang sekali), kita punya inkonsistensi: MySQL terhapus tapi request Postgres masih PENDING. Mitigasi: log error fatal + retry handler manual via admin (di luar scope MVP).

### `POST /api/journal-deletions/:id/reject`

Roles: approver / admin. Body: `{ notes?: string }`.
Validasi sama (status PENDING, requester ≠ decider). Set status='REJECTED', decided_by/at/notes. Tidak menyentuh MySQL.

## Audit Logging

Tambah tabel `journal_deletion_audit_logs` (atau pakai pola sama dengan correction audit jika ada):
```sql
CREATE TABLE journal_deletion_audit_logs (
  id          SERIAL PRIMARY KEY,
  request_id  INTEGER NOT NULL REFERENCES journal_deletion_requests(id),
  action      VARCHAR(32) NOT NULL,    -- 'CREATE' | 'APPROVE' | 'REJECT' | 'EXECUTE' | 'EXECUTE_FAILED'
  actor_id    INTEGER NOT NULL REFERENCES users(id),
  details     JSONB NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
Sisipi log di create, approve, reject, dan setiap execute (sukses/gagal).

## Frontend

### Sidebar
Tambah menu "Hapus Journal" (icon trash) di `App.jsx` setelah "Agent Proposals", visible untuk role maker/approver/admin.

### `/journal-deletions` — List
- Filter status dropdown (default: pending).
- Tampilan card mobile + tabel desktop (pola sama dengan `/corrections` & `/agent-proposals`).
- Kolom: ID, Scope badge (JOURNAL / ENTRY), MySQL Journal ID + entry_id, Maker, Alasan (truncate), Status pill, Tanggal.

### `/journal-deletions/new` — Form
1. **Search bar** (single input): "Cari journal (ID / Entry ID / Order Number)". Submit panggil `/search`.
2. **Result preview** (kalau ketemu, satu atau beberapa journal):
   - Header journal: entry_id, order_number, description, transaction_date.
   - Tabel entries: id, type, amount, account_code, account_name.
   - Banner kuning kalau `has_correction_reference`: "⚠ Journal ini sudah pernah dikoreksi di sistem ini — pastikan reviewer."
3. **Scope selector** (radio):
   - `(•) Hapus seluruh journal` — default.
   - `( ) Hapus entry tertentu` — saat dipilih, muncul checkbox di setiap baris entry.
4. **Balance preview** (saat scope=ENTRY): live recompute `debit - credit` dari entries yang **tidak dicentang**. Tampilkan badge: "Setelah hapus: Debit Rp X · Credit Rp Y · **Selisih Rp Z**" — warna merah jika Z ≠ 0.
5. **Textarea alasan** (required).
6. Tombol **Submit**: POST `/api/journal-deletions`. Sukses → redirect ke detail.

### `/journal-deletions/:id` — Detail
- Header: ID, scope badge, status pill, tombol back.
- Section "Snapshot" (frozen) — header journal + tabel entries dari `snapshot`. Untuk scope=ENTRY, beri tanda baris yang termasuk `mysql_entry_ids` (e.g. background rose).
- Section "Balance Setelah Eksekusi" (scope=ENTRY): tampilkan `balance_after`.
- Section "Maker": nama, tanggal request, alasan.
- Section "Approval":
  - PENDING + viewer = approver/admin **dan** ≠ created_by → tampilkan textarea notes + tombol Approve (hijau) / Reject (merah).
  - PENDING + viewer = created_by → "Menunggu approver lain (anda tidak bisa approve request anda sendiri)."
  - APPROVED/REJECTED → tampilkan decider, decided_at, decision_notes, dan executed_at (jika applicable).

## Error Handling

- 400 untuk body invalid (scope salah, entry_ids kosong saat ENTRY, entry tidak milik parent, journal sudah deleted, dsb).
- 403 untuk role tidak diizinkan dan untuk self-approve (separation of duty).
- 404 saat journal/entry tidak ditemukan di MySQL.
- 409 saat request sudah decided.
- 500 + status remain PENDING + audit log `EXECUTE_FAILED` jika MySQL UPDATE gagal di tahap approve.

## Testing

- Unit-ish via integration test backend:
  - Search by ketiga jenis input.
  - Create: validasi entry_ids belong-to-parent.
  - Snapshot dibekukan walau MySQL berubah setelah create.
  - has_correction_reference flag akurat.
  - Approve: separation of duty enforced (maker tidak bisa approve sendiri).
  - Approve scope=JOURNAL menghasilkan `deleted_at` di journal + entries.
  - Approve scope=ENTRY hanya kena entries yang dipilih.
  - Reject tidak menyentuh MySQL.
- Manual UI walk: maker create → approver login dari device lain → approve → verify di MySQL.

## Migration / Rollout

1. Tambah migration SQL untuk dua tabel baru.
2. Deploy backend (PM2 restart).
3. Deploy frontend build.
4. Tambah menu di sidebar.
5. Smoke test dengan 1 journal duplicate beneran (atau dummy di staging dulu kalau ada).

## Open Questions

(none — semua keputusan utama sudah dijawab user saat brainstorming)
