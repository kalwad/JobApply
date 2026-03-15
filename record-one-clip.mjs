import { chromium } from 'playwright';
import { mkdir, readdir, rename } from 'fs/promises';

const APP = 'http://localhost:8085';
const OUT = 'screenshots/clips';
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

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  recordVideo: { dir: OUT, size: { width: WIDTH * 2, height: HEIGHT * 2 } },
});
const page = await context.newPage();

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

await context.close();
await browser.close();

const files = (await readdir(OUT)).filter(f => f.endsWith('.webm')).sort();
const last = files[files.length - 1];
if (last) {
  await rename(`${OUT}/${last}`, `${OUT}/06-settings.webm`);
  const { execSync } = await import('child_process');
  execSync(`ffmpeg -y -i ${OUT}/06-settings.webm -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -an ${OUT}/06-settings.mp4`, { stdio: 'pipe' });
  console.log('✅ 06-settings.mp4');
}
