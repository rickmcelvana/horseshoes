// Horseshoe geometry, shared by the rules engine (measuring), physics
// (colliders) and rendering (mesh), so all three agree on what a shoe is.
//
// NHPA limits: at most 2 lb 10 oz, 7¼ in wide, 7⅝ in long, opening at most
// 3½ in, nothing taller than 1 in lying calks-down.
//
// Shoe local frame: +X points at the toe, the open end (the points) faces -X,
// +Z is across the shoe, and +Y is up with the calks underneath (-Y).
// The origin is the center of the toe's semicircle.

import { IN } from './court';
import { type Vec3, v3, sub, normalize, scale, add, dot } from './vec';

export const SHOE = {
  mass: 2.5 * 0.45359237, // 2 lb 8 oz
  /** Centerline radius of the toe's semicircle. */
  toeRadius: 3.2 * IN,
  /** Width of the steel bar (in the shoe's plane) and its thickness. */
  barWidth: 0.85 * IN,
  barThickness: 0.45 * IN,
  /** Each leg runs from the end of the semicircle back to its point. */
  legLength: 4.0 * IN,
  /** Half the spacing between the two points' centerlines: opening = 2 × this − barWidth = 3½ in. */
  pointHalfSpacing: 2.175 * IN,
  /** Calks stick down below the bar. Bar + calk stays under the 1 in limit. */
  calkDepth: 0.45 * IN,
  heelCalkLength: 0.7 * IN,
  toeCalkSpan: 1.2 * IN,
} as const;

export const SHOE_WIDTH = 2 * SHOE.toeRadius + SHOE.barWidth; // 7.25 in
export const SHOE_LENGTH = SHOE.toeRadius + SHOE.barWidth / 2 + SHOE.legLength; // 7.625 in
export const SHOE_OPENING = 2 * SHOE.pointHalfSpacing - SHOE.barWidth; // 3.5 in

/** Centers of the two points, at mid-thickness. A straightedge across them must clear the stake for a ringer. */
export const POINT_TIPS: [Vec3, Vec3] = [
  v3(-SHOE.legLength, 0, -SHOE.pointHalfSpacing),
  v3(-SHOE.legLength, 0, SHOE.pointHalfSpacing),
];

// cos and sin of 15° and 30° from square roots, so the geometry is identical everywhere.
const SQ3 = Math.sqrt(3);
const C15 = (Math.sqrt(6) + Math.SQRT2) / 4;
const S15 = (Math.sqrt(6) - Math.SQRT2) / 4;

/**
 * The shoe's centerline in its local XZ plane, from one point around the toe to
 * the other. `fine` steps the toe arc every 15°, otherwise every 30°.
 */
export function shoeCenterline(fine: boolean): Vec3[] {
  const r = SHOE.toeRadius;
  const pts: Vec3[] = [v3(-SHOE.legLength, 0, -SHOE.pointHalfSpacing)];
  // Unit directions from -90° to +90°, stepping by 15° or 30° using exact rotations.
  const [c, s] = fine ? [C15, S15] : [SQ3 / 2, 0.5];
  const steps = fine ? 12 : 6;
  let dx = 0;
  let dz = -1;
  for (let i = 0; i <= steps; i++) {
    pts.push(v3(r * dx, 0, r * dz));
    const nx = dx * c - dz * s;
    const nz = dx * s + dz * c;
    dx = nx;
    dz = nz;
  }
  // Snap the last arc point onto the exact end so accumulated rounding can't skew it.
  pts[pts.length - 1] = v3(0, 0, r);
  pts.push(v3(-SHOE.legLength, 0, SHOE.pointHalfSpacing));
  return pts;
}

/** Offset a polyline sideways in the XZ plane by `d`. The caller works out which side is outside. */
function offsetPolyline(pts: Vec3[], d: number): Vec3[] {
  const n = pts.length;
  const segNormal = (i: number): Vec3 => {
    const t = normalize(sub(pts[i + 1], pts[i]));
    return v3(-t.z, 0, t.x);
  };
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    let nrm: Vec3;
    if (i === 0) nrm = segNormal(0);
    else if (i === n - 1) nrm = segNormal(n - 2);
    else {
      const a = segNormal(i - 1);
      const b = segNormal(i);
      const m = normalize(add(a, b));
      nrm = scale(m, 1 / dot(m, a)); // miter
    }
    out.push(add(pts[i], scale(nrm, d)));
  }
  return out;
}

export interface ShoeOutline {
  /** Outer edge, point to point around the toe. */
  outer: Vec3[];
  /** Inner edge, point to point around the toe. */
  inner: Vec3[];
}

export function shoeOutline(fine = true): ShoeOutline {
  const cl = shoeCenterline(fine);
  const a = offsetPolyline(cl, SHOE.barWidth / 2);
  const b = offsetPolyline(cl, -SHOE.barWidth / 2);
  // The toe vertex sits at the middle of the list; the outer edge reaches further toward +X.
  const mid = Math.floor(cl.length / 2);
  return a[mid].x > b[mid].x ? { outer: a, inner: b } : { outer: b, inner: a };
}

/** Closed polygon of the steel bar itself (outer edge, then inner edge back). */
export function barPolygon(o: ShoeOutline): Vec3[] {
  return [...o.outer, ...[...o.inner].reverse()];
}
