// Match flow: game modes, who pitches first (RULE 7), and when a game ends (RULE 8).

import { type InningScore, type PitchedShoe, type Player, other, scoreCancellation, scoreCountAll } from './scoring';

export interface MatchConfig {
  scoring: 'cancellation' | 'count-all';
  /** First to reach or exceed this many points wins. */
  pointLimit: number | null;
  /** Game ends once each player has pitched this many shoes; highest score wins. */
  shoeLimit: number | null;
  leanerValue: 1 | 2;
  /**
   * RULE 7 A: "scorer" — whoever scored pitches first next; after a no-score
   * inning, whoever pitched last does. "alternate" — fixed pattern so both get
   * equal first pitches (required for count-all).
   */
  rotation: 'scorer' | 'alternate';
}

export const MODES = {
  cancellation: { scoring: 'cancellation', pointLimit: 40, shoeLimit: null, leanerValue: 1, rotation: 'scorer' },
  countAll: { scoring: 'count-all', pointLimit: null, shoeLimit: 40, leanerValue: 1, rotation: 'alternate' },
  backyard21: { scoring: 'cancellation', pointLimit: 21, shoeLimit: null, leanerValue: 2, rotation: 'scorer' },
} as const satisfies Record<string, MatchConfig>;

export interface InningRecord {
  firstPitcher: Player;
  score: InningScore;
}

export interface MatchState {
  config: MatchConfig;
  /** Winner of the opening coin toss's choice: pitched first in inning 1. */
  openingPitcher: Player;
  scores: [number, number];
  innings: InningRecord[];
  /** Who pitches first in the next inning. */
  firstPitcher: Player;
  winner: Player | null;
}

export function newMatch(config: MatchConfig, openingPitcher: Player): MatchState {
  return { config, openingPitcher, scores: [0, 0], innings: [], firstPitcher: openingPitcher, winner: null };
}

/** RULE 7 A.2(a): the opening pitcher goes first in innings 1, 4–5, 8–9, …; the other in 2–3, 6–7, … */
export function alternateFirstPitcher(opening: Player, inningNumber: number): Player {
  const m = inningNumber % 4;
  return m === 0 || m === 1 ? opening : other(opening);
}

/** The order the four shoes of the next inning are pitched in. */
export function pitchOrder(state: MatchState): Player[] {
  const a = state.firstPitcher;
  const b = other(a);
  return [a, a, b, b];
}

export function scoreInning(config: MatchConfig, shoes: PitchedShoe[]): InningScore {
  const opts = { leanerValue: config.leanerValue };
  return config.scoring === 'cancellation' ? scoreCancellation(shoes, opts) : scoreCountAll(shoes, opts);
}

function decideWinner(config: MatchConfig, scores: [number, number], innings: number): Player | null {
  const [a, b] = scores;
  const leader: Player | null = a > b ? 0 : b > a ? 1 : null;
  if (config.pointLimit !== null && Math.max(a, b) >= config.pointLimit) {
    // Count-all can push both players past the limit in one inning; a tie plays on.
    return leader;
  }
  if (config.shoeLimit !== null) {
    const shoesEach = innings * 2;
    if (shoesEach >= config.shoeLimit) {
      // RULE 8 B.2: a tie at the shoe limit is broken with two-inning blocks.
      const extra = shoesEach - config.shoeLimit;
      if (extra % 4 === 0) return leader;
    }
  }
  return null;
}

/** Record a completed inning. `shoes` are in pitch order, two per player. */
export function applyInning(state: MatchState, shoes: PitchedShoe[]): MatchState {
  if (state.winner !== null) throw new Error('match is over');
  const score = scoreInning(state.config, shoes);
  const scores: [number, number] = [state.scores[0] + score.points[0], state.scores[1] + score.points[1]];
  const innings = [...state.innings, { firstPitcher: state.firstPitcher, score }];

  let firstPitcher: Player;
  if (state.config.rotation === 'alternate') {
    firstPitcher = alternateFirstPitcher(state.openingPitcher, innings.length + 1);
  } else if (score.points[0] > 0) {
    firstPitcher = 0;
  } else if (score.points[1] > 0) {
    firstPitcher = 1;
  } else {
    firstPitcher = other(state.firstPitcher); // no score: whoever pitched last goes first
  }

  return { ...state, scores, innings, firstPitcher, winner: decideWinner(state.config, scores, innings.length) };
}
