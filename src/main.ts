import './style.css';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { COURT, IN, NEAR_STAKE } from './rules';
import { STEP, initPhysics, type ShoeSim } from './physics/sim';
import { GRIPS, LAUNCH, type FoulLine, type Grip, type Stance } from './physics/throw';
import { SwingInput, type SwingResult } from './input/swing';
import { buildCourt, buildLights } from './render/court';
import { createShoeMesh, SHOE_COLORS } from './render/shoeMesh';
import { CameraRig } from './render/cameraRig';
import { GhostArc } from './render/ghostArc';
import { Practice, SET_SIZE, describeResult, type ShoeResult } from './game/practice';
import { applyLaunch, buildTuningPanel, loadSettings, saveSettings } from './game/tuning';
import { clang, thud, unlockAudio } from './audio/sfx';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

async function start() {
  await initPhysics();

  const settings = loadSettings();
  applyLaunch(settings);
  const practice = new Practice(settings.sim);

  // Renderer and scene.
  const canvas = $<HTMLCanvasElement>('#view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  // Something for the steel to reflect until the real dusk sky arrives in Phase 2.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  buildLights(scene);
  scene.add(buildCourt());
  const rig = new CameraRig();
  const ghost = new GhostArc();
  scene.add(ghost.line);

  const meshes = new Map<number, THREE.Object3D>();
  const meshFor = (s: ShoeSim) => {
    let m = meshes.get(s.id);
    if (!m) {
      m = createShoeMesh(s.owner);
      meshes.set(s.id, m);
      scene.add(m);
    }
    return m;
  };
  const dropMesh = (s: ShoeSim) => {
    const m = meshes.get(s.id);
    if (m) scene.remove(m);
    meshes.delete(s.id);
  };

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    rig.resize(w, h);
  };
  window.addEventListener('resize', resize);
  resize();

  // UI.
  const toast = $('#toast');
  const hint = $('#hint');
  const stats = $('#stats');
  const setList = $('#set');
  let toastTimer = 0;

  const gripBox = $('#grips');
  for (const [key, g] of Object.entries(GRIPS)) {
    const b = document.createElement('button');
    b.dataset.grip = key;
    b.textContent = g.label;
    b.setAttribute('role', 'radio');
    gripBox.append(b);
  }

  const refreshControls = () => {
    gripBox.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.grip === practice.grip)));
    $('#stance')
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((b) => {
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(b.dataset.stance === practice.stance));
        b.disabled = practice.stanceLocked && b.dataset.stance !== practice.stance;
        b.title = practice.stanceLocked ? 'Both shoes of a pair are pitched from the same platform' : '';
      });
    $('#line')
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((b) => {
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(b.dataset.line === practice.line));
      });
    $('#aids').setAttribute('aria-pressed', String(settings.aids));
    ghost.line.visible = settings.aids && practice.phase === 'aim';
    ghost.update(practice.grip, practice.stance, practice.line);
    const foul = practice.line === 'full' ? COURT.foulLineFull : COURT.foulLineShort;
    rig.setAim(practice.stance, NEAR_STAKE.base.z + foul - LAUNCH.reachPastFoulLine);
  };

  const refreshStats = () => {
    const s = practice.stats;
    const pct = (n: number) => (s.thrown ? Math.round((100 * n) / s.thrown) : 0);
    const n = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;
    stats.textContent = `${n(s.thrown, 'shoe')} · ${n(s.ringers, 'ringer')} (${pct(s.ringers)}%) · ${s.inCount} in count · ${n(s.fouls, 'foul')}`;

    setList.replaceChildren();
    const live = practice.set.filter((sh) => practice.sim.shoes.includes(sh));
    const measures = practice.measureSet();
    live.forEach((sh, i) => {
      if (sh === practice.set[practice.set.length - 1] && practice.phase === 'flight') return;
      const m = measures[i];
      const el = document.createElement('div');
      el.className = 'shoe';
      el.style.color = `#${SHOE_COLORS[sh.owner].toString(16).padStart(6, '0')}`;
      const label = m.ringer ? 'ringer' : m.distance <= 6 * IN ? `${(m.distance / IN).toFixed(1)} in` : 'out';
      el.innerHTML = `<span>${label}</span>`;
      setList.append(el);
    });
    const left = SET_SIZE - practice.set.length;
    if (practice.set.length && left === 0 && practice.phase !== 'flight') {
      const el = document.createElement('div');
      el.className = 'shoe';
      el.innerHTML = '<span>next shoe clears the pit</span>';
      setList.append(el);
    }
  };

  const showToast = (r: ShoeResult, swing: SwingResult | null) => {
    const d = describeResult(r);
    toast.className = d.tone;
    toast.querySelector('.title')!.textContent = d.title;
    toast.querySelector('.detail')!.textContent = d.detail;
    const i = r.input;
    const pull = i.aim === 0 ? 'straight' : `${i.aim < 0 ? 'left' : 'right'} ${Math.abs(i.aim).toFixed(2)}`;
    toast.querySelector('.readout')!.textContent = swing
      ? `power ${(i.power * 100).toFixed(1)}% · arc ${i.release >= 0 ? '+' : ''}${i.release.toFixed(2)} · pull ${pull} · wobble ${i.wobble.toFixed(2)}`
      : '';
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.add('hidden'), 3200);
  };

  // Input.
  const swing = new SwingInput(canvas, settings.swing);
  const trail = $('#trail');
  const poly = trail.querySelector('polyline')!;
  swing.onTrail = (pts, phase) => {
    poly.setAttribute('points', pts.map((p) => `${p.x},${p.y}`).join(' '));
    trail.classList.toggle('forward', phase === 'forward');
  };

  let lastSwing: SwingResult | null = null;
  swing.onThrow = (r) => {
    const shoe = practice.pitch(r);
    if (!shoe) return;
    lastSwing = r;
    meshFor(shoe);
    rig.go('flight');
    hint.classList.add('hidden');
    toast.classList.add('hidden');
    refreshControls();
    refreshStats();
  };

  let resultAt = 0;
  practice.onResult = (r) => {
    showToast(r, lastSwing);
    rig.go('pit');
    swing.enabled = false;
    resultAt = performance.now();
    refreshControls();
    refreshStats();
  };
  practice.onRemoved = dropMesh;

  const backToAim = () => {
    if (practice.phase !== 'result') return;
    practice.ready();
    rig.go('aim');
    // Short pause so the tap that skips the result doesn't also start a swing.
    window.setTimeout(() => (swing.enabled = true), 250);
    refreshControls();
  };
  canvas.addEventListener('pointerdown', () => {
    unlockAudio();
    if (practice.phase === 'result' && performance.now() - resultAt > 400) backToAim();
  });

  gripBox.addEventListener('click', (e) => {
    const g = (e.target as HTMLElement).closest('button')?.dataset.grip as Grip | undefined;
    if (g) practice.grip = g;
    refreshControls();
  });
  $('#stance').addEventListener('click', (e) => {
    const s = (e.target as HTMLElement).closest('button')?.dataset.stance as Stance | undefined;
    if (s) practice.setStance(s);
    refreshControls();
  });
  $('#line').addEventListener('click', (e) => {
    const l = (e.target as HTMLElement).closest('button')?.dataset.line as FoulLine | undefined;
    if (l) practice.line = l;
    refreshControls();
  });
  $('#aids').addEventListener('click', () => {
    settings.aids = !settings.aids;
    saveSettings(settings);
    refreshControls();
  });
  $('#clear').addEventListener('click', () => {
    practice.clearPit();
    if (practice.phase === 'result') backToAim();
    refreshStats();
    refreshControls();
  });

  // Sounds from the physics.
  const hookSounds = () => {
    practice.sim.onImpact = (e) => {
      const v = e.speed;
      if (e.kind === 'stake' && v > 0.3) clang(v);
      else if (e.kind === 'shoe' && v > 0.3) clang(v * 0.4);
      else if (e.kind === 'clay' && v > 0.5) thud(v);
      else if ((e.kind === 'ground' || e.kind === 'backboard') && v > 0.5) thud(v, e.kind === 'backboard');
    };
  };
  hookSounds();

  const gui = buildTuningPanel(settings, {
    rebuild: () => {
      practice.rebuild(settings.sim);
      for (const id of [...meshes.keys()]) {
        const m = meshes.get(id)!;
        scene.remove(m);
        meshes.delete(id);
      }
      hookSounds();
      swing.enabled = true;
      rig.go('aim');
      refreshStats();
      refreshControls();
    },
    changed: () => {},
  });
  if (!new URLSearchParams(location.search).has('tune')) gui.hide();
  $('#tune').addEventListener('click', () => (gui._hidden ? gui.show() : gui.hide()));

  refreshControls();
  refreshStats();

  // Stake cam: a zoomed inset of the target pit while aiming, since the stake is
  // only a few pixels wide from 40 feet on a phone.
  const inset = new THREE.PerspectiveCamera(5, 4 / 3, 0.5, 60);
  const insetFrame = $('#inset');
  const drawInset = () => {
    const show = practice.phase === 'aim';
    insetFrame.classList.toggle('hidden', !show);
    if (!show) return;
    const r = insetFrame.getBoundingClientRect();
    const box = canvas.getBoundingClientRect();
    const x = r.left - box.left;
    const y = box.bottom - r.bottom;
    inset.aspect = r.width / r.height;
    inset.updateProjectionMatrix();
    inset.position.copy(rig.camera.position);
    inset.lookAt(NEAR_STAKE.base.x, 0.16, NEAR_STAKE.base.z);
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, r.width, r.height);
    renderer.setViewport(x, y, r.width, r.height);
    ghost.line.visible = false;
    renderer.render(scene, inset);
    ghost.line.visible = settings.aids;
    renderer.setScissorTest(false);
  };

  // Main loop: physics at a fixed 240 Hz, rendering at display rate.
  let last = performance.now();
  let acc = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 48) {
      practice.step();
      acc -= STEP;
      steps++;
    }
    if (steps === 48) acc = 0;

    let flying: THREE.Vector3 | null = null;
    for (const s of practice.sim.shoes) {
      const m = meshFor(s);
      const t = s.body.translation();
      const q = s.body.rotation();
      m.position.set(t.x, t.y, t.z);
      m.quaternion.set(q.x, q.y, q.z, q.w);
      if (s === practice.set[practice.set.length - 1]) flying = m.position;
    }
    if (practice.phase === 'result' && now - resultAt > 3500) backToAim();
    rig.update(dt, practice.phase === 'flight' ? flying : null);
    renderer.setViewport(0, 0, canvas.clientWidth, canvas.clientHeight);
    renderer.setScissorTest(false);
    renderer.render(scene, rig.camera);
    drawInset();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  $('#loading').classList.add('done');
}

start().catch((err) => {
  console.error(err);
  $('#loading').textContent = 'Something went wrong loading the game. Try reloading.';
});
