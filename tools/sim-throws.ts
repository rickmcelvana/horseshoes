// Headless throw simulator: fire many throws with noise and report outcomes per grip.
//
//   npm run sim                       # 200 throws per grip, default noise
//   npm run sim -- --n 1000 --noise 0 # perfect throws only
//   npm run sim -- --grip flip --verbose
//
// Noise is the standard deviation of each throw input (power is relative).

import { NEAR_STAKE, measureShoe } from '../src/rules';
import { PitSim, initPhysics } from '../src/physics/sim';
import { GRIPS, type Grip, type ThrowInput, perfectThrow } from '../src/physics/throw';
import { mulberry32 } from '../src/physics/rng';

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const n = Number(opt('n', '200'));
const noise = Number(opt('noise', '1'));
const gripArg = opt('grip', 'all');
const verbose = args.includes('--verbose');

// Spread of a decent backyard pitcher at noise 1.
const SPREAD = { power: 0.02, aim: 0.25, release: 0.2, wobble: 0.2 };

function gaussian(rng: () => number): number {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface Outcome {
  ringer: boolean;
  inCount: boolean;
  foul: boolean;
  distanceIn: number;
  leaner: boolean;
  hitStake: boolean;
  plugged: boolean;
}

export function simulateOne(input: ThrowInput): Outcome {
  const sim = new PitSim();
  const shoe = sim.throwShoe(input, 0);
  sim.runUntilSettled();
  const m = measureShoe(sim.pose(shoe), NEAR_STAKE);
  const foul = sim.isFoul(shoe);
  const out = {
    ringer: !foul && m.ringer,
    inCount: !foul && !m.ringer && m.distance <= 6 * 0.0254,
    foul,
    distanceIn: m.distance / 0.0254,
    leaner: m.leaner,
    hitStake: shoe.hitStake,
    plugged: shoe.plugged,
  };
  sim.world.free();
  return out;
}

async function main() {
  await initPhysics();
  const grips = gripArg === 'all' ? (Object.keys(GRIPS) as Grip[]) : [gripArg as Grip];
  const rng = mulberry32(12345);
  console.log(`${n} throws per grip, noise ×${noise}`);
  console.log('grip      ringer  in-count  foul  stake-hit  plugged  median-dist');
  for (const grip of grips) {
    const results: Outcome[] = [];
    for (let i = 0; i < n; i++) {
      const base = perfectThrow(grip, i % 2 ? 'left' : 'right', 'full', (rng() * 2 ** 32) >>> 0);
      const input: ThrowInput = {
        ...base,
        power: 1 + noise * SPREAD.power * gaussian(rng),
        aim: noise * SPREAD.aim * gaussian(rng),
        release: noise * SPREAD.release * gaussian(rng),
        wobble: noise * SPREAD.wobble * gaussian(rng),
      };
      const o = simulateOne(input);
      results.push(o);
      if (verbose) console.log(JSON.stringify({ input, o }));
    }
    const pct = (f: (o: Outcome) => boolean) => ((100 * results.filter(f).length) / n).toFixed(1).padStart(5) + '%';
    const dists = results.filter((o) => !o.foul).map((o) => o.distanceIn).sort((a, b) => a - b);
    const median = dists.length ? dists[Math.floor(dists.length / 2)].toFixed(1) + ' in' : '-';
    console.log(
      `${GRIPS[grip].label.padEnd(9)} ${pct((o) => o.ringer)}  ${pct((o) => o.inCount)}  ${pct((o) => o.foul)}  ${pct((o) => o.hitStake)}    ${pct((o) => o.plugged)}  ${median}`,
    );
  }
}

main();
