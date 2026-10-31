// Scoring one inning (RULE 6). Four shoes, two per player.

import type { ShoeMeasure } from './measure';
import { IN_COUNT_DISTANCE } from './measure';

export type Player = 0 | 1;
export const other = (p: Player): Player => (p === 0 ? 1 : 0);

export interface PitchedShoe {
  player: Player;
  /** RULE 5: released over the foul line, or touched the backboard, platform or ground outside the pit. */
  foul: boolean;
  measure: ShoeMeasure;
}

export interface ScoringOptions {
  /** NHPA: a leaner is just a point (1). Backyard play often makes it 2. */
  leanerValue: 1 | 2;
}

export interface InningScore {
  points: [number, number];
  /** Ringers each player threw (cancelled or not), for ringer-percentage stats. */
  ringers: [number, number];
  /** Points each shoe earned, in the order given. */
  shoeValues: number[];
}

/** Opposing shoes closer together than this are an equal distance from the stake (RULE 6 A.1.b.4). */
export const TIE_TOLERANCE = 0.001;

const isLive = (s: PitchedShoe) => !s.foul;
const inCount = (s: PitchedShoe) => isLive(s) && !s.measure.ringer && s.measure.distance <= IN_COUNT_DISTANCE;

function ringerCounts(shoes: PitchedShoe[]): [number, number] {
  const r: [number, number] = [0, 0];
  for (const s of shoes) if (isLive(s) && s.measure.ringer) r[s.player]++;
  return r;
}

/** RULE 6 A.1: cancellation scoring. Only one player can score in an inning. */
export function scoreCancellation(shoes: PitchedShoe[], opts: ScoringOptions): InningScore {
  const ringers = ringerCounts(shoes);
  const shoeValues = shoes.map(() => 0);
  const points: [number, number] = [0, 0];

  // Ringers cancel one for one; any left over are live and worth 3.
  const liveRingers = ringers[0] - ringers[1];
  let scorer: Player | null = liveRingers > 0 ? 0 : liveRingers < 0 ? 1 : null;
  if (scorer !== null) {
    let toCredit = Math.abs(liveRingers);
    shoes.forEach((s, i) => {
      if (toCredit > 0 && s.player === scorer && isLive(s) && s.measure.ringer) {
        shoeValues[i] = 3;
        toCredit--;
      }
    });
    points[scorer] += 3 * Math.abs(liveRingers);
  }

  // Remaining shoes in count, closest first. Opposing shoes at an equal distance
  // (including two shoes touching the stake) cancel each other.
  const order = shoes
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => inCount(s))
    .sort((a, b) => a.s.measure.distance - b.s.measure.distance);

  const remaining: { s: PitchedShoe; i: number }[] = [];
  for (let k = 0; k < order.length; ) {
    let end = k + 1;
    while (end < order.length && order[end].s.measure.distance - order[k].s.measure.distance <= TIE_TOLERANCE) end++;
    const group = order.slice(k, end);
    const mine = group.filter(({ s }) => s.player === 0);
    const theirs = group.filter(({ s }) => s.player === 1);
    const cancel = Math.min(mine.length, theirs.length);
    remaining.push(...mine.slice(cancel), ...theirs.slice(cancel));
    k = end;
  }

  // The closest uncancelled shoe decides who scores (unless a live ringer already did);
  // that player then scores each shoe of theirs that is closer than the opponent's best.
  if (scorer === null && remaining.length > 0) scorer = remaining[0].s.player;
  for (const { s, i } of remaining) {
    if (s.player !== scorer) break;
    const value = s.measure.leaner ? opts.leanerValue : 1;
    shoeValues[i] = value;
    points[s.player] += value;
  }

  return { points, ringers, shoeValues };
}

/** RULE 6 A.2: count-all scoring. Every live shoe scores for its owner. */
export function scoreCountAll(shoes: PitchedShoe[], opts: ScoringOptions): InningScore {
  const ringers = ringerCounts(shoes);
  const points: [number, number] = [0, 0];
  const shoeValues = shoes.map((s) => {
    if (!isLive(s)) return 0;
    if (s.measure.ringer) return 3;
    if (s.measure.distance <= IN_COUNT_DISTANCE) return s.measure.leaner ? opts.leanerValue : 1;
    return 0;
  });
  shoes.forEach((s, i) => (points[s.player] += shoeValues[i]));
  return { points, ringers, shoeValues };
}
