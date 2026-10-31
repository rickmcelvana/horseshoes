import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { COURT, IN, NEAR_STAKE, measureShoe, quatAxisTan, stakeAxisAt, v3 } from '../rules';
import { mulberry32 } from './rng';
import { PitSim, STEP, initPhysics } from './sim';
import { GRIPS, type Grip, perfectThrow } from './throw';

beforeAll(() => initPhysics());

describe('stake collisions', () => {
  it('1,000 shoes fired at the stake never pass through it', () => {
    const sim = new PitSim();
    const rng = mulberry32(99);
    const toeAtStake = quatAxisTan(v3(0, 1, 0), 1); // toe faces -Z, toward the stake
    let tunnels = 0;
    let missed = 0;
    for (let i = 0; i < 1000; i++) {
      const h = (1.5 + rng() * 11) * IN;
      const speed = 4 + rng() * 14; // up to 18 m/s, well past a real pitch
      const axis = stakeAxisAt(NEAR_STAKE, h);
      const shoe = sim.throwShoe(perfectThrow('one-and-quarter'), 0);
      const b = shoe.body;
      b.setGravityScale(0, true);
      // Toe arc center lined up so the solid toe bar meets the stake head-on.
      const offset = (rng() - 0.5) * 1.0 * IN;
      b.setTranslation(v3(axis.x + offset, h, axis.z + 0.5), true);
      b.setRotation(toeAtStake, true);
      b.setLinvel(v3(0, 0, -speed), true);
      b.setAngvel(v3(0, 0, 0), true);
      for (let t = 0; t < 0.25; t += STEP) sim.step();
      const z = b.translation().z;
      if (!shoe.hitStake) missed++;
      if (z < axis.z - COURT.stakeRadius - SHOE_REACH) tunnels++;
      sim.removeShoe(shoe);
    }
    expect(missed).toBe(0);
    expect(tunnels).toBe(0);
  });
});

// The toe bar's leading edge sits this far ahead of the shoe's origin.
const SHOE_REACH = 3.625 * IN;

describe('determinism', () => {
  it('the same throw lands in exactly the same place', () => {
    const run = () => {
      const sim = new PitSim();
      const throws: Grip[] = ['one-and-quarter', 'flip', 'three-quarter', 'one-and-three-quarter'];
      const shoes = throws.map((g, i) => {
        const s = sim.throwShoe({ ...perfectThrow(g, i % 2 ? 'left' : 'right'), power: 0.99 + i * 0.01, aim: 0.1, seed: i }, 0);
        sim.runUntilSettled();
        return s;
      });
      const out = shoes.map((s) => sim.pose(s));
      sim.world.free();
      return JSON.stringify(out);
    };
    expect(run()).toBe(run());
  });
});

describe('perfect throws', () => {
  for (const grip of Object.keys(GRIPS) as Grip[]) {
    it(`a perfect ${GRIPS[grip].label} is a ringer`, () => {
      const sim = new PitSim();
      const s = sim.throwShoe(perfectThrow(grip), 0);
      sim.runUntilSettled();
      expect(sim.isFoul(s)).toBe(false);
      expect(measureShoe(sim.pose(s), NEAR_STAKE).ringer).toBe(true);
      sim.world.free();
    });
  }
});

describe('architecture', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [join(dir, e.name)] : [],
    );
  const root = join(import.meta.dirname, '..');

  it('rules and physics never import rendering code', () => {
    for (const f of [...files(join(root, 'rules')), ...files(join(root, 'physics'))]) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/from ['"](three|\.\.\/render|\.\.\/input|\.\.\/game)/);
    }
    for (const f of files(join(root, 'rules'))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/from ['"](@dimforge|\.\.\/physics)/);
    }
  });

  it('simulation code avoids math functions browsers may round differently', () => {
    for (const f of [...files(join(root, 'rules')), ...files(join(root, 'physics'))]) {
      const src = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/Math\.(sin|cos|tan|exp|log|pow|atan2?|asin|acos|random|hypot|cbrt)\b/);
    }
  });
});
