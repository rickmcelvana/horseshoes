import { describe, expect, it } from 'vitest';
import { IN } from './court';
import { bareMeasure } from './measure';
import { type PitchedShoe, type Player, type ScoringOptions, scoreCancellation, scoreCountAll } from './scoring';

const NHPA: ScoringOptions = { leanerValue: 1 };
const BACKYARD: ScoringOptions = { leanerValue: 2 };

/** A pitched shoe: `inches` from the stake, or "R" for a ringer. */
function shoe(player: Player, at: number | 'R', extra: { foul?: boolean; leaner?: boolean } = {}): PitchedShoe {
  const ringer = at === 'R';
  const distance = ringer ? 0 : at * IN;
  return {
    player,
    foul: extra.foul ?? false,
    measure: bareMeasure({ ringer, distance, touching: distance === 0, leaner: extra.leaner ?? false }),
  };
}

const cancel = (shoes: PitchedShoe[], opts = NHPA) => scoreCancellation(shoes, opts).points;

describe('cancellation scoring (RULE 6 A.1)', () => {
  it('nothing in count scores nothing', () => {
    expect(cancel([shoe(0, 7), shoe(0, 12), shoe(1, 8), shoe(1, 30)])).toEqual([0, 0]);
  });

  it('closest shoe in count scores 1', () => {
    expect(cancel([shoe(0, 2), shoe(0, 8), shoe(1, 3), shoe(1, 9)])).toEqual([1, 0]);
  });

  it('both shoes closer than either of the opponent’s score 2', () => {
    expect(cancel([shoe(0, 1), shoe(0, 2), shoe(1, 3), shoe(1, 4)])).toEqual([2, 0]);
  });

  it('a second shoe outside 6 in does not score even if the opponent has nothing', () => {
    expect(cancel([shoe(0, 1), shoe(0, 7), shoe(1, 10), shoe(1, 11)])).toEqual([1, 0]);
  });

  it('a ringer plus the closest other shoe is 4', () => {
    expect(cancel([shoe(0, 'R'), shoe(0, 2), shoe(1, 3), shoe(1, 4)])).toEqual([4, 0]);
  });

  it('a ringer plus a shoe that is not closest is 3', () => {
    expect(cancel([shoe(0, 'R'), shoe(0, 5), shoe(1, 3), shoe(1, 4)])).toEqual([3, 0]);
  });

  it('a double ringer is 6', () => {
    expect(cancel([shoe(1, 9), shoe(1, 3), shoe(0, 'R'), shoe(0, 'R')])).toEqual([6, 0]);
  });

  it('one ringer each cancels; closest remaining shoe scores 1', () => {
    expect(cancel([shoe(0, 'R'), shoe(0, 5), shoe(1, 'R'), shoe(1, 2)])).toEqual([0, 1]);
  });

  it('two ringers each cancel completely', () => {
    expect(cancel([shoe(0, 'R'), shoe(0, 'R'), shoe(1, 'R'), shoe(1, 'R')])).toEqual([0, 0]);
  });

  it('two ringers against one leaves one live ringer, 3 points', () => {
    expect(cancel([shoe(0, 'R'), shoe(0, 'R'), shoe(1, 'R'), shoe(1, 1)])).toEqual([3, 0]);
  });

  it('opposing shoes at an equal distance cancel; next closest scores 1', () => {
    expect(cancel([shoe(0, 2), shoe(0, 3), shoe(1, 2), shoe(1, 4)])).toEqual([1, 0]);
  });

  it('opposing shoes both touching the stake cancel', () => {
    expect(cancel([shoe(0, 0, { leaner: true }), shoe(0, 5), shoe(1, 0), shoe(1, 2)])).toEqual([0, 1]);
  });

  it('all four tied in pairs scores nothing', () => {
    expect(cancel([shoe(0, 2), shoe(0, 3), shoe(1, 2), shoe(1, 3)])).toEqual([0, 0]);
  });

  it('a live ringer with a tied second shoe still scores just the ringer', () => {
    expect(cancel([shoe(0, 'R'), shoe(0, 2), shoe(1, 2), shoe(1, 4)])).toEqual([3, 0]);
  });

  it('a leaner is worth 1 under NHPA rules', () => {
    expect(cancel([shoe(0, 0, { leaner: true }), shoe(0, 9), shoe(1, 3), shoe(1, 9)])).toEqual([1, 0]);
  });

  it('a leaner is worth 2 with the backyard toggle', () => {
    expect(cancel([shoe(0, 0, { leaner: true }), shoe(0, 1), shoe(1, 3), shoe(1, 9)], BACKYARD)).toEqual([3, 0]);
  });

  it('a foul ringer is dead and cancels nothing (RULE 5)', () => {
    expect(cancel([shoe(0, 'R', { foul: true }), shoe(0, 9), shoe(1, 'R'), shoe(1, 9)])).toEqual([0, 3]);
  });

  it('a foul shoe in count scores nothing', () => {
    expect(cancel([shoe(0, 1, { foul: true }), shoe(0, 9), shoe(1, 4), shoe(1, 9)])).toEqual([0, 1]);
  });

  it('reports per-shoe values and ringers thrown', () => {
    const r = scoreCancellation([shoe(0, 'R'), shoe(0, 2), shoe(1, 'R'), shoe(1, 1)], NHPA);
    expect(r.ringers).toEqual([1, 1]);
    expect(r.shoeValues).toEqual([0, 0, 0, 1]);
  });
});

describe('count-all scoring (RULE 6 A.2)', () => {
  it('every live shoe scores for its owner', () => {
    expect(scoreCountAll([shoe(0, 'R'), shoe(0, 2), shoe(1, 'R'), shoe(1, 8)], NHPA).points).toEqual([4, 3]);
  });

  it('ringers do not cancel', () => {
    expect(scoreCountAll([shoe(0, 'R'), shoe(0, 'R'), shoe(1, 'R'), shoe(1, 'R')], NHPA).points).toEqual([6, 6]);
  });

  it('fouls score nothing', () => {
    expect(scoreCountAll([shoe(0, 'R', { foul: true }), shoe(0, 2), shoe(1, 1), shoe(1, 1)], NHPA).points).toEqual([1, 2]);
  });
});
