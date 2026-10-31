// Camera shots: behind the pitcher while aiming, chase during flight, low at the pit for the result.
// Everything is placed relative to the target stake, so it works from either end.

import * as THREE from 'three';
import { COURT, NEAR_STAKE, type Stake, type Vec3 } from '../rules';
import { LAUNCH, type FoulLine, type Stance } from '../physics/throw';

export type Shot = 'aim' | 'flight' | 'pit' | 'custom';

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(24, 1, 0.05, 200);
  private shot: Shot = 'aim';
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly wantPos = new THREE.Vector3();
  private readonly wantLook = new THREE.Vector3();
  private stance: Stance = 'right';
  private target: Stake = NEAR_STAKE;
  private releaseDist = 11.3;
  private customRate = 3;

  constructor() {
    this.aimTargets();
    this.pos.copy(this.wantPos);
    this.look.copy(this.wantLook);
  }

  setAim(stance: Stance, target: Stake, line: FoulLine) {
    this.stance = stance;
    this.target = target;
    const foul = line === 'full' ? COURT.foulLineFull : COURT.foulLineShort;
    this.releaseDist = foul - LAUNCH.reachPastFoulLine;
  }

  go(shot: Shot) {
    this.shot = shot;
  }

  /** Frame something specific (close-call cam, chalkboard). */
  frame(pos: THREE.Vector3, look: THREE.Vector3, rate = 3) {
    this.shot = 'custom';
    this.wantPos.copy(pos);
    this.wantLook.copy(look);
    this.customRate = rate;
  }

  get current(): Shot {
    return this.shot;
  }

  resize(w: number, h: number) {
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Keep at least ~20° of horizontal view in portrait so the pit stays in frame.
    const minHFov = 20;
    const vFromH = (2 * Math.atan(Math.tan((minHFov * Math.PI) / 360) / aspect) * 180) / Math.PI;
    this.camera.fov = Math.max(24, vFromH);
    this.camera.updateProjectionMatrix();
  }

  /** A point `back` meters from the target toward the pitcher, `side` meters to the pitcher's right, `up` high. */
  private at(back: number, side: number, up: number, out = new THREE.Vector3()) {
    const t = this.target;
    // Pitcher faces -leanDir; their right is cross(forward, up) = (leanDir.z, 0, -leanDir.x).
    const rx = t.leanDir.z;
    const rz = -t.leanDir.x;
    return out.set(t.base.x + t.leanDir.x * back + rx * side, up, t.base.z + t.leanDir.z * back + rz * side);
  }

  private get side() {
    return this.stance === 'right' ? 1 : -1;
  }

  private stakeLook(out = new THREE.Vector3()) {
    return this.at(0, 0, 0.12, out);
  }

  private aimTargets() {
    this.at(this.releaseDist + 1.6, this.side * (LAUNCH.releaseLateral + 0.2), 1.7, this.wantPos);
    this.stakeLook(this.wantLook);
  }

  update(dt: number, shoe: Vec3 | null) {
    let rate = 3;
    if (this.shot === 'aim') {
      this.aimTargets();
      rate = 2.2;
    } else if (this.shot === 'flight' && shoe) {
      // Ride along behind and above the shoe, easing toward the pit shot as it nears the stake.
      const t = this.target;
      const along = (shoe.x - t.base.x) * t.leanDir.x + (shoe.z - t.base.z) * t.leanDir.z;
      const near = Math.min(1, Math.max(0, 1 - along / this.releaseDist));
      const chase = new THREE.Vector3(shoe.x, Math.max(1.2, shoe.y + 0.9), shoe.z).addScaledVector(
        new THREE.Vector3(t.leanDir.x, 0, t.leanDir.z),
        3.2,
      );
      chase.x = t.base.x + (chase.x - t.base.x) * 0.5;
      this.wantPos.lerpVectors(chase, this.pitPos(), near * near);
      this.wantLook.lerpVectors(new THREE.Vector3(shoe.x, shoe.y, shoe.z), this.stakeLook(), near);
      rate = 5;
    } else if (this.shot === 'pit') {
      this.pitPos(this.wantPos);
      this.stakeLook(this.wantLook);
      rate = 2.5;
    } else if (this.shot === 'custom') {
      rate = this.customRate;
    }
    const k = 1 - Math.exp(-rate * dt);
    this.pos.lerp(this.wantPos, k);
    this.look.lerp(this.wantLook, k);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  private pitPos(out = new THREE.Vector3()) {
    return this.at(1.9, this.side * 0.5, 0.6, out);
  }
}
