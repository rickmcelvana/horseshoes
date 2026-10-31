// Online smoke test: a local PeerJS broker, a host page and a guest page in
// separate browser contexts. The guest joins through the invite link, both
// play one inning, and the test checks they agree on the score. Then quick
// chat, then the guest reloads mid-game and rejoins.
//
//   npm run build && npx vite preview --port 4173 &
//   node tools/online-smoke.mjs [url] [outDir]
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { PeerServer } = require('peer');

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'test-results';
mkdirSync(out, { recursive: true });

const broker = PeerServer({ port: 9000, path: '/' });
const peerParams = 'peerhost=localhost&peerport=9000&peerpath=/&peersecure=0';
const errors = [];
const lowQuality = JSON.stringify({ look: { quality: 'low', autoTime: true, timeOfDay: 0.2, showFps: false } });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebRtcHideLocalIpsWithMdns'],
});

async function openPage(name, url) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 480 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  await page.goto(url);
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('dusk.tuning.v1', s);
  }, lowQuality);
  await page.reload();
  await page.waitForSelector('#loading.done', { timeout: 60000 });
  return page;
}

const phase = (p) => p.evaluate(() => window.__dusk.phase);
const until = async (f, ms = 120000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await f()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

// Host opens a room.
const host = await openPage('host', `${base}?${peerParams}`);
await host.getByRole('button', { name: 'Play online' }).click();
await host.getByLabel('Your name').fill('Rick');
await host.getByRole('button', { name: 'Host and get a link' }).click();
if (!(await until(async () => (await host.evaluate(() => window.__dusk.room)) !== null, 30000))) errors.push('host: no room code');
const code = await host.evaluate(() => window.__dusk.room);
await host.screenshot({ path: `${out}/online-1-room.png`, timeout: 120000 });
console.log('room', code);

// Guest opens the invite link and joins.
const guest = await openPage('guest', `${base}?${peerParams}&join=${code}`);
await guest.getByLabel('Your name').fill('Dale');
await guest.getByRole('button', { name: 'Join', exact: true }).click();
if (!(await until(async () => (await phase(guest)).startsWith('match:') && (await phase(host)).startsWith('match:'), 60000))) errors.push('never connected');
console.log('connected', await phase(host), await phase(guest));

/** Drive both pages until each shows the inning summary. */
async function playInning(label) {
  let pitched = 0;
  const deadline = Date.now() + 900000;
  while (Date.now() < deadline) {
    const [hp, gp] = [await phase(host), await phase(guest)];
    if (hp.endsWith(':inning') && gp.endsWith(':inning')) break;
    for (const [page, ph] of [
      [host, hp],
      [guest, gp],
    ]) {
      const ready = page.getByRole('button', { name: 'Ready' });
      if (ph.endsWith(':handoff') && (await ready.isVisible())) await ready.click();
      else if (ph.endsWith(':aim') && !(await page.locator('#controls.npc').count())) {
        await page.evaluate(() => window.__dusk.pitch(0.995 + Math.random() * 0.01, (Math.random() - 0.5) * 0.4, 0));
        pitched++;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(label, 'shoes pitched', pitched, '| host', await phase(host), '| guest', await phase(guest));
  return pitched;
}

if ((await playInning('inning 1')) !== 4) errors.push('expected 4 shoes in inning 1');
const [hs, gs] = [await host.evaluate(() => window.__dusk.scores), await guest.evaluate(() => window.__dusk.scores)];
console.log('scores host', hs, 'guest', gs);
if (JSON.stringify(hs) !== JSON.stringify(gs)) errors.push(`scores differ: host ${hs} guest ${gs}`);
await host.screenshot({ path: `${out}/online-2-host-inning.png`, timeout: 120000 });
await guest.screenshot({ path: `${out}/online-3-guest-inning.png`, timeout: 120000 });

// Quick chat from the guest shows up on the host.
await guest.locator('#emote').click();
await guest.getByRole('button', { name: 'Nice shot!' }).click();
if (!(await until(async () => (await host.locator('#say').textContent())?.includes('Nice shot!'), 15000))) errors.push('emote did not arrive');
console.log('host bubble:', await host.locator('#say').textContent());

// The guest moves on; then their tab reloads and they rejoin from the link.
await guest.getByRole('button', { name: 'Next inning' }).click();
await until(async () => (await phase(host)).match(/:(handoff|aim)$/), 30000);
await guest.reload();
await guest.waitForSelector('#loading.done', { timeout: 60000 });
await guest.getByRole('button', { name: 'Join', exact: true }).click();
if (!(await until(async () => (await phase(guest)).startsWith('match:'), 60000))) errors.push('guest did not rejoin');
const [hs2, gs2] = [await host.evaluate(() => window.__dusk.scores), await guest.evaluate(() => window.__dusk.scores)];
console.log('after rejoin host', hs2, 'guest', gs2, '|', await phase(host), await phase(guest));
if (JSON.stringify(hs2) !== JSON.stringify(gs2)) errors.push('scores differ after rejoin');
if ((await playInning('inning 2')) !== 4) errors.push('expected 4 shoes in inning 2');
await guest.screenshot({ path: `${out}/online-4-guest-inning2.png`, timeout: 120000 });

await browser.close();
broker.close?.();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('online smoke ok');
process.exit(0);
