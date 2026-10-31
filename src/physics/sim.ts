// The pit world: court colliders, shoe bodies, clay behavior, fouls, and settle detection.
// Runs the same in the browser and in Node (tests, calibration tools).

import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import {
  COURT,
  NEAR_STAKE,
  FAR_STAKE,
  SHOE,
  type Player,
  type Pose,
  type Quat,
  type Stake,
  type Vec3,
  add,
  inPit,
  length,
  normalize,
  quatFromUnitVectors,
  scale,
  shoeCenterline,
  stakeAxisAt,
  sub,
  v3,
} from '../rules';
import { mulberry32, type Rng } from './rng';
import { GRAVITY, type ThrowInput, launch } from './throw';

let ready: Promise<void> | null = null;
/** Load the physics engine's WebAssembly once. */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

export const STEP = 1 / 240;

export interface ClayParams {
  /** Share of the shoe's horizontal speed the clay soaks up on landing (0–1). */
  absorb: number;
  /** Linear and angular damping once a shoe has touched the clay. Stops it sliding like ice. */
  linearDamping: number;
  angularDamping: number;
  friction: number;
  /** Chance that a steep landing plugs (sticks at its landing angle). */
  plugChance: number;
  /** Landings steeper than this (downward speed ÷ speed) can plug. */
  plugSteepness: number;
}

export const CLAY_PRESETS: Record<'wet' | 'dry' | 'sand', ClayParams> = {
  wet: { absorb: 0.8, linearDamping: 12, angularDamping: 12, friction: 1.2, plugChance: 0.35, plugSteepness: 0.55 },
  dry: { absorb: 0.55, linearDamping: 6, angularDamping: 6, friction: 0.9, plugChance: 0.12, plugSteepness: 0.6 },
  sand: { absorb: 0.9, linearDamping: 16, angularDamping: 14, friction: 1.4, plugChance: 0.5, plugSteepness: 0.45 },
};

export interface SimParams {
  clay: ClayParams;
  /** Steel on steel. */
  stakeRestitution: number;
  stakeFriction: number;
  shoeRestitution: number;
  shoeFriction: number;
}

export const DEFAULT_PARAMS: SimParams = {
  clay: { ...CLAY_PRESETS.wet },
  stakeRestitution: 0.55,
  stakeFriction: 0.3,
  shoeRestitution: 0.35,
  shoeFriction: 0.5,
};

/** Settle thresholds: slower than this for SETTLE_TIME counts as at rest. */
const SETTLE_LINEAR = 0.03;
const SETTLE_ANGULAR = 0.4;
const SETTLE_TIME = 0.5;
/** A shoe still jittering after this long is force-settled. */
const SETTLE_TIMEOUT = 8;
const PLUGGED_DAMPING = 60;

export type ColliderKind = 'clay' | 'ground' | 'backboard' | 'stake' | 'shoe';

/** A shoe started touching something, for sound and effects. */
export interface Impact {
  shoe: ShoeSim;
  kind: ColliderKind;
  /** Shoe speed at the moment of contact (m/s). */
  speed: number;
}

export interface ShoeSim {
  id: number;
  owner: Player;
  input: ThrowInput;
  target: Stake;
  body: RAPIER.RigidBody;
  thrownAt: number;
  /** RULE 5 B.2(c): touched the backboard, platform or ground outside the pit during its delivery. */
  foulContact: boolean;
  /** Has come to rest at least once; contacts after that are another shoe knocking it about. */
  delivered: boolean;
  landed: boolean;
  plugged: boolean;
  hitStake: boolean;
  /** Where, how and how hard it first hit the clay, for marks in the pit. */
  landing: { position: Vec3; rotation: Quat; velocity: Vec3; speed: number } | null;
  /** At rest right now. A later shoe can knock it loose again. */
  settled: boolean;
  slowFor: number;
  /** Clock for the force-settle timeout; restarts whenever a new shoe is thrown. */
  clockFrom: number;
  rng: Rng;
}

export class PitSim {
  readonly world: RAPIER.World;
  readonly shoes: ShoeSim[] = [];
  time = 0;
  onImpact: ((e: Impact) => void) | null = null;
  private readonly events = new RAPIER.EventQueue(true);
  private readonly kinds = new Map<number, ColliderKind>();
  private readonly owners = new Map<number, ShoeSim>();
  private nextId = 1;

  /** Call `initPhysics()` first. */
  constructor(readonly params: SimParams = DEFAULT_PARAMS) {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = STEP;
    this.world.integrationParameters.numSolverIterations = 8;
    for (const stake of [NEAR_STAKE, FAR_STAKE]) this.buildEnd(stake);
    this.buildGround();
  }

  private fixed(desc: RAPIER.ColliderDesc, kind: ColliderKind) {
    const c = this.world.createCollider(desc);
    this.kinds.set(c.handle, kind);
    return c;
  }

  private buildEnd(stake: Stake) {
    const p = this.params;
    const depth = 8 * 0.0254;
    // Clay fill, top at y = 0.
    this.fixed(
      RAPIER.ColliderDesc.cuboid(COURT.pitWidth / 2, depth / 2, COURT.pitLength / 2)
        .setTranslation(stake.base.x, -depth / 2, stake.base.z)
        .setFriction(p.clay.friction)
        .setRestitution(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Multiply),
      'clay',
    );

    // Stake: a leaning steel cylinder, driven a few inches into the clay.
    const below = 4 * 0.0254;
    const top = stakeAxisAt(stake, COURT.stakeHeight);
    const axis = normalize(sub(top, stake.base));
    const bottom = sub(stake.base, scale(axis, below));
    const len = length(sub(top, bottom));
    const mid = scale(add(top, bottom), 0.5);
    this.fixed(
      RAPIER.ColliderDesc.cylinder(len / 2, COURT.stakeRadius)
        .setTranslation(mid.x, mid.y, mid.z)
        .setRotation(quatFromUnitVectors(v3(0, 1, 0), axis))
        .setFriction(p.stakeFriction)
        .setRestitution(p.stakeRestitution / p.shoeRestitution)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Multiply),
      'stake',
    );

    // Backboard: 3 ft behind the stake, 1 ft high, across the pit.
    const t = 0.75 * 0.0254;
    const behind = sub(stake.base, scale(stake.leanDir, COURT.backboardDistance + t / 2));
    this.fixed(
      RAPIER.ColliderDesc.cuboid(COURT.pitWidth / 2 + 4 * 0.0254, COURT.backboardHeight / 2, t / 2)
        .setTranslation(behind.x, COURT.backboardHeight / 2, behind.z)
        .setRestitution(0.2)
        .setFriction(0.6),
      'backboard',
    );
  }

  /** Everything outside the pits: platforms, walkways and lawn. Touching it is a foul. */
  private buildGround() {
    const halfW = 4;
    const depth = 0.5;
    const zMin = -6;
    const zMax = FAR_STAKE.base.z + 6;
    const pitHalfW = COURT.pitWidth / 2;
    const pitHalfL = COURT.pitLength / 2;
    const slab = (x0: number, x1: number, z0: number, z1: number) => {
      if (x1 <= x0 || z1 <= z0) return;
      this.fixed(
        RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, depth / 2, (z1 - z0) / 2)
          .setTranslation((x0 + x1) / 2, -depth / 2, (z0 + z1) / 2)
          .setFriction(0.8)
          .setRestitution(0.1),
        'ground',
      );
    };
    // Strips left and right of the pits, full length.
    slab(-halfW, -pitHalfW, zMin, zMax);
    slab(pitHalfW, halfW, zMin, zMax);
    // Between the pits' x-range: before, between and after the two pits.
    const n0 = NEAR_STAKE.base.z - pitHalfL;
    const n1 = NEAR_STAKE.base.z + pitHalfL;
    const f0 = FAR_STAKE.base.z - pitHalfL;
    const f1 = FAR_STAKE.base.z + pitHalfL;
    slab(-pitHalfW, pitHalfW, zMin, n0);
    slab(-pitHalfW, pitHalfW, n1, f0);
    slab(-pitHalfW, pitHalfW, f1, zMax);
  }

  private buildShoe(body: RAPIER.RigidBody) {
    const p = this.params;
    const cl = shoeCenterline(false);
    const w = SHOE.barWidth;
    const t = SHOE.barThickness;
    const r = 0.06 * 0.0254; // rounded edges
    const overlap = 0.06 * 0.0254;

    const parts: { desc: RAPIER.ColliderDesc; volume: number }[] = [];
    for (let i = 0; i + 1 < cl.length; i++) {
      const a = cl[i];
      const b = cl[i + 1];
      const d = sub(b, a);
      const len = length(d);
      const mid = scale(add(a, b), 0.5);
      const hl = len / 2 + overlap;
      parts.push({
        desc: RAPIER.ColliderDesc.roundCuboid(hl - r, t / 2 - r, w / 2 - r, r)
          .setTranslation(mid.x, mid.y, mid.z)
          .setRotation(quatFromUnitVectors(v3(1, 0, 0), scale(d, 1 / len))),
        volume: 2 * hl * t * w,
      });
    }
    // Heel calks under each point, toe calk under the toe.
    const cy = -(t / 2 + SHOE.calkDepth / 2);
    for (const z of [-SHOE.pointHalfSpacing, SHOE.pointHalfSpacing]) {
      const x = -SHOE.legLength + SHOE.heelCalkLength / 2;
      parts.push({
        desc: RAPIER.ColliderDesc.cuboid(SHOE.heelCalkLength / 2, SHOE.calkDepth / 2, w / 2).setTranslation(x, cy, z),
        volume: SHOE.heelCalkLength * SHOE.calkDepth * w,
      });
    }
    parts.push({
      desc: RAPIER.ColliderDesc.cuboid(w / 2, SHOE.calkDepth / 2, SHOE.toeCalkSpan / 2).setTranslation(SHOE.toeRadius, cy, 0),
      volume: w * SHOE.calkDepth * SHOE.toeCalkSpan,
    });

    const total = parts.reduce((s, q) => s + q.volume, 0);
    for (const { desc, volume } of parts) {
      desc
        .setMass((SHOE.mass * volume) / total)
        .setFriction(p.shoeFriction)
        .setRestitution(p.shoeRestitution)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const c = this.world.createCollider(desc, body);
      this.kinds.set(c.handle, 'shoe');
    }
  }

  throwShoe(input: ThrowInput, owner: Player, target: Stake = NEAR_STAKE): ShoeSim {
    const s = launch(input, target);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(s.position.x, s.position.y, s.position.z)
        .setRotation(s.rotation)
        .setLinvel(s.linvel.x, s.linvel.y, s.linvel.z)
        .setAngvel(s.angvel)
        .setCcdEnabled(true)
        .setCanSleep(true),
    );
    this.buildShoe(body);
    const shoe: ShoeSim = {
      id: this.nextId++,
      owner,
      input,
      target,
      body,
      thrownAt: this.time,
      foulContact: false,
      delivered: false,
      landed: false,
      plugged: false,
      hitStake: false,
      landing: null,
      settled: false,
      slowFor: 0,
      clockFrom: this.time,
      rng: mulberry32(input.seed),
    };
    for (const other of this.shoes) other.clockFrom = this.time;
    for (let i = 0; i < body.numColliders(); i++) this.owners.set(body.collider(i).handle, shoe);
    this.shoes.push(shoe);
    return shoe;
  }

  removeShoe(shoe: ShoeSim) {
    for (let i = 0; i < shoe.body.numColliders(); i++) {
      const h = shoe.body.collider(i).handle;
      this.owners.delete(h);
      this.kinds.delete(h);
    }
    this.world.removeRigidBody(shoe.body);
    this.shoes.splice(this.shoes.indexOf(shoe), 1);
  }

  clearShoes() {
    for (const s of [...this.shoes]) this.removeShoe(s);
  }

  step() {
    this.world.step(this.events);
    this.time += STEP;
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      this.contact(h1, h2);
      this.contact(h2, h1);
      // Shoe on shoe reports once, for the first shoe.
      const shoe = this.owners.get(h1) ?? this.owners.get(h2);
      const otherHandle = this.owners.get(h1) ? h2 : h1;
      const kind = this.kinds.get(otherHandle);
      if (shoe && kind && this.onImpact) {
        const v = shoe.body.linvel();
        this.onImpact({ shoe, kind, speed: Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) });
      }
    });
    for (const s of this.shoes) this.updateSettle(s);
  }

  private contact(shoeHandle: number, otherHandle: number) {
    const shoe = this.owners.get(shoeHandle);
    if (!shoe) return;
    const kind = this.kinds.get(otherHandle);
    if ((kind === 'ground' || kind === 'backboard') && !shoe.delivered) shoe.foulContact = true;
    else if (kind === 'stake') shoe.hitStake = true;
    else if (kind === 'clay' && !shoe.landed) this.land(shoe);
  }

  /** First touch of the clay: it grabs the shoe. */
  private land(shoe: ShoeSim) {
    const clay = this.params.clay;
    const v = shoe.body.linvel();
    const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    shoe.landed = true;
    const q = shoe.body.rotation();
    shoe.landing = { position: { ...shoe.body.translation() }, rotation: { x: q.x, y: q.y, z: q.z, w: q.w }, velocity: v3(v.x, v.y, v.z), speed };
    const steep = speed > 0 ? -v.y / speed : 0;
    const roll = shoe.rng();
    if (steep > clay.plugSteepness && roll < clay.plugChance) {
      shoe.plugged = true;
      shoe.body.setLinvel(scale(v3(v.x, v.y, v.z), 0.1), true);
      shoe.body.setAngvel(v3(0, 0, 0), true);
      shoe.body.setLinearDamping(PLUGGED_DAMPING);
      shoe.body.setAngularDamping(PLUGGED_DAMPING);
    } else {
      const keep = 1 - clay.absorb;
      shoe.body.setLinvel(v3(v.x * keep, v.y, v.z * keep), true);
      shoe.body.setLinearDamping(clay.linearDamping);
      shoe.body.setAngularDamping(clay.angularDamping);
    }
  }

  private updateSettle(s: ShoeSim) {
    const v = s.body.linvel();
    const w = s.body.angvel();
    const slow =
      s.body.isSleeping() ||
      (v.x * v.x + v.y * v.y + v.z * v.z < SETTLE_LINEAR * SETTLE_LINEAR &&
        w.x * w.x + w.y * w.y + w.z * w.z < SETTLE_ANGULAR * SETTLE_ANGULAR);
    s.slowFor = slow ? s.slowFor + STEP : 0;
    s.settled = s.slowFor >= SETTLE_TIME || this.time - s.clockFrom >= SETTLE_TIMEOUT;
    if (s.settled) s.delivered = true;
  }

  /** Has every shoe come to rest? */
  allSettled(): boolean {
    return this.shoes.every((s) => s.settled);
  }

  /** RULE 5 foul contact during delivery, or (RULE 3 B.1) resting outside the pit. */
  isFoul(s: ShoeSim): boolean {
    return s.foulContact || !inPit(s.target, s.body.translation());
  }

  pose(s: ShoeSim): Pose {
    const t = s.body.translation();
    const q = s.body.rotation();
    return { position: v3(t.x, t.y, t.z), rotation: { x: q.x, y: q.y, z: q.z, w: q.w } };
  }

  /** Run until every shoe has settled (headless use). */
  runUntilSettled(maxSeconds = 12) {
    const end = this.time + maxSeconds;
    do this.step();
    while (!this.allSettled() && this.time < end);
  }
}
