import './style.css';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { IN, type Player } from './rules';
import { STEP, initPhysics, type ShoeSim } from './physics/sim';
import { GRIPS, type FoulLine, type Grip, type Stance } from './physics/throw';
import { SwingInput, type SwingResult } from './input/swing';
import { buildCourt, buildLights } from './render/court';
import { createShoeMesh } from './render/shoeMesh';
import { CameraRig } from './render/cameraRig';
import { GhostArc } from './render/ghostArc';
import { Practice, SET_SIZE, describeResult } from './game/practice';
import { MODE_INFO, MatchFlow, type MatchSetup, type SavedMatch } from './game/matchFlow';
import { ThrowSession, type Controller, type ShoeResult } from './game/session';
import { applyLaunch, buildTuningPanel, loadSettings, saveSettings } from './game/tuning';
import { clang, thud, unlockAudio } from './audio/sfx';
import { confirmLeave, hideOverlay, playerColor, showGameOver, showHandoff, showInning, showMenu, showSetup, showToss } from './ui/overlay';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const SAVE_KEY = 'dusk.match.v1';
const PLAYERS_KEY = 'dusk.setup.v1';

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the match just won't survive a reload.
  }
}

async function start() {
  await initPhysics();

  const settings = loadSettings();
  applyLaunch(settings);
  const session = new ThrowSession(settings.sim);

  // Renderer and scene.
  const canvas = $<HTMLCanvasElement>('#view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
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
  session.onRemoved = (s) => {
    const m = meshes.get(s.id);
    if (m) scene.remove(m);
    meshes.delete(s.id);
  };

  const resize = () => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    rig.resize(canvas.clientWidth, canvas.clientHeight);
  };
  window.addEventListener('resize', resize);
  resize();

  // Sounds from the physics.
  session.sim.onImpact = (e) => {
    const v = e.speed;
    if (e.kind === 'stake' && v > 0.3) clang(v);
    else if (e.kind === 'shoe' && v > 0.3) clang(v * 0.4);
    else if (e.kind === 'clay' && v > 0.5) thud(v);
    else if ((e.kind === 'ground' || e.kind === 'backboard') && v > 0.5) thud(v, e.kind === 'backboard');
  };

  // ── Modes ───────────────────────────────────────────────────────────

  let mode: 'menu' | 'practice' | 'match' = 'menu';
  let ctl: Controller = new Practice(session);
  let flow: MatchFlow | null = null;
  let shownPhase = '';
  let lastSetup: MatchSetup = readJson<MatchSetup>(PLAYERS_KEY) ?? {
    mode: 'cancellation',
    players: [
      { name: 'Player 1', line: 'full' },
      { name: 'Player 2', line: 'full' },
    ],
  };

  const attach = (c: Controller) => {
    ctl = c;
    c.onResult = onResult;
    c.onChange = refresh;
    shownPhase = '';
    refresh();
  };

  const goMenu = () => {
    mode = 'menu';
    hint.classList.add('hidden');
    toast.classList.add('hidden');
    flow = null;
    session.clear();
    attach(new Practice(session));
    showMenu({
      saved: readJson<SavedMatch>(SAVE_KEY),
      practice: startPractice,
      newMatch: () => showSetup(lastSetup, { back: goMenu, start: toss }),
      resume: () => {
        const saved = readJson<SavedMatch>(SAVE_KEY);
        if (saved) startMatch(saved.setup, saved);
      },
    });
    refresh();
  };

  const startPractice = () => {
    mode = 'practice';
    flow = null;
    session.clear();
    hideOverlay();
    attach(new Practice(session));
    hint.classList.remove('hidden');
  };

  const toss = (setup: MatchSetup) => {
    lastSetup = setup;
    writeJson(PLAYERS_KEY, setup);
    const winner: Player = Math.random() < 0.5 ? 0 : 1;
    showToss(setup, winner, (first) => startMatch(setup, first));
  };

  const startMatch = (setup: MatchSetup, opening: Player | SavedMatch) => {
    mode = 'match';
    toast.classList.add('hidden');
    session.clear();
    flow = new MatchFlow(session, setup, opening);
    flow.onInning = (saved) => writeJson(SAVE_KEY, saved.state.winner === null ? saved : null);
    writeJson(SAVE_KEY, flow.save());
    attach(flow);
    if (flow.state.innings.length === 0) hint.classList.remove('hidden');
  };

  // ── HUD ─────────────────────────────────────────────────────────────

  const toast = $('#toast');
  const hint = $('#hint');
  const stats = $('#stats');
  const brandSub = $('.brand span');
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

  const nameChip = (p: Player, text: string, current = false) => {
    const s = document.createElement('span');
    s.className = `name${current ? ' current' : ''}`;
    s.style.setProperty('--c', playerColor(p));
    s.textContent = text;
    return s;
  };

  const refreshTop = () => {
    if (mode === 'match' && flow) {
      brandSub.textContent = MODE_INFO[flow.setup.mode].label.toLowerCase();
      const [a, b] = flow.state.scores;
      const pitching = ['aim', 'flight', 'result', 'handoff'].includes(flow.phase) ? flow.pitcher : null;
      const cfg = flow.state.config;
      const progress =
        cfg.shoeLimit !== null ? `shoe ${Math.min(cfg.shoeLimit, flow.state.innings.length * 2 + 2)} of ${cfg.shoeLimit}` : `to ${cfg.pointLimit}`;
      stats.replaceChildren(
        nameChip(0, `${flow.name(0)} ${a}`, pitching === 0),
        ' · ',
        nameChip(1, `${flow.name(1)} ${b}`, pitching === 1),
        ` · inning ${flow.inningNumber} · ${progress}`,
      );
    } else if (ctl instanceof Practice) {
      brandSub.textContent = mode === 'menu' ? '' : 'practice';
      const s = ctl.stats;
      const pct = (n: number) => (s.thrown ? Math.round((100 * n) / s.thrown) : 0);
      const n = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;
      stats.textContent =
        mode === 'menu' ? '' : `${n(s.thrown, 'shoe')} · ${n(s.ringers, 'ringer')} (${pct(s.ringers)}%) · ${s.inCount} in count · ${n(s.fouls, 'foul')}`;
    }
  };

  const refreshSet = () => {
    setList.replaceChildren();
    const inFlight = ctl.phase === 'flight';
    const shoes = ctl.shoesInPit();
    shoes.forEach((sh, i) => {
      if (inFlight && i === shoes.length - 1) return;
      const m = session.measure(sh);
      const el = document.createElement('div');
      el.className = 'shoe';
      el.style.color = playerColor(sh.owner);
      const label = m.ringer ? 'ringer' : m.distance <= 6 * IN ? `${(m.distance / IN).toFixed(1)} in` : 'out';
      el.innerHTML = `<span>${label}</span>`;
      setList.append(el);
    });
    if (ctl instanceof Practice && ctl.set.length === SET_SIZE && !inFlight) {
      const el = document.createElement('div');
      el.className = 'shoe';
      el.innerHTML = '<span>next shoe clears the pit</span>';
      setList.append(el);
    }
  };

  const refreshControls = () => {
    gripBox.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.grip === ctl.grip)));
    $('#stance')
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((b) => {
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(b.dataset.stance === ctl.stance));
        b.disabled = ctl.stanceLocked && b.dataset.stance !== ctl.stance;
        b.title = ctl.stanceLocked ? 'Both shoes of a pair are pitched from the same platform' : '';
      });
    $('#line')
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((b) => {
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(b.dataset.line === ctl.line));
      });
    $('#line').hidden = mode === 'match';
    $('#clear').hidden = mode !== 'practice';
    $('#controls').classList.toggle('hidden', mode === 'menu');
    $('#aids').setAttribute('aria-pressed', String(settings.aids));
  };

  const refreshOverlay = () => {
    if (mode !== 'match' || !flow) return;
    const key = `${flow.phase}:${flow.inningNumber}:${flow.shoeIndex}`;
    if (key === shownPhase) return;
    const prev = shownPhase;
    shownPhase = key;
    const f = flow;
    if (f.phase === 'handoff') showHandoff(f, !prev.startsWith('handoff') && f.shoeIndex === 0, () => f.acceptHandoff());
    else if (f.phase === 'inning') showInning(f, () => f.nextInning());
    else if (f.phase === 'over') {
      writeJson(SAVE_KEY, null);
      showGameOver(f, { menu: goMenu, rematch: () => toss(f.setup) });
    } else hideOverlay();
  };

  function refresh() {
    const p = ctl.phase;
    swing.enabled = mode !== 'menu' && p === 'aim';
    rig.setAim(ctl.stance, ctl.target, ctl.line);
    rig.go(p === 'flight' ? 'flight' : p === 'result' || p === 'inning' || p === 'over' ? 'pit' : 'aim');
    ghost.update(ctl.grip, ctl.stance, ctl.line, ctl.target);
    ghost.line.visible = settings.aids && (p === 'aim' || p === 'handoff') && mode !== 'menu';
    refreshControls();
    refreshTop();
    refreshSet();
    refreshOverlay();
  }

  const showToast = (r: ShoeResult) => {
    const d = describeResult(r);
    toast.className = d.tone;
    toast.querySelector('.title')!.textContent = d.title;
    toast.querySelector('.detail')!.textContent = d.detail;
    const i = r.input;
    const pull = i.aim === 0 ? 'straight' : `${i.aim < 0 ? 'left' : 'right'} ${Math.abs(i.aim).toFixed(2)}`;
    toast.querySelector('.readout')!.textContent = `power ${(i.power * 100).toFixed(1)}% · arc ${i.release >= 0 ? '+' : ''}${i.release.toFixed(2)} · pull ${pull} · wobble ${i.wobble.toFixed(2)}`;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.add('hidden'), 3200);
  };

  let resultAt = 0;
  function onResult(r: ShoeResult) {
    showToast(r);
    resultAt = performance.now();
    refresh();
  }

  const finishResult = () => {
    if (ctl.phase !== 'result') return;
    toast.classList.add('hidden');
    ctl.ready();
  };

  // ── Input ───────────────────────────────────────────────────────────

  const swing = new SwingInput(canvas, settings.swing);
  const trail = $('#trail');
  const poly = trail.querySelector('polyline')!;
  swing.onTrail = (pts, phase) => {
    poly.setAttribute('points', pts.map((p) => `${p.x},${p.y}`).join(' '));
    trail.classList.toggle('forward', phase === 'forward');
  };
  swing.onThrow = (r: SwingResult) => {
    const shoe = ctl.pitch(r);
    if (!shoe) return;
    meshFor(shoe);
    hint.classList.add('hidden');
    toast.classList.add('hidden');
  };

  canvas.addEventListener('pointerdown', () => {
    unlockAudio();
    // A tap during the result skips ahead; the short delay stops it from also starting a swing.
    if (ctl.phase === 'result' && performance.now() - resultAt > 400) {
      swing.enabled = false;
      finishResult();
      window.setTimeout(refresh, 250);
    }
  });
  document.addEventListener('pointerdown', unlockAudio, { once: true });

  gripBox.addEventListener('click', (e) => {
    const g = (e.target as HTMLElement).closest('button')?.dataset.grip as Grip | undefined;
    if (g) ctl.grip = g;
    refresh();
  });
  $('#stance').addEventListener('click', (e) => {
    const s = (e.target as HTMLElement).closest('button')?.dataset.stance as Stance | undefined;
    if (s) ctl.setStance(s);
    refresh();
  });
  $('#line').addEventListener('click', (e) => {
    const l = (e.target as HTMLElement).closest('button')?.dataset.line as FoulLine | undefined;
    if (l && ctl instanceof Practice) ctl.line = l;
    refresh();
  });
  $('#aids').addEventListener('click', () => {
    settings.aids = !settings.aids;
    saveSettings(settings);
    refresh();
  });
  $('#clear').addEventListener('click', () => {
    if (ctl instanceof Practice) ctl.clearPit();
    toast.classList.add('hidden');
  });
  $('#menu').addEventListener('click', () => {
    if (mode === 'match' && flow && flow.phase !== 'over') {
      const back = () => {
        shownPhase = '';
        hideOverlay();
        refresh();
      };
      confirmLeave(goMenu, back);
    } else goMenu();
  });

  const gui = buildTuningPanel(settings, {
    rebuild: () => {
      session.rebuild(settings.sim);
      if (flow) flow.restartInning();
      else if (ctl instanceof Practice) ctl.clearPit();
      refresh();
    },
    changed: () => {},
  });
  if (!new URLSearchParams(location.search).has('tune')) gui.hide();
  $('#tune').addEventListener('click', () => (gui._hidden ? gui.show() : gui.hide()));

  // Stake cam: a zoomed inset of the target pit while aiming, since the stake is
  // only a few pixels wide from 40 feet on a phone.
  const inset = new THREE.PerspectiveCamera(5, 4 / 3, 0.5, 60);
  const insetFrame = $('#inset');
  const drawInset = () => {
    const show = mode !== 'menu' && ctl.phase === 'aim';
    insetFrame.classList.toggle('hidden', !show);
    if (!show) return;
    const r = insetFrame.getBoundingClientRect();
    const box = canvas.getBoundingClientRect();
    const x = r.left - box.left;
    const y = box.bottom - r.bottom;
    inset.aspect = r.width / r.height;
    inset.updateProjectionMatrix();
    inset.position.copy(rig.camera.position);
    const t = ctl.target.base;
    inset.lookAt(t.x, 0.16, t.z);
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, r.width, r.height);
    renderer.setViewport(x, y, r.width, r.height);
    const ghostVisible = ghost.line.visible;
    ghost.line.visible = false;
    renderer.render(scene, inset);
    ghost.line.visible = ghostVisible;
    renderer.setScissorTest(false);
  };

  // ── Main loop: physics at a fixed 240 Hz, rendering at display rate ──

  let last = performance.now();
  let acc = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 48) {
      session.step();
      acc -= STEP;
      steps++;
    }
    if (steps === 48) acc = 0;

    let flying: THREE.Vector3 | null = null;
    const pit = ctl.shoesInPit();
    for (const s of session.sim.shoes) {
      const m = meshFor(s);
      const t = s.body.translation();
      const q = s.body.rotation();
      m.position.set(t.x, t.y, t.z);
      m.quaternion.set(q.x, q.y, q.z, q.w);
      if (s === pit[pit.length - 1]) flying = m.position;
    }
    if (ctl.phase === 'result' && now - resultAt > 3500) finishResult();
    rig.update(dt, ctl.phase === 'flight' ? flying : null);
    renderer.setViewport(0, 0, canvas.clientWidth, canvas.clientHeight);
    renderer.setScissorTest(false);
    renderer.render(scene, rig.camera);
    drawInset();
    requestAnimationFrame(frame);
  };

  // Read-only peek for the browser smoke test.
  Object.assign(window, {
    __dusk: {
      get phase() {
        return `${mode}:${ctl.phase}`;
      },
      get shoes() {
        return ctl.shoesInPit().length;
      },
    },
  });

  goMenu();
  requestAnimationFrame(frame);
  $('#loading').classList.add('done');
}

start().catch((err) => {
  console.error(err);
  $('#loading').textContent = 'Something went wrong loading the game. Try reloading.';
});
