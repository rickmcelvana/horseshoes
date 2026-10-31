// Golden hour sliding into night. One number, t (0 → 1), drives the sun, sky,
// fog, sky reflections, string lights, pit floodlights and fireflies.

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { COURT, FAR_STAKE, NEAR_STAKE, type Stake } from '../rules';
import { DUSK } from '../game/duskProgress';
import type { QualityProfile } from './quality';

const DEG = Math.PI / 180;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const smooth = (e0: number, e1: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return k * k * (3 - 2 * k);
};
const mixColor = (a: number, b: number, k: number) => new THREE.Color(a).lerp(new THREE.Color(b), k);

/** Sun elevation in degrees: low gold at the start, below the horizon at match point. */
const sunElevation = (t: number) => lerp(13, -6, t);
/** The sun sets in the west, off to the side of the court so nobody pitches into it. */
const SUN_AZIMUTH = new THREE.Vector2(-0.88, 0.47).normalize();

const STRAND_X = -2.4;
const STRAND_POSTS = [-2.2, 3.4, 8.8, 14.4];
const POST_HEIGHT = 2.7;

export class Dusk {
  t = 0;
  private target = 0;
  private readonly sky = new Sky();
  private readonly envSky = new Sky();
  private readonly envScene = new THREE.Scene();
  private readonly pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private bakedT = -1;
  private bakeTimer = 0;

  readonly sun = new THREE.DirectionalLight(0xffd29a, 2.6);
  private readonly hemi = new THREE.HemisphereLight(0xbfd4ff, 0x4a5a32, 1);
  private readonly lamps: THREE.SpotLight[] = [];
  private readonly lampHeads: THREE.Mesh[] = [];
  private readonly bulbs: THREE.InstancedMesh;
  private readonly bulbMat: THREE.MeshStandardMaterial;
  private readonly bulbPhase: number[] = [];
  private readonly strandLights: THREE.PointLight[] = [];
  private readonly fireflies: Fireflies;
  private time = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    quality: QualityProfile,
  ) {
    this.pmrem = new THREE.PMREMGenerator(renderer);

    for (const s of [this.sky, this.envSky]) {
      s.scale.setScalar(180);
      const u = s.material.uniforms;
      u.turbidity.value = 7;
      u.rayleigh.value = 2.2;
      u.mieCoefficient.value = 0.006;
      u.mieDirectionalG.value = 0.86;
      u.cloudCoverage.value = 0.35;
      u.cloudDensity.value = 0.35;
    }
    this.sky.position.set(0, 0, FAR_STAKE.base.z / 2);
    scene.add(this.sky);
    this.envScene.add(this.envSky);

    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.02;
    const cam = this.sun.shadow.camera;
    cam.left = -9;
    cam.right = 9;
    cam.top = 11;
    cam.bottom = -11;
    cam.near = 1;
    cam.far = 60;
    this.sun.target.position.set(0, 0, FAR_STAKE.base.z / 2);
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = new THREE.Fog(0xf0c890, 30, 95);

    // A floodlight on a pole behind each pit.
    for (const stake of [NEAR_STAKE, FAR_STAKE]) this.addLamp(stake);

    // String lights along the left side of the court.
    const { bulbs, mat, lights } = this.buildStrand();
    this.bulbs = bulbs;
    this.bulbMat = mat;
    this.strandLights = lights;

    this.fireflies = new Fireflies(scene);
    this.applyQuality(quality);
    this.apply(0);
  }

  applyQuality(q: QualityProfile) {
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.strandLights.forEach((l, i) => (l.visible = i < q.stringLights));
    for (const l of this.lamps) l.castShadow = q.lampShadows;
    this.fireflies.setCount(q.fireflies);
  }

  /** Ease toward a new dusk level (or jump there). */
  /** 0 in daylight, 1 once it's properly dark: lamps follow this. */
  get night(): number {
    return smooth(0.25, 0.75, this.t);
  }

  setTarget(t: number, immediate = false) {
    this.target = t;
    if (immediate) this.apply(t);
  }

  update(dt: number) {
    this.time += dt;
    if (Math.abs(this.target - this.t) > 1e-4) {
      // A slow fade so the change reads as time passing, not a switch.
      const step = dt * 0.12;
      this.apply(this.t + Math.max(-step, Math.min(step, this.target - this.t)));
    }
    this.bakeTimer -= dt;
    if (Math.abs(this.t - this.bakedT) > 0.02 && this.bakeTimer <= 0) this.bakeEnvironment();
    this.animateBulbs();
    this.fireflies.update(dt, smooth(DUSK.fireflies, DUSK.fireflies + 0.15, this.t));
    this.sky.material.uniforms.time.value = this.time;
  }

  private apply(t: number) {
    this.t = t;
    const el = sunElevation(t) * DEG;
    const dir = new THREE.Vector3(SUN_AZIMUTH.x * Math.cos(el), Math.sin(el), SUN_AZIMUTH.y * Math.cos(el));
    for (const s of [this.sky, this.envSky]) s.material.uniforms.sunPosition.value.copy(dir);
    this.sun.position.copy(this.sun.target.position).addScaledVector(dir, 40);

    const day = smooth(-3, 9, sunElevation(t));
    this.sun.intensity = 2.8 * day;
    this.sun.color.copy(mixColor(0xff7a3c, 0xffd8a4, smooth(-2, 12, sunElevation(t))));
    this.sun.castShadow = day > 0.05;

    this.hemi.color.copy(mixColor(0x223258, 0xc4d6ff, day));
    this.hemi.groundColor.copy(mixColor(0x12160e, 0x56643a, day));
    this.hemi.intensity = lerp(0.35, 1.0, day);

    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(mixColor(0x1b2340, 0xf2c48e, day));
    this.scene.environmentIntensity = lerp(0.25, 0.75, day);
    this.renderer.toneMappingExposure = lerp(1.45, 1.05, day);

    const night = smooth(0.25, 0.75, t);
    for (const l of this.lamps) l.intensity = 70 * night;
    for (const h of this.lampHeads) (h.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2 + 6 * night;
  }

  private bakeEnvironment() {
    this.envTarget?.dispose();
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000);
    this.scene.environment = this.envTarget.texture;
    this.bakedT = this.t;
    this.bakeTimer = 0.5;
  }

  private addLamp(stake: Stake) {
    const behind = COURT.backboardDistance + 0.6;
    const x = stake.base.x - 1.3;
    const z = stake.base.z - stake.leanDir.z * behind;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 3.1, 10), new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 0.6, metalness: 0.6 }));
    pole.position.set(x, 1.55, z);
    pole.castShadow = true;
    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.14, 0.16, 16),
      new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffe2b0, emissiveIntensity: 0.2, roughness: 0.4 }),
    );
    head.position.set(x + 0.2, 3.05, z + stake.leanDir.z * 0.2);
    const spot = new THREE.SpotLight(0xffe0b0, 0, 14, 0.62, 0.55, 1.6);
    spot.position.copy(head.position);
    spot.target.position.set(stake.base.x, 0, stake.base.z + stake.leanDir.z * 0.4);
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0005;
    this.scene.add(pole, head, spot, spot.target);
    this.lamps.push(spot);
    this.lampHeads.push(head);
  }

  private buildStrand() {
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 0.9 });
    const points: THREE.Vector3[] = [];
    for (let i = 0; i + 1 < STRAND_POSTS.length; i++) {
      const z0 = STRAND_POSTS[i];
      const z1 = STRAND_POSTS[i + 1];
      const n = Math.round((z1 - z0) / 0.45);
      for (let k = i === 0 ? 0 : 1; k <= n; k++) {
        const u = k / n;
        const sag = 0.38 * 4 * u * (1 - u);
        points.push(new THREE.Vector3(STRAND_X, POST_HEIGHT - 0.08 - sag, z0 + (z1 - z0) * u));
      }
    }
    for (const z of STRAND_POSTS) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, POST_HEIGHT, 0.09), wood);
      post.position.set(STRAND_X, POST_HEIGHT / 2, z);
      post.castShadow = true;
      this.scene.add(post);
    }
    const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x111111 }));
    this.scene.add(wire);

    const mat = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffc46b, emissiveIntensity: 0, roughness: 0.3 });
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 10, 8), mat, points.length);
    const m = new THREE.Matrix4();
    points.forEach((p, i) => {
      bulbs.setMatrixAt(i, m.makeTranslation(p.x, p.y - 0.05, p.z));
      bulbs.setColorAt(i, new THREE.Color(1, 1, 1));
      this.bulbPhase.push(Math.random() * 100);
    });
    this.scene.add(bulbs);

    // A few real lights spread along the strand; the rest is glow.
    const lights: THREE.PointLight[] = [];
    for (let i = 0; i < 4; i++) {
      const p = points[Math.round(((i + 0.5) / 4) * (points.length - 1))];
      const l = new THREE.PointLight(0xffc27a, 0, 7, 2);
      l.position.set(p.x + 0.1, p.y - 0.1, p.z);
      lights.push(l);
      this.scene.add(l);
    }
    return { bulbs, mat, lights };
  }

  /** Bulbs come on one by one past the milestone, then flicker now and then. */
  private animateBulbs() {
    const on = (this.t - DUSK.stringLightsOn) / 0.08; // >1 means all on
    const count = this.bulbs.count;
    const c = new THREE.Color();
    let lit = 0;
    for (let i = 0; i < count; i++) {
      const order = ((i * 7919) % count) / count; // scattered switch-on order
      const p = this.bulbPhase[i];
      let k = on > order ? 1 : 0;
      if (k) {
        const flicker = Math.sin(this.time * 23 + p) * Math.sin(this.time * 3.1 + p * 2);
        if (flicker > 0.93) k = 0.25;
        lit++;
      }
      this.bulbs.setColorAt(i, c.setScalar(0.25 + 0.75 * k));
    }
    this.bulbs.instanceColor!.needsUpdate = true;
    this.bulbMat.emissiveIntensity = lit ? 5 : 0;
    const share = lit / count;
    for (const l of this.strandLights) l.intensity = 2.2 * share;
  }
}

/** Little blinking lights over the lawn after the halfway mark. */
class Fireflies {
  private readonly geo = new THREE.BufferGeometry();
  private readonly points: THREE.Points;
  private readonly mat: THREE.ShaderMaterial;
  private seeds: Float32Array = new Float32Array(0);
  private n = 0;
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 300 } },
      vertexShader: /* glsl */ `
        attribute float alpha;
        varying float vAlpha;
        uniform float uScale;
        void main() {
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uScale * 0.03 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float glow = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vec3(0.85, 1.0, 0.45) * glow * 2.0, glow * vAlpha);
          gl_FragColor.rgb *= vAlpha;
        }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  setCount(n: number) {
    this.n = n;
    this.seeds = new Float32Array(n * 4).map(() => Math.random());
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(n), 1));
  }

  update(dt: number, amount: number) {
    this.time += dt;
    this.points.visible = amount > 0.01;
    if (!this.points.visible) return;
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const alpha = this.geo.getAttribute('alpha') as THREE.BufferAttribute;
    const t = this.time;
    for (let i = 0; i < this.n; i++) {
      const [a, b, c, d] = [this.seeds[i * 4], this.seeds[i * 4 + 1], this.seeds[i * 4 + 2], this.seeds[i * 4 + 3]];
      // Mostly off to the sides of the court, drifting lazily.
      const side = a < 0.5 ? -1 : 1;
      const x = side * (1.8 + b * 5) + Math.sin(t * 0.3 + c * 20) * 0.6;
      const z = -3 + d * 18 + Math.cos(t * 0.23 + a * 30) * 0.8;
      const y = 0.25 + c * 1.4 + Math.sin(t * 0.7 + b * 40) * 0.15;
      pos.setXYZ(i, x, y, z);
      const blink = Math.max(0, Math.sin(t * (0.6 + a) + d * 50));
      const visible = i < this.n * amount ? 1 : 0;
      alpha.setX(i, blink * blink * blink * visible);
    }
    pos.needsUpdate = true;
    alpha.needsUpdate = true;
  }
}
