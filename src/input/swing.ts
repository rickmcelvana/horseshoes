// The swing gesture: press, drag back (down the screen), push forward (up) and let go.
//
//   forward speed at release  → power
//   where you let go          → release timing (arc height)
//   sideways drift            → aim (pull)
//   a curving stroke          → wobble
//
// Works the same for mouse and touch through pointer events.

export interface SwingTuning {
  /** Forward speed, in screen heights per second, that gives exactly 100% power. */
  nominalSpeed: number;
  /** How much a speed error moves power: 0.25 means 10% too fast → 2.5% more power. */
  powerSensitivity: number;
  /** Release timing per unit of "let go past the start point" (in backswing lengths). */
  releaseSensitivity: number;
  /** Aim per unit of sideways drift (drift ÷ forward stroke length). */
  aimSensitivity: number;
  /** Wobble per unit of change in stroke direction between its two halves. */
  wobbleSensitivity: number;
}

export const DEFAULT_SWING: SwingTuning = {
  nominalSpeed: 2.4,
  powerSensitivity: 0.15,
  releaseSensitivity: 1.0,
  aimSensitivity: 2.2,
  wobbleSensitivity: 1.5,
};

export interface SwingResult {
  power: number;
  release: number;
  aim: number;
  wobble: number;
  /** Raw measurements, shown after the throw so the player can learn. */
  speedRatio: number;
}

interface Sample {
  t: number;
  x: number;
  y: number;
}

type Phase = 'idle' | 'back' | 'forward';

const MIN_BACKSWING = 0.06; // of screen height

export class SwingInput {
  enabled = true;
  onThrow: ((r: SwingResult) => void) | null = null;
  /** Called while dragging, for the on-screen swing trail. */
  onTrail: ((pts: { x: number; y: number }[], phase: Phase) => void) | null = null;

  private phase: Phase = 'idle';
  private pointerId = -1;
  private start: Sample = { t: 0, x: 0, y: 0 };
  private low: Sample = { t: 0, x: 0, y: 0 };
  private samples: Sample[] = [];
  private trail: { x: number; y: number }[] = [];

  constructor(
    private readonly el: HTMLElement,
    readonly tuning: SwingTuning = { ...DEFAULT_SWING },
  ) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
  }

  private get h() {
    return Math.max(320, this.el.clientHeight);
  }

  private sample(e: PointerEvent): Sample {
    return { t: e.timeStamp / 1000, x: e.clientX / this.h, y: e.clientY / this.h };
  }

  private down = (e: PointerEvent) => {
    if (!this.enabled || this.phase !== 'idle' || e.button > 0) return;
    this.pointerId = e.pointerId;
    this.el.setPointerCapture(e.pointerId);
    this.start = this.sample(e);
    this.low = this.start;
    this.samples = [this.start];
    this.trail = [{ x: e.clientX, y: e.clientY }];
    this.phase = 'back';
  };

  private move = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId || this.phase === 'idle') return;
    // Coalesced events give smooth, high-rate samples on touch screens.
    const events = e.getCoalescedEvents?.() ?? [e];
    for (const ev of events.length ? events : [e]) {
      const s = this.sample(ev);
      this.trail.push({ x: ev.clientX, y: ev.clientY });
      if (this.phase === 'back') {
        if (s.y >= this.low.y) {
          this.low = s;
        } else if (this.low.y - this.start.y > MIN_BACKSWING && this.low.y - s.y > 0.01) {
          // Turned around after a real backswing: the forward swing starts at the lowest point.
          this.phase = 'forward';
          this.samples = [this.low];
        }
      }
      if (this.phase === 'forward') this.samples.push(s);
    }
    if (this.trail.length > 120) this.trail.splice(0, this.trail.length - 120);
    this.onTrail?.(this.trail, this.phase);
  };

  private up = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    const phase = this.phase;
    this.reset();
    if (phase !== 'forward' || this.samples.length < 3) return;
    const r = this.measure(this.sample(e));
    if (r) this.onThrow?.(r);
  };

  private cancel = (e: PointerEvent) => {
    if (e.pointerId === this.pointerId) this.reset();
  };

  private reset() {
    this.phase = 'idle';
    this.pointerId = -1;
    this.onTrail?.([], 'idle');
  }

  private measure(end: Sample): SwingResult | null {
    const s = this.samples;
    const last = s[s.length - 1];
    if (end.t - last.t < 0.03) s.push(end);
    const tEnd = s[s.length - 1].t;

    // Forward speed over the last ~60 ms of the stroke.
    let i = s.length - 1;
    while (i > 0 && tEnd - s[i - 1].t < 0.06) i--;
    const a = s[Math.max(0, i - 1)];
    const b = s[s.length - 1];
    const dt = b.t - a.t;
    if (dt <= 0) return null;
    const speed = (a.y - b.y) / dt; // screen heights per second, upward positive
    if (speed <= 0.2) return null; // a stall, not a throw

    const T = this.tuning;
    const speedRatio = speed / T.nominalSpeed;
    const power = 1 + (speedRatio - 1) * T.powerSensitivity;

    // Release timing: let go level with where you pressed down = 0.
    const backswing = this.low.y - this.start.y;
    const past = (this.start.y - b.y) / backswing;
    const release = past * T.releaseSensitivity;

    // Aim: sideways drift over the forward stroke.
    const stroke = Math.max(0.05, this.low.y - b.y);
    const aim = ((b.x - this.low.x) / stroke) * T.aimSensitivity;

    // Wobble: the stroke bending one way between its first and second halves.
    const mid = s[Math.floor(s.length / 2)];
    const slope = (p: Sample, q: Sample) => (q.x - p.x) / Math.max(0.02, p.y - q.y);
    const wobble = (slope(mid, b) - slope(this.low, mid)) * T.wobbleSensitivity;

    return { power, release, aim, wobble, speedRatio };
  }
}
