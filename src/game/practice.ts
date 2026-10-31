// Phase 0 practice: pitch sets of four shoes at the near stake and see how each one measures.

import { IN, IN_COUNT_DISTANCE, NEAR_STAKE, measureShoe, type ShoeMeasure } from '../rules';
import { PitSim, type ShoeSim, type SimParams } from '../physics/sim';
import type { FoulLine, Grip, Stance, ThrowInput } from '../physics/throw';
import type { SwingResult } from '../input/swing';

export type PracticePhase = 'aim' | 'flight' | 'result';

export interface ShoeResult {
  shoe: ShoeSim;
  input: ThrowInput;
  measure: ShoeMeasure;
  foul: boolean;
  inCount: boolean;
}

export interface PracticeStats {
  thrown: number;
  ringers: number;
  inCount: number;
  fouls: number;
}

/** Shoes per set: two pairs, like one inning's worth of pitching. */
export const SET_SIZE = 4;

export class Practice {
  sim: PitSim;
  phase: PracticePhase = 'aim';
  grip: Grip = 'one-and-quarter';
  stance: Stance = 'right';
  line: FoulLine = 'full';
  /** Shoes currently in the pit (this set), in throw order. */
  set: ShoeSim[] = [];
  stats: PracticeStats = { thrown: 0, ringers: 0, inCount: 0, fouls: 0 };
  lastResult: ShoeResult | null = null;
  onResult: ((r: ShoeResult) => void) | null = null;
  /** Shoes pulled out of the pit (fouls), so the renderer can drop their meshes. */
  onRemoved: ((s: ShoeSim) => void) | null = null;
  private pending: ShoeSim | null = null;

  constructor(params: SimParams) {
    this.sim = new PitSim(params);
  }

  /** RULE 3 C.1: both shoes of a pair come from the same platform. */
  get stanceLocked(): boolean {
    return this.set.length % 2 === 1;
  }

  setStance(s: Stance) {
    if (!this.stanceLocked) this.stance = s;
  }

  pitch(swing: SwingResult): ShoeSim | null {
    if (this.phase !== 'aim') return null;
    if (this.set.length >= SET_SIZE) this.clearPit();
    const input: ThrowInput = {
      grip: this.grip,
      stance: this.stance,
      line: this.line,
      power: swing.power,
      aim: swing.aim,
      release: swing.release,
      wobble: swing.wobble,
      seed: (Math.random() * 2 ** 32) >>> 0,
    };
    const owner = this.set.length < 2 ? 0 : 1;
    const shoe = this.sim.throwShoe(input, owner, NEAR_STAKE);
    this.set.push(shoe);
    this.pending = shoe;
    this.phase = 'flight';
    return shoe;
  }

  step() {
    this.sim.step();
    if (this.phase === 'flight' && this.pending && this.sim.allSettled()) this.resolve(this.pending);
  }

  private resolve(shoe: ShoeSim) {
    this.pending = null;
    const measure = measureShoe(this.sim.pose(shoe), NEAR_STAKE);
    const foul = this.sim.isFoul(shoe);
    const inCount = !foul && !measure.ringer && measure.distance <= IN_COUNT_DISTANCE;
    const r: ShoeResult = { shoe, input: shoe.input, measure, foul, inCount };

    this.stats.thrown++;
    if (foul) this.stats.fouls++;
    else if (measure.ringer) this.stats.ringers++;
    else if (inCount) this.stats.inCount++;

    // RULE 5 A: a foul shoe comes out of the pit before the next shoe is pitched.
    if (foul) this.remove(shoe);
    this.lastResult = r;
    this.phase = 'result';
    this.onResult?.(r);
  }

  /** Back to aiming after looking at the result. */
  ready() {
    if (this.phase === 'result') this.phase = 'aim';
  }

  private remove(shoe: ShoeSim) {
    this.sim.removeShoe(shoe);
    this.onRemoved?.(shoe);
  }

  clearPit() {
    for (const s of [...this.sim.shoes]) this.remove(s);
    this.set = [];
    this.pending = null;
    if (this.phase === 'flight') this.phase = 'aim';
  }

  /** Measurements of every shoe still in the pit, for the set summary. */
  measureSet(): ShoeMeasure[] {
    return this.set.filter((s) => this.sim.shoes.includes(s)).map((s) => measureShoe(this.sim.pose(s), NEAR_STAKE));
  }

  /** Swap in new physics settings; clears the pit. */
  rebuild(params: SimParams) {
    this.clearPit();
    this.sim.world.free();
    this.sim = new PitSim(params);
    this.phase = 'aim';
  }
}

export function describeResult(r: ShoeResult): { title: string; detail: string; tone: 'great' | 'good' | 'meh' | 'bad' } {
  const inches = (r.measure.distance / IN).toFixed(1);
  if (r.foul) {
    const why = r.shoe.foulContact ? 'touched the backboard or ground outside the pit' : 'came to rest outside the pit';
    return { title: 'Foul shoe', detail: `It ${why}, so it’s out of count and pulled from the pit.`, tone: 'bad' };
  }
  if (r.measure.ringer) return { title: 'Ringer!', detail: 'Three points. The straightedge clears the stake.', tone: 'great' };
  if (r.measure.leaner) return { title: 'Leaner', detail: 'Propped against the stake: one point (two in backyard rules).', tone: 'good' };
  if (r.inCount) return { title: `${inches} in`, detail: 'In count: within 6 inches of the stake.', tone: 'good' };
  return { title: `${inches} in`, detail: 'Out of count: more than 6 inches away.', tone: 'meh' };
}
