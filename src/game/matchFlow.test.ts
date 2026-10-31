import { beforeAll, describe, expect, it } from 'vitest';
import { FAR_STAKE, NEAR_STAKE, alternateFirstPitcher, other, type Player } from '../rules';
import { DEFAULT_PARAMS, initPhysics } from '../physics/sim';
import { mulberry32 } from '../physics/rng';
import { MatchFlow, type MatchSetup, type ModeKey } from './matchFlow';
import { ThrowSession } from './session';

beforeAll(() => initPhysics());

const players: MatchSetup['players'] = [
  { name: 'Rick', line: 'full' },
  { name: 'Dale', line: 'full' },
];

/** Play a whole match headlessly with slightly noisy throws. */
function playOut(mode: ModeKey, seed: number) {
  const session = new ThrowSession({ ...DEFAULT_PARAMS, clay: { ...DEFAULT_PARAMS.clay } });
  const flow = new MatchFlow(session, { mode, players }, 0);
  const rng = mulberry32(seed);
  const jitter = (s: number) => (rng() - 0.5) * 2 * s;
  const log: { inning: number; target: string; order: Player[]; handoffs: number }[] = [];
  let handoffs = 0;
  let order: Player[] = [];
  let target = '';
  let guard = 0;
  while (flow.phase !== 'over' && guard++ < 5_000_000) {
    switch (flow.phase) {
      case 'handoff':
        handoffs++;
        flow.acceptHandoff();
        break;
      case 'aim':
        if (order.length === 0) target = flow.target === NEAR_STAKE ? 'near' : 'far';
        order.push(flow.pitcher);
        expect(flow.stanceLocked).toBe(flow.pitcherShoe === 1);
        flow.pitch({ power: 1 + jitter(0.012), aim: jitter(0.3), release: jitter(0.2), wobble: jitter(0.2), speedRatio: 1 });
        break;
      case 'flight':
        session.step();
        break;
      case 'result':
        flow.ready();
        break;
      case 'inning':
        log.push({ inning: flow.lastInning!.number, target, order, handoffs });
        order = [];
        handoffs = 0;
        flow.nextInning();
        break;
    }
  }
  session.sim.world.free();
  return { flow, log };
}

describe('hot-seat match', () => {
  it('plays a cancellation game to 40 by the rules', () => {
    const { flow, log } = playOut('cancellation', 3);
    const s = flow.state;
    expect(flow.phase).toBe('over');
    expect(s.winner).not.toBeNull();
    expect(s.scores[s.winner!]).toBeGreaterThanOrEqual(40);
    expect(s.scores[other(s.winner!)]).toBeLessThan(40);

    // Score totals add up from the innings, and only one player scores per inning.
    const sum: [number, number] = [0, 0];
    for (const i of s.innings) {
      expect(i.score.points[0] === 0 || i.score.points[1] === 0).toBe(true);
      sum[0] += i.score.points[0];
      sum[1] += i.score.points[1];
    }
    expect(sum).toEqual(s.scores);

    // Ends alternate, each inning is two shoes each in a,a,b,b order, and RULE 7 A.1 decides who leads.
    log.forEach((l, k) => {
      expect(l.target).toBe(k % 2 === 0 ? 'near' : 'far');
      expect(l.order[0]).toBe(l.order[1]);
      expect(l.order[2]).toBe(l.order[3]);
      expect(l.order[0]).not.toBe(l.order[2]);
      if (k > 0) {
        const prev = s.innings[k - 1];
        const [a, b] = prev.score.points;
        const expected = a > 0 ? 0 : b > 0 ? 1 : other(prev.firstPitcher);
        expect(l.order[0]).toBe(expected);
      }
      // One handoff at the start of the inning (or none if the same player continues), one mid-inning.
      expect(l.handoffs).toBeGreaterThanOrEqual(1);
    });
  });

  it('plays count-all to 40 shoes with alternating first pitch', () => {
    const { flow, log } = playOut('countAll', 5);
    expect(flow.state.innings.length).toBeGreaterThanOrEqual(20);
    log.forEach((l, k) => expect(l.order[0]).toBe(alternateFirstPitcher(0, k + 1)));
  });

  it('can be saved after an inning and resumed', () => {
    const session = new ThrowSession(DEFAULT_PARAMS);
    const a = new MatchFlow(session, { mode: 'backyard21', players }, 1);
    let saved = null as ReturnType<MatchFlow['save']> | null;
    a.onInning = (s) => (saved = JSON.parse(JSON.stringify(s)));
    while (a.phase !== 'inning') {
      if (a.phase === 'handoff') a.acceptHandoff();
      else if (a.phase === 'aim') a.pitch({ power: 1, aim: 0, release: 0, wobble: 0, speedRatio: 1 });
      else if (a.phase === 'result') a.ready();
      else session.step();
    }
    expect(saved).not.toBeNull();
    const b = new MatchFlow(new ThrowSession(DEFAULT_PARAMS), saved!.setup, saved!);
    expect(b.state.scores).toEqual(a.state.scores);
    expect(b.inningNumber).toBe(2);
    expect(b.target).toBe(FAR_STAKE);
    expect(b.phase).toBe('handoff');
  });
});
