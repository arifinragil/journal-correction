// Capture remaining 3 screenshots that timed out.
const { chromium } = require('playwright-chromium');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5182';
const OUT  = path.resolve(__dirname, '..', 'assets', 'screenshots');
const VIEW = { width: 1366, height: 860 };

async function login(page, username, password) {
  await page.goto(BASE + '/login');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('input', { timeout: 5000 });
  await page.fill('input >> nth=0', username);
  await page.fill('input[type=password]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 8000 }),
    page.click('button:has-text("Masuk")'),
  ]);
  await page.waitForLoadState('networkidle');
}
async function shoot(page, name) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('  ✓', name);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  console.log('▶ approver1 → detail PENDING');
  await login(page, 'approver1', 'password123');
  await page.goto(BASE + '/corrections');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('table', { timeout: 8000 });
  await page.waitForTimeout(500);
  // click first PENDING in list
  const pendingLink = page.locator('a:has-text("CJ-202604-0002")');
  await pendingLink.waitFor({ timeout: 8000 });
  await pendingLink.click();
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('text=Timeline', { timeout: 8000 });
  await shoot(page, '08-detail-pending-approver.png');

  console.log('▶ admin → users page + approved detail');
  await page.goto(BASE + '/login');
  await page.waitForLoadState('networkidle');
  await page.click('button:has-text("Logout")').catch(() => {});
  await login(page, 'admin', 'admin123');
  await page.goto(BASE + '/users');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('table', { timeout: 8000 });
  await shoot(page, '09-users-admin.png');

  await page.goto(BASE + '/corrections');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('table', { timeout: 8000 });
  await page.waitForTimeout(500);
  const approvedLink = page.locator('a:has-text("CJ-202604-0003")');
  await approvedLink.waitFor({ timeout: 8000 });
  await approvedLink.click();
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('text=Timeline', { timeout: 8000 });
  await shoot(page, '10-detail-approved.png');

  await browser.close();
  console.log('✅ Done');
})().catch(e => { console.error(e); process.exit(1); });
