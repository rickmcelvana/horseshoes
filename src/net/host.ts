// The host's side of online play: runs the real match (MatchFlow) and keeps
// the guest's mirror in step. Every throw goes through here, so throws, rulings
// and scores all come from one place.

import type { MatchFlow } from '../game/matchFlow';
import type { ShoeResult } from '../game/session';
import type { ShoeSim } from '../physics/sim';
import type { ShoeMeasure } from '../rules';
import type { Channel } from './channel';
import { PROTOCOL_VERSION, endOf, type EmoteId, type GuestMessage, type HostMessage, type MatchSnapshot, type ShoeSnapshot, type WorldSettings } from './protocol';

export interface HostHooks {
  onChange: () => void;
  onResult: (r: ShoeResult) => void;
  /** The guest is done looking at a result. Default: move on. */
  onSkip?: () => void;
  onEmote?: (id: EmoteId) => void;
  /** The guest's connection dropped. */
  onGuestLost?: () => void;
}

/** Fouls carry an infinite distance, which JSON can't; send a large number instead. */
const wireMeasure = (m: ShoeMeasure): ShoeMeasure => (Number.isFinite(m.distance) ? m : { ...m, distance: 999 });

export class HostLink {
  private channel: Channel<GuestMessage, HostMessage> | null = null;
  /** The guest's player slot in the match. */
  readonly guest = 1 as const;

  constructor(
    readonly flow: MatchFlow,
    private readonly world: WorldSettings,
    private readonly build: string,
    private readonly hooks: HostHooks,
  ) {
    flow.onChange = () => {
      this.sendState();
      hooks.onChange();
    };
    flow.onResult = (r) => {
      this.send({ t: 'settled', id: r.shoe.id, measure: wireMeasure(r.measure), foul: r.foul, inCount: r.inCount, pit: this.pit() });
      hooks.onResult(r);
    };
    flow.onPitch = (shoe) => {
      this.send({ t: 'throw', shoe: this.snap(shoe), pit: this.pit().filter((s) => s.id !== shoe.id) });
    };
  }

  get connected(): boolean {
    return this.channel !== null;
  }

  /**
   * Take a (re)connected guest. The first message must be their hello; a
   * mismatched version is turned away.
   */
  attach(channel: Channel<GuestMessage, HostMessage>, hello: Extract<GuestMessage, { t: 'hello' }>): boolean {
    if (hello.protocol !== PROTOCOL_VERSION || hello.build !== this.build) {
      channel.send({ t: 'reject', reason: 'You and the host are on different versions of the game. Reload both pages and try again.' });
      return false;
    }
    this.adopt(channel);
    return true;
  }

  /** Start talking over a connection that has already said hello (a reconnect, or a rematch). */
  adopt(channel: Channel<GuestMessage, HostMessage>) {
    this.channel = channel;
    channel.onMessage = (m) => this.receive(m);
    channel.onClose = () => {
      if (this.channel !== channel) return;
      this.channel = null;
      this.hooks.onGuestLost?.();
    };
    channel.send({ t: 'welcome', you: this.guest, setup: this.flow.setup, world: this.world, match: this.matchSnapshot(), pit: this.pit() });
  }

  /** Hand the guest's connection to the link for a new match (rematch). */
  handOver(next: HostLink) {
    const ch = this.channel;
    this.channel = null;
    if (ch) next.adopt(ch);
  }

  sendEmote(id: EmoteId) {
    this.send({ t: 'emote', id });
  }

  /** Tell the guest we're leaving, then let go of the connection. */
  close() {
    this.send({ t: 'bye' });
    this.channel?.close();
    this.channel = null;
  }

  private send(m: HostMessage) {
    this.channel?.send(m);
  }

  private receive(m: GuestMessage) {
    const f = this.flow;
    const theirTurn = f.pitcher === this.guest;
    switch (m.t) {
      case 'swing':
        if (f.phase === 'aim' && theirTurn) {
          f.setChoicesFor(this.guest, m.grip, m.stance);
          f.pitch(m.swing);
        }
        break;
      case 'ready':
        if (f.phase === 'handoff' && theirTurn) f.acceptHandoff();
        break;
      case 'skip':
        if (f.phase === 'result') (this.hooks.onSkip ?? (() => f.ready()))();
        break;
      case 'next':
        if (f.phase === 'inning') f.nextInning();
        break;
      case 'emote':
        this.hooks.onEmote?.(m.id);
        break;
      case 'hello':
        break;
    }
  }

  private sendState() {
    // While a shoe is in the air the guest is simulating it too; don't snap the pit under it.
    const pit = this.flow.phase === 'flight' ? undefined : this.pit();
    this.send({ t: 'state', match: this.matchSnapshot(), pit });
  }

  private matchSnapshot(): MatchSnapshot {
    const f = this.flow;
    return { saved: f.save(), phase: f.phase, shoeIndex: f.shoeIndex, pitcher: f.pitcher, lastInning: f.lastInning };
  }

  private snap(s: ShoeSim): ShoeSnapshot {
    return { id: s.id, owner: s.owner, end: endOf(s.target), input: s.input, pose: this.flow.session.sim.pose(s), plugged: s.plugged, foulContact: s.foulContact };
  }

  private pit(): ShoeSnapshot[] {
    return this.flow.session.sim.shoes.map((s) => this.snap(s));
  }
}
