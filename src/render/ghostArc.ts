// Aim aid: the arc a perfect throw would fly. It only shows information; it never changes the throw.

import * as THREE from 'three';
import type { Stake } from '../rules';
import { GRAVITY, type FoulLine, type Grip, type Stance, launch, perfectThrow } from '../physics/throw';

export class GhostArc {
  readonly line: THREE.Line;
  private readonly geo = new THREE.BufferGeometry();

  constructor() {
    const mat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.45 });
    this.line = new THREE.Line(this.geo, mat);
    this.line.frustumCulled = false;
  }

  update(grip: Grip, stance: Stance, line: FoulLine, target: Stake) {
    const s = launch(perfectThrow(grip, stance, line), target);
    const pts: THREE.Vector3[] = [];
    const n = 60;
    for (let i = 0; i <= n; i++) {
      const t = (s.nominalFlightTime * i) / n;
      pts.push(
        new THREE.Vector3(
          s.position.x + s.linvel.x * t,
          s.position.y + s.linvel.y * t - 0.5 * GRAVITY * t * t,
          s.position.z + s.linvel.z * t,
        ),
      );
    }
    this.geo.setFromPoints(pts);
    this.line.computeLineDistances();
  }
}
