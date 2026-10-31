// Minimal vector and quaternion math shared by the rules engine and physics.
//
// Everything here uses only + - * / and sqrt, which IEEE 754 defines exactly,
// so results are bit-identical in every browser. Never use Math.sin, Math.cos,
// Math.exp and friends in code that feeds the simulation: browsers are allowed
// to round those differently.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / length(a));

export const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

export function qmul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function qnormalize(q: Quat): Quat {
  const n = 1 / Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  return { x: q.x * n, y: q.y * n, z: q.z * n, w: q.w * n };
}

/** Rotate vector v by unit quaternion q. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
  const u = v3(q.x, q.y, q.z);
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q.w)), cross(u, t));
}

/**
 * Rotation about a unit axis, given t = tan(angle / 2) instead of the angle.
 * cos and sin of the half angle come out of t with only arithmetic and sqrt.
 */
export function quatAxisTan(axis: Vec3, t: number): Quat {
  const c = 1 / Math.sqrt(1 + t * t);
  const s = t * c;
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: c };
}

/** Shortest rotation taking unit vector a onto unit vector b (not opposite). */
export function quatFromUnitVectors(a: Vec3, b: Vec3): Quat {
  const c = cross(a, b);
  return qnormalize({ x: c.x, y: c.y, z: c.z, w: 1 + dot(a, b) });
}

/** Exact quarter and half turns, the release orientations the grips need. */
const H = Math.SQRT1_2;
export const QUARTER_TURN = {
  yPos90: { x: 0, y: H, z: 0, w: H } as Quat,
  yNeg90: { x: 0, y: -H, z: 0, w: H } as Quat,
  x180: { x: 1, y: 0, z: 0, w: 0 } as Quat,
};
