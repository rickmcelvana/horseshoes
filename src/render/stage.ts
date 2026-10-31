// Everything on screen: renderer, scene, post-processing, quality tiers, and
// the stake-cam inset. main.ts owns the game; this owns the picture.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FAR_STAKE, NEAR_STAKE, type Stake } from '../rules';
import type { ShoeSim } from '../physics/sim';
import { buildCourt } from './court';
import { createShoeMesh } from './shoeMesh';
import { CameraRig } from './cameraRig';
import { GhostArc } from './ghostArc';
import { Dusk } from './dusk';
import { ClayPit } from './clayPit';
import { Chalkboard } from './chalkboard';
import { CloseCall } from './closeCall';
import { createMaterials, type Materials } from './materials';
import { FrameMonitor, PROFILES, guessTier, lowerTier, targetFps, type QualityProfile, type Tier, type TierSetting } from './quality';

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig = new CameraRig();
  readonly ghost = new GhostArc();
  readonly dusk: Dusk;
  readonly pits: [ClayPit, ClayPit];
  readonly boards: [Chalkboard, Chalkboard];
  readonly closeCall: CloseCall;
  quality: QualityProfile;
  /** Called when auto quality steps down, so the UI can mention it. */
  onQualityChange: ((q: QualityProfile) => void) | null = null;
  private readonly mats: Materials;
  private readonly meshes = new Map<number, THREE.Object3D>();
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly monitor = new FrameMonitor(targetFps());
  private readonly inset = new THREE.PerspectiveCamera(5, 4 / 3, 0.5, 60);
  private readonly court: THREE.Group;
  private auto: boolean;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    tier: TierSetting,
    private readonly insetFrame: HTMLElement,
    measureLabel: HTMLElement,
  ) {
    this.auto = tier === 'auto';
    this.quality = PROFILES[tier === 'auto' ? guessTier() : tier];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.AgXToneMapping;

    this.mats = createMaterials(this.quality.anisotropy);
    this.dusk = new Dusk(this.scene, this.renderer, this.quality);
    this.court = buildCourt(this.mats);
    this.pits = [new ClayPit(NEAR_STAKE, this.mats.clay), new ClayPit(FAR_STAKE, this.mats.clay)];
    this.boards = [new Chalkboard(NEAR_STAKE, this.mats), new Chalkboard(FAR_STAKE, this.mats)];
    this.closeCall = new CloseCall(measureLabel);
    this.scene.add(this.court, this.ghost.line, this.closeCall.group, ...this.pits.map((p) => p.mesh), ...this.boards.map((b) => b.group));

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.rig.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.4, 1.05);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.applyQuality();
  }

  pitFor(stake: Stake): ClayPit {
    return stake === NEAR_STAKE ? this.pits[0] : this.pits[1];
  }

  boardFor(stake: Stake): Chalkboard {
    return stake === NEAR_STAKE ? this.boards[0] : this.boards[1];
  }

  setTier(t: TierSetting) {
    this.auto = t === 'auto';
    this.quality = PROFILES[t === 'auto' ? guessTier() : t];
    this.applyQuality();
  }

  get tier(): Tier {
    return this.quality.tier;
  }

  get fps(): number {
    return this.monitor.fps;
  }

  private applyQuality() {
    const q = this.quality;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio));
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio));
    this.bloom.enabled = q.bloom;
    this.dusk.applyQuality(q);
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.rig.resize(w, h);
  }

  /** Keep a mesh in step with each simulated shoe. */
  syncShoes(shoes: ShoeSim[]) {
    for (const s of shoes) {
      let m = this.meshes.get(s.id);
      if (!m) {
        m = createShoeMesh(s.owner);
        this.meshes.set(s.id, m);
        this.scene.add(m);
      }
      const t = s.body.translation();
      const q = s.body.rotation();
      m.position.set(t.x, t.y, t.z);
      m.quaternion.set(q.x, q.y, q.z, q.w);
    }
  }

  dropShoe(s: ShoeSim) {
    const m = this.meshes.get(s.id);
    if (m) this.scene.remove(m);
    this.meshes.delete(s.id);
  }

  meshOf(s: ShoeSim): THREE.Object3D | undefined {
    return this.meshes.get(s.id);
  }

  /** Draw a frame. `insetTarget` shows the stake cam aimed at that stake. */
  render(dt: number, insetTarget: Stake | null) {
    if (this.monitor.tick(dt) && this.auto) {
      const lower = lowerTier(this.quality.tier);
      if (lower) {
        this.quality = PROFILES[lower];
        this.applyQuality();
        this.onQualityChange?.(this.quality);
      }
    }
    this.dusk.update(dt);
    for (const b of this.boards) b.setNight(this.dusk.night, this.quality.tier !== 'low');
    for (const p of this.pits) p.flush();
    for (const b of this.boards) b.update(dt);

    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.setScissorTest(false);
    if (this.quality.bloom) this.composer.render(dt);
    else this.renderer.render(this.scene, this.rig.camera);

    this.insetFrame.classList.toggle('hidden', !insetTarget);
    if (insetTarget) this.drawInset(insetTarget);
  }

  private drawInset(target: Stake) {
    const r = this.insetFrame.getBoundingClientRect();
    const box = this.canvas.getBoundingClientRect();
    const x = r.left - box.left;
    const y = box.bottom - r.bottom;
    this.inset.aspect = r.width / r.height;
    this.inset.updateProjectionMatrix();
    this.inset.position.copy(this.rig.camera.position);
    this.inset.lookAt(target.base.x, 0.16, target.base.z);
    const ghostVisible = this.ghost.line.visible;
    this.ghost.line.visible = false;
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(x, y, r.width, r.height);
    this.renderer.setViewport(x, y, r.width, r.height);
    this.renderer.render(this.scene, this.inset);
    this.renderer.setScissorTest(false);
    this.ghost.line.visible = ghostVisible;
  }
}
