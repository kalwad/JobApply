import { chromium } from 'playwright';
import { mkdir, readdir, rename } from 'fs/promises';

const APP = 'http://localhost:8085';
const LANDING = 'https://careerpulse.macneilmediagroup.com';
const OUT = 'screenshots/clips';

await mkdir(OUT, { recursive: true });

const WIDTH = 1080;
const HEIGHT = 1350;

async function smoothScroll(page, pixels, duration = 1000) {
  await page.evaluate(({ px, ms }) => {
    return new Promise(resolve => {
      const start = window.scrollY;
      const target = start + px;
      const startTime = performance.now();
      function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / ms, 1);
        const ease = progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        window.scrollTo(0, start + (target - start) * ease);
        if (progress < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
  }, { px: pixels, ms: duration });
}

async function recordClip(name, fn) {
  console.log(`🎬 Recording: ${name}`);
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    recordVideo: {
      dir: OUT,
      size: { width: WIDTH * 2, height: HEIGHT * 2 },
    },
  });
  const page = await context.newPage();
  await fn(page);
  await context.close();

  // Rename the last recorded file
  const files = (await readdir(OUT)).filter(f => f.endsWith('.webm')).sort();
  const last = files[files.length - 1];
  if (last) {
    await rename(`${OUT}/${last}`, `${OUT}/${name}.webm`);
  }
  console.log(`  ✅ ${name}.webm`);
}

const browser = await chromium.launch();

// --------------------------------------------------
// Clip 1: Landing page hero + scroll
// --------------------------------------------------
await recordClip('01-landing', async (page) => {
  await page.goto(LANDING, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);
  await smoothScroll(page, 800, 2000);
  await page.waitForTimeout(1500);
  await smoothScroll(page, 600, 1500);
  await page.waitForTimeout(1500);
});

// --------------------------------------------------
// Clip 2: Landing features
// --------------------------------------------------
await recordClip('02-landing-features', async (page) => {
  await page.goto(LANDING, { waitUntil: 'networkidle', timeout: 30000 });
  await page.evaluate(() => window.scrollTo(0, 1400));
  await page.waitForTimeout(1500);
  await smoothScroll(page, 800, 2000);
  await page.waitForTimeout(1500);
  await smoothScroll(page, 800, 2000);
  await page.waitForTimeout(1500);
});

// --------------------------------------------------
// Clip 3: Job feed browse
// --------------------------------------------------
await recordClip('03-job-feed', async (page) => {
  await page.goto(`${APP}/#/`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('jf_theme', 'dark');
  });
  await page.waitForTimeout(300);
  await page.goto(`${APP}/#/`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  await smoothScroll(page, 500, 1500);
  await page.waitForTimeout(1500);
  await smoothScroll(page, 500, 1500);
  await page.waitForTimeout(1000);
});

// --------------------------------------------------
// Clip 4: Job detail - top + score
// --------------------------------------------------
await recordClip('04-job-detail', async (page) => {
  await page.goto(`${APP}/#/`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('jf_theme', 'dark');
  });
  await page.waitForTimeout(300);
  await page.goto(`${APP}/#/job/1`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  await smoothScroll(page, 500, 1500);
  await page.waitForTimeout(1500);
  await smoothScroll(page, 500, 1500);
  await page.waitForTimeout(1500);
  await smoothScroll(page, 400, 1200);
  await page.waitForTimeout(1000);
});

// --------------------------------------------------
// Clip 5: Dashboard + digest
// --------------------------------------------------
await recordClip('05-dashboard', async (page) => {
  await page.goto(`${APP}/#/`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('jf_theme', 'dark');
  });
  await page.waitForTimeout(300);
  await page.goto(`${APP}/#/stats`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  await smoothScroll(page, 500, 1500);
  await page.waitForTimeout(1500);
  await smoothScroll(page, 400, 1200);
  await page.waitForTimeout(1000);
});

// --------------------------------------------------
// Clip 6: Settings - AI + resume analysis
// --------------------------------------------------
await recordClip('06-settings', async (page) => {
  await page.goto(`${APP}/#/`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('jf_theme', 'dark');
  });
  await page.waitForTimeout(300);
  await page.goto(`${APP}/#/settings`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  await smoothScroll(page, 600, 1800);
  await page.waitForTimeout(1500);
  await smoothScroll(page, 600, 1800);
  await page.waitForTimeout(1500);
});

// --------------------------------------------------
// Clip 7: Keyboard shortcuts
// --------------------------------------------------
await recordClip('07-shortcuts', async (page) => {
  await page.goto(`${APP}/#/`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('jf_theme', 'dark');
  });
  await page.waitForTimeout(300);
  await page.goto(`${APP}/#/`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.keyboard.press('?');
  await page.waitForTimeout(3000);
});

await browser.close();

// Convert all to MP4
console.log('\n🔄 Converting to MP4...');
const { execSync } = await import('child_process');
const clips = (await readdir(OUT)).filter(f => f.endsWith('.webm')).sort();
for (const clip of clips) {
  const mp4 = clip.replace('.webm', '.mp4');
  execSync(`ffmpeg -y -i ${OUT}/${clip} -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -an ${OUT}/${mp4}`, { stdio: 'pipe' });
  console.log(`  ✅ ${mp4}`);
}

console.log(`\nDone! ${clips.length} clips in ${OUT}/`);
