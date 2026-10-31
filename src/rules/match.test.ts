import { describe, expect, it } from 'vitest';
import { IN } from './court';
import { bareMeasure } from './measure';
import { MODES, alternateFirstPitcher, applyInning, newMatch, pitchOrder, type MatchState } from './match';
import type { PitchedShoe, Player } from './scoring';

const s = (player: Player, inches: number | 'R'): PitchedShoe => ({
  player,
  foul: false,
  measure: bareMeasure({ ringer: inches === 'R', distance: inches === 'R' ? 0 : inches * IN, touching: false, leaner: false }),
});

/** An inning where `who` scores `n` points under cancellation (n in 0,1,2,3,4,6). */
function inning(who: Player | null, n = 1): PitchedShoe[] {
  if (who === null) return [s(0, 10), s(0, 11), s(1, 12), s(1, 13)];
  const o: Player = who === 0 ? 1 : 0;
  const mine: Record<number, PitchedShoe[]> = {
    1: [s(who, 1), s(who, 8)],
    2: [s(who, 1), s(who, 2)],
    3: [s(who, 'R'), s(who, 8)],
    4: [s(who, 'R'), s(who, 1)],
    6: [s(who, 'R'), s(who, 'R')],
  };
  return [...mine[n], s(o, 3), s(o, 9)];
}

const play = (state: MatchState, innings: PitchedShoe[][]) => innings.reduce(applyInning, state);

describe('pitching rotation (RULE 7)', () => {
  it('cancellation: the scorer pitches first next inning', () => {
    let m = newMatch(MODES.cancellation, 0);
    expect(pitchOrder(m)).toEqual([0, 0, 1, 1]);
    m = applyInning(m, inning(1));
    expect(m.firstPitcher).toBe(1);
    expect(pitchOrder(m)).toEqual([1, 1, 0, 0]);
  });

  it('cancellation: after a no-score inning, whoever pitched last goes first', () => {
    let m = newMatch(MODES.cancellation, 0);
    m = applyInning(m, inning(null));
    expect(m.firstPitcher).toBe(1);
    m = applyInning(m, inning(null));
    expect(m.firstPitcher).toBe(0);
  });

  it('alternate first pitch follows the 1, 4–5, 8–9 pattern', () => {
    const firsts = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => alternateFirstPitcher(0, n));
    expect(firsts).toEqual([0, 1, 1, 0, 0, 1, 1, 0, 0]);
  });

  it('count-all uses the alternate pattern regardless of who scores', () => {
    let m = newMatch(MODES.countAll, 1);
    m = applyInning(m, inning(1));
    expect(m.firstPitcher).toBe(0);
    m = applyInning(m, inning(1));
    expect(m.firstPitcher).toBe(0);
    m = applyInning(m, inning(1));
    expect(m.firstPitcher).toBe(1);
  });
});

describe('game length (RULE 8)', () => {
  it('cancellation to 40: first to reach or exceed wins', () => {
    let m = newMatch(MODES.cancellation, 0);
    m = play(m, Array.from({ length: 6 }, () => inning(0, 6))); // 36
    expect(m.winner).toBeNull();
    m = applyInning(m, inning(0, 6)); // 42
    expect(m.scores).toEqual([42, 0]);
    expect(m.winner).toBe(0);
    expect(() => applyInning(m, inning(0))).toThrow();
  });

  it('backyard 21 ends at 21 and pays 2 for a leaner', () => {
    expect(MODES.backyard21.leanerValue).toBe(2);
    let m = newMatch(MODES.backyard21, 0);
    m = play(m, Array.from({ length: 3 }, () => inning(1, 6)));
    expect(m.winner).toBeNull();
    m = applyInning(m, inning(1, 3));
    expect(m.winner).toBe(1);
  });

  it('count-all 40 shoes ends after 20 innings with the higher score', () => {
    let m = newMatch(MODES.countAll, 0);
    m = play(m, Array.from({ length: 19 }, () => inning(0, 2)));
    expect(m.winner).toBeNull();
    m = applyInning(m, inning(0, 2));
    expect(m.winner).toBe(0);
  });

  it('a tie at the shoe limit plays two-inning tiebreakers', () => {
    const even = [s(0, 1), s(0, 9), s(1, 1), s(1, 9)]; // 1–1 each inning in count-all
    let m = newMatch(MODES.countAll, 0);
    m = play(m, Array.from({ length: 20 }, () => even));
    expect(m.winner).toBeNull();
    m = applyInning(m, inning(1, 2));
    expect(m.winner).toBeNull(); // must finish the two-inning block
    m = applyInning(m, even);
    expect(m.winner).toBe(1);
  });
});
