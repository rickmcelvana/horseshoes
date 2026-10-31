// A hot-seat match: two players, one device. Owns the inning state machine
// (who pitches, from which end, handoffs) and leans on the rules engine for
// scoring, rotation and when the game ends.
//
//   handoff → aim → flight → result → (next shoe: aim or handoff)
//                                   → after the 4th shoe: inning → handoff … → over

import {
  FAR_STAKE,
  MODES,
  NEAR_STAKE,
  type InningScore,
  type MatchState,
  type PitchedShoe,
  type Player,
  type Stake,
  applyInning,
  newMatch,
  pitchOrder,
} from '../rules';
import type { ShoeSim } from '../physics/sim';
import type { FoulLine, Grip, Stance } from '../physics/throw';
import type { SwingResult } from '../input/swing';
import type { Controller, Phase, ShoeResult, ThrowSession } from './session';

export type ModeKey = keyof typeof MODES;

export const MODE_INFO: Record<ModeKey, { label: string; blurb: string }> = {
  cancellation: { label: 'Cancellation to 40', blurb: 'NHPA standard. Ringers cancel; only one player scores each inning.' },
  countAll: { label: 'Count-all, 40 shoes', blurb: 'Every shoe counts for its owner. Highest total after 40 shoes each.' },
  backyard21: { label: 'Backyard 21', blurb: 'Cancellation to 21, and a leaner is worth 2.' },
};

export interface PlayerSetup {
  name: string;
  line: FoulLine;
}

export interface MatchSetup {
  mode: ModeKey;
  players: [PlayerSetup, PlayerSetup];
}

export interface InningSummary {
  number: number;
  score: InningScore;
  /** Each shoe as it finally lay, in pitch order. */
  results: ShoeResult[];
  /** The score called the way pitchers call it. */
  call: string;
}

/** Everything needed to pick a match back up at an inning boundary. */
export interface SavedMatch {
  setup: MatchSetup;
  state: MatchState;
  grips: [Grip, Grip];
  stances: [Stance, Stance];
}

export class MatchFlow implements Controller {
  phase: Phase = 'handoff';
  state: MatchState;
  grips: [Grip, Grip] = ['one-and-quarter', 'one-and-quarter'];
  stances: [Stance, Stance] = ['right', 'right'];
  /** Shoes pitched this inning, in pitch order. */
  thrown: { shoe: ShoeSim; player: Player }[] = [];
  lastInning: InningSummary | null = null;
  onResult: ((r: ShoeResult) => void) | null = null;
  onChange: (() => void) | null = null;
  /** Called after each inning so the match can be saved. */
  onInning: ((saved: SavedMatch) => void) | null = null;
  private order: Player[];

  constructor(
    readonly session: ThrowSession,
    readonly setup: MatchSetup,
    opening: Player | SavedMatch,
  ) {
    if (typeof opening === 'number') {
      this.state = newMatch(MODES[setup.mode], opening);
    } else {
      this.state = opening.state;
      this.grips = [...opening.grips];
      this.stances = [...opening.stances];
    }
    this.order = pitchOrder(this.state);
    session.onSettled = (r) => this.resolve(r);
    if (this.state.winner !== null) this.phase = 'over';
  }

  get inningNumber(): number {
    return this.state.innings.length + 1;
  }

  /** Players start at one end and walk to the other after every inning. */
  get target(): Stake {
    return this.state.innings.length % 2 === 0 ? NEAR_STAKE : FAR_STAKE;
  }

  get shoeIndex(): number {
    return this.thrown.length;
  }

  /** Who pitches the next shoe (or the one in flight). */
  get pitcher(): Player {
    const i = this.phase === 'flight' || this.phase === 'result' ? this.shoeIndex - 1 : this.shoeIndex;
    return this.order[Math.min(i, 3)];
  }

  /** 0 or 1: which of the pitcher's two shoes this is. */
  get pitcherShoe(): number {
    const i = this.phase === 'flight' || this.phase === 'result' ? this.shoeIndex - 1 : this.shoeIndex;
    return i % 2;
  }

  get grip(): Grip {
    return this.grips[this.pitcher];
  }
  set grip(g: Grip) {
    this.grips[this.pitcher] = g;
  }

  get stance(): Stance {
    return this.stances[this.pitcher];
  }

  /** RULE 3 C.1: both of a player's shoes in an inning come from the same platform. */
  get stanceLocked(): boolean {
    return this.pitcherShoe === 1 || this.phase === 'flight' || this.phase === 'result';
  }

  setStance(s: Stance) {
    if (!this.stanceLocked) this.stances[this.pitcher] = s;
  }

  get line(): FoulLine {
    return this.setup.players[this.pitcher].line;
  }

  name(p: Player): string {
    return this.setup.players[p].name;
  }

  shoesInPit(): ShoeSim[] {
    return this.thrown.map((t) => t.shoe).filter((s) => this.session.sim.shoes.includes(s));
  }

  /** The player has taken the device; let them pitch. */
  acceptHandoff() {
    if (this.phase !== 'handoff') return;
    this.phase = 'aim';
    this.onChange?.();
  }

  pitch(swing: SwingResult): ShoeSim | null {
    if (this.phase !== 'aim') return null;
    const player = this.order[this.shoeIndex];
    const shoe = this.session.throw(swing, { grip: this.grip, stance: this.stance, line: this.line }, player, this.target);
    this.thrown.push({ shoe, player });
    this.phase = 'flight';
    this.onChange?.();
    return shoe;
  }

  private resolve(r: ShoeResult) {
    this.phase = 'result';
    this.onResult?.(r);
  }

  ready() {
    if (this.phase !== 'result') return;
    if (this.shoeIndex === 4) {
      this.finishInning();
    } else {
      const next = this.order[this.shoeIndex];
      this.phase = next === this.order[this.shoeIndex - 1] ? 'aim' : 'handoff';
    }
    this.onChange?.();
  }

  private finishInning() {
    // Shoes are scored where they lie once all four are down (RULE 5 A note).
    const results = this.thrown.map(({ shoe }) => this.session.judge(shoe));
    const shoes: PitchedShoe[] = results.map((r, i) => ({ player: this.thrown[i].player, foul: r.foul, measure: r.measure }));
    const number = this.inningNumber;
    this.state = applyInning(this.state, shoes);
    const score = this.state.innings[this.state.innings.length - 1].score;
    this.lastInning = { number, score, results, call: this.callScore(score) };
    this.phase = 'inning';
    this.onInning?.(this.save());
  }

  /** Physics was rebuilt mid-inning: pitch this inning again from the top. */
  restartInning() {
    if (this.phase === 'inning' || this.phase === 'over') return;
    this.thrown = [];
    this.phase = 'handoff';
    this.onChange?.();
  }

  /** Pick up the shoes and walk to the other end. */
  nextInning() {
    if (this.phase !== 'inning') return;
    this.session.clear();
    this.thrown = [];
    this.order = pitchOrder(this.state);
    this.phase = this.state.winner !== null ? 'over' : 'handoff';
    this.onChange?.();
  }

  save(): SavedMatch {
    return { setup: this.setup, state: this.state, grips: [...this.grips], stances: [...this.stances] };
  }

  /** Ringers thrown and shoes pitched so far, per player. */
  stats(): { ringers: [number, number]; shoes: number } {
    const ringers: [number, number] = [0, 0];
    for (const i of this.state.innings) {
      ringers[0] += i.score.ringers[0];
      ringers[1] += i.score.ringers[1];
    }
    return { ringers, shoes: this.state.innings.length * 2 };
  }

  callScore(score: InningScore): string {
    const [a, b] = score.points;
    if (this.state.config.scoring === 'count-all') {
      return `${this.name(0)} ${a}, ${this.name(1)} ${b}`;
    }
    if (a === 0 && b === 0) {
      const [r0, r1] = score.ringers;
      if (r0 > 0 && r0 === r1) return r0 === 2 ? 'Four dead: the double ringers cancel. No score.' : 'Ringers cancel. No score.';
      return 'No score.';
    }
    const scorer: Player = a > 0 ? 0 : 1;
    const values = score.shoeValues.filter((_, i) => this.thrown[i]?.player === scorer);
    const ringers = values.filter((v) => v === 3).length;
    const points = values.filter((v) => v > 0 && v !== 3).reduce((s, v) => s + v, 0);
    const cancelled = Math.min(score.ringers[0], score.ringers[1]);
    const parts: string[] = [];
    if (ringers === 2) parts.push('a double ringer');
    else if (ringers === 1) parts.push(cancelled ? 'a live ringer' : 'a ringer');
    if (points === 1) parts.push('a point');
    else if (points > 1) parts.push(`${['', '', 'two', 'three', 'four'][points] ?? points} points`);
    const total = score.points[scorer];
    return `${this.name(scorer)} scores ${total}: ${parts.join(' and ')}.`;
  }

  /** Whoever pitches first next inning, for the summary. */
  get nextFirstPitcher(): Player {
    return this.state.firstPitcher;
  }
}
