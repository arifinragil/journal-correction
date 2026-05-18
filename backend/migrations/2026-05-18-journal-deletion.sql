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
