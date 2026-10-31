// Browser smoke test: load the built game, pitch in practice, then play one
// hot-seat inning, checking for errors and saving screenshots along the way.
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

async function swing(page, { width: w, height: h }) {
  const x = w / 2;
  const y = h * 0.45;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + h * 0.25, { steps: 8 });
  // Software rendering is slow, so send the forward swing without waiting on frames.
  await page.mouse.move(x, y - h * 0.05, { steps: 6 });
  await page.mouse.up();
}

const phase = (page) => page.evaluate(() => window.__dusk.phase);

/** Swing until a shoe is in the air, then wait for its result. Software rendering can
 *  stall the page long enough that a synthetic swing reads as a stall, so after a
 *  couple of tries fall back to the game's exact-throw hook. */
async function pitch(page, viewport) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await swing(page, viewport);
    await page.waitForTimeout(800);
    if (!(await phase(page)).endsWith(':aim')) break;
  }
  if ((await phase(page)).endsWith(':aim')) await page.evaluate(() => window.__dusk.pitch(0.99, 0.1, 0));
  await page.waitForFunction(() => window.__dusk.phase.endsWith(':result'), null, { timeout: 60000 });
}

for (const [name, viewport] of [
  ['desktop', { width: 1280, height: 800 }],
  ['phone', { width: 390, height: 844 }],
]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#loading.done', { timeout: 30000 });
  await page.screenshot({ path: `${out}/${name}-1-menu.png` });

  // Practice: one shoe.
  await page.getByRole('button', { name: 'Practice' }).click();
  await page.waitForTimeout(600);
  await pitch(page, viewport).catch(() => errors.push(`${name}: no practice result`));
  console.log(name, 'practice:', await page.locator('#toast .title').textContent());

  // Match setup: a friend on desktop (hot-seat), Uncle Dale on the phone (computer opponent).
  const vsComputer = name === 'phone';
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Play a match' }).click();
  await page.getByLabel('Player 1 name').fill('Rick');
  if (vsComputer) await page.locator('button[data-opponent="dale"]').click();
  else await page.getByLabel('Player 2 name').fill('Dale');
  await page.screenshot({ path: `${out}/${name}-2-setup.png`, timeout: 120000 });
  await page.getByRole('button', { name: 'Toss for first pitch' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}-3-toss.png`, timeout: 120000 });
  await page.locator('#overlay button.primary').click();

  // One full inning: four shoes, with handoffs. The computer takes its own turns.
  let handoffShot = false;
  let pitched = 0;
  const deadline = Date.now() + 600000;
  while (!(await phase(page)).endsWith(':inning') && Date.now() < deadline) {
    const ph = await phase(page);
    const ready = page.getByRole('button', { name: 'Ready' });
    if (ph.endsWith(':handoff') && (await ready.isVisible())) {
      if (!handoffShot) await page.screenshot({ path: `${out}/${name}-4-handoff.png`, timeout: 120000 });
      handoffShot = true;
      await ready.click();
    } else if (ph.endsWith(':aim') && !(await page.locator('#controls.npc').count())) {
      await pitch(page, viewport).catch(() => errors.push(`${name}: no result for shoe ${pitched + 1}`));
      pitched++;
    } else if (ph.endsWith(':result')) {
      // Tap to move on from the result (it also moves on by itself after a few seconds).
      await page.waitForTimeout(600);
      if ((await phase(page)).endsWith(':result')) await page.mouse.click(viewport.width / 2, viewport.height / 2);
    }
    await page.waitForTimeout(400);
  }
  if (vsComputer && pitched !== 2) errors.push(`${name}: expected to pitch 2 of 4 shoes against the computer, pitched ${pitched}`);
  if (vsComputer) console.log(name, 'opponent said:', await page.locator('#say').textContent());
  await page.waitForSelector('.card.inning', { timeout: 15000 }).catch(() => errors.push(`${name}: no inning summary`));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}-5-inning.png` });
  console.log(name, 'inning:', await page.locator('.card.inning .call').textContent().catch(() => '?'), '|', await page.locator('#stats').textContent());

  await page.getByRole('button', { name: 'Next inning' }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${name}-6-other-end.png` });
  await page.close();
}
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('smoke ok');
