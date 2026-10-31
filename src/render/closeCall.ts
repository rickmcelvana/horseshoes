// The close-call cam: when a shoe stops near the stake, drop the camera to the
// clay and slide in a measuring tool. Every number it shows comes straight from
// the rules engine's measurement, so what you see is what was scored.

import * as THREE from 'three';
import { IN, SHOE, type ShoeMeasure, type Vec3 } from '../rules';

/** Shoes this close get measured on camera. */
export const CLOSE_CALL_DISTANCE = 3 * IN;

/** Ringers whose straightedge clears by less than this get measured too. */
export const CLOSE_RINGER_CLEARANCE = 1.5 * IN;

export type CloseCallKind = 'gap' | 'straightedge';

export function closeCallKind(m: ShoeMeasure, foul: boolean): CloseCallKind | null {
  if (foul) return null;
  // A ringer that sits deep around the stake isn't a close call; one that barely clears is.
  if (m.straightedge.encircles) return m.straightedge.clearance < CLOSE_RINGER_CLEARANCE ? 'straightedge' : null;
  if (m.distance <= CLOSE_CALL_DISTANCE) return 'gap';
  return null;
}

/** What the label under the tool says. */
export function closeCallLabel(kind: CloseCallKind, m: ShoeMeasure): { text: string; good: boolean } {
  if (kind === 'straightedge') {
    const c = m.straightedge.clearance / IN;
    return c > 0 ? { text: `Clears by ${c.toFixed(2)} in: ringer`, good: true } : { text: 'Straightedge touches the stake: no ringer', good: false };
  }
  if (m.touching) return { text: m.leaner ? 'Leaning on the stake' : 'Touching the stake', good: true };
  return { text: `${(m.distance / IN).toFixed(2)} in`, good: true };
}

const toV = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);
const ease = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

/** Seconds the shot holds before the result card. */
export const CLOSE_CALL_TIME = 2.6;

export class CloseCall {
  readonly group = new THREE.Group();
  active = false;
  /** Where the camera should sit and look during the shot. */
  readonly cameraPos = new THREE.Vector3();
  readonly cameraLook = new THREE.Vector3();
  private kind: CloseCallKind = 'gap';
  private t = 0;
  private readonly brass = new THREE.MeshStandardMaterial({ color: 0xd8b25a, metalness: 1, roughness: 0.3 });
  private readonly rule = new THREE.MeshStandardMaterial({ color: 0x8d9196, metalness: 1, roughness: 0.38 });
  private readonly beam: THREE.Mesh;
  private readonly jawA: THREE.Mesh;
  private readonly jawB: THREE.Mesh;
  private readonly edge: THREE.Mesh;
  // Tool layout, worked out at start.
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private slide = new THREE.Vector3();
  private labelAt = new THREE.Vector3();

  constructor(private readonly label: HTMLElement) {
    this.beam = new THREE.Mesh(new THREE.BoxGeometry(1, 0.004, 0.012), this.brass);
    this.jawA = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.03, 0.012), this.brass);
    this.jawB = this.jawA.clone();
    this.edge = new THREE.Mesh(new THREE.BoxGeometry(1, 0.004, 0.022), this.rule);
    for (const m of [this.beam, this.jawA, this.jawB, this.edge]) {
      m.castShadow = true;
      this.group.add(m);
    }
    this.group.visible = false;
  }

  /** Begin the shot. `viewFrom` is roughly where the camera is now, to pick a side. */
  start(kind: CloseCallKind, m: ShoeMeasure, stakeCenter: Vec3, viewFrom: THREE.Vector3) {
    this.kind = kind;
    this.t = 0;
    this.active = true;
    this.group.visible = true;
    this.label.className = 'hidden';
    const up = new THREE.Vector3(0, 1, 0);

    if (kind === 'gap') {
      const s = toV(m.nearest.stake);
      const p = toV(m.nearest.shoe);
      const y = Math.max(p.y, 0.006);
      s.y = p.y = y;
      const along = p.clone().sub(s).setY(0);
      if (along.lengthSq() < 1e-8) along.set(1, 0, 0);
      along.normalize();
      const side = new THREE.Vector3().crossVectors(along, up).normalize();
      const mid = s.clone().add(p).multiplyScalar(0.5);
      if (side.dot(viewFrom.clone().sub(mid)) < 0) side.negate();
      this.from.copy(s);
      this.to.copy(p);
      this.slide.copy(side).multiplyScalar(0.18);
      this.cameraPos.copy(mid).addScaledVector(side, 0.3).addScaledVector(up, 0.07);
      this.cameraLook.copy(mid).addScaledVector(up, 0.01);
      this.labelAt.copy(mid).addScaledVector(up, 0.045);
    } else {
      const a = toV(m.straightedge.a);
      const b = toV(m.straightedge.b);
      const along = b.clone().sub(a).setY(0).normalize();
      const y = Math.max(a.y, b.y) + SHOE.barThickness / 2 + 0.003;
      this.from.copy(a).addScaledVector(along, -0.035).setY(y);
      this.to.copy(b).addScaledVector(along, 0.035).setY(y);
      const mid = this.from.clone().add(this.to).multiplyScalar(0.5);
      // Look in through the shoe's open end, past the straightedge at the stake.
      const out = mid.clone().sub(toV(stakeCenter)).setY(0);
      if (out.lengthSq() < 1e-8) out.copy(viewFrom).sub(mid).setY(0);
      out.normalize();
      this.slide.set(0, 0.16, 0);
      this.cameraPos.copy(mid).addScaledVector(out, 0.36).addScaledVector(up, 0.1);
      this.cameraLook.set(stakeCenter.x, y - 0.005, stakeCenter.z);
      this.labelAt.copy(mid).addScaledVector(up, 0.06);
    }
    this.layout(0, 0);
  }

  stop() {
    this.active = false;
    this.group.visible = false;
    this.label.className = 'hidden';
  }

  /** Returns true once the shot has played out. */
  update(dt: number, camera: THREE.Camera, viewport: { w: number; h: number }): boolean {
    if (!this.active) return true;
    this.t += dt;
    const slideIn = ease(this.t / 0.6);
    const close = ease((this.t - 0.6) / 0.45);
    this.layout(slideIn, close);

    if (this.t > 1.05) {
      const p = this.labelAt.clone().project(camera);
      this.label.style.left = `${((p.x + 1) / 2) * viewport.w}px`;
      this.label.style.top = `${((1 - p.y) / 2) * viewport.h}px`;
      this.label.className = '';
    }
    return this.t >= CLOSE_CALL_TIME;
  }

  private layout(slideIn: number, close: number) {
    const off = this.slide.clone().multiplyScalar(1 - slideIn);
    const show = (m: THREE.Object3D, v: boolean) => (m.visible = v);
    if (this.kind === 'gap') {
      show(this.edge, false);
      [this.beam, this.jawA, this.jawB].forEach((m) => show(m, true));
      const dir = this.to.clone().sub(this.from);
      const len = dir.length();
      const unit = len > 1e-6 ? dir.clone().divideScalar(len) : new THREE.Vector3(1, 0, 0);
      // The moving jaw starts an inch beyond the shoe and closes onto it.
      const reach = len + (1 - close) * 0.03;
      const jawB = this.from.clone().addScaledVector(unit, reach).add(off);
      const jawA = this.from.clone().add(off);
      const beamLen = Math.max(0.02, reach + 0.03);
      this.beam.scale.set(beamLen, 1, 1);
      this.beam.position.copy(jawA).addScaledVector(unit, reach / 2).add(new THREE.Vector3(0, 0.022, 0));
      this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), unit);
      this.jawA.position.copy(jawA).add(new THREE.Vector3(0, 0.008, 0));
      this.jawB.position.copy(jawB).add(new THREE.Vector3(0, 0.008, 0));
      this.jawA.quaternion.copy(this.beam.quaternion);
      this.jawB.quaternion.copy(this.beam.quaternion);
    } else {
      [this.beam, this.jawA, this.jawB].forEach((m) => show(m, false));
      show(this.edge, true);
      const dir = this.to.clone().sub(this.from);
      this.edge.scale.set(dir.length(), 1, 1);
      this.edge.position.copy(this.from).addScaledVector(dir, 0.5).add(off);
      this.edge.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
    }
  }

  setLabel(text: string, good: boolean) {
    this.label.textContent = text;
    this.label.dataset.good = String(good);
  }
}
