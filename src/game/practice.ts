// Practice: pitch sets of four shoes at the near stake and see how each one measures.

import { IN, NEAR_STAKE, type Stake } from '../rules';
import type { ShoeSim } from '../physics/sim';
import type { FoulLine, Grip, Stance } from '../physics/throw';
import type { SwingResult } from '../input/swing';
import type { Controller, Phase, ShoeResult, ThrowSession } from './session';

export interface PracticeStats {
  thrown: number;
  ringers: number;
  inCount: number;
  fouls: number;
}

/** Shoes per set: two pairs, like one inning's worth of pitching. */
export const SET_SIZE = 4;

export class Practice implements Controller {
  phase: Phase = 'aim';
  grip: Grip = 'one-and-quarter';
  stance: Stance = 'right';
  line: FoulLine = 'full';
  readonly target: Stake = NEAR_STAKE;
  /** Shoes pitched this set, in throw order (fouls included until pulled). */
  set: ShoeSim[] = [];
  stats: PracticeStats = { thrown: 0, ringers: 0, inCount: 0, fouls: 0 };
  onResult: ((r: ShoeResult) => void) | null = null;
  onChange: (() => void) | null = null;

  constructor(readonly session: ThrowSession) {
    session.onSettled = (r) => this.resolve(r);
  }

  /** RULE 3 C.1: both shoes of a pair come from the same platform. */
  get stanceLocked(): boolean {
    return this.set.length % 2 === 1;
  }

  setStance(s: Stance) {
    if (!this.stanceLocked) this.stance = s;
  }

  shoesInPit(): ShoeSim[] {
    return this.set.filter((s) => this.session.sim.shoes.includes(s));
  }

  pitch(swing: SwingResult): ShoeSim | null {
    if (this.phase !== 'aim') return null;
    if (this.set.length >= SET_SIZE) this.clearPit();
    const owner = this.set.length < 2 ? 0 : 1;
    const shoe = this.session.throw(swing, this, owner, this.target);
    this.set.push(shoe);
    this.phase = 'flight';
    this.onChange?.();
    return shoe;
  }

  private resolve(r: ShoeResult) {
    this.stats.thrown++;
    if (r.foul) this.stats.fouls++;
    else if (r.measure.ringer) this.stats.ringers++;
    else if (r.inCount) this.stats.inCount++;
    this.phase = 'result';
    this.onResult?.(r);
  }

  ready() {
    if (this.phase !== 'result') return;
    this.phase = 'aim';
    this.onChange?.();
  }

  clearPit() {
    this.session.clear();
    this.set = [];
    if (this.phase === 'flight' || this.phase === 'result') this.phase = 'aim';
    this.onChange?.();
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
