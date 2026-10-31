// A throw session: the pit simulation plus the bookkeeping every mode needs,
// namely waiting for a pitched shoe to settle, judging it, and pulling foul shoes.

import { IN_COUNT_DISTANCE, measureShoe, type Player, type ShoeMeasure, type Stake } from '../rules';
import { PitSim, type ShoeSim, type SimParams } from '../physics/sim';
import type { FoulLine, Grip, Stance, ThrowInput } from '../physics/throw';
import type { SwingResult } from '../input/swing';

export interface ShoeResult {
  shoe: ShoeSim;
  input: ThrowInput;
  measure: ShoeMeasure;
  foul: boolean;
  inCount: boolean;
}

export class ThrowSession {
  sim: PitSim;
  onSettled: ((r: ShoeResult) => void) | null = null;
  /** A shoe left the pit (foul, or cleared), so the renderer can drop its mesh. */
  onRemoved: ((s: ShoeSim) => void) | null = null;
  /** Shoes judged foul during this session, even after they've been pulled. */
  readonly fouls = new Set<ShoeSim>();
  private pending: ShoeSim | null = null;

  constructor(params: SimParams) {
    this.sim = new PitSim(params);
  }

  get busy(): boolean {
    return this.pending !== null;
  }

  throw(swing: SwingResult, setup: { grip: Grip; stance: Stance; line: FoulLine }, owner: Player, target: Stake): ShoeSim {
    const input: ThrowInput = { ...setup, power: swing.power, aim: swing.aim, release: swing.release, wobble: swing.wobble, seed: (Math.random() * 2 ** 32) >>> 0 };
    return this.throwInput(input, owner, target);
  }

  throwInput(input: ThrowInput, owner: Player, target: Stake): ShoeSim {
    const shoe = this.sim.throwShoe(input, owner, target);
    this.pending = shoe;
    return shoe;
  }

  step() {
    this.sim.step();
    if (this.pending && this.sim.allSettled()) {
      const shoe = this.pending;
      this.pending = null;
      this.onSettled?.(this.judge(shoe));
    }
  }

  /** Measure a shoe where it lies, without judging it (no side effects). */
  measure(shoe: ShoeSim): ShoeMeasure {
    return this.sim.shoes.includes(shoe) ? measureShoe(this.sim.pose(shoe), shoe.target) : FOUL_MEASURE;
  }

  /** Judge a shoe where it lies now, pulling it from the pit if it's foul. */
  judge(shoe: ShoeSim): ShoeResult {
    const live = this.sim.shoes.includes(shoe);
    const foul = this.fouls.has(shoe) || !live || this.sim.isFoul(shoe);
    const measure = live ? measureShoe(this.sim.pose(shoe), shoe.target) : FOUL_MEASURE;
    if (foul && live) {
      // RULE 5 A: a foul shoe comes out of the pit before the next shoe is pitched.
      this.fouls.add(shoe);
      this.remove(shoe);
    }
    const inCount = !foul && !measure.ringer && measure.distance <= IN_COUNT_DISTANCE;
    return { shoe, input: shoe.input, measure, foul, inCount };
  }

  remove(shoe: ShoeSim) {
    if (!this.sim.shoes.includes(shoe)) return;
    this.sim.removeShoe(shoe);
    this.onRemoved?.(shoe);
  }

  /** Pick up every shoe. */
  clear() {
    for (const s of [...this.sim.shoes]) this.remove(s);
    this.pending = null;
    this.fouls.clear();
  }

  /** Swap in new physics settings; clears the pit. */
  rebuild(params: SimParams) {
    this.clear();
    const onImpact = this.sim.onImpact;
    this.sim.world.free();
    this.sim = new PitSim(params);
    this.sim.onImpact = onImpact;
  }
}

const FOUL_MEASURE: ShoeMeasure = { ringer: false, distance: Infinity, touching: false, leaner: false };

/** What the shell needs from a game mode (practice or a match). */
export type Phase = 'aim' | 'flight' | 'result' | 'handoff' | 'inning' | 'over';

export interface Controller {
  readonly session: ThrowSession;
  readonly phase: Phase;
  readonly target: Stake;
  grip: Grip;
  readonly stance: Stance;
  readonly stanceLocked: boolean;
  setStance(s: Stance): void;
  readonly line: FoulLine;
  /** Shoes pitched this set or inning that are still in the pit, in throw order. */
  shoesInPit(): ShoeSim[];
  pitch(swing: SwingResult): ShoeSim | null;
  /** Done looking at a shoe's result. */
  ready(): void;
  onResult: ((r: ShoeResult) => void) | null;
  /** Phase changed for any reason, so the UI should refresh. */
  onChange: (() => void) | null;
}
