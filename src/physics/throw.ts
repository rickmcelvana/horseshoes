// The throw input, and turning it into the shoe's state at the moment of release.
//
// A throw input fully describes a pitch. The player's swing, the NPC and a
// remote friend all produce one, and replays are just the same input run again.

import {
  COURT,
  FT,
  IN,
  type Quat,
  type Stake,
  type Vec3,
  QUARTER_TURN,
  add,
  cross,
  normalize,
  qmul,
  quatFromUnitVectors,
  scale,
  stakeAxisAt,
  v3,
} from '../rules';

export type Grip = 'three-quarter' | 'one-and-quarter' | 'one-and-three-quarter' | 'flip';
export type Stance = 'left' | 'right';
export type FoulLine = 'full' | 'short';

export interface ThrowInput {
  grip: Grip;
  /** Which pitching platform, as seen by the pitcher facing the target. Fixed for an inning (RULE 3 C.1). */
  stance: Stance;
  line: FoulLine;
  /** Release speed relative to the speed that carries a nominal arc to the stake. 1 = perfect. */
  power: number;
  /** Horizontal pull, −1 (left) … 1 (right). */
  aim: number;
  /** Release timing, −1 (early, flat) … 1 (late, high arc). */
  release: number;
  /** Off-axis wobble, −1 … 1. */
  wobble: number;
  /** Seeds the clay's randomness for this shoe. */
  seed: number;
}

export const GRIPS: Record<Grip, { label: string; turns: number; flip: boolean }> = {
  'three-quarter': { label: '¾ turn', turns: 0.75, flip: false },
  'one-and-quarter': { label: '1¼ turn', turns: 1.25, flip: false },
  'one-and-three-quarter': { label: '1¾ turn', turns: 1.75, flip: false },
  flip: { label: 'Flip', turns: 1.5, flip: true },
};

/** Tunable launch geometry. Kept as data so the tuning panel and the NPC can read it. */
export const LAUNCH = {
  /** Hand height at release. */
  releaseHeight: 0.65,
  /** Hand ends up this far in front of the foul line. */
  reachPastFoulLine: 0.5 * FT,
  /** Hand's distance from the court's centerline. */
  releaseLateral: 22 * IN,
  /** tan(15°): half-angle tangent of the nominal 30° launch. */
  nominalHalfTan: 2 - Math.sqrt(3),
  /** Release ±1 swings the launch angle by ±10° (tan 5°). */
  releaseHalfTan: 0.08748866352592401,
  /** Aim ±1 swings the heading by ±4° (tan 2°). */
  aimHalfTan: 0.03492076949174773,
  /** Wobble ±1 adds this much spin about the direction of travel (rad/s). */
  wobbleRate: 2.5,
  /** Where the shoe's toe-arc center should cross the stake: this high above the clay… */
  aimHeight: 3 * IN,
  /** …and this far in front of the stake (toward the pitcher). */
  aimShort: 0.5 * IN,
};

export const GRAVITY = 9.81;
const TWO_PI = 6.283185307179586;

export interface LaunchState {
  position: Vec3;
  rotation: Quat;
  linvel: Vec3;
  angvel: Vec3;
  /** Flight time a perfect throw would take, for the ghost arc and the camera. */
  nominalFlightTime: number;
}

/** Rotate (c, s) by the angle whose half-angle tangent is u. Exact arithmetic only. */
function turnBy(c: number, s: number, u: number): [number, number] {
  const k = 1 / (1 + u * u);
  const cu = (1 - u * u) * k;
  const su = 2 * u * k;
  return [c * cu - s * su, c * su + s * cu];
}

export function launch(input: ThrowInput, target: Stake): LaunchState {
  const up = v3(0, 1, 0);
  const back = target.leanDir; // from the target stake toward the pitcher
  const forward = scale(back, -1);
  const right = cross(forward, up);

  const foulLine = input.line === 'full' ? COURT.foulLineFull : COURT.foulLineShort;
  const along = foulLine + COURT.stakeRadius - LAUNCH.reachPastFoulLine;
  const side = input.stance === 'right' ? 1 : -1;
  const position = add(add(target.base, scale(back, along)), add(scale(right, side * LAUNCH.releaseLateral), v3(0, LAUNCH.releaseHeight, 0)));

  // Aim point: just in front of the stake, at the height the toe arc should meet it.
  const stakeAt = stakeAxisAt(target, LAUNCH.aimHeight);
  const aimPoint = add(stakeAt, scale(back, LAUNCH.aimShort));
  const dx = aimPoint.x - position.x;
  const dz = aimPoint.z - position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const heading = v3(dx / dist, 0, dz / dist);
  const drop = position.y - aimPoint.y;

  // Nominal launch: 30°, with the speed that lands it exactly on the aim point.
  const t = LAUNCH.nominalHalfTan;
  const cosA = (1 - t * t) / (1 + t * t);
  const sinA = (2 * t) / (1 + t * t);
  const tanA = sinA / cosA;
  const nominalSpeed = Math.sqrt((GRAVITY * dist * dist) / (2 * cosA * cosA * (dist * tanA + drop)));
  const nominalFlightTime = dist / (nominalSpeed * cosA);

  // The actual throw: tilt the elevation by release timing and the heading by aim.
  const [ce, se] = turnBy(cosA, sinA, clamp1(input.release) * LAUNCH.releaseHalfTan);
  const [ch, sh] = turnBy(1, 0, -clamp1(input.aim) * LAUNCH.aimHalfTan);
  const headingRight = cross(heading, up);
  const flatDir = add(scale(heading, ch), scale(headingRight, -sh));
  const speed = nominalSpeed * input.power;
  const linvel = add(scale(flatDir, speed * ce), v3(0, speed * se, 0));

  // Spin: the grip's turns spread over a nominal flight, so a perfect throw arrives
  // flat with its open end facing the stake. Any other throw arrives off.
  const grip = GRIPS[input.grip];
  const rate = (grip.turns * TWO_PI) / nominalFlightTime;
  const arrival = quatFromUnitVectors(v3(1, 0, 0), back); // toe trailing, points leading
  let rotation: Quat;
  let spin: Vec3;
  if (grip.flip) {
    // End over end, top rolling forward; 1½ flips means it leaves the hand upside down and reversed.
    spin = scale(right, -rate);
    rotation = qmul({ x: right.x, y: right.y, z: right.z, w: 0 }, arrival);
  } else {
    // Flat spin, counterclockwise from above. ¾ and 1¾ turns start a quarter turn
    // one way; 1¼ starts a quarter turn the other way.
    spin = scale(up, rate);
    const start = grip.turns === 1.25 ? QUARTER_TURN.yNeg90 : QUARTER_TURN.yPos90;
    rotation = qmul(start, arrival);
  }
  const angvel = add(spin, scale(normalize(flatDir), clamp1(input.wobble) * LAUNCH.wobbleRate));

  return { position, rotation, linvel, angvel, nominalFlightTime };
}

/** A throw with nothing wrong with it. */
export function perfectThrow(grip: Grip, stance: Stance = 'right', line: FoulLine = 'full', seed = 1): ThrowInput {
  return { grip, stance, line, power: 1, aim: 0, release: 0, wobble: 0, seed };
}

const clamp1 = (x: number) => (x < -1 ? -1 : x > 1 ? 1 : x);
