-- Journal Correction App - PostgreSQL schema
-- Run as: psql -U journal_app -d journal_correction -f schema.sql

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  username        VARCHAR(64) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  full_name       VARCHAR(128) NOT NULL,
  role            VARCHAR(16) NOT NULL CHECK (role IN ('maker','approver','admin')),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS correction_journals (
  id                       SERIAL PRIMARY KEY,
  correction_journal_id    VARCHAR(32) UNIQUE NOT NULL,
  status                   VARCHAR(16) NOT NULL DEFAULT 'DRAFT'
                             CHECK (status IN ('DRAFT','PENDING','APPROVED','REJECTED')),
  reason                   TEXT NOT NULL,
  source_journal_id        INT,
  source_journal_entry_id  VARCHAR(64),
  created_by               INT NOT NULL REFERENCES users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at             TIMESTAMPTZ,
  reviewed_by              INT REFERENCES users(id),
  reviewed_at              TIMESTAMPTZ,
  review_note              TEXT
);

CREATE TABLE IF NOT EXISTS correction_journal_entries (
  id                          SERIAL PRIMARY KEY,
  correction_journal_id       INT NOT NULL REFERENCES correction_journals(id) ON DELETE CASCADE,
  source_journal_entry_id     INT NOT NULL,
  original_type               VARCHAR(8)  NOT NULL,
  original_amount             NUMERIC(18,2) NOT NULL,
  original_account_id         INT NOT NULL,
  original_account_code       VARCHAR(32),
  original_account_name       VARCHAR(128),
  original_notes              TEXT,
  original_transaction_date   DATE,
  original_company_code       VARCHAR(32),
  corrected_type              VARCHAR(8)  NOT NULL,
  corrected_amount            NUMERIC(18,2) NOT NULL,
  corrected_account_id        INT NOT NULL,
  corrected_account_code      VARCHAR(32),
  corrected_account_name      VARCHAR(128),
  corrected_notes             TEXT,
  corrected_transaction_date  DATE,
  corrected_company_code      VARCHAR(32)
);

CREATE TABLE IF NOT EXISTS correction_attachments (
  id                       SERIAL PRIMARY KEY,
  correction_journal_id    INT NOT NULL REFERENCES correction_journals(id) ON DELETE CASCADE,
  filename                 VARCHAR(255) NOT NULL,
  original_name            VARCHAR(255) NOT NULL,
  mime_type                VARCHAR(64) NOT NULL,
  size_bytes               BIGINT NOT NULL,
  uploaded_by              INT NOT NULL REFERENCES users(id),
  uploaded_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS correction_logs (
  id                       SERIAL PRIMARY KEY,
  correction_journal_id    INT NOT NULL REFERENCES correction_journals(id) ON DELETE CASCADE,
  action                   VARCHAR(16) NOT NULL,
  actor_user_id            INT NOT NULL REFERENCES users(id),
  payload_json             JSONB,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cj_status        ON correction_journals(status);
CREATE INDEX IF NOT EXISTS idx_cj_created_by    ON correction_journals(created_by);
CREATE INDEX IF NOT EXISTS idx_cj_created_at    ON correction_journals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cje_cj           ON correction_journal_entries(correction_journal_id);
CREATE INDEX IF NOT EXISTS idx_cl_cj            ON correction_logs(correction_journal_id);
CREATE INDEX IF NOT EXISTS idx_cl_created_at    ON correction_logs(created_at DESC);
-- Journal deletion workflow (2026-05-18)
CREATE TABLE IF NOT EXISTS journal_deletion_requests (
  id                       SERIAL PRIMARY KEY,
  scope                    VARCHAR(16) NOT NULL CHECK (scope IN ('JOURNAL','ENTRY')),
  mysql_journal_id         INTEGER NOT NULL,
  mysql_entry_ids          INTEGER[] NULL,
  snapshot                 JSONB NOT NULL,
  balance_after            JSONB NULL,
  has_correction_reference BOOLEAN NOT NULL DEFAULT FALSE,
  reason                   TEXT NOT NULL,
  status                   VARCHAR(16) NOT NULL DEFAULT 'PENDING'
                             CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  created_by               INTEGER NOT NULL REFERENCES users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by               INTEGER NULL REFERENCES users(id),
  decided_at               TIMESTAMPTZ NULL,
  decision_notes           TEXT NULL,
  executed_at              TIMESTAMPTZ NULL,
  CONSTRAINT jdr_entry_scope_has_ids
    CHECK (scope <> 'ENTRY' OR (mysql_entry_ids IS NOT NULL AND cardinality(mysql_entry_ids) > 0))
);

CREATE INDEX IF NOT EXISTS idx_jdr_status_created
  ON journal_deletion_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_jdr_mysql_journal
  ON journal_deletion_requests (mysql_journal_id);

CREATE TABLE IF NOT EXISTS journal_deletion_audit_logs (
  id          SERIAL PRIMARY KEY,
  request_id  INTEGER NOT NULL REFERENCES journal_deletion_requests(id) ON DELETE CASCADE,
  action      VARCHAR(32) NOT NULL,
  actor_id    INTEGER NOT NULL REFERENCES users(id),
  details     JSONB NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jdal_request ON journal_deletion_audit_logs (request_id);


-- Correction journal: add ADD_ENTRIES mode (2026-05-18)

-- 1. Add mode column on correction_journals (CORRECTION = existing behavior, ADD_ENTRIES = append new entries to parent journal without replacing existing)
ALTER TABLE correction_journals
  ADD COLUMN IF NOT EXISTS mode VARCHAR(16) NOT NULL DEFAULT 'CORRECTION'
  CHECK (mode IN ('CORRECTION','ADD_ENTRIES'));

-- 2. Relax NOT NULL on original-side and source-entry-id columns: ADD_ENTRIES mode has no original
ALTER TABLE correction_journal_entries ALTER COLUMN source_journal_entry_id DROP NOT NULL;
ALTER TABLE correction_journal_entries ALTER COLUMN original_type           DROP NOT NULL;
ALTER TABLE correction_journal_entries ALTER COLUMN original_amount         DROP NOT NULL;
ALTER TABLE correction_journal_entries ALTER COLUMN original_account_id     DROP NOT NULL;
