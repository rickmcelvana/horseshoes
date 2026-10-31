// Placeholder sounds synthesized with Web Audio: a steel clang and a clay thud.
// Recorded samples replace these in the Phase 2 art pass.

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

/** Browsers only allow audio after a user gesture; call this from one. */
export function unlockAudio() {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const len = Math.floor(ctx.sampleRate * 0.4);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

/** Steel on steel. Inharmonic partials with fast-decaying highs. */
export function clang(intensity: number) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = Math.min(1, 0.15 + intensity * 0.12);
  out.connect(ctx.destination);
  const base = 620 + Math.random() * 60;
  for (const [ratio, amp, decay] of [
    [1, 0.5, 1.4],
    [2.76, 0.3, 0.8],
    [5.4, 0.18, 0.4],
    [8.93, 0.1, 0.2],
  ]) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = base * ratio;
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + decay);
  }
}

/** A shoe biting into clay: low, short, muffled. */
export function thud(intensity: number, bright = false) {
  if (!ctx || !noise) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = bright ? 1800 : 380;
  const g = ctx.createGain();
  g.gain.setValueAtTime(Math.min(0.9, 0.1 + intensity * 0.08), t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t);
  src.stop(t + 0.2);
}
