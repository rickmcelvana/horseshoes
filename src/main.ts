import './style.css';
import * as THREE from 'three';
import { FAR_STAKE, IN, NEAR_STAKE, type Player, type Pose, type Stake, stakeAxisAt } from './rules';
import { STEP, initPhysics, type ShoeSim } from './physics/sim';
import { GRIPS, type FoulLine, type Grip, type Stance } from './physics/throw';
import { SwingInput, type SwingResult } from './input/swing';
import { Stage } from './render/stage';
import { boardPlacement, type BoardState } from './render/chalkboard';
import { closeCallKind, closeCallLabel } from './render/closeCall';
import { Practice, SET_SIZE, describeResult } from './game/practice';
import { matchDusk, practiceDusk } from './game/duskProgress';
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

  // Rendering.
  const canvas = $<HTMLCanvasElement>('#view');
  const stage = new Stage(canvas, settings.look.quality, $('#inset'), $('#measure'));
  const { rig, ghost } = stage;
  window.addEventListener('resize', () => stage.resize());

  // Clay keeps marks: a dent and a scuff where a shoe landed and slid, and its
  // imprint when it's picked up.
  const lastPoses = new Map<number, Pose>();
  session.onRemoved = (s, pose) => {
    stage.dropShoe(s);
    lastPoses.set(s.id, pose);
    stage.pitFor(s.target).imprint(pose, s.plugged ? 0.012 : 0.004);
  };
  const markLanding = (s: ShoeSim) => {
    const l = s.landing;
    if (!l) return;
    const rest = session.sim.shoes.includes(s) ? s.body.translation() : lastPoses.get(s.id)?.position;
    if (!rest) return;
    const pit = stage.pitFor(s.target);
    if (Math.hypot(rest.x - l.position.x, rest.z - l.position.z) > 0.05) {
      const depth = Math.min(0.008, 0.002 + Math.max(0, -l.velocity.y) * 0.0012);
      pit.imprint({ position: l.position, rotation: l.rotation }, depth, 0.8);
      pit.skid(l.position, rest);
    }
  };

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

  const rakePits = () => stage.pits.forEach((p) => p.rake());

  const goMenu = () => {
    mode = 'menu';
    endCloseCall(false);
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
    rakePits();
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
    rakePits();
    flow = new MatchFlow(session, setup, opening);
    flow.onInning = (saved) => writeJson(SAVE_KEY, saved.state.winner === null ? saved : null);
    writeJson(SAVE_KEY, flow.save());
    attach(flow);
    stage.dusk.setTarget(duskTarget(), true);
    updateBoards(false);
    if (flow.state.innings.length === 0) hint.classList.remove('hidden');
  };

  // ── Dusk and chalkboards ────────────────────────────────────────────

  const duskTarget = () => {
    if (!settings.look.autoTime) return settings.look.timeOfDay;
    if (mode === 'match' && flow) return matchDusk(flow.state);
    if (mode === 'practice' && ctl instanceof Practice) return practiceDusk(ctl.stats.thrown);
    return 0.12;
  };

  let boardKey = '';
  const updateBoards = (animate: boolean) => {
    let state: BoardState;
    if (mode === 'match' && flow) {
      const f = flow;
      const cfg = f.state.config;
      const live = (i: (typeof f.state.innings)[number], p: Player) =>
        cfg.scoring === 'count-all' ? i.score.ringers[p] > 0 : i.score.ringers[p] > i.score.ringers[p === 0 ? 1 : 0];
      state = {
        title: MODE_INFO[f.setup.mode].label,
        footer: cfg.pointLimit !== null ? `Inning ${f.inningNumber} · first to ${cfg.pointLimit}` : `Inning ${f.inningNumber} · ${cfg.shoeLimit} shoes`,
        rows: ([0, 1] as Player[]).map((p) => ({
          name: f.name(p),
          color: playerColor(p),
          innings: f.state.innings.map((i) => ({ points: i.score.points[p], ringer: live(i, p) })),
        })),
      };
    } else if (ctl instanceof Practice && mode === 'practice') {
      const hist = ctl.history;
      state = {
        title: 'Practice',
        footer: `${ctl.stats.thrown} shoes`,
        rows: [
          { name: 'Ringers', color: '#ffd36b', innings: hist.map((h) => ({ points: h === 'ringer' ? 1 : 0, ringer: h === 'ringer' })) },
          { name: 'In count', color: '#b8e07a', innings: hist.map((h) => ({ points: h === 'count' ? 1 : 0, ringer: false })) },
        ],
      };
    } else {
      state = { title: 'Dusk at the Pits', footer: 'Tonight: horseshoes', rows: [] };
    }
    const key = JSON.stringify(state);
    if (key === boardKey) return;
    boardKey = key;
    for (const b of stage.boards) b.set(state, animate);
  };

  /** A camera shot of the chalkboard at one end. */
  const frameBoard = (stake: Stake) => {
    const { position, facing } = boardPlacement(stake);
    const normal = new THREE.Vector3(-Math.sin(0.35), 0, facing * Math.cos(0.35));
    // Far enough back that the whole board fits a phone held upright; aimed a little
    // high so the board sits below the inning card.
    rig.frame(position.clone().addScaledVector(normal, 3).add(new THREE.Vector3(0, 0.05, 0)), position.clone().add(new THREE.Vector3(0, 0.14, 0)), 2.5);
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
    if (!stage.closeCall.active) {
      if (p === 'inning' && flow?.lastInning) frameBoard(flow.lastInning.number % 2 === 1 ? NEAR_STAKE : FAR_STAKE);
      else rig.go(p === 'flight' ? 'flight' : p === 'result' || p === 'over' ? 'pit' : 'aim');
    }
    stage.dusk.setTarget(duskTarget());
    updateBoards(true);
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
  let pendingToast: ShoeResult | null = null;
  function onResult(r: ShoeResult) {
    markLanding(r.shoe);
    resultAt = performance.now();
    // Close calls get measured on camera before the result card.
    const kind = closeCallKind(r.measure, r.foul);
    if (kind) {
      const label = closeCallLabel(kind, r.measure);
      stage.closeCall.setLabel(label.text, label.good);
      stage.closeCall.start(kind, r.measure, stakeAxisAt(r.shoe.target, r.measure.straightedge.a.y), rig.camera.position);
      rig.frame(stage.closeCall.cameraPos, stage.closeCall.cameraLook, 3.5);
      pendingToast = r;
    } else {
      showToast(r);
    }
    refresh();
  }

  /** End the close-call shot (early or on time) and show the result card. */
  function endCloseCall(showResult = true) {
    if (!stage.closeCall.active) return;
    stage.closeCall.stop();
    if (pendingToast && showResult) showToast(pendingToast);
    pendingToast = null;
    resultAt = performance.now();
    rig.go('pit');
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
    hint.classList.add('hidden');
    toast.classList.add('hidden');
  };

  canvas.addEventListener('pointerdown', () => {
    unlockAudio();
    // A tap during the result skips ahead; the short delay stops it from also starting a swing.
    if (ctl.phase === 'result' && performance.now() - resultAt > 400) {
      swing.enabled = false;
      if (stage.closeCall.active) endCloseCall();
      else finishResult();
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
    look: () => {
      stage.setTier(settings.look.quality);
      stage.dusk.setTarget(duskTarget(), true);
      fpsEl.hidden = !settings.look.showFps;
    },
  });
  const fpsEl = $('#fps');
  fpsEl.hidden = !settings.look.showFps;
  stage.onQualityChange = (q) => console.info(`Quality stepped down to ${q.tier} to keep the frame rate up.`);
  if (!new URLSearchParams(location.search).has('tune')) gui.hide();
  $('#tune').addEventListener('click', () => (gui._hidden ? gui.show() : gui.hide()));

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

    stage.syncShoes(session.sim.shoes);
    const pit = ctl.shoesInPit();
    const newest = pit[pit.length - 1];
    const flying = newest ? (stage.meshOf(newest)?.position ?? null) : null;

    if (stage.closeCall.active) {
      if (stage.closeCall.update(dt, rig.camera, { w: canvas.clientWidth, h: canvas.clientHeight })) endCloseCall();
    } else if (ctl.phase === 'result' && now - resultAt > 3500) finishResult();

    rig.update(dt, ctl.phase === 'flight' ? flying : null);
    stage.render(dt, mode !== 'menu' && ctl.phase === 'aim' ? ctl.target : null);
    if (settings.look.showFps) fpsEl.textContent = `${Math.round(stage.fps)} fps · ${stage.tier}`;
    requestAnimationFrame(frame);
  };

  // Hooks for the browser smoke test: read the phase, or pitch an exact throw
  // (software rendering is too slow for synthetic swings to be repeatable).
  Object.assign(window, {
    __dusk: {
      get phase() {
        return `${mode}:${ctl.phase}`;
      },
      get shoes() {
        return ctl.shoesInPit().length;
      },
      get fps() {
        return Math.round(stage.fps);
      },
      pitch(power = 1, aim = 0, release = 0) {
        swing.onThrow?.({ power, aim, release, wobble: 0, speedRatio: 1 });
      },
    },
  });

  goMenu();
  stage.dusk.setTarget(duskTarget(), true);
  requestAnimationFrame(frame);
  $('#loading').classList.add('done');
}

start().catch((err) => {
  console.error(err);
  $('#loading').textContent = 'Something went wrong loading the game. Try reloading.';
});
