// Graybox court: real dimensions, plain materials. The PBR art pass is Phase 2.

import * as THREE from 'three';
import { COURT, FAR_STAKE, FT, IN, NEAR_STAKE, type Stake, stakeAxisAt } from '../rules';

const MAT = {
  lawn: new THREE.MeshStandardMaterial({ color: 0x5d7a3a, roughness: 1 }),
  platform: new THREE.MeshStandardMaterial({ color: 0xb9b2a4, roughness: 0.95 }),
  clay: new THREE.MeshStandardMaterial({ color: 0x9a6a44, roughness: 1 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 }),
  stake: new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.85, roughness: 0.35 }),
  line: new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.9 }),
};

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.receiveShadow = true;
  m.castShadow = true;
  return m;
}

function buildEnd(group: THREE.Group, stake: Stake) {
  const { x, z } = stake.base;
  const lean = stake.leanDir.z;

  // Clay sits a hair below the lawn line visually so they don't z-fight.
  const pit = box(COURT.pitWidth, 0.02, COURT.pitLength, MAT.clay, x, -0.0095, z);
  pit.castShadow = false;
  group.add(pit);

  // Platforms either side of the pit, the full pitcher's box length.
  for (const side of [-1, 1]) {
    const px = x + side * (COURT.pitWidth / 2 + COURT.platformWidth / 2);
    const p = box(COURT.platformWidth, 0.02, 6 * FT, MAT.platform, px, -0.009, z);
    p.castShadow = false;
    group.add(p);
  }

  // Stake.
  const top = stakeAxisAt(stake, COURT.stakeHeight);
  const axis = new THREE.Vector3(top.x - x, top.y, top.z - z);
  const len = axis.length();
  const stakeMesh = new THREE.Mesh(new THREE.CylinderGeometry(COURT.stakeRadius, COURT.stakeRadius, len, 20), MAT.stake);
  stakeMesh.position.set(x + axis.x / 2, axis.y / 2, z + axis.z / 2);
  stakeMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
  stakeMesh.castShadow = true;
  group.add(stakeMesh);

  // Backboard behind the stake.
  const t = 0.75 * IN;
  group.add(
    box(COURT.pitWidth + 8 * IN, COURT.backboardHeight, t, MAT.wood, x, COURT.backboardHeight / 2, z - lean * (COURT.backboardDistance + t / 2)),
  );
}

export function buildCourt(): THREE.Group {
  const g = new THREE.Group();

  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(40, 60), MAT.lawn);
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(0, -0.02, FAR_STAKE.base.z / 2);
  lawn.receiveShadow = true;
  g.add(lawn);

  // Walkway along both sides, the full length between the boxes.
  for (const side of [-1, 1]) {
    const px = side * (COURT.pitWidth / 2 + COURT.platformWidth / 2);
    const w = box(COURT.platformWidth, 0.01, FAR_STAKE.base.z - 6 * FT, MAT.platform, px, -0.014, FAR_STAKE.base.z / 2);
    w.castShadow = false;
    g.add(w);
  }

  buildEnd(g, NEAR_STAKE);
  buildEnd(g, FAR_STAKE);

  // Foul lines across the platforms, measured from the front of the opposite stake.
  const lineAt = (zz: number) => {
    for (const side of [-1, 1]) {
      const px = side * (COURT.pitWidth / 2 + COURT.platformWidth / 2);
      const l = box(COURT.platformWidth, 0.004, 2 * IN, MAT.line, px, 0.002, zz);
      l.castShadow = false;
      g.add(l);
    }
  };
  const nearFront = NEAR_STAKE.base.z + COURT.stakeRadius;
  const farFront = FAR_STAKE.base.z - COURT.stakeRadius;
  for (const d of [COURT.foulLineFull, COURT.foulLineShort]) {
    lineAt(nearFront + d); // pitching toward the near stake
    lineAt(farFront - d); // pitching toward the far stake
  }

  return g;
}

export function buildLights(scene: THREE.Scene) {
  scene.background = new THREE.Color(0xf0c890);
  scene.fog = new THREE.Fog(0xf0c890, 25, 70);
  scene.add(new THREE.HemisphereLight(0xffe2b8, 0x4a5a32, 1.1));

  // Low golden-hour sun from behind and to the side of the pitcher.
  const sun = new THREE.DirectionalLight(0xffd29a, 2.4);
  sun.position.set(-8, 7, FAR_STAKE.base.z + 6);
  sun.target.position.set(0, 0, FAR_STAKE.base.z / 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -10;
  cam.right = 10;
  cam.top = 10;
  cam.bottom = -10;
  cam.near = 1;
  cam.far = 40;
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
}
