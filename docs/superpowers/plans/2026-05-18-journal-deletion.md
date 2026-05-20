# Journal Deletion Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build maker/approver workflow to soft-delete MySQL journals (whole journal or selected entries) with snapshot audit, separation-of-duty enforcement, and correction-reference warning.

**Architecture:** New Postgres tables (`journal_deletion_requests`, `journal_deletion_audit_logs`) hold the workflow state and a frozen snapshot of MySQL data at request time. New `/api/journal-deletions/*` endpoints handle search, create, list, detail, approve, reject. Approve performs MySQL soft-delete inside a cross-DB sequence (MySQL commit first, then Postgres commit). New React pages at `/journal-deletions/*` follow the existing patterns from `/corrections/*` and `/agent-proposals/*`.

**Tech Stack:** Express + `pg` (Postgres pool) + `mysql2` (MySQL pool) on the backend; React + Vite + Tailwind on the frontend. No test framework in repo — verification is curl-based smoke tests + manual UI walk.

**Spec:** `docs/superpowers/specs/2026-05-18-journal-deletion-design.md`

---

## File Structure

**Created:**
- `backend/migrations/2026-05-18-journal-deletion.sql` — schema migration
- `frontend/src/pages/JournalDeletionsPage.jsx` — list
- `frontend/src/pages/JournalDeletionNewPage.jsx` — search + create form
- `frontend/src/pages/JournalDeletionDetailPage.jsx` — detail + approve/reject

**Modified:**
- `backend/schema.sql` — append new table DDL (so fresh installs get them)
- `backend/index.js` — add endpoints + helper
- `frontend/src/App.jsx` — add 3 routes + 1 sidebar link

---

## Task 1: Database Migration

**Files:**
- Create: `backend/migrations/2026-05-18-journal-deletion.sql`
- Modify: `backend/schema.sql` (append same DDL at end)

- [ ] **Step 1: Write migration SQL**

Create `backend/migrations/2026-05-18-journal-deletion.sql`:

```sql
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
```

- [ ] **Step 2: Append same DDL to `backend/schema.sql`**

Open `backend/schema.sql`, scroll to end of file, append the entire SQL from Step 1 (without the leading `-- Journal deletion workflow` comment duplication — keep it as a section header).

- [ ] **Step 3: Run migration**

```bash
cd /home/krttpt/journal
psql -U journal_app -d journal_correction -f backend/migrations/2026-05-18-journal-deletion.sql
```

Expected: `CREATE TABLE` (×2), `CREATE INDEX` (×3), no errors. If user prompts password, get it from `backend/.env` (`DB_PASSWORD`).

- [ ] **Step 4: Verify schema**

```bash
psql -U journal_app -d journal_correction -c "\d journal_deletion_requests"
psql -U journal_app -d journal_correction -c "\d journal_deletion_audit_logs"
```

Expected: both tables listed with all columns and the constraint `jdr_entry_scope_has_ids`.

- [ ] **Step 5: Commit**

```bash
cd /home/krttpt/journal
git add backend/migrations/2026-05-18-journal-deletion.sql backend/schema.sql
git commit -m "feat(db): journal_deletion_requests + audit tables"
```

---

## Task 2: Backend Search Endpoint

**Files:**
- Modify: `backend/index.js` — add `GET /api/journal-deletions/search` before the `/api/health` route (around line ~688).

- [ ] **Step 1: Add search endpoint**

Find this line near the end of `backend/index.js`:

```js
// Health
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));
```

Insert above it:

```js
// ---------------------------------------------------------------------------
// Journal Deletions
// ---------------------------------------------------------------------------

/**
 * GET /api/journal-deletions/search?q=<term>
 * Single-input search across MySQL journal.id, journal_entries.id (numeric),
 * journal.entry_id, journal.order_number (string). Returns matching active journals
 * with their entries and correction-reference flag.
 */
app.get('/api/journal-deletions/search', requireAuth, requireRole('maker', 'approver', 'admin'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ results: [] });
  try {
    const isNumeric = /^\d+$/.test(q);
    let journalIds = new Set();

    if (isNumeric) {
      const n = parseInt(q, 10);
      const [byJournal] = await mysqlPool.query(
        `SELECT id FROM journal WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
        [n]
      );
      byJournal.forEach(r => journalIds.add(r.id));
      const [byEntry] = await mysqlPool.query(
        `SELECT journal_id FROM journal_entries WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
        [n]
      );
      byEntry.forEach(r => journalIds.add(r.journal_id));
    } else {
      const like = '%' + q + '%';
      const [rows] = await mysqlPool.query(
        `SELECT id FROM journal
          WHERE deleted_at IS NULL
            AND (entry_id LIKE ? OR order_number LIKE ?)
          ORDER BY id DESC LIMIT 20`,
        [like, like]
      );
      rows.forEach(r => journalIds.add(r.id));
    }

    const ids = [...journalIds];
    if (ids.length === 0) return res.json({ results: [] });

    const [journals] = await mysqlPool.query(
      `SELECT id, entry_id, order_number, pr_finance_id, description,
              transaction_date, company_code
         FROM journal WHERE id IN (?) AND deleted_at IS NULL`,
      [ids]
    );
    const [entries] = await mysqlPool.query(
      `SELECT je.id, je.journal_id, je.type, je.amount, je.account_id, je.notes,
              a.account_number AS account_code, a.name AS account_name
         FROM journal_entries je
         LEFT JOIN accounts a ON a.id = je.account_id
        WHERE je.journal_id IN (?) AND je.deleted_at IS NULL
        ORDER BY je.id`,
      [ids]
    );
    const entriesByJournal = new Map();
    entries.forEach(e => {
      if (!entriesByJournal.has(e.journal_id)) entriesByJournal.set(e.journal_id, []);
      entriesByJournal.get(e.journal_id).push(e);
    });

    const { rows: refRows } = await pg.query(
      `SELECT DISTINCT source_journal_id FROM correction_journals
        WHERE source_journal_id = ANY($1::int[])`,
      [ids]
    );
    const refSet = new Set(refRows.map(r => r.source_journal_id));

    const results = journals.map(j => ({
      journal: j,
      entries: entriesByJournal.get(j.id) || [],
      has_correction_reference: refSet.has(j.id),
    }));
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 2: Restart backend**

```bash
pm2 restart journal-correction-backend
```

Expected: status `online`.

- [ ] **Step 3: Smoke-test search**

Replace `<COOKIE>` with the session cookie from an authenticated browser (DevTools → Application → Cookies → `connect.sid`):

```bash
curl -s -b "connect.sid=<COOKIE>" 'http://127.0.0.1:5180/api/journal-deletions/search?q=1' | head -c 400
```

Expected: JSON with `results` array. If no MySQL journal with id=1 exists, results is `[]`.

- [ ] **Step 4: Commit**

```bash
cd /home/krttpt/journal
git add backend/index.js
git commit -m "feat(api): GET /api/journal-deletions/search"
```

---

## Task 3: Backend Create Endpoint

**Files:**
- Modify: `backend/index.js` — append below the search endpoint.

- [ ] **Step 1: Add helper + POST endpoint**

Append directly below the search endpoint added in Task 2:

```js
/**
 * Builds the snapshot, balance_after, and has_correction_reference for a request.
 * Throws Error with .status if validation fails.
 */
async function buildDeletionPayload({ scope, mysql_journal_id, mysql_entry_ids }) {
  const [journals] = await mysqlPool.query(
    `SELECT id, entry_id, order_number, pr_finance_id, description,
            transaction_date, company_code
       FROM journal WHERE id = ? AND deleted_at IS NULL`,
    [mysql_journal_id]
  );
  if (journals.length === 0) {
    const e = new Error('MySQL journal not found or already deleted');
    e.status = 404; throw e;
  }
  const [entries] = await mysqlPool.query(
    `SELECT je.id, je.type, je.amount, je.account_id, je.notes,
            a.account_number AS account_code, a.name AS account_name
       FROM journal_entries je
       LEFT JOIN accounts a ON a.id = je.account_id
      WHERE je.journal_id = ? AND je.deleted_at IS NULL
      ORDER BY je.id`,
    [mysql_journal_id]
  );

  let balance_after = null;
  if (scope === 'ENTRY') {
    const idSet = new Set(mysql_entry_ids);
    for (const id of idSet) {
      if (!entries.find(e => e.id === id)) {
        const err = new Error(`Entry ${id} does not belong to journal ${mysql_journal_id} or is already deleted`);
        err.status = 400; throw err;
      }
    }
    let debit = 0, credit = 0;
    for (const e of entries) {
      if (idSet.has(e.id)) continue;
      const amt = Number(e.amount);
      if (e.type === 'DEBIT') debit += amt; else if (e.type === 'CREDIT') credit += amt;
    }
    balance_after = {
      debit: debit.toFixed(2),
      credit: credit.toFixed(2),
      imbalance: (debit - credit).toFixed(2),
    };
  }

  const { rows: refRows } = await pg.query(
    `SELECT 1 FROM correction_journals WHERE source_journal_id = $1 LIMIT 1`,
    [mysql_journal_id]
  );
  const has_correction_reference = refRows.length > 0;

  const snapshot = {
    journal: { ...journals[0], captured_at: new Date().toISOString() },
    entries,
  };
  return { snapshot, balance_after, has_correction_reference };
}

/**
 * POST /api/journal-deletions
 * Body: { scope, mysql_journal_id, mysql_entry_ids?, reason }
 */
app.post('/api/journal-deletions', requireAuth, requireRole('maker', 'approver', 'admin'), async (req, res) => {
  const scope = String(req.body?.scope || '').trim();
  const mysql_journal_id = parseInt(req.body?.mysql_journal_id, 10);
  const reason = String(req.body?.reason || '').trim();
  const entry_ids_raw = Array.isArray(req.body?.mysql_entry_ids) ? req.body.mysql_entry_ids : null;

  if (!['JOURNAL', 'ENTRY'].includes(scope)) return res.status(400).json({ error: 'scope must be JOURNAL|ENTRY' });
  if (!Number.isInteger(mysql_journal_id) || mysql_journal_id <= 0) return res.status(400).json({ error: 'mysql_journal_id required' });
  if (!reason) return res.status(400).json({ error: 'reason required' });

  let mysql_entry_ids = null;
  if (scope === 'ENTRY') {
    if (!entry_ids_raw || entry_ids_raw.length === 0) return res.status(400).json({ error: 'mysql_entry_ids required for scope=ENTRY' });
    mysql_entry_ids = entry_ids_raw.map(x => parseInt(x, 10)).filter(Number.isInteger);
    if (mysql_entry_ids.length === 0) return res.status(400).json({ error: 'mysql_entry_ids invalid' });
  }

  try {
    const { snapshot, balance_after, has_correction_reference } =
      await buildDeletionPayload({ scope, mysql_journal_id, mysql_entry_ids });

    const { rows } = await pg.query(
      `INSERT INTO journal_deletion_requests
         (scope, mysql_journal_id, mysql_entry_ids, snapshot, balance_after,
          has_correction_reference, reason, created_by)
       VALUES ($1::text, $2::int, $3::int[], $4::jsonb, $5::jsonb, $6::bool, $7::text, $8::int)
       RETURNING *`,
      [scope, mysql_journal_id, mysql_entry_ids, JSON.stringify(snapshot),
       balance_after ? JSON.stringify(balance_after) : null,
       has_correction_reference, reason, req.session.userId]
    );
    const request = rows[0];
    await pg.query(
      `INSERT INTO journal_deletion_audit_logs (request_id, action, actor_id, details)
       VALUES ($1, 'CREATE', $2, $3::jsonb)`,
      [request.id, req.session.userId, JSON.stringify({ scope, mysql_journal_id, mysql_entry_ids })]
    );
    res.status(201).json(request);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
```

- [ ] **Step 2: Restart backend**

```bash
pm2 restart journal-correction-backend
```

- [ ] **Step 3: Smoke-test create (JOURNAL scope)**

Pick a real MySQL journal id (`<JID>`) from the DB. With the same auth cookie:

```bash
curl -s -b "connect.sid=<COOKIE>" -H 'Content-Type: application/json' \
  -X POST http://127.0.0.1:5180/api/journal-deletions \
  -d '{"scope":"JOURNAL","mysql_journal_id":<JID>,"reason":"test duplicate"}' | head -c 400
```

Expected: 201 with `status:"PENDING"`, `snapshot` populated, `balance_after:null`.

- [ ] **Step 4: Smoke-test ENTRY scope**

Pick a real entry id (`<EID>`) belonging to `<JID>`:

```bash
curl -s -b "connect.sid=<COOKIE>" -H 'Content-Type: application/json' \
  -X POST http://127.0.0.1:5180/api/journal-deletions \
  -d '{"scope":"ENTRY","mysql_journal_id":<JID>,"mysql_entry_ids":[<EID>],"reason":"test entry"}' | head -c 400
```

Expected: 201 with `balance_after` showing imbalance.

- [ ] **Step 5: Commit**

```bash
git add backend/index.js
git commit -m "feat(api): POST /api/journal-deletions"
```

---

## Task 4: Backend List + Detail Endpoints

**Files:**
- Modify: `backend/index.js` — append after the POST endpoint.

- [ ] **Step 1: Add list + detail handlers**

Append:

```js
/**
 * GET /api/journal-deletions?status=&limit=
 */
app.get('/api/journal-deletions', requireAuth, requireRole('maker', 'approver', 'admin'), async (req, res) => {
  const status = req.query.status ? String(req.query.status).toUpperCase() : null;
  const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
  const params = [];
  let where = '';
  if (status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
    params.push(status);
    where = `WHERE r.status = $1::text`;
  }
  params.push(limit);
  const { rows } = await pg.query(
    `SELECT r.id, r.scope, r.mysql_journal_id, r.mysql_entry_ids,
            r.has_correction_reference, r.reason, r.status,
            r.created_at, r.decided_at, r.executed_at,
            r.snapshot->'journal'->>'entry_id'   AS journal_entry_id,
            r.snapshot->'journal'->>'order_number' AS order_number,
            u.full_name AS created_by_name,
            d.full_name AS decided_by_name
       FROM journal_deletion_requests r
       JOIN users u ON u.id = r.created_by
       LEFT JOIN users d ON d.id = r.decided_by
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${params.length}::int`,
    params
  );
  res.json({ rows });
});

/**
 * GET /api/journal-deletions/:id
 */
app.get('/api/journal-deletions/:id', requireAuth, requireRole('maker', 'approver', 'admin'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await pg.query(
    `SELECT r.*, u.full_name AS created_by_name, d.full_name AS decided_by_name
       FROM journal_deletion_requests r
       JOIN users u ON u.id = r.created_by
       LEFT JOIN users d ON d.id = r.decided_by
      WHERE r.id = $1::int`,
    [id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});
```

- [ ] **Step 2: Restart and smoke-test**

```bash
pm2 restart journal-correction-backend
curl -s -b "connect.sid=<COOKIE>" 'http://127.0.0.1:5180/api/journal-deletions?status=pending' | head -c 400
curl -s -b "connect.sid=<COOKIE>" 'http://127.0.0.1:5180/api/journal-deletions/1' | head -c 400
```

Expected: list returns array of pending rows; detail returns single record with full snapshot.

- [ ] **Step 3: Commit**

```bash
git add backend/index.js
git commit -m "feat(api): GET list + detail for journal-deletions"
```

---

## Task 5: Backend Approve Endpoint

**Files:**
- Modify: `backend/index.js` — append.

- [ ] **Step 1: Add approve handler**

Append:

```js
/**
 * POST /api/journal-deletions/:id/approve
 * Body: { notes?: string }
 * Cross-DB sequence: Postgres BEGIN → MySQL BEGIN → MySQL UPDATE → MySQL COMMIT → Postgres UPDATE → Postgres COMMIT
 */
app.post('/api/journal-deletions/:id/approve', requireAuth, requireRole('approver', 'admin'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const notes = req.body?.notes ? String(req.body.notes) : null;
  const decider = req.session.userId;

  const pgClient = await pg.connect();
  let mysqlConn = null;
  try {
    await pgClient.query('BEGIN');
    const { rows } = await pgClient.query(
      `SELECT id, scope, mysql_journal_id, mysql_entry_ids, status, created_by
         FROM journal_deletion_requests
        WHERE id = $1::int FOR UPDATE`,
      [id]
    );
    if (rows.length === 0) { await pgClient.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const r = rows[0];
    if (r.status !== 'PENDING') { await pgClient.query('ROLLBACK'); return res.status(409).json({ error: 'Already decided' }); }
    if (r.created_by === decider) { await pgClient.query('ROLLBACK'); return res.status(403).json({ error: 'Cannot approve own request (separation of duty)' }); }

    mysqlConn = await mysqlPool.getConnection();
    await mysqlConn.beginTransaction();
    let affected = 0;
    if (r.scope === 'JOURNAL') {
      const [j] = await mysqlConn.query(
        `UPDATE journal SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL`,
        [r.mysql_journal_id]
      );
      affected = j.affectedRows;
      await mysqlConn.query(
        `UPDATE journal_entries SET deleted_at = NOW()
          WHERE journal_id = ? AND deleted_at IS NULL`,
        [r.mysql_journal_id]
      );
    } else {
      const [e] = await mysqlConn.query(
        `UPDATE journal_entries SET deleted_at = NOW()
          WHERE id IN (?) AND deleted_at IS NULL`,
        [r.mysql_entry_ids]
      );
      affected = e.affectedRows;
    }
    if (affected === 0) {
      await mysqlConn.rollback();
      await pgClient.query('ROLLBACK');
      await pg.query(
        `INSERT INTO journal_deletion_audit_logs (request_id, action, actor_id, details)
         VALUES ($1, 'EXECUTE_FAILED', $2, $3::jsonb)`,
        [id, decider, JSON.stringify({ reason: 'no rows affected in MySQL' })]
      );
      return res.status(409).json({ error: 'Target already deleted or missing in MySQL' });
    }
    await mysqlConn.commit();

    await pgClient.query(
      `UPDATE journal_deletion_requests
          SET status = 'APPROVED', decided_by = $2::int, decided_at = NOW(),
              decision_notes = $3::text, executed_at = NOW()
        WHERE id = $1::int`,
      [id, decider, notes]
    );
    await pgClient.query(
      `INSERT INTO journal_deletion_audit_logs (request_id, action, actor_id, details)
       VALUES ($1, 'APPROVE', $2, $3::jsonb),
              ($1, 'EXECUTE', $2, $3::jsonb)`,
      [id, decider, JSON.stringify({ notes, affected })]
    );
    await pgClient.query('COMMIT');
    res.json({ ok: true, id, status: 'APPROVED', affected });
  } catch (err) {
    try { if (mysqlConn) await mysqlConn.rollback(); } catch (_) {}
    try { await pgClient.query('ROLLBACK'); } catch (_) {}
    try {
      await pg.query(
        `INSERT INTO journal_deletion_audit_logs (request_id, action, actor_id, details)
         VALUES ($1, 'EXECUTE_FAILED', $2, $3::jsonb)`,
        [id, decider, JSON.stringify({ error: err.message })]
      );
    } catch (_) {}
    res.status(500).json({ error: err.message });
  } finally {
    if (mysqlConn) mysqlConn.release();
    pgClient.release();
  }
});
```

- [ ] **Step 2: Restart**

```bash
pm2 restart journal-correction-backend
```

- [ ] **Step 3: Smoke-test self-approve rejection**

As the same user who created request id `<RID>`:

```bash
curl -s -b "connect.sid=<COOKIE>" -H 'Content-Type: application/json' \
  -X POST http://127.0.0.1:5180/api/journal-deletions/<RID>/approve -d '{}' | head -c 200
```

Expected: 403 with `Cannot approve own request`.

- [ ] **Step 4: Smoke-test approve as a DIFFERENT approver**

Log in as another approver/admin in a second browser, copy that cookie, then:

```bash
curl -s -b "connect.sid=<OTHER_COOKIE>" -H 'Content-Type: application/json' \
  -X POST http://127.0.0.1:5180/api/journal-deletions/<RID>/approve \
  -d '{"notes":"approved"}'
```

Expected: `{ok:true, status:"APPROVED", affected:>0}`. Verify MySQL:

```bash
mysql -e "SELECT id, deleted_at FROM journal WHERE id = <JID>;" <DB>
```

Expected: `deleted_at` populated.

- [ ] **Step 5: Commit**

```bash
git add backend/index.js
git commit -m "feat(api): POST /api/journal-deletions/:id/approve with cross-DB txn"
```

---

## Task 6: Backend Reject Endpoint

**Files:**
- Modify: `backend/index.js` — append.

- [ ] **Step 1: Add reject handler**

Append:

```js
/**
 * POST /api/journal-deletions/:id/reject
 * Body: { notes?: string }
 */
app.post('/api/journal-deletions/:id/reject', requireAuth, requireRole('approver', 'admin'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const notes = req.body?.notes ? String(req.body.notes) : null;
  const decider = req.session.userId;
  try {
    const { rows } = await pg.query(
      `SELECT status, created_by FROM journal_deletion_requests WHERE id = $1::int FOR UPDATE`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (rows[0].status !== 'PENDING') return res.status(409).json({ error: 'Already decided' });
    if (rows[0].created_by === decider) return res.status(403).json({ error: 'Cannot decide own request' });

    await pg.query(
      `UPDATE journal_deletion_requests
          SET status = 'REJECTED', decided_by = $2::int, decided_at = NOW(),
              decision_notes = $3::text
        WHERE id = $1::int`,
      [id, decider, notes]
    );
    await pg.query(
      `INSERT INTO journal_deletion_audit_logs (request_id, action, actor_id, details)
       VALUES ($1, 'REJECT', $2, $3::jsonb)`,
      [id, decider, JSON.stringify({ notes })]
    );
    res.json({ ok: true, id, status: 'REJECTED' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 2: Restart + smoke test**

```bash
pm2 restart journal-correction-backend
# create a fresh pending request first, then:
curl -s -b "connect.sid=<OTHER_COOKIE>" -H 'Content-Type: application/json' \
  -X POST http://127.0.0.1:5180/api/journal-deletions/<RID2>/reject \
  -d '{"notes":"not duplicate"}'
```

Expected: `{ok:true, status:"REJECTED"}`. Verify MySQL row unaffected.

- [ ] **Step 3: Commit**

```bash
git add backend/index.js
git commit -m "feat(api): POST /api/journal-deletions/:id/reject"
```

---

## Task 7: Frontend Routes + Sidebar Link

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Add imports + routes + nav link**

In `frontend/src/App.jsx`, find the import block at the top with the page imports and add:

```jsx
import JournalDeletionsPage from './pages/JournalDeletionsPage.jsx';
import JournalDeletionNewPage from './pages/JournalDeletionNewPage.jsx';
import JournalDeletionDetailPage from './pages/JournalDeletionDetailPage.jsx';
```

In the `<nav>` block (around line 88-94), after the Agent Proposals link, add:

```jsx
{link('/journal-deletions', 'Hapus Journal', '🗑')}
```

In the `<Routes>` block (around line 162-171), before `<Route path="*" …>`, add:

```jsx
<Route path="/journal-deletions" element={<JournalDeletionsPage />} />
<Route path="/journal-deletions/new" element={<JournalDeletionNewPage />} />
<Route path="/journal-deletions/:id" element={<JournalDeletionDetailPage />} />
```

- [ ] **Step 2: Build will fail until pages exist — skip build for now**

(Frontend won't build until Task 8-10 land. Don't `npm run build` yet.)

- [ ] **Step 3: Commit (routing only)**

```bash
git add frontend/src/App.jsx
git commit -m "feat(ui): wire journal-deletions routes + sidebar link"
```

---

## Task 8: Frontend List Page

**Files:**
- Create: `frontend/src/pages/JournalDeletionsPage.jsx`

- [ ] **Step 1: Create page**

```jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { fmtDate } from '../api';

const STATUS_CLASS = {
  PENDING:  'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-800',
};

export default function JournalDeletionsPage() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('PENDING');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/journal-deletions', { params: { status } })
      .then(r => setRows(r.data?.rows || []))
      .finally(() => setLoading(false));
  };
  useEffect(load, [status]);

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:flex-wrap">
        <h2 className="text-lg font-semibold sm:flex-1">🗑 Hapus Journal</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <select className="input w-auto" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
          <button className="btn-ghost" onClick={load}>↻ Refresh</button>
          <Link to="/journal-deletions/new" className="btn-primary">+ Request Baru</Link>
        </div>
      </div>

      {loading && <p className="text-sm opacity-60">Loading…</p>}
      {!loading && rows.length === 0 && <p className="text-sm opacity-60">Tidak ada request {status.toLowerCase()}.</p>}

      <div className="card overflow-hidden">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>ID</th><th>Scope</th><th>Journal</th><th>Maker</th>
                <th>Alasan</th><th>Status</th><th>Tanggal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td><Link to={`/journal-deletions/${r.id}`} className="font-semibold text-prestisa-700 hover:underline">#{r.id}</Link></td>
                  <td><span className="pill bg-slate-100 text-slate-700">{r.scope}</span></td>
                  <td>
                    <div className="text-sm">#{r.mysql_journal_id}</div>
                    <div className="text-[11px] text-prestisa-500">{r.journal_entry_id || ''} {r.order_number ? `· ${r.order_number}` : ''}</div>
                  </td>
                  <td>{r.created_by_name}</td>
                  <td className="max-w-xs truncate" title={r.reason}>{r.reason}</td>
                  <td><span className={`pill ${STATUS_CLASS[r.status] || ''}`}>{r.status}</span></td>
                  <td className="text-xs text-prestisa-500">{fmtDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/JournalDeletionsPage.jsx
git commit -m "feat(ui): JournalDeletionsPage list"
```

---

## Task 9: Frontend New/Create Page

**Files:**
- Create: `frontend/src/pages/JournalDeletionNewPage.jsx`

- [ ] **Step 1: Create page**

```jsx
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { fmtIDR } from '../api';

export default function JournalDeletionNewPage() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null); // {journal, entries, has_correction_reference}
  const [scope, setScope] = useState('JOURNAL');
  const [checked, setChecked] = useState(new Set());
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  const search = async (e) => {
    e?.preventDefault();
    setErr(''); setSearching(true);
    try {
      const { data } = await api.get('/journal-deletions/search', { params: { q } });
      setResults(data.results || []);
      if ((data.results || []).length === 1) pick(data.results[0]);
    } catch (e) {
      setErr(e.response?.data?.error || 'Search gagal');
    } finally { setSearching(false); }
  };

  const pick = (r) => {
    setSelected(r);
    setScope('JOURNAL');
    setChecked(new Set());
    setReason('');
  };

  const toggle = (id) => {
    const next = new Set(checked);
    next.has(id) ? next.delete(id) : next.add(id);
    setChecked(next);
  };

  const balance = useMemo(() => {
    if (!selected || scope !== 'ENTRY') return null;
    let d = 0, c = 0;
    for (const e of selected.entries) {
      if (checked.has(e.id)) continue;
      const a = Number(e.amount);
      if (e.type === 'DEBIT') d += a; else if (e.type === 'CREDIT') c += a;
    }
    return { debit: d, credit: c, imbalance: d - c };
  }, [selected, scope, checked]);

  const submit = async () => {
    setErr('');
    if (!reason.trim()) { setErr('Alasan wajib diisi'); return; }
    if (scope === 'ENTRY' && checked.size === 0) { setErr('Pilih minimal 1 entry'); return; }
    setSubmitting(true);
    try {
      const body = {
        scope,
        mysql_journal_id: selected.journal.id,
        reason,
        ...(scope === 'ENTRY' ? { mysql_entry_ids: [...checked] } : {}),
      };
      const { data } = await api.post('/journal-deletions', body);
      nav(`/journal-deletions/${data.id}`);
    } catch (e) {
      setErr(e.response?.data?.error || 'Gagal submit');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h2 className="text-lg font-semibold mb-3">🗑 Request Hapus Journal</h2>
        <form onSubmit={search} className="flex flex-col sm:flex-row gap-2">
          <input className="input sm:flex-1" placeholder="Cari (ID / Entry ID / Order Number)"
                 value={q} onChange={e => setQ(e.target.value)} autoFocus />
          <button className="btn-primary" disabled={!q.trim() || searching}>
            {searching ? 'Mencari…' : '🔍 Cari'}
          </button>
        </form>
        {err && <div className="mt-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-3 py-2">{err}</div>}
      </div>

      {results.length > 1 && !selected && (
        <div className="card p-4 space-y-2">
          <div className="text-sm font-semibold mb-1">{results.length} journal ditemukan — pilih satu:</div>
          {results.map(r => (
            <button key={r.journal.id} onClick={() => pick(r)} className="w-full text-left p-3 rounded-lg border border-prestisa-100 hover:bg-prestisa-50">
              <div className="font-semibold text-sm">#{r.journal.id} · {r.journal.entry_id}</div>
              <div className="text-xs text-prestisa-500">{r.journal.order_number} — {r.journal.description}</div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <>
          <div className="card p-4">
            <div className="flex items-start justify-between flex-wrap gap-2 mb-3">
              <div>
                <div className="text-xs text-prestisa-500">Journal MySQL</div>
                <div className="font-semibold">#{selected.journal.id} · {selected.journal.entry_id}</div>
                <div className="text-sm text-prestisa-700">{selected.journal.description}</div>
                <div className="text-xs text-prestisa-500 mt-1">
                  {selected.journal.order_number ? `Order ${selected.journal.order_number} · ` : ''}
                  {selected.journal.transaction_date?.slice?.(0, 10)}
                </div>
              </div>
              <button onClick={() => { setSelected(null); setResults([]); }} className="btn-ghost">← Ganti</button>
            </div>

            {selected.has_correction_reference && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2 mb-3">
                ⚠ Journal ini sudah pernah dikoreksi di sistem koreksi. Pastikan reviewer aware.
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 mb-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={scope === 'JOURNAL'} onChange={() => setScope('JOURNAL')} />
                Hapus seluruh journal
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={scope === 'ENTRY'} onChange={() => setScope('ENTRY')} />
                Hapus entry tertentu
              </label>
            </div>

            <div className="table-wrap">
              <table className="data data-compact">
                <thead>
                  <tr>
                    {scope === 'ENTRY' && <th>✓</th>}
                    <th>ID</th><th>Type</th><th>Account</th><th>Notes</th><th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.entries.map(e => (
                    <tr key={e.id} className={scope === 'ENTRY' && checked.has(e.id) ? 'bg-rose-50' : ''}>
                      {scope === 'ENTRY' && (
                        <td><input type="checkbox" checked={checked.has(e.id)} onChange={() => toggle(e.id)} /></td>
                      )}
                      <td className="font-mono">{e.id}</td>
                      <td>{e.type}</td>
                      <td><span className="font-mono">{e.account_code}</span> {e.account_name}</td>
                      <td className="max-w-xs truncate" title={e.notes}>{e.notes}</td>
                      <td className="text-right font-mono">{fmtIDR(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {scope === 'ENTRY' && balance && (
              <div className={`mt-3 text-sm rounded-lg px-3 py-2 border ${
                balance.imbalance === 0
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}>
                Setelah hapus: Debit <b className="font-mono">{fmtIDR(balance.debit)}</b> ·
                Credit <b className="font-mono">{fmtIDR(balance.credit)}</b> ·
                <b className="font-mono"> Selisih {fmtIDR(balance.imbalance)}</b>
                {balance.imbalance !== 0 && ' (akan tidak balance)'}
              </div>
            )}
          </div>

          <div className="card p-4 space-y-3">
            <label className="label">Alasan</label>
            <textarea className="input min-h-[100px]" value={reason} onChange={e => setReason(e.target.value)}
                      placeholder="Cth: Duplikat dari journal #12300, sudah ada entry yang benar di JV-2025-0099" />
            <div className="flex justify-end">
              <button className="btn-primary" disabled={submitting} onClick={submit}>
                {submitting ? 'Submitting…' : 'Submit Request'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/JournalDeletionNewPage.jsx
git commit -m "feat(ui): JournalDeletionNewPage with search + scope + balance preview"
```

---

## Task 10: Frontend Detail Page

**Files:**
- Create: `frontend/src/pages/JournalDeletionDetailPage.jsx`

- [ ] **Step 1: Create page**

```jsx
import React, { useContext, useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api, { fmtDate, fmtIDR } from '../api';
import { AuthCtx } from '../App.jsx';

const STATUS_CLASS = {
  PENDING:  'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-800',
};

export default function JournalDeletionDetailPage() {
  const { id } = useParams();
  const user = useContext(AuthCtx);
  const nav = useNavigate();
  const [r, setR] = useState(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = () => api.get(`/journal-deletions/${id}`).then(res => setR(res.data));
  useEffect(() => { load(); }, [id]);

  if (!r) return <p className="text-sm opacity-60">Loading…</p>;

  const snap = r.snapshot || {};
  const journal = snap.journal || {};
  const entries = snap.entries || [];
  const deletedSet = new Set(r.mysql_entry_ids || []);
  const isApprover = ['approver', 'admin'].includes(user.role);
  const isOwn = user.id === r.created_by;
  const canDecide = r.status === 'PENDING' && isApprover && !isOwn;

  const decide = async (action) => {
    setErr(''); setBusy(true);
    try {
      await api.post(`/journal-deletions/${id}/${action}`, { notes });
      await load();
    } catch (e) {
      setErr(e.response?.data?.error || 'Gagal');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-start justify-between flex-wrap gap-2">
        <div>
          <Link to="/journal-deletions" className="text-sm text-prestisa-500 hover:underline">← Kembali</Link>
          <h2 className="text-lg font-semibold mt-1">
            Request #{r.id}
            <span className="ml-2 pill bg-slate-100 text-slate-700">{r.scope}</span>
            <span className={`ml-2 pill ${STATUS_CLASS[r.status]}`}>{r.status}</span>
          </h2>
        </div>
      </div>

      {r.has_correction_reference && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2">
          ⚠ Journal ini sudah pernah dikoreksi di sistem koreksi.
        </div>
      )}

      <div className="card p-4">
        <div className="text-xs text-prestisa-500 mb-1">Snapshot Journal (MySQL #{r.mysql_journal_id})</div>
        <div className="font-semibold">{journal.entry_id} — {journal.description}</div>
        <div className="text-sm text-prestisa-500">
          {journal.order_number ? `Order ${journal.order_number} · ` : ''}
          {journal.transaction_date?.slice?.(0, 10)}
        </div>

        <div className="table-wrap mt-3">
          <table className="data data-compact">
            <thead>
              <tr><th>ID</th><th>Type</th><th>Account</th><th>Notes</th><th className="text-right">Amount</th></tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} className={r.scope === 'ENTRY' && deletedSet.has(e.id) ? 'bg-rose-50' : ''}>
                  <td className="font-mono">{e.id}</td>
                  <td>{e.type}</td>
                  <td><span className="font-mono">{e.account_code}</span> {e.account_name}</td>
                  <td className="max-w-xs truncate" title={e.notes}>{e.notes}</td>
                  <td className="text-right font-mono">{fmtIDR(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {r.balance_after && (
          <div className={`mt-3 text-sm rounded-lg px-3 py-2 border ${
            Number(r.balance_after.imbalance) === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}>
            Setelah eksekusi: Debit <b className="font-mono">{fmtIDR(r.balance_after.debit)}</b> ·
            Credit <b className="font-mono">{fmtIDR(r.balance_after.credit)}</b> ·
            <b className="font-mono"> Selisih {fmtIDR(r.balance_after.imbalance)}</b>
          </div>
        )}
      </div>

      <div className="card p-4">
        <div className="text-xs text-prestisa-500 mb-1">Maker</div>
        <div className="font-semibold">{r.created_by_name}</div>
        <div className="text-xs text-prestisa-500">{fmtDate(r.created_at)}</div>
        <div className="mt-2 text-sm whitespace-pre-wrap">{r.reason}</div>
      </div>

      <div className="card p-4 space-y-3">
        <div className="text-xs text-prestisa-500">Approval</div>
        {r.status === 'PENDING' && isOwn && (
          <p className="text-sm italic text-prestisa-500">
            Anda yang mengajukan request ini — approver lain harus mereview.
          </p>
        )}
        {r.status === 'PENDING' && !isApprover && (
          <p className="text-sm italic text-prestisa-500">Menunggu approver.</p>
        )}
        {canDecide && (
          <>
            <textarea className="input min-h-[80px]" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Catatan (opsional)" />
            {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-3 py-2">{err}</div>}
            <div className="flex flex-col sm:flex-row gap-2 justify-end">
              <button className="btn-danger" disabled={busy} onClick={() => decide('reject')}>✗ Reject</button>
              <button className="btn-success" disabled={busy} onClick={() => decide('approve')}>✓ Approve & Execute</button>
            </div>
          </>
        )}
        {r.status !== 'PENDING' && (
          <div className="text-sm">
            <div><b>{r.status}</b> oleh {r.decided_by_name} · {fmtDate(r.decided_at)}</div>
            {r.decision_notes && <div className="mt-1 italic">"{r.decision_notes}"</div>}
            {r.executed_at && <div className="text-xs text-prestisa-500 mt-1">Executed: {fmtDate(r.executed_at)}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify `user.id` is in AuthCtx**

Open `frontend/src/App.jsx` and confirm the AuthCtx value carries `id` (e.g. `<AuthCtx.Provider value={user}>` where `user` came from `/api/me`). The backend `/api/me` endpoint already returns the user record with `id`. If for some reason it doesn't, expose `id` there. (Check `backend/index.js` `/api/me` handler near line 152.)

- [ ] **Step 3: Build & restart frontend**

```bash
cd /home/krttpt/journal/frontend
npm run build
```

Expected: build success, no missing module errors.

- [ ] **Step 4: Commit**

```bash
cd /home/krttpt/journal
git add frontend/src/pages/JournalDeletionDetailPage.jsx
git commit -m "feat(ui): JournalDeletionDetailPage with approve/reject"
```

---

## Task 11: End-to-End Smoke Test

- [ ] **Step 1: Manual UI flow**

1. Open `https://journal.prestisa.net/journal-deletions` as a **maker** user. Confirm sidebar shows "Hapus Journal".
2. Click "+ Request Baru" → search for a real duplicate journal by entry_id or order_number → result appears.
3. Default scope = JOURNAL. Type alasan, submit → redirects to detail page with `PENDING`.
4. Log out, log in as **approver** (different user). Open the request from list. Verify approve & reject buttons visible.
5. Click "Approve & Execute" → status changes to `APPROVED`, `Executed:` timestamp appears.
6. In MySQL: confirm `journal.deleted_at` and all `journal_entries.deleted_at` for that journal are set.

- [ ] **Step 2: Test ENTRY scope**

1. As maker, create a new request, this time choose "Hapus entry tertentu", check one DEBIT row.
2. Verify balance preview shows imbalance (red).
3. Submit. Detail page shows `balance_after` and the deleted entry highlighted rose.
4. As approver, approve. Confirm only that specific entry has `deleted_at` set; parent `journal.deleted_at` is still NULL; sibling entries unaffected.

- [ ] **Step 3: Test guards**

1. As maker who created request, try to approve own request via the approver UI (refresh the detail after creating). Verify error `Cannot approve own request`.
2. As approver, try to approve a request that's already APPROVED. Expect `Already decided`.
3. Try ENTRY scope with empty checkboxes — UI should block submission with "Pilih minimal 1 entry".

- [ ] **Step 4: Verify audit log**

```bash
psql -U journal_app -d journal_correction -c \
  "SELECT request_id, action, actor_id, created_at FROM journal_deletion_audit_logs ORDER BY id DESC LIMIT 20;"
```

Expected: CREATE + APPROVE + EXECUTE rows for each approved request.

- [ ] **Step 5: Final commit (if any small fixes)**

If any tweaks needed in the smoke test, commit them:

```bash
git add -p
git commit -m "fix(journal-deletion): smoke-test polish"
```

---

## Done Criteria

- ✅ Two new Postgres tables exist and are populated by use.
- ✅ Maker can create JOURNAL and ENTRY scope requests via UI.
- ✅ Approver (different user) can approve → MySQL `deleted_at` is set on correct rows.
- ✅ Approver can reject → no MySQL changes.
- ✅ Maker cannot self-approve (403).
- ✅ Duplicate/already-decided requests return 409.
- ✅ Correction-reference banner shows when applicable.
- ✅ ENTRY scope live-previews balance and stores `balance_after`.
- ✅ Audit log has rows for every state transition.
