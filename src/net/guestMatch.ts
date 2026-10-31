// The guest's side of online play: a mirror of the host's match. It simulates
// every throw itself (so the flight looks right with no lag), but the host
// decides where shoes end up, what they score, and what happens next.

import { FAR_STAKE, NEAR_STAKE, type MatchState, type Player, type Stake } from '../rules';
import type { ShoeSim } from '../physics/sim';
import type { FoulLine, Grip, Stance } from '../physics/throw';
import type { SwingResult } from '../input/swing';
import { matchStats, type InningSummary, type MatchSetup, type MatchView } from '../game/matchFlow';
import type { Controller, Phase, ShoeResult, ThrowSession } from '../game/session';
import type { Character } from '../ai/roster';
import type { Channel } from './channel';
import { stakeOf, type EmoteId, type GuestMessage, type HostMessage, type MatchSnapshot, type ShoeSnapshot } from './protocol';

export interface GuestHooks {
  onEmote?: (id: EmoteId) => void;
  /** The host ended the match. */
  onBye?: () => void;
  /** The host started a new match (rematch) over this connection. */
  onWelcome?: (m: Extract<HostMessage, { t: 'welcome' }>) => void;
}

export class GuestMatch implements Controller, MatchView {
  phase: Phase = 'handoff';
  state!: MatchState;
  shoeIndex = 0;
  pitcher: Player = 0;
  lastInning: InningSummary | null = null;
  onResult: ((r: ShoeResult) => void) | null = null;
  onChange: (() => void) | null = null;
  private grips: [Grip, Grip] = ['one-and-quarter', 'one-and-quarter'];
  private stances: [Stance, Stance] = ['right', 'right'];
  /** Host shoe id → our copy, in throw order. Kept after a shoe leaves the pit. */
  private readonly shoes = new Map<number, ShoeSim>();
  /** Sent our swing; waiting for the host to throw it. */
  private awaitingThrow = false;
  private channel: Channel<HostMessage, GuestMessage>;

  constructor(
    readonly session: ThrowSession,
    channel: Channel<HostMessage, GuestMessage>,
    readonly me: Player,
    readonly setup: MatchSetup,
    match: MatchSnapshot,
    pit: ShoeSnapshot[],
    private readonly hooks: GuestHooks = {},
  ) {
    session.judging = false;
    this.channel = channel;
    this.listen(channel);
    this.applyMatch(match);
    this.applyPit(pit);
  }

  /** After a reconnect: carry on over the new connection from the host's current state. */
  rejoin(channel: Channel<HostMessage, GuestMessage>, match: MatchSnapshot, pit: ShoeSnapshot[]) {
    this.channel = channel;
    this.listen(channel);
    this.awaitingThrow = false;
    this.session.settlePending();
    this.applyMatch(match);
    this.applyPit(pit);
    this.onChange?.();
  }

  private listen(channel: Channel<HostMessage, GuestMessage>) {
    channel.onMessage = (m) => this.receive(m);
  }

  // ── MatchView ────────────────────────────────────────────────────────

  get inningNumber(): number {
    return this.state.innings.length + 1;
  }

  get target(): Stake {
    return this.state.innings.length % 2 === 0 ? NEAR_STAKE : FAR_STAKE;
  }

  get nextFirstPitcher(): Player {
    return this.state.firstPitcher;
  }

  name(p: Player): string {
    return this.setup.players[p].name;
  }

  character(): Character | null {
    return null;
  }

  controlledHere(p: Player): boolean {
    return p === this.me;
  }

  stats() {
    return matchStats(this.state);
  }

  acceptHandoff() {
    if (this.phase === 'handoff' && this.pitcher === this.me) this.channel.send({ t: 'ready' });
  }

  nextInning() {
    if (this.phase === 'inning') this.channel.send({ t: 'next' });
  }

  sendEmote(id: EmoteId) {
    this.channel.send({ t: 'emote', id });
  }

  // ── Controller ───────────────────────────────────────────────────────

  get grip(): Grip {
    return this.grips[this.pitcher];
  }
  set grip(g: Grip) {
    if (this.pitcher === this.me) this.grips[this.me] = g;
  }

  get stance(): Stance {
    return this.stances[this.pitcher];
  }

  private get pitcherShoe(): number {
    const i = this.phase === 'flight' || this.phase === 'result' ? this.shoeIndex - 1 : this.shoeIndex;
    return i % 2;
  }

  get stanceLocked(): boolean {
    return this.pitcher !== this.me || this.pitcherShoe === 1 || this.phase === 'flight' || this.phase === 'result';
  }

  setStance(s: Stance) {
    if (!this.stanceLocked) this.stances[this.me] = s;
  }

  get line(): FoulLine {
    return this.setup.players[this.pitcher].line;
  }

  shoesInPit(): ShoeSim[] {
    return [...this.shoes.values()].filter((s) => this.session.sim.shoes.includes(s));
  }

  /** Our swing goes to the host, who throws it for both of us. */
  pitch(swing: SwingResult): ShoeSim | null {
    if (this.phase !== 'aim' || this.pitcher !== this.me || this.awaitingThrow) return null;
    this.awaitingThrow = true;
    this.channel.send({ t: 'swing', swing, grip: this.grips[this.me], stance: this.stances[this.me] });
    return null;
  }

  /** Done looking at a result: tell the host. */
  ready() {
    if (this.phase === 'result') this.channel.send({ t: 'skip' });
  }

  // ── From the host ────────────────────────────────────────────────────

  private receive(m: HostMessage) {
    switch (m.t) {
      case 'state':
        this.applyMatch(m.match);
        if (m.pit) this.applyPit(m.pit);
        this.onChange?.();
        break;
      case 'throw': {
        this.applyPit(m.pit);
        const s = m.shoe;
        const local = this.session.throwInput(s.input, s.owner, stakeOf(s.end));
        this.shoes.set(s.id, local);
        this.awaitingThrow = false;
        this.phase = 'flight';
        this.onChange?.();
        break;
      }
      case 'settled': {
        this.applyPit(m.pit);
        this.session.settlePending();
        const shoe = this.shoes.get(m.id);
        if (!shoe) break;
        this.phase = 'result';
        const measure = m.foul ? { ...m.measure, distance: Infinity } : m.measure;
        this.onResult?.({ shoe, input: shoe.input, measure, foul: m.foul, inCount: m.inCount });
        break;
      }
      case 'emote':
        this.hooks.onEmote?.(m.id);
        break;
      case 'bye':
        this.hooks.onBye?.();
        break;
      case 'welcome':
        this.hooks.onWelcome?.(m);
        break;
      default:
        break;
    }
  }

  private applyMatch(m: MatchSnapshot) {
    this.state = m.saved.state;
    this.phase = m.phase;
    this.shoeIndex = m.shoeIndex;
    this.pitcher = m.pitcher;
    this.lastInning = m.lastInning;
    // The other side's grip and platform come from the host; ours stay as we set them.
    const other: Player = this.me === 0 ? 1 : 0;
    this.grips[other] = m.saved.grips[other];
    this.stances[other] = m.saved.stances[other];
    if (this.pitcherShoe === 1 && this.pitcher === this.me) this.stances[this.me] = m.saved.stances[this.me];
  }

  /** Make our pit match the host's: same shoes, exactly where the host says they lie. */
  private applyPit(pit: ShoeSnapshot[]) {
    const ids = new Set(pit.map((s) => s.id));
    for (const [id, local] of this.shoes) {
      if (!ids.has(id) && this.session.sim.shoes.includes(local)) this.session.remove(local);
    }
    for (const s of pit) {
      let local = this.shoes.get(s.id);
      if (!local || !this.session.sim.shoes.includes(local)) {
        local = this.session.addAtRest(s.input, s.owner, stakeOf(s.end), s.pose);
        this.shoes.set(s.id, local);
      } else {
        this.session.sim.placeAtRest(local, s.pose);
      }
      local.plugged = s.plugged;
      local.foulContact = s.foulContact;
    }
  }
}
