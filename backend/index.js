require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express  = require('express');
const cors     = require('cors');
const session  = require('express-session');
const mysql    = require('mysql2/promise');
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: false, maxAge: 8 * 60 * 60 * 1000, sameSite: 'lax' },
}));

// SSO via Authentik forward_auth: auto-set session dari header X-Authentik-*
app.use((req, _res, next) => {
  if (!req.session?.user && !req.session?.authenticated && req.headers['x-authentik-username']) {
    req.session.authenticated = true;
    req.session.user = {
      username: req.headers['x-authentik-username'],
      displayName: req.headers['x-authentik-name'] || req.headers['x-authentik-username'],
      email: req.headers['x-authentik-email'] || '',
    };
  }
  next();
});


const pg = new Pool({
  host: process.env.PG_HOST,
  port: parseInt(process.env.PG_PORT),
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  max: 10,
});

const mysqlPool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 5,
});

const UPLOAD_DIR = path.resolve(__dirname, process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png', 'image/jpeg', 'image/jpg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _f, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, crypto.randomUUID() + ext);
    },
  }),
  limits: {
    fileSize: parseInt(process.env.MAX_UPLOAD_MB || '5') * 1024 * 1024,
    files: parseInt(process.env.MAX_UPLOAD_FILES || '5'),
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error('File type not allowed: ' + file.mimetype));
  },
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
  const t = req.headers['x-agent-token'];
  const expected = process.env.AGENT_SERVICE_TOKEN || process.env.AGENT_TOKEN;
  if (t && expected && t === expected) {
    req.agent = { source: 'agent-runtime' };
    return next();
  }
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

/**
 * Token-based auth for service-to-service calls (e.g., n8n webhooks from agent runtime).
 * Reads X-Agent-Token header, compares constant-time against AGENT_TOKEN env.
 * Sets req.agentToken=true on success so downstream handlers can branch.
 */
function requireAgentToken(req, res, next) {
  const expected = process.env.AGENT_TOKEN;
  const got = req.get('X-Agent-Token');
  if (!expected) return res.status(503).json({ error: 'AGENT_TOKEN not configured on server' });
  if (!got || got.length !== expected.length) return res.status(401).json({ error: 'Invalid agent token' });
  // Constant-time comparison
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  if (diff !== 0) return res.status(401).json({ error: 'Invalid agent token' });
  req.agentToken = true;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.session.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
  try {
    const { rows } = await pg.query(
      'SELECT id, username, password_hash, full_name, role, is_active FROM users WHERE username = $1',
      [username]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const u = rows[0];
    if (!u.is_active) return res.status(403).json({ error: 'Account disabled' });
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    req.session.userId = u.id;
    req.session.username = u.username;
    req.session.role = u.role;
    req.session.fullName = u.full_name;
    res.json({ id: u.id, username: u.username, full_name: u.full_name, role: u.role });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/me', requireAuth, (req, res) => {
  res.json({
    id: req.session.userId,
    username: req.session.username,
    full_name: req.session.fullName,
    role: req.session.role,
  });
});

// ---------------------------------------------------------------------------
// Lookups (READ-ONLY MySQL)
// ---------------------------------------------------------------------------
app.get('/api/journal-entries/:id', requireAuth, async (req, res) => {
  try {
    const [rows] = await mysqlPool.query(
      `SELECT je.id, je.type, je.amount, je.account_id, je.journal_id,
              je.notes, je.transaction_date, je.company_code, je.report,
              j.entry_id AS journal_entry_id, j.order_number, j.pr_finance_id, j.description AS journal_description,
              a.account_number AS account_code, a.name AS account_name, a.type AS account_type
       FROM journal_entries je
       JOIN journal j ON j.id = je.journal_id
       LEFT JOIN accounts a ON a.id = je.account_id
       WHERE je.id = ? AND je.deleted_at IS NULL AND j.deleted_at IS NULL`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/journal/:id/entries', requireAuth, async (req, res) => {
  try {
    const [rows] = await mysqlPool.query(
      `SELECT je.id, je.type, je.amount, je.account_id, je.journal_id,
              je.notes, je.transaction_date, je.company_code,
              j.entry_id AS journal_entry_id, j.order_number, j.pr_finance_id, j.description AS journal_description,
              a.account_number AS account_code, a.name AS account_name
       FROM journal_entries je
       JOIN journal j ON j.id = je.journal_id
       LEFT JOIN accounts a ON a.id = je.account_id
       WHERE je.journal_id = ? AND je.deleted_at IS NULL AND j.deleted_at IS NULL
       ORDER BY je.id`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/accounts', requireAuth, async (req, res) => {
  try {
    const q = '%' + (req.query.q || '') + '%';
    const [rows] = await mysqlPool.query(
      `SELECT id, account_number AS code, name, type, category
       FROM accounts
       WHERE deleted_at IS NULL AND (name LIKE ? OR account_number LIKE ?)
       ORDER BY account_number
       LIMIT 50`,
      [q, q]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------
async function generateCorrectionId(client) {
  const now = new Date();
  const yyyymm = now.toISOString().slice(0, 7).replace('-', '');
  const prefix = `CJ-${yyyymm}-`;
  const { rows } = await client.query(
    `SELECT correction_journal_id FROM correction_journals
     WHERE correction_journal_id LIKE $1
     ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [prefix + '%']
  );
  let next = 1;
  if (rows.length > 0) {
    const lastSeq = parseInt(rows[0].correction_journal_id.slice(prefix.length));
    if (!isNaN(lastSeq)) next = lastSeq + 1;
  }
  return prefix + String(next).padStart(4, '0');
}

function sumByType(entries, type, field) {
  return entries
    .filter(e => (e[field === 'amount' ? 'type' : 'corrected_type'] || e.type || '').toLowerCase() === type)
    .reduce((s, e) => s + Number(e[field] || 0), 0);
}

function isBalanced(entries, typeField, amountField) {
  const debit = entries
    .filter(e => (e[typeField] || '').toLowerCase() === 'debit')
    .reduce((s, e) => s + Number(e[amountField] || 0), 0);
  const credit = entries
    .filter(e => (e[typeField] || '').toLowerCase() === 'credit')
    .reduce((s, e) => s + Number(e[amountField] || 0), 0);
  return { ok: Math.abs(debit - credit) < 0.01, debit, credit };
}

app.get('/api/corrections', requireAuth, async (req, res) => {
  try {
    const params = [];
    let where = '1=1';
    if (req.query.status) { params.push(req.query.status); where += ` AND cj.status = $${params.length}`; }
    if (req.query.q) { params.push('%' + req.query.q + '%'); where += ` AND (cj.correction_journal_id ILIKE $${params.length} OR cj.reason ILIKE $${params.length})`; }
    if (req.query.mine === '1') { params.push(req.session.userId); where += ` AND cj.created_by = $${params.length}`; }
    const { rows } = await pg.query(
      `SELECT cj.id, cj.correction_journal_id, cj.status, cj.reason,
              cj.source_journal_id, cj.source_journal_entry_id,
              cj.created_at, cj.submitted_at, cj.reviewed_at,
              uc.full_name AS created_by_name, uc.username AS created_by_username,
              ur.full_name AS reviewed_by_name,
              (SELECT COUNT(*) FROM correction_journal_entries WHERE correction_journal_id = cj.id) AS entry_count,
              (SELECT COALESCE(SUM(corrected_amount),0) FROM correction_journal_entries
               WHERE correction_journal_id = cj.id AND corrected_type ILIKE 'debit') AS total_debit
       FROM correction_journals cj
       JOIN users uc ON uc.id = cj.created_by
       LEFT JOIN users ur ON ur.id = cj.reviewed_by
       WHERE ${where}
       ORDER BY cj.created_at DESC
       LIMIT 100`,
      params
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/corrections/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows: hRows } = await pg.query(
      `SELECT cj.*, uc.full_name AS created_by_name, uc.username AS created_by_username,
              ur.full_name AS reviewed_by_name, ur.username AS reviewed_by_username
       FROM correction_journals cj
       JOIN users uc ON uc.id = cj.created_by
       LEFT JOIN users ur ON ur.id = cj.reviewed_by
       WHERE cj.id = $1`,
      [id]
    );
    if (hRows.length === 0) return res.status(404).json({ error: 'Not found' });
    const header = hRows[0];
    if (header.source_journal_id) {
      try {
        const [jRows] = await mysqlPool.query(
          `SELECT entry_id, order_number, pr_finance_id, description
           FROM journal WHERE id = ? LIMIT 1`,
          [header.source_journal_id]
        );
        if (jRows.length > 0) {
          header.source_order_number = jRows[0].order_number;
          header.source_pr_finance_id = jRows[0].pr_finance_id;
          header.source_journal_entry_code = jRows[0].entry_id;
          header.source_journal_description = jRows[0].description;
        }
      } catch (_) { /* MySQL lookup failure should not block detail view */ }
    }
    const { rows: eRows } = await pg.query(
      `SELECT * FROM correction_journal_entries WHERE correction_journal_id = $1 ORDER BY id`,
      [id]
    );
    const { rows: aRows } = await pg.query(
      `SELECT id, original_name, mime_type, size_bytes, uploaded_at FROM correction_attachments WHERE correction_journal_id = $1 ORDER BY id`,
      [id]
    );
    const { rows: lRows } = await pg.query(
      `SELECT cl.id, cl.action, cl.payload_json, cl.created_at,
              u.full_name AS actor_name, u.username AS actor_username, u.role AS actor_role
       FROM correction_logs cl JOIN users u ON u.id = cl.actor_user_id
       WHERE cl.correction_journal_id = $1 ORDER BY cl.created_at`,
      [id]
    );
    res.json({ header, entries: eRows, attachments: aRows, logs: lRows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/corrections', requireAuth, requireRole('maker', 'admin'), async (req, res) => {
  const { reason, source_journal_id, source_journal_entry_id, entries } = req.body || {};
  const mode = String(req.body?.mode || 'CORRECTION').trim().toUpperCase();
  if (!['CORRECTION', 'ADD_ENTRIES'].includes(mode)) return res.status(400).json({ error: 'mode must be CORRECTION|ADD_ENTRIES' });
  if (!reason || reason.trim().length < 10) return res.status(400).json({ error: 'Reason required (min 10 chars)' });
  if (!Array.isArray(entries) || entries.length < 2) return res.status(400).json({ error: 'At least 2 entries required' });

  const sourceJournalId = Number.isInteger(source_journal_id) ? source_journal_id : parseInt(source_journal_id, 10);
  if (mode === 'ADD_ENTRIES') {
    if (!Number.isInteger(sourceJournalId) || sourceJournalId <= 0) {
      return res.status(400).json({ error: 'source_journal_id required for ADD_ENTRIES' });
    }
  }

  if (mode === 'CORRECTION') {
    const orig = isBalanced(entries, 'original_type', 'original_amount');
    if (!orig.ok) return res.status(400).json({ error: `Original entries not balanced (debit=${orig.debit}, credit=${orig.credit})` });
  }
  const corr = isBalanced(entries, 'corrected_type', 'corrected_amount');
  if (!corr.ok) return res.status(400).json({ error: `Corrected entries not balanced (debit=${corr.debit}, credit=${corr.credit})` });

  const client = await pg.connect();
  try {
    await client.query('BEGIN');
    const cjId = await generateCorrectionId(client);
    const { rows: ins } = await client.query(
      `INSERT INTO correction_journals
       (correction_journal_id, status, mode, reason, source_journal_id, source_journal_entry_id, created_by)
       VALUES ($1, 'DRAFT', $2, $3, $4, $5, $6) RETURNING id`,
      [
        cjId,
        mode,
        reason.trim(),
        Number.isInteger(sourceJournalId) ? sourceJournalId : null,
        mode === 'ADD_ENTRIES' ? null : (source_journal_entry_id || null),
        req.session.userId,
      ]
    );
    const newId = ins[0].id;
    for (const e of entries) {
      const isAdd = mode === 'ADD_ENTRIES';
      await client.query(
        `INSERT INTO correction_journal_entries
         (correction_journal_id, source_journal_entry_id,
          original_type, original_amount, original_account_id, original_account_code, original_account_name,
          original_notes, original_transaction_date, original_company_code,
          corrected_type, corrected_amount, corrected_account_id, corrected_account_code, corrected_account_name,
          corrected_notes, corrected_transaction_date, corrected_company_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          newId,
          isAdd ? null : e.source_journal_entry_id,
          isAdd ? null : e.original_type,
          isAdd ? null : e.original_amount,
          isAdd ? null : e.original_account_id,
          isAdd ? null : e.original_account_code,
          isAdd ? null : e.original_account_name,
          isAdd ? null : e.original_notes,
          isAdd ? null : e.original_transaction_date,
          isAdd ? null : e.original_company_code,
          e.corrected_type, e.corrected_amount, e.corrected_account_id, e.corrected_account_code, e.corrected_account_name,
          e.corrected_notes, e.corrected_transaction_date, e.corrected_company_code,
        ]
      );
    }
    await client.query(
      `INSERT INTO correction_logs (correction_journal_id, action, actor_user_id, payload_json)
       VALUES ($1, 'CREATED', $2, $3)`,
      [newId, req.session.userId, JSON.stringify({ entry_count: entries.length, mode })]
    );
    await client.query('COMMIT');
    res.json({ id: newId, correction_journal_id: cjId, status: 'DRAFT', mode });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

app.post('/api/corrections/:id/submit', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const client = await pg.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT status, created_by FROM correction_journals WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    if (rows[0].created_by !== req.session.userId && req.session.role !== 'admin') {
      await client.query('ROLLBACK'); return res.status(403).json({ error: 'Not your draft' });
    }
    if (!['DRAFT', 'REJECTED'].includes(rows[0].status)) {
      await client.query('ROLLBACK'); return res.status(400).json({ error: 'Only DRAFT or REJECTED can be submitted' });
    }
    await client.query(
      `UPDATE correction_journals SET status = 'PENDING', submitted_at = NOW() WHERE id = $1`,
      [id]
    );
    await client.query(
      `INSERT INTO correction_logs (correction_journal_id, action, actor_user_id) VALUES ($1, 'SUBMITTED', $2)`,
      [id, req.session.userId]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK'); res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

async function pushCorrectionToMySQL(client, correctionId) {
  // Read parent correction (mode + source journal) and the entries
  const { rows: cjRows } = await client.query(
    `SELECT mode, source_journal_id FROM correction_journals WHERE id = $1`,
    [correctionId]
  );
  if (cjRows.length === 0) throw new Error('correction not found');
  const { mode, source_journal_id } = cjRows[0];

  const { rows: entries } = await client.query(
    `SELECT source_journal_entry_id,
            corrected_type, corrected_amount, corrected_account_id,
            corrected_notes, corrected_transaction_date, corrected_company_code
       FROM correction_journal_entries
      WHERE correction_journal_id = $1
      ORDER BY id`,
    [correctionId]
  );
  if (entries.length === 0) throw new Error('No entries to sync');

  const conn = await mysqlPool.getConnection();
  try {
    await conn.beginTransaction();

    if (mode === 'ADD_ENTRIES') {
      if (!source_journal_id) throw new Error('ADD_ENTRIES requires source_journal_id');
      // Verify parent journal exists and not deleted
      const [parent] = await conn.query(
        `SELECT id, transaction_date, company_code FROM journal WHERE id = ? AND deleted_at IS NULL`,
        [source_journal_id]
      );
      if (parent.length === 0) throw new Error(`MySQL journal id=${source_journal_id} not found or deleted`);
      const fallbackDate = parent[0].transaction_date;
      const fallbackCompany = parent[0].company_code;

      for (const e of entries) {
        await conn.query(
          `INSERT INTO journal_entries
             (journal_id, type, amount, account_id, notes, transaction_date, company_code, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            source_journal_id,
            e.corrected_type,
            e.corrected_amount,
            e.corrected_account_id,
            e.corrected_notes,
            e.corrected_transaction_date || fallbackDate,
            e.corrected_company_code || fallbackCompany,
          ]
        );
      }
    } else {
      // CORRECTION mode — UPDATE existing entries by source_journal_entry_id
      for (const e of entries) {
        const [result] = await conn.query(
          `UPDATE journal_entries
              SET type = ?, amount = ?, account_id = ?, notes = ?,
                  transaction_date = ?, company_code = ?, updated_at = NOW()
            WHERE id = ?`,
          [
            e.corrected_type,
            e.corrected_amount,
            e.corrected_account_id,
            e.corrected_notes,
            e.corrected_transaction_date,
            e.corrected_company_code,
            e.source_journal_entry_id,
          ]
        );
        if (result.affectedRows !== 1) {
          throw new Error(`journal_entries id=${e.source_journal_entry_id} not found or not updated`);
        }
      }
    }
    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch {}
    throw err;
  } finally {
    conn.release();
  }
}

async function reviewAction(req, res, action) {
  const id = parseInt(req.params.id);
  const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const note = (req.body && req.body.note) || null;
  if (action === 'REJECT' && !note) return res.status(400).json({ error: 'Reject note required' });
  const client = await pg.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT status, created_by FROM correction_journals WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    if (rows[0].status !== 'PENDING') {
      await client.query('ROLLBACK'); return res.status(400).json({ error: 'Only PENDING can be reviewed' });
    }
    if (rows[0].created_by === req.session.userId) {
      await client.query('ROLLBACK'); return res.status(403).json({ error: 'Cannot review your own correction' });
    }

    // For APPROVE: push corrections to MySQL prod first. If it fails, rollback PG (status stays PENDING).
    if (action === 'APPROVE') {
      try {
        await pushCorrectionToMySQL(client, id);
      } catch (err) {
        await client.query('ROLLBACK');
        // Log failure on a fresh PG connection so the audit trail is preserved
        try {
          await pg.query(
            `INSERT INTO correction_logs (correction_journal_id, action, actor_user_id, payload_json)
             VALUES ($1, 'MYSQL_SYNC_FAILED', $2, $3)`,
            [id, req.session.userId, JSON.stringify({ error: err.message })]
          );
        } catch {}
        return res.status(502).json({ error: `MySQL sync failed: ${err.message}. Status tetap PENDING.` });
      }
    }

    await client.query(
      `UPDATE correction_journals
         SET status = $1::varchar, reviewed_by = $2, reviewed_at = NOW(), review_note = $3,
             synced_to_mysql_at = CASE WHEN $1::varchar = 'APPROVED' THEN NOW() ELSE synced_to_mysql_at END
       WHERE id = $4`,
      [newStatus, req.session.userId, note, id]
    );
    await client.query(
      `INSERT INTO correction_logs (correction_journal_id, action, actor_user_id, payload_json)
       VALUES ($1, $2, $3, $4)`,
      [id, newStatus, req.session.userId, JSON.stringify({ note })]
    );
    await client.query('COMMIT');
    res.json({ ok: true, status: newStatus });
  } catch (e) {
    await client.query('ROLLBACK'); res.status(500).json({ error: e.message });
  } finally { client.release(); }
}
app.post('/api/corrections/:id/approve', requireAuth, requireRole('approver', 'admin'), (req, res) => reviewAction(req, res, 'APPROVE'));
app.post('/api/corrections/:id/reject',  requireAuth, requireRole('approver', 'admin'), (req, res) => reviewAction(req, res, 'REJECT'));

// Attachments
app.post('/api/corrections/:id/attachments', requireAuth, upload.array('files', parseInt(process.env.MAX_UPLOAD_FILES || '5')), async (req, res) => {
  const id = parseInt(req.params.id);
  const { rows } = await pg.query('SELECT status, created_by FROM correction_journals WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  if (rows[0].created_by !== req.session.userId && req.session.role !== 'admin')
    return res.status(403).json({ error: 'Forbidden' });
  if (rows[0].status !== 'DRAFT') return res.status(400).json({ error: 'Can only attach in DRAFT' });
  const inserted = [];
  for (const f of req.files) {
    const { rows: r } = await pg.query(
      `INSERT INTO correction_attachments (correction_journal_id, filename, original_name, mime_type, size_bytes, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [id, f.filename, f.originalname, f.mimetype, f.size, req.session.userId]
    );
    inserted.push({ id: r[0].id, original_name: f.originalname });
  }
  res.json(inserted);
});

app.get('/api/corrections/:id/attachments/:fid', requireAuth, async (req, res) => {
  const { rows } = await pg.query(
    'SELECT filename, original_name, mime_type FROM correction_attachments WHERE id = $1 AND correction_journal_id = $2',
    [req.params.fid, req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Type', rows[0].mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${rows[0].original_name}"`);
  res.sendFile(path.join(UPLOAD_DIR, rows[0].filename));
});

// Users (admin)
app.get('/api/users', requireAuth, requireRole('admin'), async (req, res) => {
  const { rows } = await pg.query(
    'SELECT id, username, full_name, role, is_active, created_at FROM users ORDER BY id'
  );
  res.json(rows);
});

app.post('/api/users', requireAuth, requireRole('admin'), async (req, res) => {
  const { username, password, full_name, role } = req.body || {};
  if (!username || !password || !full_name || !['maker', 'approver', 'admin'].includes(role))
    return res.status(400).json({ error: 'Invalid payload' });
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pg.query(
      `INSERT INTO users (username, password_hash, full_name, role) VALUES ($1,$2,$3,$4)
       RETURNING id, username, full_name, role, is_active, created_at`,
      [username, hash, full_name, role]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Username taken' });
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const { role, password, is_active } = req.body || {};
  const sets = [];
  const params = [];
  if (role !== undefined) {
    if (!['maker', 'approver', 'admin'].includes(role))
      return res.status(400).json({ error: 'Invalid role' });
    params.push(role); sets.push(`role = $${params.length}`);
  }
  if (password !== undefined && password !== '') {
    if (typeof password !== 'string' || password.length < 6)
      return res.status(400).json({ error: 'Password min 6 chars' });
    const hash = await bcrypt.hash(password, 10);
    params.push(hash); sets.push(`password_hash = $${params.length}`);
  }
  if (is_active !== undefined) {
    params.push(!!is_active); sets.push(`is_active = $${params.length}`);
  }
  if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
  params.push(id);
  try {
    const { rows } = await pg.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, username, full_name, role, is_active, created_at`,
      params
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// Agent Journal Proposals — token-auth endpoint for n8n agent webhook
// ---------------------------------------------------------------------------

/**
 * POST /api/agent-proposals
 * Auth: X-Agent-Token header (NO session required)
 * Body: { agent_slug, debit_account, credit_account, amount, memo?, approval_id_at_studio? }
 * Stores a journal entry proposal from the AI agent system. Human reviews via UI
 * and converts to a real correction (POST /api/corrections) when ready.
 */
app.post('/api/agent-proposals', requireAgentToken, async (req, res) => {
  const b = req.body || {};
  const agentSlug = String(b.agent_slug || '').trim();
  const debit = String(b.debit_account || '').trim();
  const credit = String(b.credit_account || '').trim();
  const amount = Number(b.amount);
  const memo = b.memo ? String(b.memo) : null;
  const approvalId = b.approval_id_at_studio != null ? Number(b.approval_id_at_studio) : null;

  if (!agentSlug) return res.status(400).json({ error: 'agent_slug required' });
  if (!debit) return res.status(400).json({ error: 'debit_account required' });
  if (!credit) return res.status(400).json({ error: 'credit_account required' });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'amount must be positive number' });

  const { rows } = await pg.query(
    `INSERT INTO agent_journal_proposals
       (agent_slug, debit_account, credit_account, amount, memo, approval_id_at_studio, raw_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, status, created_at`,
    [agentSlug, debit, credit, amount, memo, approvalId, b]
  );
  const row = rows[0];
  res.json({
    ok: true,
    id: row.id,
    status: row.status,
    created_at: row.created_at,
    view_url: `https://journal.prestisa.net/agent-proposals/${row.id}`,
  });
});

/**
 * GET /api/agent-proposals?status=pending&limit=50
 * Auth: session (human reviewer only)
 */
app.get('/api/agent-proposals', requireAuth, async (req, res) => {
  const status = req.query.status ? String(req.query.status) : 'pending';
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const { rows } = await pg.query(
    `SELECT id, agent_slug, debit_account, credit_account, amount, memo,
            status, approval_id_at_studio, created_at, posted_at, posted_by, rejected_reason
     FROM agent_journal_proposals
     WHERE status = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [status, limit]
  );
  res.json({ rows, count: rows.length });
});

/**
 * POST /api/agent-proposals/:id/decide
 * Auth: session + role 'maker'|'admin' (human review action)
 * Body: { decision: 'posted'|'rejected', notes?: string }
 */
app.post('/api/agent-proposals/:id/decide', requireAuth, requireRole('maker', 'approver', 'admin'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const decision = String(req.body?.decision || '').trim();
  const notes = req.body?.notes ? String(req.body.notes) : null;
  if (!['posted', 'rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be posted|rejected' });
  const { rowCount } = await pg.query(
    `UPDATE agent_journal_proposals
       SET status = $1::text,
           posted_at = CASE WHEN $1::text='posted' THEN now() ELSE posted_at END,
           posted_by = CASE WHEN $1::text='posted' THEN $2::int ELSE posted_by END,
           rejected_reason = CASE WHEN $1::text='rejected' THEN $3::text ELSE rejected_reason END
     WHERE id = $4::int AND status = 'pending'`,
    [decision, req.session.userId, notes, id]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'proposal not found or already decided' });
  res.json({ ok: true, id, status: decision });
});

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

// ============================================================================
// iris_account_statements: view / add / edit / delete + bulk Excel upload
// ============================================================================
const XLSX = require('xlsx');

const uploadXlsx = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    cb(ok ? null : new Error('File harus .xlsx / .xls / .csv'), ok);
  },
});

function parseStatementRow(raw) {
  const account_id = parseInt(raw.account_id ?? raw.AccountId ?? raw['Account ID'], 10);
  const description = String(raw.description ?? raw.Description ?? '').trim();
  const received = Number(raw.received ?? raw.Received ?? 0) || 0;
  const spent = Number(raw.spent ?? raw.Spent ?? 0) || 0;
  const reconciledRaw = raw.reconciled ?? raw.Reconciled ?? 0;
  const reconciled = (reconciledRaw === 1 || reconciledRaw === '1' || reconciledRaw === true ||
    String(reconciledRaw).toLowerCase() === 'yes' || String(reconciledRaw).toLowerCase() === 'true') ? 1 : 0;
  const closeRaw = raw.close_balance ?? raw['Close Balance'] ?? raw.closeBalance;
  const close_balance = (closeRaw === '' || closeRaw == null) ? null : Number(closeRaw);

  let td = raw.transaction_date ?? raw['Transaction Date'] ?? raw.transactionDate ?? null;
  if (td instanceof Date) td = td.toISOString().slice(0, 19).replace('T', ' ');
  else if (typeof td === 'number') {
    const d = XLSX.SSF.parse_date_code(td);
    if (d) td = `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')} ${String(d.H||0).padStart(2,'0')}:${String(d.M||0).padStart(2,'0')}:${String(d.S||0).padStart(2,'0')}`;
  } else if (typeof td === 'string') {
    td = td.trim() || null;
  }
  return { account_id, description, received, spent, reconciled, close_balance, transaction_date: td };
}

function validateStatement(row, idx) {
  const errs = [];
  if (!Number.isInteger(row.account_id) || row.account_id <= 0) errs.push('account_id invalid');
  if (!(row.received >= 0)) errs.push('received invalid');
  if (!(row.spent >= 0)) errs.push('spent invalid');
  if (row.received === 0 && row.spent === 0) errs.push('received atau spent harus > 0');
  if (row.received > 0 && row.spent > 0) errs.push('hanya salah satu received atau spent yang boleh > 0');
  if (!row.transaction_date) errs.push('transaction_date wajib diisi');
  return errs.length ? { row: idx, errors: errs } : null;
}

// Lookup helper: list accounts (for dropdown)
app.get('/api/iris-accounts', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const params = [];
    let where = 'deleted_at IS NULL';
    if (q) { where += ' AND (name LIKE ? OR account_number LIKE ? OR CAST(id AS CHAR) = ?)'; params.push('%' + q + '%', '%' + q + '%', q); }
    const [rows] = await mysqlPool.query(
      `SELECT id, name, account_number, company_code, type, category FROM accounts WHERE ${where} ORDER BY account_number, name LIMIT 500`, params
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const STMT_SORT_MAP = {
  id: 's.id',
  transaction_date: 's.transaction_date',
  account_number: 'a.account_number',
  account_name: 'a.name',
  description: 's.description',
  received: 's.received',
  spent: 's.spent',
  reconciled: 's.reconciled',
};

function buildStatementFilters(query) {
  const { account_id, account_ids, from, to, q, reconciled } = query;
  const params = [];
  const where = ['s.deleted_at IS NULL'];
  const idList = (account_ids ? String(account_ids).split(',') : [])
    .map(x => parseInt(x, 10)).filter(Number.isInteger);
  if (idList.length > 0) {
    where.push(`s.account_id IN (${idList.map(() => '?').join(',')})`);
    params.push(...idList);
  } else if (account_id) {
    where.push('s.account_id = ?'); params.push(parseInt(account_id, 10));
  }
  if (from) { where.push('s.transaction_date >= ?'); params.push(from); }
  if (to) { where.push('s.transaction_date <= ?'); params.push(to + ' 23:59:59'); }
  if (q) { where.push('s.description LIKE ?'); params.push('%' + q + '%'); }
  if (reconciled === '0' || reconciled === '1') { where.push('s.reconciled = ?'); params.push(parseInt(reconciled, 10)); }
  return { where: where.join(' AND '), params };
}

function buildStatementOrder(query) {
  const col = STMT_SORT_MAP[query.sort] || 's.transaction_date';
  const dir = String(query.dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `${col} ${dir}, s.id ${dir}`;
}

// List with filters
app.get('/api/iris-statements', requireAuth, async (req, res) => {
  try {
    const { where, params } = buildStatementFilters(req.query);
    const order = buildStatementOrder(req.query);
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
    const offset = parseInt(req.query.offset || '0', 10);

    const [rows] = await mysqlPool.query(
      `SELECT s.id, s.account_id, a.name AS account_name, a.account_number, s.description, s.received, s.spent,
              s.reconciled, s.close_balance, s.transaction_date, s.created_at, s.updated_at
         FROM iris_account_statements s
         LEFT JOIN accounts a ON a.id = s.account_id
        WHERE ${where}
        ORDER BY ${order}
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [[cnt]] = await mysqlPool.query(
      `SELECT COUNT(*) AS total FROM iris_account_statements s WHERE ${where}`, params
    );
    res.json({ items: rows, total: cnt.total, limit, offset });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Export all matching rows as XLSX
app.get('/api/iris-statements/export.xlsx', requireAuth, async (req, res) => {
  try {
    const { where, params } = buildStatementFilters(req.query);
    const order = buildStatementOrder(req.query);
    const [rows] = await mysqlPool.query(
      `SELECT s.id, s.transaction_date, a.account_number, s.account_id, a.name AS account_name,
              s.description, s.received, s.spent, s.reconciled, s.close_balance,
              s.created_at, s.updated_at
         FROM iris_account_statements s
         LEFT JOIN accounts a ON a.id = s.account_id
        WHERE ${where}
        ORDER BY ${order}
        LIMIT 100000`, params
    );
    const data = rows.map(r => ({
      id: r.id,
      transaction_date: r.transaction_date ? new Date(r.transaction_date).toISOString().slice(0, 10) : '',
      account_number: r.account_number || '',
      account_id: r.account_id,
      account_name: r.account_name || '',
      description: r.description || '',
      received: Number(r.received) || 0,
      spent: Number(r.spent) || 0,
      reconciled: r.reconciled ? 1 : 0,
      close_balance: r.close_balance == null ? '' : Number(r.close_balance),
      created_at: r.created_at ? new Date(r.created_at).toISOString() : '',
      updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 36 },
      { wch: 50 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 14 },
      { wch: 20 }, { wch: 20 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'statements');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="iris_statements_${stamp}.xlsx"`);
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Detail
app.get('/api/iris-statements/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [rows] = await mysqlPool.query(
      `SELECT s.*, a.name AS account_name, a.account_number
         FROM iris_account_statements s
         LEFT JOIN accounts a ON a.id = s.account_id
        WHERE s.id = ? AND s.deleted_at IS NULL`, [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create one
app.post('/api/iris-statements', requireAuth, requireRole('maker', 'approver', 'admin'), async (req, res) => {
  try {
    const row = parseStatementRow(req.body || {});
    const err = validateStatement(row, 0);
    if (err) return res.status(400).json({ error: err.errors.join('; ') });
    const [r] = await mysqlPool.query(
      `INSERT INTO iris_account_statements
         (account_id, description, received, spent, reconciled, close_balance, transaction_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [row.account_id, row.description, row.received, row.spent, row.reconciled, row.close_balance, row.transaction_date]
    );
    res.json({ id: r.insertId, ...row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update
app.put('/api/iris-statements/:id', requireAuth, requireRole('maker', 'approver', 'admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = parseStatementRow(req.body || {});
    const err = validateStatement(row, 0);
    if (err) return res.status(400).json({ error: err.errors.join('; ') });
    const [r] = await mysqlPool.query(
      `UPDATE iris_account_statements
          SET account_id = ?, description = ?, received = ?, spent = ?,
              reconciled = ?, close_balance = ?, transaction_date = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [row.account_id, row.description, row.received, row.spent, row.reconciled, row.close_balance, row.transaction_date, id]
    );
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ id, ...row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Soft delete
app.delete('/api/iris-statements/:id', requireAuth, requireRole('approver', 'admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [r] = await mysqlPool.query(
      `UPDATE iris_account_statements SET deleted_at = NOW(6) WHERE id = ? AND deleted_at IS NULL`, [id]
    );
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Excel template download
app.get('/api/iris-statements/template/xlsx', requireAuth, (_req, res) => {
  const ws = XLSX.utils.aoa_to_sheet([
    ['account_id', 'description', 'received', 'spent', 'reconciled', 'close_balance', 'transaction_date'],
    [580, 'Contoh: TRSF E-BANKING masuk', 100000, 0, 1, null, '2026-05-19'],
    [580, 'Contoh: BIAYA ADM', 0, 30000, 1, null, '2026-05-19'],
  ]);
  ws['!cols'] = [{ wch: 12 }, { wch: 50 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'statements');
  const ws2 = XLSX.utils.aoa_to_sheet([
    ['Kolom', 'Wajib', 'Keterangan'],
    ['account_id', 'YA', 'ID akun (lihat tab accounts atau lookup di UI)'],
    ['description', 'tidak', 'Keterangan transaksi'],
    ['received', 'salah satu', 'Nominal masuk (rupiah). Isi 0 jika ini transaksi keluar.'],
    ['spent', 'salah satu', 'Nominal keluar (rupiah). Isi 0 jika ini transaksi masuk.'],
    ['reconciled', 'tidak', '1 = sudah reconciled, 0 = belum (default 0)'],
    ['close_balance', 'tidak', 'Saldo akhir setelah transaksi (boleh kosong)'],
    ['transaction_date', 'YA', 'Format: YYYY-MM-DD atau YYYY-MM-DD HH:mm:ss'],
  ]);
  ws2['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'panduan');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="iris_statements_template.xlsx"');
  res.send(buf);
});

// Bulk upload: parse first; if ?commit=1 then insert. Otherwise return preview.
app.post('/api/iris-statements/bulk-upload', requireAuth, requireRole('maker', 'approver', 'admin'),
  uploadXlsx.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'File required' });
    try {
      const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(sheet, { defval: null });
      const parsed = raw.map(parseStatementRow);
      const errors = [];
      parsed.forEach((r, i) => { const e = validateStatement(r, i + 2); if (e) errors.push(e); });

      const commit = req.query.commit === '1' && errors.length === 0;
      if (!commit) {
        return res.json({
          preview: parsed.slice(0, 50),
          total: parsed.length,
          errors,
          commit: false,
        });
      }
      const conn = await mysqlPool.getConnection();
      try {
        await conn.beginTransaction();
        const ids = [];
        for (const row of parsed) {
          const [r] = await conn.query(
            `INSERT INTO iris_account_statements
               (account_id, description, received, spent, reconciled, close_balance, transaction_date)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [row.account_id, row.description, row.received, row.spent, row.reconciled, row.close_balance, row.transaction_date]
          );
          ids.push(r.insertId);
        }
        await conn.commit();
        res.json({ commit: true, inserted: ids.length, ids });
      } catch (e) {
        await conn.rollback();
        res.status(500).json({ error: 'Insert failed: ' + e.message });
      } finally {
        conn.release();
      }
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

const port = parseInt(process.env.PORT || '5180');
app.listen(port, '127.0.0.1', () => console.log('Journal Correction API listening on 127.0.0.1:' + port));
