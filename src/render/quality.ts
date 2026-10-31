// Quality tiers. Auto picks a starting tier from the device, then steps down if
// the frame rate can't keep up. The tuning panel can pin a tier.

export type Tier = 'low' | 'medium' | 'high';
export type TierSetting = Tier | 'auto';

export interface QualityProfile {
  tier: Tier;
  maxPixelRatio: number;
  shadowMapSize: number;
  /** Glow around string lights and lamps. */
  bloom: boolean;
  /** Real point lights from the string-light strand (the bulbs glow either way). */
  stringLights: number;
  /** Pit floodlights cast shadows. */
  lampShadows: boolean;
  fireflies: number;
  anisotropy: number;
}

export const PROFILES: Record<Tier, QualityProfile> = {
  low: { tier: 'low', maxPixelRatio: 1, shadowMapSize: 1024, bloom: false, stringLights: 0, lampShadows: false, fireflies: 24, anisotropy: 2 },
  medium: { tier: 'medium', maxPixelRatio: 1.5, shadowMapSize: 2048, bloom: false, stringLights: 2, lampShadows: false, fireflies: 48, anisotropy: 4 },
  high: { tier: 'high', maxPixelRatio: 2, shadowMapSize: 2048, bloom: true, stringLights: 4, lampShadows: true, fireflies: 80, anisotropy: 8 },
};

const ORDER: Tier[] = ['low', 'medium', 'high'];

/** A first guess before any frames are measured. */
export function guessTier(): Tier {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (coarse) return cores >= 6 ? 'medium' : 'low';
  return cores >= 4 ? 'high' : 'medium';
}

/**
 * Watches frame times and asks for a lower tier when the game runs slow.
 * Only steps down, and waits between steps so a one-off hitch doesn't count.
 */
export class FrameMonitor {
  fps = 60;
  private frames = 0;
  private elapsed = 0;
  private slowWindows = 0;
  private cooldown = 4;

  constructor(private readonly target: number) {}

  /** Returns true when the caller should drop a tier. */
  tick(dt: number): boolean {
    this.frames++;
    this.elapsed += dt;
    this.cooldown -= dt;
    if (this.elapsed < 1.5) return false;
    this.fps = this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;
    if (this.cooldown > 0) return false;
    this.slowWindows = this.fps < this.target * 0.75 ? this.slowWindows + 1 : 0;
    if (this.slowWindows >= 2) {
      this.slowWindows = 0;
      this.cooldown = 6;
      return true;
    }
    return false;
  }
}

export function lowerTier(t: Tier): Tier | null {
  const i = ORDER.indexOf(t);
  return i > 0 ? ORDER[i - 1] : null;
}

/** Frame-rate goal: 60 on desktop, 30 on phones and tablets. */
export function targetFps(): number {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse ? 30 : 60;
}
