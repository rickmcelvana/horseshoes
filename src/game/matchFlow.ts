// A match: owns the inning state machine (who pitches, from which end,
// handoffs) and leans on the rules engine for scoring, rotation and when the
// game ends. Each side is a person at this device, a computer opponent, or (in
// online play, on the host) a friend on another device.
//
// In online play the host runs this; the guest mirrors it (see net/guestMatch.ts).
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
import { ROSTER, type Character, type CharacterId } from '../ai/roster';
import type { Situation } from '../ai/arm';
import { matchDusk } from './duskProgress';

export type ModeKey = keyof typeof MODES;

export const MODE_INFO: Record<ModeKey, { label: string; blurb: string }> = {
  cancellation: { label: 'Cancellation to 40', blurb: 'NHPA standard. Ringers cancel; only one player scores each inning.' },
  countAll: { label: 'Count-all, 40 shoes', blurb: 'Every shoe counts for its owner. Highest total after 40 shoes each.' },
  backyard21: { label: 'Backyard 21', blurb: 'Cancellation to 21, and a leaner is worth 2.' },
};

export interface PlayerSetup {
  name: string;
  line: FoulLine;
  /** A computer opponent plays this side. */
  npc?: CharacterId;
  /** A friend on another device plays this side (online play, host's view). */
  remote?: boolean;
}

/** Setup for a side played by a character: their name and their foul line. */
export function npcPlayer(id: CharacterId): PlayerSetup {
  const c = ROSTER[id];
  return { name: c.name, line: c.line, npc: id };
}

export interface MatchSetup {
  mode: ModeKey;
  players: [PlayerSetup, PlayerSetup];
}

/** How a shoe finally lay, in plain data (it travels to the guest in online play). */
export interface ShoeLabel {
  player: Player;
  foul: boolean;
  ringer: boolean;
  leaner: boolean;
  /** Meters from the stake; -1 for a foul shoe. */
  distance: number;
}

export interface InningSummary {
  number: number;
  score: InningScore;
  /** Each shoe as it finally lay, in pitch order. */
  shoes: ShoeLabel[];
  /** The score called the way pitchers call it. */
  call: string;
}

/** What the match screens need, whether the match runs here or is mirrored from a host. */
export interface MatchView {
  readonly setup: MatchSetup;
  readonly state: MatchState;
  readonly phase: Phase;
  readonly pitcher: Player;
  readonly inningNumber: number;
  readonly shoeIndex: number;
  readonly target: Stake;
  readonly lastInning: InningSummary | null;
  readonly nextFirstPitcher: Player;
  name(p: Player): string;
  character(p: Player): Character | null;
  /** Someone at this device plays this side. */
  controlledHere(p: Player): boolean;
  stats(): { ringers: [number, number]; shoes: number };
  acceptHandoff(): void;
  nextInning(): void;
}

/** Everything needed to pick a match back up at an inning boundary. */
export interface SavedMatch {
  setup: MatchSetup;
  state: MatchState;
  grips: [Grip, Grip];
  stances: [Stance, Stance];
}

/** Ringers thrown and shoes pitched so far, per player. */
export function matchStats(state: MatchState): { ringers: [number, number]; shoes: number } {
  const ringers: [number, number] = [0, 0];
  for (const i of state.innings) {
    ringers[0] += i.score.ringers[0];
    ringers[1] += i.score.ringers[1];
  }
  return { ringers, shoes: state.innings.length * 2 };
}

export class MatchFlow implements Controller, MatchView {
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
  /** Called with each shoe as it leaves the hand (online play sends it to the guest). */
  onPitch: ((shoe: ShoeSim) => void) | null = null;
  private order: Player[];

  constructor(
    readonly session: ThrowSession,
    readonly setup: MatchSetup,
    opening: Player | SavedMatch,
  ) {
    if (typeof opening === 'number') {
      this.state = newMatch(MODES[setup.mode], opening);
      setup.players.forEach((p, i) => {
        if (p.npc) {
          this.grips[i] = ROSTER[p.npc].grip;
          this.stances[i] = ROSTER[p.npc].stance;
        }
      });
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

  controlledHere(p: Player): boolean {
    const s = this.setup.players[p];
    return !s.npc && !s.remote;
  }

  /** A remote player's choice of grip and platform, applied when it's their turn. */
  setChoicesFor(p: Player, grip: Grip, stance: Stance) {
    this.grips[p] = grip;
    if (this.pitcher === p && !this.stanceLocked) this.stances[p] = stance;
  }

  /** The character playing this side, if it's a computer opponent. */
  character(p: Player): Character | null {
    const id = this.setup.players[p].npc;
    return id ? ROSTER[id] : null;
  }

  /** What's at stake for this player right now, for the NPC's pressure model. */
  situation(p: Player): Situation {
    const o: Player = p === 0 ? 1 : 0;
    const ringers: [number, number] = [0, 0];
    for (const { shoe, player } of this.thrown) {
      if (this.session.sim.shoes.includes(shoe) && !this.session.isFoulNow(shoe) && this.session.measure(shoe).ringer) ringers[player]++;
    }
    return {
      myScore: this.state.scores[p],
      oppScore: this.state.scores[o],
      progress: matchDusk(this.state),
      mustAnswerRinger: this.state.config.scoring === 'cancellation' && ringers[o] > ringers[p],
    };
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
    this.onPitch?.(shoe);
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
    const labels: ShoeLabel[] = results.map((r, i) => ({
      player: this.thrown[i].player,
      foul: r.foul,
      ringer: !r.foul && r.measure.ringer,
      leaner: !r.foul && r.measure.leaner,
      distance: r.foul ? -1 : r.measure.distance,
    }));
    this.lastInning = { number, score, shoes: labels, call: this.callScore(score) };
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

  stats() {
    return matchStats(this.state);
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
