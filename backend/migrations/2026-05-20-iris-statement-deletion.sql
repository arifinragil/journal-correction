-- Iris account statement deletion workflow + audit (2026-05-20)
CREATE TABLE IF NOT EXISTS iris_statement_deletion_requests (
  id                  SERIAL PRIMARY KEY,
  mysql_statement_id  INTEGER NOT NULL,
  snapshot            JSONB NOT NULL,
  reason              TEXT NOT NULL,
  status              VARCHAR(16) NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  created_by          INTEGER NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by          INTEGER NULL REFERENCES users(id),
  decided_at          TIMESTAMPTZ NULL,
  decision_notes      TEXT NULL,
  executed_at         TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_isdr_status_created
  ON iris_statement_deletion_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_isdr_mysql_statement
  ON iris_statement_deletion_requests (mysql_statement_id);

CREATE TABLE IF NOT EXISTS iris_statement_deletion_audit_logs (
  id          SERIAL PRIMARY KEY,
  request_id  INTEGER NOT NULL REFERENCES iris_statement_deletion_requests(id) ON DELETE CASCADE,
  action      VARCHAR(32) NOT NULL,
  actor_id    INTEGER NOT NULL REFERENCES users(id),
  details     JSONB NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_isdal_request ON iris_statement_deletion_audit_logs (request_id);
