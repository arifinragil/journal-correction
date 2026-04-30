require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { Pool } = require('pg');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const pg = new Pool({
  host: process.env.PG_HOST, port: parseInt(process.env.PG_PORT),
  database: process.env.PG_DATABASE, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
});
const my = mysql.createPool({
  host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT),
  database: process.env.DB_DATABASE, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});

const USERS = [
  { username: 'maker1',    password: 'password123', full_name: 'Andi Saputra',  role: 'maker' },
  { username: 'approver1', password: 'password123', full_name: 'Budi Santoso',  role: 'approver' },
  { username: 'admin',     password: 'admin123',    full_name: 'Citra Lestari', role: 'admin' },
];

async function pickBalancedJournals(limit) {
  const [rows] = await my.query(`
    SELECT je.journal_id,
           SUM(CASE WHEN LOWER(je.type)='debit'  THEN je.amount ELSE 0 END) AS d,
           SUM(CASE WHEN LOWER(je.type)='credit' THEN je.amount ELSE 0 END) AS c,
           COUNT(*) AS n,
           MAX(je.transaction_date) AS td
    FROM journal_entries je
    JOIN journal j ON j.id = je.journal_id
    WHERE je.deleted_at IS NULL AND j.deleted_at IS NULL
      AND je.transaction_date >= '2026-04-01'
      AND je.amount BETWEEN 100000 AND 5000000
    GROUP BY je.journal_id
    HAVING n = 2 AND ABS(d - c) < 0.01 AND d > 0
    ORDER BY je.journal_id DESC
    LIMIT ?
  `, [limit]);
  return rows.map(r => r.journal_id);
}

async function fetchJournalEntries(journalId) {
  const [rows] = await my.query(`
    SELECT je.id, je.type, je.amount, je.account_id, je.notes, je.transaction_date, je.company_code,
           j.entry_id AS journal_entry_id, j.order_number, j.pr_finance_id, j.description AS journal_description,
           a.account_number AS account_code, a.name AS account_name
    FROM journal_entries je
    JOIN journal j ON j.id = je.journal_id
    LEFT JOIN accounts a ON a.id = je.account_id
    WHERE je.journal_id = ? AND je.deleted_at IS NULL
    ORDER BY je.id
  `, [journalId]);
  return rows;
}

async function genCJID(client) {
  const yyyymm = new Date().toISOString().slice(0, 7).replace('-', '');
  const prefix = `CJ-${yyyymm}-`;
  const { rows } = await client.query(
    `SELECT correction_journal_id FROM correction_journals WHERE correction_journal_id LIKE $1 ORDER BY id DESC LIMIT 1`,
    [prefix + '%']
  );
  let next = 1;
  if (rows.length > 0) {
    const last = parseInt(rows[0].correction_journal_id.slice(prefix.length));
    if (!isNaN(last)) next = last + 1;
  }
  return prefix + String(next).padStart(4, '0');
}

async function main() {
  console.log('▶ Seeding users...');
  await pg.query(`TRUNCATE correction_logs, correction_attachments, correction_journal_entries, correction_journals, users RESTART IDENTITY CASCADE`);

  const userIds = {};
  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    const { rows } = await pg.query(
      `INSERT INTO users (username, password_hash, full_name, role) VALUES ($1,$2,$3,$4) RETURNING id`,
      [u.username, hash, u.full_name, u.role]
    );
    userIds[u.username] = rows[0].id;
    console.log(`  ✓ ${u.username} (${u.role}) → id ${rows[0].id}`);
  }

  console.log('▶ Picking 3 balanced journals from MySQL prod...');
  const journalIds = await pickBalancedJournals(3);
  if (journalIds.length < 3) throw new Error('Not enough balanced journals found');
  console.log('  picked:', journalIds);

  const samples = [
    { journal: journalIds[0], status: 'DRAFT',
      reason: 'Akun pencatatan salah — seharusnya posting ke akun bank yang berbeda sesuai company code.' },
    { journal: journalIds[1], status: 'PENDING',
      reason: 'Kesalahan input nominal — invoice sebenarnya lebih kecil 50.000 dari yang dicatat.' },
    { journal: journalIds[2], status: 'APPROVED',
      reason: 'Salah input transaction_date — backdate ke periode sebelumnya untuk closing yang benar.' },
  ];

  for (const s of samples) {
    const entries = await fetchJournalEntries(s.journal);
    if (entries.length < 2) { console.log('  skip', s.journal); continue; }

    const client = await pg.connect();
    try {
      await client.query('BEGIN');
      const cjId = await genCJID(client);
      const isApprovedOrPending = (s.status === 'PENDING' || s.status === 'APPROVED');
      const submittedAt = isApprovedOrPending ? `NOW() - INTERVAL '2 hours'` : 'NULL';
      const reviewedSet = (s.status === 'APPROVED')
        ? `, reviewed_by = ${userIds.approver1}, reviewed_at = NOW() - INTERVAL '30 minutes'`
        : '';

      const { rows: ins } = await client.query(
        `INSERT INTO correction_journals
         (correction_journal_id, status, reason, source_journal_id, source_journal_entry_id, created_by, submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6, ${s.status === 'DRAFT' ? 'NULL' : `NOW() - INTERVAL '2 hours'`})
         RETURNING id`,
        [cjId, s.status, s.reason, s.journal, entries[0].journal_entry_id, userIds.maker1]
      );
      if (reviewedSet) {
        await client.query(`UPDATE correction_journals SET reviewed_by = $1, reviewed_at = NOW() - INTERVAL '30 minutes', review_note = $2 WHERE id = $3`,
          [userIds.approver1, 'Approved — supporting documents complete and balance verified.', ins[0].id]);
      }

      // Build corrected entries: tweak a small amount (mocking small adjustment) for one of the seeds, change account for another
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        let corrected_amount = Number(e.amount);
        let corrected_account_id = e.account_id;
        let corrected_account_code = e.account_code;
        let corrected_account_name = e.account_name;
        let corrected_notes = e.notes;
        if (s.status === 'PENDING') {
          // reduce both legs by 50000 (still balanced)
          corrected_amount = Math.max(0, corrected_amount - 50000);
        } else if (s.status === 'APPROVED') {
          // change account name for first leg only — simulate account swap (still balanced as type/amount same on each side)
          if (i === 0) {
            corrected_account_id = e.account_id; // keep id in mockup
            corrected_account_name = e.account_name + ' (Corrected: backdated period)';
          }
        } else {
          // DRAFT: change account name + tweak notes on first leg
          if (i === 0) {
            corrected_notes = (e.notes || '') + ' [REVISI: posting ulang ke akun yang benar]';
          }
        }

        await client.query(
          `INSERT INTO correction_journal_entries (
             correction_journal_id, source_journal_entry_id,
             original_type, original_amount, original_account_id, original_account_code, original_account_name,
             original_notes, original_transaction_date, original_company_code,
             corrected_type, corrected_amount, corrected_account_id, corrected_account_code, corrected_account_name,
             corrected_notes, corrected_transaction_date, corrected_company_code
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [
            ins[0].id, e.id,
            e.type, e.amount, e.account_id, e.account_code, e.account_name,
            e.notes, e.transaction_date, e.company_code,
            e.type, corrected_amount, corrected_account_id, corrected_account_code, corrected_account_name,
            corrected_notes, e.transaction_date, e.company_code,
          ]
        );
      }
      await client.query(
        `INSERT INTO correction_logs (correction_journal_id, action, actor_user_id, created_at, payload_json)
         VALUES ($1, 'CREATED', $2, NOW() - INTERVAL '3 hours', $3)`,
        [ins[0].id, userIds.maker1, JSON.stringify({ entry_count: entries.length, source_journal_id: s.journal })]
      );
      if (s.status === 'PENDING' || s.status === 'APPROVED') {
        await client.query(
          `INSERT INTO correction_logs (correction_journal_id, action, actor_user_id, created_at)
           VALUES ($1, 'SUBMITTED', $2, NOW() - INTERVAL '2 hours')`,
          [ins[0].id, userIds.maker1]
        );
      }
      if (s.status === 'APPROVED') {
        await client.query(
          `INSERT INTO correction_logs (correction_journal_id, action, actor_user_id, created_at, payload_json)
           VALUES ($1, 'APPROVED', $2, NOW() - INTERVAL '30 minutes', $3)`,
          [ins[0].id, userIds.approver1, JSON.stringify({ note: 'Approved — supporting documents complete and balance verified.' })]
        );
      }

      await client.query('COMMIT');
      console.log(`  ✓ ${cjId} [${s.status}] from journal_id=${s.journal} (${entries.length} entries)`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('  ✗ FAILED:', e.message);
    } finally { client.release(); }
  }

  await pg.end(); await my.end();
  console.log('✅ Seed complete');
}

main().catch(e => { console.error(e); process.exit(1); });
