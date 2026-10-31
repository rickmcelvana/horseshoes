import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../physics/rng';
import { CALM, npcSwing, scatterFactor, seasonFactor, stress, type Situation } from './arm';
import { lineFor } from './lines';
import { CHARACTER_IDS, ROSTER } from './roster';

const crunch: Situation = { myScore: 30, oppScore: 38, progress: 0.95, mustAnswerRinger: true };

describe('NPC arm', () => {
  it('is repeatable for a given seed', () => {
    const a = npcSwing(ROSTER.dale, CALM, mulberry32(5));
    const b = npcSwing(ROSTER.dale, CALM, mulberry32(5));
    expect(a).toEqual(b);
  });

  it('stress is zero when calm and high when behind late with a ringer to answer', () => {
    expect(stress(CALM)).toBe(0);
    expect(stress(crunch)).toBeGreaterThan(0.9);
    expect(stress({ ...crunch, mustAnswerRinger: false, oppScore: 20 })).toBeLessThan(stress(crunch));
  });

  it('Mae never chokes, the Professor does, Uncle Dale gets sharper', () => {
    expect(scatterFactor(ROSTER.mae, crunch)).toBe(1);
    expect(scatterFactor(ROSTER.professor, crunch)).toBeGreaterThan(1.6);
    expect(scatterFactor(ROSTER.dale, crunch)).toBeLessThan(1);
  });

  it('scatter really does widen under pressure', () => {
    const spread = (s: Situation) => {
      const rng = mulberry32(9);
      let sum = 0;
      for (let i = 0; i < 2000; i++) sum += Math.abs(npcSwing(ROSTER.professor, s, rng).aim);
      return sum / 2000;
    };
    expect(spread(crunch)).toBeGreaterThan(spread(CALM) * 1.5);
  });

  it('the Rookie improves over a season, but only so far', () => {
    expect(seasonFactor(0)).toBe(1);
    expect(seasonFactor(4)).toBeLessThan(1);
    expect(seasonFactor(100)).toBe(0.75);
  });

  it('harder characters scatter less', () => {
    const order = CHARACTER_IDS.map((id) => ROSTER[id]).sort((a, b) => a.targetRingerPct - b.targetRingerPct);
    for (let i = 1; i < order.length; i++) {
      // Mae pitches from 30 ft, which is easier, so only compare characters on the same line.
      if (order[i].line === order[i - 1].line) expect(order[i].scale).toBeLessThan(order[i - 1].scale);
    }
  });
});

describe('canned lines', () => {
  it('every character has something for every event', () => {
    for (const id of CHARACTER_IDS) {
      for (const e of ['greet', 'ringer', 'double', 'close', 'miss', 'foul', 'oppRinger', 'oppMiss', 'cancel', 'pressure', 'win', 'lose'] as const) {
        // lineFor may return null on purpose (Mae), but must not throw.
        expect(() => lineFor(id, e, mulberry32(1))).not.toThrow();
      }
    }
  });

  it('does not repeat the line it just said', () => {
    const first = lineFor('dale', 'miss', () => 0);
    expect(lineFor('dale', 'miss', () => 0, first)).not.toBe(first);
  });
});
