# Company Code Mismatch → Correction — Design

**Date:** 2026-06-10
**Repo:** journal-correction (`/home/krttpt/journal`)
**Branch:** `feat/company-code-mismatch`
**Status:** Approved

## Problem

Journal entries get booked on a **bank account** while carrying a `company_code`
that differs from the account's master `company_code`. The cash physically moves
through that bank account, so the bank balance includes it, but the per-company
book excludes it — a balance discrepancy (e.g. account 1047 PKSO: KRTT/KBSO
entries netted +36.164 vs the real Mandiri balance).

recon's "Recon Company Code" tab already **detects** these read-only. This
feature lets a maker **correct** them inside the journal-correction app, using
the existing maker-checker flow that pushes `company_code` UPDATEs to MySQL on
approval.

## Resolved decisions

- Re-tag direction: **to the bank account's master `company_code`** (both lines
  of the pair).
- Granularity: **one correction per pair (per `journal_id`)**.
- Created status: **DRAFT** (maker submits → PENDING → approver approves).
- Pairing: bank entry + its **contra** (same `journal_id`, adjacent id, opposite
  type, equal amount, same wrong `company_code`). Entries without a clean unique
  contra (e.g. the 2 large `Credit` intercompany entries on 1058) are shown but
  **not submittable** — flagged for manual handling.

## Architecture

No new write path — reuse the audited `POST /api/corrections`.

### Backend — `GET /api/company-code-mismatch?dateFrom=&dateTo=` (requireAuth)
1. Query `mysqlPool` for mismatched bank entries in the date range:
   account in `iris_account_statements`, `a.company_code IS NOT NULL`,
   `je.company_code IS NOT NULL`, `je.company_code <> a.company_code`,
   `je.deleted_at IS NULL`.
2. Fetch all entries for the involved `journal_id`s; in JS resolve each
   mismatched entry's contra (adjacent id, opposite type, equal amount, same
   `company_code`). Unique contra → **safe**; else → **complex** (flagged).
3. For each safe pair, build a ready-to-post `correction` payload:
   - `mode: 'CORRECTION'`, `source_journal_id`, `source_journal_entry_id` = bank
     entry id, auto `reason` (>= 10 chars).
   - `entries`: the two lines, `corrected_*` = `original_*` except
     `corrected_company_code` = bank account master code.
4. Response: `{ safe: [{ pair_meta, payload }], complex: [entry_meta] }`.

### Frontend — `CompanyCodeMismatchPage.jsx` (route `/company-code-mismatch`)
- Date range filter (default first-of-year → today), fetch GET endpoint.
- Table of safe pairs: account, master CC, entry CC, type, amount, both entry
  ids, auto reason. Checkbox per pair (default all selected).
- A "complex / manual" section listing non-submittable entries with a note.
- "Buat DRAFT correction" → for each selected pair, `POST /api/corrections`
  with the server-provided `payload` (NOT calling `/submit` → stays DRAFT).
  Show progress + result links to `/corrections/:id`.
- Nav link in `App.jsx` (maker/admin only, since it creates corrections).

### Why client posts per pair
The GET returns server-authored payloads; `POST /api/corrections` re-validates
balance + role (`maker`/`admin`). Mirrors how `CorrectionFormPage` already
builds and posts payloads. Keeps the create logic in one audited endpoint.

## Validation

For 2026-01-01 → 2026-03-31 the endpoint must return 23 safe pairs
(1003×6, 1033×14, 1055×2, 1058×1) and 2 complex entries on 1058
(Credit 19.579.547 + 1.051.651). Account 1047 returns nothing (already fixed).

## Out of scope

No auto-approve, no bulk single-correction, no handling of the complex
intercompany entries (manual). No changes to the recon app.
