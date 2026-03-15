import { chromium } from 'playwright';

const BASE = 'http://localhost:8085';
const OUT = 'app/static/screenshots';

const browser = await chromium.launch();

async function takeScreenshots(themeName, colorScheme) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    colorScheme,
  });
  const page = await context.newPage();
  const suffix = themeName === 'dark' ? '' : `-${themeName}`;

  async function shot(name, opts = {}) {
    const path = `${OUT}/${name}${suffix}.png`;
    if (opts.fullPage) {
      await page.screenshot({ path, fullPage: true });
    } else {
      await page.screenshot({ path });
    }
    console.log(`✓ ${name}${suffix}`);
  }

  // Set theme
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  if (themeName === 'dark') {
    // Click theme toggle if currently light
    const theme = await page.getAttribute('html', 'data-theme');
    if (theme === 'light') {
      await page.click('#theme-toggle');
      await page.waitForTimeout(500);
    }
  } else {
    const theme = await page.getAttribute('html', 'data-theme');
    if (theme === 'dark') {
      await page.click('#theme-toggle');
      await page.waitForTimeout(500);
    }
  }

  // Queue view
  await page.goto(`${BASE}/#/queue`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);
  await shot('queue');

  // Network/CRM view
  await page.goto(`${BASE}/#/network`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);
  await shot('network');

  // Dashboard (has response analytics now)
  await page.goto(`${BASE}/#/stats`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);
  await shot('dashboard');

  // Pipeline view
  await page.goto(`${BASE}/#/pipeline`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);
  await shot('pipeline');

  // Job feed - select 2 jobs for comparison
  await page.goto(`${BASE}/#/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);
  await shot('feed');

  // Job detail view
  const firstJob = await page.$('.job-card');
  if (firstJob) {
    await firstJob.click();
    await page.waitForTimeout(1500);
    await shot('job-detail');
  }

  // Settings - resumes tab
  await page.goto(`${BASE}/#/settings`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);
  // Try to click Resumes tab if it exists
  const resumeTab = await page.$('text=Resumes');
  if (resumeTab) {
    await resumeTab.click();
    await page.waitForTimeout(800);
    await shot('settings-resumes');
  }

  // Settings - alerts tab
  const alertsTab = await page.$('text=Alerts');
  if (alertsTab) {
    await alertsTab.click();
    await page.waitForTimeout(800);
    await shot('settings-alerts');
  }

  // Settings - follow-ups tab
  const followUpsTab = await page.$('text=Follow-Ups');
  if (followUpsTab) {
    await followUpsTab.click();
    await page.waitForTimeout(800);
    await shot('settings-followups');
  }

  await context.close();
}

// Take dark theme screenshots (primary)
await takeScreenshots('dark', 'dark');

// Take light theme screenshots for select views
await takeScreenshots('light', 'light');

await browser.close();
console.log(`\nDone! Screenshots saved to ${OUT}/`);
