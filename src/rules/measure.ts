// Measuring a resting shoe against the stake, the way a judge would.
//
// RULE 3 B.2: a ringer is a live shoe that comes to rest encircling the stake,
// such that a straightedge touching the points (or heel calks) clears the
// stake. Any other live shoe 6 in or closer is "in count", leaners included.

import { COURT, IN, type Stake, stakeAxisAt } from './court';
import { POINT_TIPS, SHOE, barPolygon, shoeOutline } from './shoe';
import { type Quat, type Vec3, add, rotate, v3 } from './vec';

export interface Pose {
  position: Vec3;
  rotation: Quat;
}

export interface ShoeMeasure {
  ringer: boolean;
  /** Gap between the stake's surface and the nearest part of the shoe, in meters. */
  distance: number;
  /** Resting against the stake. */
  touching: boolean;
  /** Touching the stake and propped up off the clay. */
  leaner: boolean;
  /** Where the gap was measured: nearest steel and the facing point on the stake's surface. */
  nearest: { shoe: Vec3; stake: Vec3 };
  /** The straightedge laid across the points, and how far it clears the stake (negative: it touches). */
  straightedge: { a: Vec3; b: Vec3; clearance: number; encircles: boolean };
}

export const IN_COUNT_DISTANCE = 6 * IN;
/** Gaps smaller than this count as touching the stake. */
export const TOUCH_TOLERANCE = 0.002;
/** A leaner's plane tilts at least this much (cosine of ~20°). */
const LEANER_MAX_UP_Y = 0.94;

const OUTLINE = shoeOutline(true);
const BAR = barPolygon(OUTLINE);
const ENCLOSURE = [...OUTLINE.inner]; // closed across the open end by the chord between the inner points

const HALF_T = SHOE.barThickness / 2;
const BAR_TOP = BAR.map((p) => v3(p.x, HALF_T, p.z));
const BAR_BOTTOM = BAR.map((p) => v3(p.x, -HALF_T, p.z));

const toWorld = (pose: Pose, p: Vec3): Vec3 => add(pose.position, rotate(pose.rotation, p));

interface P2 {
  x: number;
  z: number;
}

function pointInPolygon(p: P2, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Closest point to p on segment ab (horizontally), as a fraction along ab. */
function closestT(p: P2, a: P2, b: P2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  const t = len2 > 0 ? ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2 : 0;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function segmentDistance(p: P2, a: P2, b: P2): number {
  const t = closestT(p, a, b);
  const dx = a.x + (b.x - a.x) * t - p.x;
  const dz = a.z + (b.z - a.z) * t - p.z;
  return Math.sqrt(dx * dx + dz * dz);
}

interface Gap {
  gap: number;
  shoe: Vec3;
  stake: Vec3;
}

/** Smallest horizontal gap between a closed loop of world points and the stake's surface. */
function loopGap(stake: Stake, loop: Vec3[]): Gap {
  let best: Gap = { gap: Infinity, shoe: loop[0], stake: loop[0] };
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    // The stake leans, so measure each edge against the stake's center at that edge's height.
    const c = stakeAxisAt(stake, (a.y + b.y) / 2);
    const t = closestT(c, a, b);
    const p = v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const gap = dist - COURT.stakeRadius;
    if (gap < best.gap) {
      const k = dist > 0 ? COURT.stakeRadius / dist : 0;
      best = { gap, shoe: p, stake: v3(c.x + dx * k, p.y, c.z + dz * k) };
    }
  }
  return best;
}

/** A measurement without geometry: for shoes that left the pit (fouls) and for scoring tests. */
export function bareMeasure(m: Pick<ShoeMeasure, 'ringer' | 'distance' | 'touching' | 'leaner'>): ShoeMeasure {
  const o = v3(0, 0, 0);
  return { ...m, nearest: { shoe: o, stake: o }, straightedge: { a: o, b: o, clearance: 0, encircles: m.ringer } };
}

export function measureShoe(pose: Pose, stake: Stake): ShoeMeasure {
  const center = stakeAxisAt(stake, pose.position.y);

  // Ringer: the stake sits inside the shoe, and the straightedge across the points clears it.
  const enclosure = ENCLOSURE.map((p) => toWorld(pose, p));
  const [tipA, tipB] = POINT_TIPS.map((p) => toWorld(pose, p));
  const encircles = pointInPolygon(center, enclosure);
  const clearance = segmentDistance(center, tipA, tipB) - COURT.stakeRadius;
  const ringer = encircles && clearance > 0;

  // Distance: nearest part of the bar's top or bottom edge to the stake.
  const top = BAR_TOP.map((p) => toWorld(pose, p));
  const bottom = BAR_BOTTOM.map((p) => toWorld(pose, p));
  const overlapsBar = pointInPolygon(center, top) || pointInPolygon(center, bottom);
  const gTop = loopGap(stake, top);
  const gBottom = loopGap(stake, bottom);
  const g = gTop.gap <= gBottom.gap ? gTop : gBottom;
  const gap = overlapsBar ? 0 : g.gap;
  const distance = gap < 0 ? 0 : gap;
  const touching = distance <= TOUCH_TOLERANCE;

  const up = rotate(pose.rotation, v3(0, 1, 0));
  const leaner = !ringer && touching && Math.abs(up.y) < LEANER_MAX_UP_Y;

  return {
    ringer,
    distance,
    touching,
    leaner,
    nearest: { shoe: g.shoe, stake: g.stake },
    straightedge: { a: tipA, b: tipB, clearance, encircles },
  };
}
