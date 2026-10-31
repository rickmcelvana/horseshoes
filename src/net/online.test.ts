import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, initPhysics } from '../physics/sim';
import { mulberry32 } from '../physics/rng';
import { MatchFlow, type MatchSetup } from '../game/matchFlow';
import { ThrowSession } from '../game/session';
import { loopback } from './channel';
import { GuestMatch } from './guestMatch';
import { HostLink } from './host';
import { PROTOCOL_VERSION, type GuestMessage, type HostMessage } from './protocol';

beforeAll(() => initPhysics());

const params = () => ({ ...DEFAULT_PARAMS, clay: { ...DEFAULT_PARAMS.clay } });
const world = { sim: params(), launch: { aimHeightIn: 3, aimShortIn: 0.5, releaseHeight: 0.65 } };
const setup: MatchSetup = {
  mode: 'cancellation',
  players: [
    { name: 'Rick', line: 'full' },
    { name: 'Dale', line: 'full', remote: true },
  ],
};

function connect() {
  const pipe = loopback<HostMessage, GuestMessage>();
  const hostSession = new ThrowSession(params());
  const flow = new MatchFlow(hostSession, setup, 0);
  const hostResults: number[] = [];
  const link = new HostLink(flow, world, 'test', { onChange: () => {}, onResult: (r) => hostResults.push(r.shoe.id) });

  // The guest says hello; the host welcomes them.
  let guest: GuestMatch | null = null;
  let rejected = '';
  const guestSession = new ThrowSession(params());
  pipe.b.onMessage = (m) => {
    if (m.t === 'welcome') guest = new GuestMatch(guestSession, pipe.b, m.you, m.setup, m.match, m.pit);
    if (m.t === 'reject') rejected = m.reason;
  };
  return { pipe, flow, link, hostSession, guestSession, hostResults, guest: () => guest, rejected: () => rejected };
}

describe('online play over a loopback channel', () => {
  it('turns away a guest on a different build', () => {
    const c = connect();
    expect(c.link.attach(c.pipe.a, { t: 'hello', protocol: PROTOCOL_VERSION, build: 'other', name: 'Dale' })).toBe(false);
    c.pipe.flush();
    expect(c.rejected()).toMatch(/different versions/);
  });

  it('host and guest play two innings and agree on every shoe and the score', () => {
    const c = connect();
    expect(c.link.attach(c.pipe.a, { t: 'hello', protocol: PROTOCOL_VERSION, build: 'test', name: 'Dale' })).toBe(true);
    c.pipe.flush();
    const guest = c.guest()!;
    expect(guest).not.toBeNull();
    expect(guest.me).toBe(1);

    const rng = mulberry32(8);
    const jitter = (s: number) => (rng() - 0.5) * 2 * s;
    let drift = 0;
    let settledShoes = 0;
    let guard = 0;

    while (c.flow.state.innings.length < 2 && guard++ < 2_000_000) {
      c.pipe.flush();
      const f = c.flow;
      switch (f.phase) {
        case 'handoff':
          if (f.pitcher === 0) f.acceptHandoff();
          else guest.acceptHandoff();
          break;
        case 'aim': {
          const swing = { power: 1 + jitter(0.01), aim: jitter(0.3), release: jitter(0.2), wobble: jitter(0.2), speedRatio: 1 };
          if (f.pitcher === 0) f.pitch(swing);
          else {
            guest.grip = 'flip';
            guest.pitch(swing);
          }
          break;
        }
        case 'flight':
          c.hostSession.step();
          c.guestSession.step();
          break;
        case 'result': {
          // Let the guest's own simulation finish before the host's ruling arrives, and see how close it got.
          for (let i = 0; i < 5000 && !c.guestSession.sim.allSettled(); i++) c.guestSession.step();
          for (const hs of c.hostSession.sim.shoes) {
            const gs = guest.shoesInPit().find((s) => s.id === hs.id) ?? null;
            if (!gs) continue;
            const a = hs.body.translation();
            const b = gs.body.translation();
            drift = Math.max(drift, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
          }
          c.pipe.flush();
          expect(guest.phase).toBe('result');
          // After the ruling, the guest's pit matches the host's.
          const hostPoses = c.hostSession.sim.shoes.map((s) => c.hostSession.sim.pose(s));
          const guestPoses = guest.shoesInPit().map((s) => c.guestSession.sim.pose(s));
          // (Rapier renormalizes a quaternion when it's set, which can move the last float32 bit.)
          expect(guestPoses.length).toBe(hostPoses.length);
          guestPoses.forEach((g, k) => {
            const h = hostPoses[k];
            expect(g.position).toEqual(h.position);
            for (const key of ['x', 'y', 'z', 'w'] as const) expect(g.rotation[key]).toBeCloseTo(h.rotation[key], 5);
          });
          settledShoes++;
          if (settledShoes % 2 === 0) guest.ready(); // the guest can move things on too
          else f.ready();
          break;
        }
        case 'inning':
          c.pipe.flush();
          expect(guest.phase).toBe('inning');
          expect(guest.state.scores).toEqual(f.state.scores);
          expect(guest.lastInning?.call).toBe(f.lastInning?.call);
          if (f.state.innings.length === 1) guest.nextInning();
          else f.nextInning();
          break;
        default:
          break;
      }
    }
    c.pipe.flush();
    expect(c.flow.state.innings.length).toBe(2);
    expect(settledShoes).toBe(8);
    expect(guest.state.scores).toEqual(c.flow.state.scores);
    // The guest's thrown shoes went in with the guest's chosen grip.
    expect(c.hostResults.length).toBe(8);
    // Same build, same inputs: the guest's own simulation lands where the host's does, before any snapping.
    expect(drift).toBeLessThan(0.001);
  });
});
