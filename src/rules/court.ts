// Court and equipment dimensions from the NHPA specifications (RGS Book,
// Specifications section, January 2016). All lengths are in meters.
//
// World frame: +Y is up, the pit surface is y = 0, and the court runs along Z.
// The "near" stake (the one pitched at in practice) stands at the origin and
// the "far" stake at z = +STAKE_TO_STAKE.

import { type Vec3, v3, add, scale } from './vec';

export const IN = 0.0254;
export const FT = 12 * IN;

export const COURT = {
  /** Measured between the fronts of the stakes, so centers sit 1 in further apart. */
  stakeToStake: 40 * FT,
  /** Foul lines, measured from the front of the opposite stake. */
  foulLineFull: 37 * FT,
  foulLineShort: 27 * FT,
  playingAreaWidth: 6 * FT,
  playingAreaLength: 46 * FT,
  /** Pit inside dimensions: 31–36 in wide, 43–72 in long. We use the roomy end. */
  pitWidth: 36 * IN,
  pitLength: 72 * IN,
  /** Pitching platforms flank the pit: 18–20½ in wide. */
  platformWidth: 18 * IN,
  stakeRadius: 0.5 * IN,
  /** Top of the stake above the platform: 14–15 in. */
  stakeHeight: 14.5 * IN,
  /** The top leans this far toward the opposite stake. */
  stakeLean: 3 * IN,
  /** Backboard: at least 3 ft behind the stake, at least 1 ft high, pit width. */
  backboardDistance: 3 * FT,
  backboardHeight: 1 * FT,
} as const;

export const STAKE_CENTER_SPACING = COURT.stakeToStake + 2 * COURT.stakeRadius;

/** A stake: base center on the pit surface, leaning toward `leanDir` (unit, horizontal). */
export interface Stake {
  base: Vec3;
  leanDir: Vec3;
}

export const NEAR_STAKE: Stake = { base: v3(0, 0, 0), leanDir: v3(0, 0, 1) };
export const FAR_STAKE: Stake = { base: v3(0, 0, STAKE_CENTER_SPACING), leanDir: v3(0, 0, -1) };

/** Center of the stake's cross-section at height h above the pit (clamped to the stake). */
export function stakeAxisAt(stake: Stake, h: number): Vec3 {
  const hh = h < 0 ? 0 : h > COURT.stakeHeight ? COURT.stakeHeight : h;
  const offset = (COURT.stakeLean * hh) / COURT.stakeHeight;
  return add(add(stake.base, scale(stake.leanDir, offset)), v3(0, hh, 0));
}

/** Is a point (x, z) inside the pit around this stake? */
export function inPit(stake: Stake, p: Vec3): boolean {
  return (
    Math.abs(p.x - stake.base.x) <= COURT.pitWidth / 2 &&
    Math.abs(p.z - stake.base.z) <= COURT.pitLength / 2
  );
}
