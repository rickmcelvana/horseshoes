// Browser smoke test: load the built game, check for errors, pitch one shoe, save screenshots.
//   npm run build && npx vite preview --port 4173 &
//   node tools/smoke.mjs [url] [outDir]
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

// require() so a globally installed Playwright (NODE_PATH) works too.
const { chromium } = createRequire(import.meta.url)('playwright');

const url = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'test-results';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
for (const [name, viewport] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  await page.goto(url);
  await page.waitForSelector('#loading.done', { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}-aim.png` });

  // A swing: press, pull back down, then flick up and let go.
  const { width: w, height: h } = viewport;
  const x = w / 2, y = h * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + h * 0.25, { steps: 8 });
  // Software rendering is slow, so send the forward swing without waiting on frames.
  await page.mouse.move(x, y - h * 0.05, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}-flight.png` });
  await page.waitForFunction(() => !document.querySelector('#toast').classList.contains('hidden'), null, { timeout: 30000 }).catch(() => errors.push(`${name}: no result toast`));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${name}-result.png` });
  console.log(name, 'result:', await page.locator('#toast .title').textContent(), '|', await page.locator('#toast .readout').textContent());
  await page.close();
}
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('smoke ok');
