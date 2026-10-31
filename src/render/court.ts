// The backyard court at real NHPA dimensions: lawn, platforms, backboards,
// stakes, foul lines, plus a fence, a cooler and a tree line for company.
// The clay pits are separate (see clayPit.ts) because they keep marks.

import * as THREE from 'three';
import { COURT, FAR_STAKE, FT, IN, NEAR_STAKE, type Stake, stakeAxisAt } from '../rules';
import { type Materials, tiledClone } from './materials';

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.receiveShadow = true;
  m.castShadow = cast;
  return m;
}

const PLATFORM_X = COURT.pitWidth / 2 + COURT.platformWidth / 2;

function buildEnd(g: THREE.Group, stake: Stake, mats: Materials) {
  const { x, z } = stake.base;
  const lean = stake.leanDir.z;

  // Concrete pitching platforms either side of the pit, the pitcher's box length.
  const slab = tiledClone(mats.concrete, 0.5, 2);
  for (const side of [-1, 1]) g.add(box(COURT.platformWidth, 0.03, 6 * FT, slab, x + side * PLATFORM_X, -0.0149, z, false));

  // Timber frame around the pit.
  const frame = tiledClone(mats.wood, 0.2, 2);
  const t = 1.5 * IN;
  for (const side of [-1, 1]) {
    g.add(box(t, 0.03, COURT.pitLength + 2 * t, frame, x + side * (COURT.pitWidth / 2 + t / 2), -0.012, z, false));
    g.add(box(COURT.pitWidth, 0.03, t, frame, x, -0.012, z + side * (COURT.pitLength / 2 + t / 2), false));
  }

  // Stake.
  const top = stakeAxisAt(stake, COURT.stakeHeight);
  const axis = new THREE.Vector3(top.x - x, top.y, top.z - z);
  const len = axis.length();
  const stakeMesh = new THREE.Mesh(new THREE.CylinderGeometry(COURT.stakeRadius, COURT.stakeRadius, len, 24), mats.steel);
  stakeMesh.position.set(x + axis.x / 2, axis.y / 2, z + axis.z / 2);
  stakeMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
  stakeMesh.castShadow = true;
  g.add(stakeMesh);

  // Backboard behind the stake.
  const bt = 0.75 * IN;
  g.add(box(COURT.pitWidth + 8 * IN, COURT.backboardHeight, bt, tiledClone(mats.wood, 1, 0.35), x, COURT.backboardHeight / 2, z - lean * (COURT.backboardDistance + bt / 2)));

  // Protective fence 8 ft behind the stake (NHPA specs), planks on two rails.
  const fz = z - lean * 8 * FT;
  const fenceMat = tiledClone(mats.darkWood, 4, 0.6);
  g.add(box(8, 1.1, 0.04, fenceMat, x, 0.55, fz));
  for (const px of [-4, -2, 0, 2, 4]) g.add(box(0.09, 1.25, 0.09, mats.darkWood, x + px, 0.62, fz + lean * 0.06));
}

function buildTrees(count: number): THREE.Group {
  const g = new THREE.Group();
  if (count === 0) return g;
  const crown = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshStandardMaterial({ color: 0x223018, roughness: 1 }), count);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.18, 1, 6), new THREE.MeshStandardMaterial({ color: 0x3b2d22, roughness: 1 }), count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd() * 0.2;
    // Far enough that fog turns them into a soft tree line behind the yard.
    const r = 55 + rnd() * 25;
    const x = Math.cos(a) * r * 0.75;
    const z = FAR_STAKE.base.z / 2 + Math.sin(a) * r;
    const h = 6 + rnd() * 4;
    const s = 3 + rnd() * 2.5;
    crown.setMatrixAt(i, m.compose(new THREE.Vector3(x, h, z), q, new THREE.Vector3(s, s * (1.1 + rnd() * 0.5), s)));
    trunk.setMatrixAt(i, m.compose(new THREE.Vector3(x, h / 2 - 0.5, z), q, new THREE.Vector3(1, h, 1)));
  }
  crown.castShadow = true;
  g.add(crown, trunk);
  return g;
}

function buildCooler(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0xb2382c, roughness: 0.45 });
  const lid = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.4 });
  g.add(box(0.56, 0.32, 0.36, body, 0, 0.16, 0));
  g.add(box(0.58, 0.07, 0.38, lid, 0, 0.355, 0));
  g.add(box(0.3, 0.025, 0.04, lid, 0, 0.4, 0));
  return g;
}

export function buildCourt(mats: Materials, trees: number): THREE.Group {
  const g = new THREE.Group();

  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(80, 100), mats.lawn);
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(0, -0.03, FAR_STAKE.base.z / 2);
  lawn.receiveShadow = true;
  g.add(lawn);

  // Walkways along both sides between the pitcher's boxes.
  const walkLen = FAR_STAKE.base.z - 6 * FT;
  const walk = tiledClone(mats.concrete, 0.5, 6);
  for (const side of [-1, 1]) g.add(box(COURT.platformWidth, 0.02, walkLen, walk, side * PLATFORM_X, -0.019, FAR_STAKE.base.z / 2, false));

  buildEnd(g, NEAR_STAKE, mats);
  buildEnd(g, FAR_STAKE, mats);

  // Foul lines across the platforms, measured from the front of the opposite stake.
  const line = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.9 });
  const lineAt = (zz: number) => {
    for (const side of [-1, 1]) g.add(box(COURT.platformWidth, 0.004, 2 * IN, line, side * PLATFORM_X, 0.0012, zz, false));
  };
  const nearFront = NEAR_STAKE.base.z + COURT.stakeRadius;
  const farFront = FAR_STAKE.base.z - COURT.stakeRadius;
  for (const d of [COURT.foulLineFull, COURT.foulLineShort]) {
    lineAt(nearFront + d);
    lineAt(farFront - d);
  }

  // Side fence along the left, where the string lights hang.
  const side = tiledClone(mats.darkWood, 12, 0.6);
  g.add(box(0.04, 1.1, FAR_STAKE.base.z + 5, side, -3.6, 0.55, FAR_STAKE.base.z / 2));

  const cooler = buildCooler();
  cooler.position.set(1.35, 0, FAR_STAKE.base.z + 1.1);
  cooler.rotation.y = 0.3;
  g.add(cooler);

  g.add(buildTrees(trees));
  return g;
}
