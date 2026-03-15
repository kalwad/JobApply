import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const BASE = 'https://careerpulse.macneilmediagroup.com';
const OUT = 'screenshots/landing';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1080, height: 1350 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});
const page = await context.newPage();

async function shot(name, { fullPage, clip } = {}) {
  const opts = { path: `${OUT}/${name}.png` };
  if (fullPage) opts.fullPage = true;
  else opts.clip = clip || { x: 0, y: 0, width: 1080, height: 1350 };
  await page.screenshot(opts);
  console.log(`✓ ${name}`);
}

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2000);

// 1. Hero section - above the fold
await shot('01-hero');

// 2. Scroll to feature cards
await page.evaluate(() => window.scrollBy(0, 900));
await page.waitForTimeout(800);
await shot('02-features-top');

// 3. More features
await page.evaluate(() => window.scrollBy(0, 900));
await page.waitForTimeout(800);
await shot('03-features-mid');

// 4. Keep scrolling
await page.evaluate(() => window.scrollBy(0, 900));
await page.waitForTimeout(800);
await shot('04-how-it-works');

// 5. Continue
await page.evaluate(() => window.scrollBy(0, 900));
await page.waitForTimeout(800);
await shot('05-sources');

// 6. Continue
await page.evaluate(() => window.scrollBy(0, 900));
await page.waitForTimeout(800);
await shot('06-bottom');

// 7. Continue if more content
await page.evaluate(() => window.scrollBy(0, 900));
await page.waitForTimeout(800);
await shot('07-footer');

// 8. Full page
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2000);
await shot('08-full-page', { fullPage: true });

await browser.close();
console.log(`\nDone! ${OUT}/`);
