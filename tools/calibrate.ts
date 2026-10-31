// Calibrate each character's scatter so their calm ringer rate hits its target.
//
//   npm run calibrate                     # all characters, prints new scales
//   npm run calibrate -- --who dale       # one character
//   npm run calibrate -- --check          # just measure current scales (n = 2000)
//
// Uses the real physics, one shoe at a time, with no pressure.

import { NEAR_STAKE, measureShoe } from '../src/rules';
import { PitSim, initPhysics } from '../src/physics/sim';
import { perfectThrow, type ThrowInput } from '../src/physics/throw';
import { mulberry32 } from '../src/physics/rng';
import { CALM, npcSwing } from '../src/ai/arm';
import { CHARACTER_IDS, ROSTER, type Character, type CharacterId } from '../src/ai/roster';

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const who = opt('who', 'all');
const checkOnly = args.includes('--check');
const searchN = Number(opt('n', '500'));
const verifyN = Number(opt('verify', '2000'));

/** Ringer percentage for a character at a given scale, over n throws from a fixed seed. */
export function ringerRate(c: Character, scale: number, n: number, seed = 777): number {
  const sim = new PitSim();
  const rng = mulberry32(seed);
  let ringers = 0;
  for (let i = 0; i < n; i++) {
    const swing = npcSwing({ ...c, scale }, CALM, rng);
    const input: ThrowInput = { ...perfectThrow(c.grip, i % 2 ? 'left' : 'right', c.line, (rng() * 2 ** 32) >>> 0), ...swing };
    const shoe = sim.throwShoe(input, 0, NEAR_STAKE);
    sim.runUntilSettled();
    if (!sim.isFoul(shoe) && measureShoe(sim.pose(shoe), NEAR_STAKE).ringer) ringers++;
    sim.removeShoe(shoe);
  }
  sim.world.free();
  return (100 * ringers) / n;
}

async function main() {
  await initPhysics();
  const ids = who === 'all' ? CHARACTER_IDS : [who as CharacterId];
  for (const id of ids) {
    const c = ROSTER[id];
    let scale = c.scale;
    if (!checkOnly) {
      // Ringer rate falls as scatter grows, so bisect on scale.
      let lo = 0.05;
      let hi = 4;
      for (let it = 0; it < 10; it++) {
        const mid = Math.sqrt(lo * hi);
        const r = ringerRate(c, mid, searchN);
        if (r > c.targetRingerPct) lo = mid;
        else hi = mid;
        console.error(`${id} it${it} scale ${mid.toFixed(3)} → ${r.toFixed(1)}%`);
      }
      scale = Math.sqrt(lo * hi);
    }
    const rate = ringerRate(c, scale, verifyN, 4242);
    const ok = Math.abs(rate - c.targetRingerPct) <= 3;
    console.log(JSON.stringify({ id, scale: Number(scale.toFixed(3)), target: c.targetRingerPct, measured: Number(rate.toFixed(1)), n: verifyN, withinThree: ok }));
  }
}

main();
