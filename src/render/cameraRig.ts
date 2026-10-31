// Camera shots: behind the pitcher while aiming, chase during flight, low at the pit for the result.

import * as THREE from 'three';
import { NEAR_STAKE, type Vec3 } from '../rules';
import { LAUNCH, type Stance } from '../physics/throw';

export type Shot = 'aim' | 'flight' | 'pit';

const stakeLook = new THREE.Vector3(NEAR_STAKE.base.x, 0.12, NEAR_STAKE.base.z);

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(24, 1, 0.05, 200);
  private shot: Shot = 'aim';
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly wantPos = new THREE.Vector3();
  private readonly wantLook = new THREE.Vector3();
  private stance: Stance = 'right';
  private releaseZ = 11.3;

  constructor() {
    this.aimTargets();
    this.pos.copy(this.wantPos);
    this.look.copy(this.wantLook);
  }

  setAim(stance: Stance, releaseZ: number) {
    this.stance = stance;
    this.releaseZ = releaseZ;
  }

  go(shot: Shot) {
    this.shot = shot;
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

  private aimTargets() {
    const side = this.stance === 'right' ? 1 : -1;
    this.wantPos.set(side * (LAUNCH.releaseLateral + 0.2), 1.7, this.releaseZ + 1.6);
    this.wantLook.copy(stakeLook);
  }

  update(dt: number, shoe: Vec3 | null) {
    let rate = 3;
    if (this.shot === 'aim') {
      this.aimTargets();
    } else if (this.shot === 'flight' && shoe) {
      // Ride along behind and above the shoe, easing toward the pit shot as it nears the stake.
      const near = Math.min(1, Math.max(0, 1 - shoe.z / this.releaseZ));
      const chase = new THREE.Vector3(shoe.x * 0.5, Math.max(1.2, shoe.y + 0.9), shoe.z + 3.2);
      const pit = this.pitPos();
      this.wantPos.lerpVectors(chase, pit, near * near);
      this.wantLook.lerpVectors(new THREE.Vector3(shoe.x, shoe.y, shoe.z), stakeLook, near);
      rate = 5;
    } else if (this.shot === 'pit') {
      this.wantPos.copy(this.pitPos());
      this.wantLook.copy(stakeLook);
      rate = 2.5;
    }
    const k = 1 - Math.exp(-rate * dt);
    this.pos.lerp(this.wantPos, k);
    this.look.lerp(this.wantLook, k);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  private pitPos() {
    const side = this.stance === 'right' ? 1 : -1;
    return new THREE.Vector3(side * 0.5, 0.6, 1.9);
  }
}
