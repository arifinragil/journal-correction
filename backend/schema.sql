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
