// The pit's clay surface, which keeps every mark: landing dents, skid scuffs,
// plugs and the imprint a shoe leaves when it's picked up. A height field in a
// small texture drives both the surface shape and its shading.
//
// The marks are visual only: physics still sees a flat pit.

import * as THREE from 'three';
import { COURT, SHOE, type Pose, type Stake, type Vec3, add, rotate, shoeCenterline, v3 } from '../rules';

const TEX_W = 160; // across the pit (36 in → ~5.7 mm per texel)
const TEX_H = 320; // along the pit (72 in)
/** Meters of height per byte step; 128 is the flat surface. */
const HEIGHT_STEP = 0.00018;

/** The toe arc and legs, densified so stamped discs overlap into a solid bar. */
const BAR_POINTS: Vec3[] = (() => {
  const cl = shoeCenterline(true);
  const out: Vec3[] = [];
  for (let i = 0; i + 1 < cl.length; i++) {
    const a = cl[i];
    const b = cl[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.004));
    for (let k = 0; k < n; k++) out.push(v3(a.x + ((b.x - a.x) * k) / n, 0, a.z + ((b.z - a.z) * k) / n));
  }
  out.push(cl[cl.length - 1]);
  return out;
})();

export class ClayPit {
  readonly mesh: THREE.Mesh;
  private readonly height = new Float32Array(TEX_W * TEX_H);
  private readonly disturbed = new Float32Array(TEX_W * TEX_H);
  private readonly bytes = new Uint8Array(TEX_W * TEX_H * 2);
  private readonly tex: THREE.DataTexture;
  private dirty = true;

  constructor(
    readonly stake: Stake,
    base: THREE.MeshStandardMaterial,
  ) {
    this.tex = new THREE.DataTexture(this.bytes, TEX_W, TEX_H, THREE.RGFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(COURT.pitWidth, COURT.pitLength, 72, 144);
    geo.rotateX(-Math.PI / 2);
    const mat = base.clone();
    const uniforms = {
      markMap: { value: this.tex },
      markScale: { value: 255 * HEIGHT_STEP },
      markTexel: { value: new THREE.Vector2(1 / TEX_W, 1 / TEX_H) },
      markTexelWorld: { value: new THREE.Vector2(COURT.pitWidth / TEX_W, COURT.pitLength / TEX_H) },
    };
    mat.customProgramCacheKey = () => 'clay-pit';
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D markMap;
          uniform float markScale;
          varying vec2 vMarkUv;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vMarkUv = uv;
          transformed.y += (texture2D(markMap, uv).r - 0.50196) * markScale;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D markMap;
          uniform float markScale;
          uniform vec2 markTexel;
          uniform vec2 markTexelWorld;
          varying vec2 vMarkUv;`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float markDisturb = texture2D(markMap, vMarkUv).g;
          // Freshly turned clay is darker and damper.
          diffuseColor.rgb *= 1.0 - 0.3 * markDisturb;`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor *= 1.0 - 0.3 * markDisturb;`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            float hL = texture2D(markMap, vMarkUv - vec2(markTexel.x, 0.0)).r;
            float hR = texture2D(markMap, vMarkUv + vec2(markTexel.x, 0.0)).r;
            float hD = texture2D(markMap, vMarkUv - vec2(0.0, markTexel.y)).r;
            float hU = texture2D(markMap, vMarkUv + vec2(0.0, markTexel.y)).r;
            float dhdx = (hR - hL) * markScale / (2.0 * markTexelWorld.x);
            // +v runs toward world -z.
            float dhdz = -(hU - hD) * markScale / (2.0 * markTexelWorld.y);
            vec3 nView = normalize((viewMatrix * vec4(-dhdx, 1.0, -dhdz, 0.0)).xyz);
            vec3 upView = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
            normal = normalize(normal + (nView - upView));
          }`,
        );
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(stake.base.x, 0, stake.base.z);
    this.mesh.receiveShadow = true;
    this.rake();
  }

  /** Smooth the pit for a new game. */
  rake() {
    this.height.fill(0);
    this.disturbed.fill(0);
    this.dirty = true;
  }

  /** Push changes to the GPU (once per frame at most). */
  flush() {
    if (!this.dirty) return;
    for (let i = 0; i < TEX_W * TEX_H; i++) {
      const h = Math.round(128 + this.height[i] / HEIGHT_STEP);
      this.bytes[i * 2] = h < 0 ? 0 : h > 255 ? 255 : h;
      this.bytes[i * 2 + 1] = Math.round(255 * Math.min(1, this.disturbed[i]));
    }
    this.tex.needsUpdate = true;
    this.dirty = false;
  }

  /** World (x, z) → fractional texel coordinates. */
  private texel(x: number, z: number): [number, number] {
    const u = (x - (this.stake.base.x - COURT.pitWidth / 2)) / COURT.pitWidth;
    const v = (this.stake.base.z + COURT.pitLength / 2 - z) / COURT.pitLength;
    return [u * TEX_W - 0.5, v * TEX_H - 0.5];
  }

  /**
   * A round dent of radius r (meters) and depth d at (x, z), with a low rim of
   * pushed-up clay around it. Dents don't stack deeper than the deepest press.
   */
  private dent(x: number, z: number, r: number, d: number, disturb: number) {
    const [ci, cj] = this.texel(x, z);
    if (ci < -2 || cj < -2 || ci > TEX_W + 1 || cj > TEX_H + 1) return; // outside the pit
    const ri = (1.8 * r * TEX_W) / COURT.pitWidth;
    const rj = (1.8 * r * TEX_H) / COURT.pitLength;
    const i0 = Math.max(0, Math.floor(ci - ri));
    const i1 = Math.min(TEX_W - 1, Math.ceil(ci + ri));
    const j0 = Math.max(0, Math.floor(cj - rj));
    const j1 = Math.min(TEX_H - 1, Math.ceil(cj + rj));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = ((i - ci) / TEX_W) * COURT.pitWidth;
        const dz = ((j - cj) / TEX_H) * COURT.pitLength;
        const q = Math.sqrt(dx * dx + dz * dz) / r;
        const k = j * TEX_W + i;
        if (q < 1) {
          const target = -d * (1 - q * q);
          if (target < this.height[k]) this.height[k] = target;
          this.disturbed[k] = Math.max(this.disturbed[k], disturb);
        } else if (q < 1.8) {
          const rim = 0.22 * d * Math.sin(((q - 1) / 0.8) * Math.PI);
          this.height[k] = Math.min(this.height[k] + rim * 0.35, 0.004);
          this.disturbed[k] = Math.max(this.disturbed[k], disturb * 0.5 * (1.8 - q));
        }
      }
    }
    this.dirty = true;
  }

  /** The shape of a shoe pressed into the clay at this pose. */
  imprint(pose: Pose, depth: number, disturb = 0.9) {
    for (const p of BAR_POINTS) {
      const w = add(pose.position, rotate(pose.rotation, p));
      this.dent(w.x, w.z, SHOE.barWidth * 0.55, depth, disturb);
    }
  }

  /** A shallow scuff where a shoe slid from one spot to another. */
  skid(from: Vec3, to: Vec3, width = 0.05) {
    const len = Math.hypot(to.x - from.x, to.z - from.z);
    const n = Math.max(1, Math.ceil(len / 0.01));
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      this.dent(from.x + (to.x - from.x) * u, from.z + (to.z - from.z) * u, width * (1 - 0.4 * u), 0.0015, 0.55);
    }
  }
}
