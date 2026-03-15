import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const APP = 'http://localhost:8085';
const LANDING = 'https://careerpulse.macneilmediagroup.com';
const OUT = 'screenshots/video';

await mkdir(OUT, { recursive: true });

// 4:5 portrait ratio for LinkedIn feed (1080x1350 at 2x)
const WIDTH = 1080;
const HEIGHT = 1350;

const browser = await chromium.launch();
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

async function smoothScroll(pixels, duration = 1000) {
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

async function pause(ms = 1000) {
  await page.waitForTimeout(ms);
}

// ============================================
// SCENE 1: Landing hero (3s)
// ============================================
console.log('🎬 Scene 1: Landing hero');
await page.goto(LANDING, { waitUntil: 'networkidle', timeout: 30000 });
await pause(2500);

// ============================================
// SCENE 2: Job feed (5s)
// ============================================
console.log('🎬 Scene 2: Job feed');
await page.goto(`${APP}/#/`, { waitUntil: 'networkidle', timeout: 15000 });
await page.evaluate(() => {
  document.documentElement.setAttribute('data-theme', 'dark');
  localStorage.setItem('jf_theme', 'dark');
});
await pause(300);
await page.goto(`${APP}/#/`, { waitUntil: 'networkidle', timeout: 15000 });
await pause(1500);
await smoothScroll(500, 1200);
await pause(1200);

// ============================================
// SCENE 3: Job detail + score (6s)
// ============================================
console.log('🎬 Scene 3: Job detail');
await page.goto(`${APP}/#/job/1`, { waitUntil: 'networkidle', timeout: 15000 });
await pause(1500);
await smoothScroll(500, 1200);
await pause(1200);
await smoothScroll(400, 1000);
await pause(800);

// ============================================
// SCENE 4: Dashboard (4s)
// ============================================
console.log('🎬 Scene 4: Dashboard');
await page.goto(`${APP}/#/stats`, { waitUntil: 'networkidle', timeout: 15000 });
await pause(1500);
await smoothScroll(400, 1000);
await pause(1200);

// ============================================
// SCENE 5: Settings - AI provider (3s)
// ============================================
console.log('🎬 Scene 5: Settings');
await page.goto(`${APP}/#/settings`, { waitUntil: 'networkidle', timeout: 15000 });
await pause(1200);
await smoothScroll(400, 1000);
await pause(1000);

// ============================================
// SCENE 6: Back to landing hero (2s)
// ============================================
console.log('🎬 Scene 6: Outro');
await page.goto(LANDING, { waitUntil: 'networkidle', timeout: 30000 });
await pause(2000);

await context.close();
await browser.close();

const { readdirSync } = await import('fs');
const files = readdirSync(OUT).filter(f => f.endsWith('.webm'));
if (files.length > 0) {
  const videoFile = `${OUT}/${files[files.length - 1]}`;
  console.log(`\n🎬 Raw: ${videoFile}`);
}
