import { describe, expect, it } from 'vitest';
import { IN, NEAR_STAKE, COURT, stakeAxisAt } from './court';
import { measureShoe, type Pose } from './measure';
import { SHOE, SHOE_LENGTH, SHOE_OPENING, SHOE_WIDTH, shoeOutline } from './shoe';
import { quatAxisTan, qmul, v3, IDENTITY } from './vec';

const RESTING_Y = SHOE.calkDepth + SHOE.barThickness / 2;
const Y_AXIS = v3(0, 1, 0);
// Rotation about +Y by -90° (tan(-45°) = -1) turns the toe (+X) to face +Z.
const TOE_POS_Z = quatAxisTan(Y_AXIS, -1);
const TOE_NEG_Z = quatAxisTan(Y_AXIS, 1);

const flat = (z: number, rotation = TOE_POS_Z, x = 0): Pose => ({ position: v3(x, RESTING_Y, z), rotation });
const stakeZ = stakeAxisAt(NEAR_STAKE, RESTING_Y).z;

describe('shoe geometry', () => {
  it('meets the NHPA size limits', () => {
    expect(SHOE_WIDTH).toBeCloseTo(7.25 * IN, 10);
    expect(SHOE_LENGTH).toBeCloseTo(7.625 * IN, 10);
    expect(SHOE_OPENING).toBeCloseTo(3.5 * IN, 10);
    expect(SHOE.barThickness + SHOE.calkDepth).toBeLessThanOrEqual(1 * IN);
    expect(SHOE.mass).toBeLessThanOrEqual((2 + 10 / 16) * 0.45359237);
  });

  it('outer edge spans the full width', () => {
    const { outer } = shoeOutline(true);
    const maxZ = Math.max(...outer.map((p) => p.z));
    // The miter where each leg leaves the toe arc pokes out a fraction of a millimeter.
    expect(maxZ * 2).toBeCloseTo(SHOE_WIDTH, 3);
  });
});

describe('ringer test', () => {
  it('a shoe lying around the stake is a ringer', () => {
    const m = measureShoe(flat(0), NEAR_STAKE);
    expect(m.ringer).toBe(true);
  });

  it('the straightedge across the points must clear the stake', () => {
    // Points' chord sits 0.6 in past the stake's center, more than the 0.5 in radius, so it clears.
    const clears = measureShoe(flat(stakeZ + SHOE.legLength - 0.6 * IN), NEAR_STAKE);
    expect(clears.ringer).toBe(true);
    // Chord 0.4 in past the center: the straightedge touches the 1 in stake.
    const touches = measureShoe(flat(stakeZ + SHOE.legLength - 0.4 * IN), NEAR_STAKE);
    expect(touches.ringer).toBe(false);
    expect(touches.distance).toBeLessThan(6 * IN);
  });

  it('a shoe straddling the stake with its points is in count, not a ringer', () => {
    const m = measureShoe(flat(stakeZ + SHOE.legLength), NEAR_STAKE);
    expect(m.ringer).toBe(false);
    // Stake center sits between the points: gap = half spacing − half bar − stake radius.
    const expected = SHOE.pointHalfSpacing - SHOE.barWidth / 2 - COURT.stakeRadius;
    expect(m.distance).toBeCloseTo(expected, 3);
  });

  it('a shoe on its back around the stake still counts', () => {
    const upsideDown = qmul(TOE_POS_Z, { x: 1, y: 0, z: 0, w: 0 });
    expect(measureShoe(flat(0, upsideDown), NEAR_STAKE).ringer).toBe(true);
  });

  it('a shoe beside the stake is not a ringer', () => {
    expect(measureShoe(flat(0, TOE_POS_Z, 10 * IN), NEAR_STAKE).ringer).toBe(false);
  });
});

describe('distance', () => {
  // Toe pointing at the stake from the pitcher's side: toe's outer edge is at z − (r + w/2).
  // The stake leans toward the pitcher, so the nearest steel is the bar's top edge.
  const toeReach = SHOE.toeRadius + SHOE.barWidth / 2;
  const stakeZAtTop = stakeAxisAt(NEAR_STAKE, RESTING_Y + SHOE.barThickness / 2).z;
  const at = (gap: number) => flat(stakeZAtTop + COURT.stakeRadius + toeReach + gap, TOE_NEG_Z);

  it('measures the gap from the stake surface to the nearest steel', () => {
    expect(measureShoe(at(4 * IN), NEAR_STAKE).distance).toBeCloseTo(4 * IN, 3);
  });

  it('6 in is in count, past 6 in is not', () => {
    expect(measureShoe(at(5.99 * IN), NEAR_STAKE).distance).toBeLessThanOrEqual(6 * IN);
    expect(measureShoe(at(6.01 * IN), NEAR_STAKE).distance).toBeGreaterThan(6 * IN);
  });

  it('a flat shoe touching the stake is touching but not a leaner', () => {
    const m = measureShoe(at(0.0005), NEAR_STAKE);
    expect(m.touching).toBe(true);
    expect(m.leaner).toBe(false);
  });

  it('a tilted shoe against the stake is a leaner', () => {
    // Toe raised ~30° about the shoe's cross axis, resting on the stake.
    const tilt = quatAxisTan(v3(1, 0, 0), 0.2679491924311227);
    const pose: Pose = { position: v3(0, 3 * IN, stakeZ + SHOE.toeRadius), rotation: qmul(tilt, TOE_NEG_Z) };
    const m = measureShoe(pose, NEAR_STAKE);
    expect(m.touching).toBe(true);
    expect(m.leaner).toBe(true);
    expect(m.ringer).toBe(false);
  });

  it('identity pose is well-formed', () => {
    const m = measureShoe({ position: v3(0, RESTING_Y, 0), rotation: IDENTITY }, NEAR_STAKE);
    expect(m.ringer).toBe(true);
  });
});

describe('measurement geometry for the close-call cam', () => {
  const horizontal = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

  it('the nearest points are exactly the measured distance apart', () => {
    for (const gap of [0.5, 1.75, 3, 5.5]) {
      const z = stakeZ + COURT.stakeRadius + SHOE.toeRadius + SHOE.barWidth / 2 + gap * IN;
      const m = measureShoe(flat(z, TOE_NEG_Z, 0.3 * IN), NEAR_STAKE);
      expect(horizontal(m.nearest.shoe, m.nearest.stake)).toBeCloseTo(m.distance, 9);
    }
  });

  it('the stake point sits on the stake surface', () => {
    const m = measureShoe(flat(stakeZ + 6 * IN, TOE_NEG_Z, 2 * IN), NEAR_STAKE);
    const axis = stakeAxisAt(NEAR_STAKE, m.nearest.stake.y);
    expect(horizontal(m.nearest.stake, axis)).toBeCloseTo(COURT.stakeRadius, 9);
  });

  it('straightedge clearance agrees with the ringer call', () => {
    for (const back of [0.3, 0.45, 0.55, 0.7, 1.5]) {
      const m = measureShoe(flat(stakeZ + SHOE.legLength - back * IN), NEAR_STAKE);
      expect(m.straightedge.encircles).toBe(true);
      expect(m.ringer).toBe(m.straightedge.clearance > 0);
      expect(m.straightedge.clearance).toBeCloseTo((back - 0.5) * IN, 4);
    }
  });
});
