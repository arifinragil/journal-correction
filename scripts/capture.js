// Capture screenshots of the Correction Journals app.
// Pre-req: backend running on 127.0.0.1:5180. Frontend served by vite preview on 5181.

const { chromium } = require('playwright-chromium');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5181';
const OUT  = path.resolve(__dirname, '..', 'assets', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const VIEW = { width: 1366, height: 860 };

async function login(page, username, password) {
  await page.goto(BASE + '/login');
  await page.waitForSelector('input[autofocus], input', { timeout: 5000 });
  await page.fill('input >> nth=0', username);
  await page.fill('input[type=password]', password);
  await page.click('button:has-text("Masuk")');
  await page.waitForURL(/.*\/(?!login)/, { timeout: 5000 });
}

async function shoot(page, name) {
  const file = path.join(OUT, name);
  await page.waitForTimeout(500);
  await page.screenshot({ path: file, fullPage: false });
  console.log('  ✓', name, '→', file);
}

async function logout(page) {
  await page.click('button:has-text("Logout")').catch(() => {});
  await page.waitForURL(/login/, { timeout: 3000 }).catch(() => {});
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  console.log('▶ 01 Login page');
  await page.goto(BASE + '/login');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await shoot(page, '01-login.png');

  console.log('▶ Login as maker1');
  await login(page, 'maker1', 'password123');
  await page.waitForLoadState('networkidle');
  await shoot(page, '02-dashboard-maker.png');

  console.log('▶ List page');
  await page.goto(BASE + '/corrections');
  await page.waitForLoadState('networkidle');
  await shoot(page, '03-corrections-list.png');

  console.log('▶ Form Step 1 (lookup)');
  await page.goto(BASE + '/corrections/new');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
  await shoot(page, '04-form-step1-lookup.png');

  console.log('▶ Form Step 2 (edit)');
  // pick a balanced journal
  await page.fill('input[placeholder*="cth"]', '339282');
  await page.click('button:has-text("Lookup")');
  await page.waitForSelector('text=ORIGINAL', { timeout: 5000 });
  await page.fill('textarea', 'Akun pencatatan salah — seharusnya posting ke akun bank yang berbeda sesuai company code.');
  await page.waitForTimeout(500);
  await shoot(page, '05-form-step2-edit.png');

  console.log('▶ Form Step 3 (review)');
  await page.click('button:has-text("Lanjut Review")');
  await page.waitForSelector('text=Review & Submit', { timeout: 5000 });
  await page.waitForTimeout(400);
  await shoot(page, '06-form-step3-review.png');

  console.log('▶ Detail page (DRAFT) - go to existing one');
  await page.goto(BASE + '/corrections');
  await page.waitForLoadState('networkidle');
  await page.click('a:has-text("CJ-202604-0001")');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await shoot(page, '07-detail-draft.png');

  console.log('▶ Logout, login as approver1');
  await logout(page);
  await login(page, 'approver1', 'password123');
  await page.goto(BASE + '/corrections');
  await page.waitForLoadState('networkidle');
  await page.click('a:has-text("CJ-202604-0002")');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await shoot(page, '08-detail-pending-approver.png');

  console.log('▶ Logout, login as admin → users page');
  await logout(page);
  await login(page, 'admin', 'admin123');
  await page.goto(BASE + '/users');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await shoot(page, '09-users-admin.png');

  console.log('▶ Approved detail (admin view)');
  await page.goto(BASE + '/corrections');
  await page.waitForLoadState('networkidle');
  await page.click('a:has-text("CJ-202604-0003")');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await shoot(page, '10-detail-approved.png');

  await browser.close();
  console.log('✅ All screenshots captured to', OUT);
})().catch(e => { console.error(e); process.exit(1); });
