import './style.css';
import * as THREE from 'three';
import { FAR_STAKE, IN, NEAR_STAKE, type Player, type Pose, type Stake, stakeAxisAt } from './rules';
import { STEP, initPhysics, type ShoeSim } from './physics/sim';
import { GRIPS, type FoulLine, type Grip, type Stance } from './physics/throw';
import { SwingInput, type SwingResult } from './input/swing';
import { Stage } from './render/stage';
import { boardPlacement, type BoardState } from './render/chalkboard';
import { closeCallKind, closeCallLabel } from './render/closeCall';
import { npcSwing, seasonFactor, stress } from './ai/arm';
import { lineFor, type LineEvent } from './ai/lines';
import type { Character } from './ai/roster';
import { HostLink } from './net/host';
import { GuestMatch } from './net/guestMatch';
import { RoomHost, joinRoom, normalizeCode } from './net/peer';
import type { Channel } from './net/channel';
import { EMOTES, PROTOCOL_VERSION, type EmoteId, type GuestMessage, type HostMessage } from './net/protocol';
import { showJoin, showOnline, showRoom, showStatus, type OnlineProfile } from './ui/onlineCards';
import { Practice, SET_SIZE, describeResult } from './game/practice';
import { matchDusk, practiceDusk } from './game/duskProgress';
import { MODE_INFO, MatchFlow, type MatchSetup, type MatchView, type SavedMatch } from './game/matchFlow';
import { ThrowSession, type Controller, type ShoeResult } from './game/session';
import { applyLaunch, applyLaunchValues, buildTuningPanel, loadSettings, readout, saveSettings } from './game/tuning';
import { clang, thud, unlockAudio } from './audio/sfx';
import { confirmLeave, hideOverlay, playerColor, showGameOver, showHandoff, showInning, showMenu, showSetup, showToss } from './ui/overlay';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const SAVE_KEY = 'dusk.match.v1';
const PLAYERS_KEY = 'dusk.setup.v1';
/** Games played against the Rookie, who improves over a season. */
const ROOKIE_KEY = 'dusk.rookie.games';
const ONLINE_KEY = 'dusk.online.v1';

type Online =
  | { role: 'host'; room: RoomHost; link: HostLink | null; profile: OnlineProfile }
  | { role: 'guest'; code: string; profile: OnlineProfile; guest: GuestMatch | null; channel: Channel<HostMessage, GuestMessage> | null; leave: () => void; leaving: boolean };

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
  /** The match run on this device (hot-seat, computer opponent, or hosting online). */
  let flow: MatchFlow | null = null;
  /** The match on screen: `flow`, or an online guest's mirror of the host's. */
  let view: MatchView | null = null;
  let online: Online | null = null;
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
    leaveOnline();
    mode = 'menu';
    window.clearTimeout(npcTimer);
    npcKey = '';
    sayEl.className = 'hidden';
    endCloseCall(false);
    hint.classList.add('hidden');
    toast.classList.add('hidden');
    flow = null;
    view = null;
    session.clear();
    attach(new Practice(session));
    showMenu({
      online: openOnline,
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
    view = null;
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

  const startMatch = (setup: MatchSetup, opening: Player | SavedMatch, hostingOnline = false) => {
    mode = 'match';
    toast.classList.add('hidden');
    session.clear();
    rakePits();
    flow = new MatchFlow(session, setup, opening);
    view = flow;
    // Online games aren't saved for Resume: they need the friend on the other end.
    if (!hostingOnline) {
      flow.onInning = (saved) => writeJson(SAVE_KEY, saved.state.winner === null ? saved : null);
      writeJson(SAVE_KEY, flow.save());
    }
    attach(flow);
    stage.dusk.setTarget(duskTarget(), true);
    updateBoards(false);
    if (flow.state.innings.length === 0) hint.classList.remove('hidden');
    const npc = flow.character(1);
    if (npc && flow.state.innings.length === 0) window.setTimeout(() => say(npc, 'greet'), 700);
  };

  // ── Computer opponents ──────────────────────────────────────────────

  const sayEl = $('#say');
  let sayTimer = 0;
  let lastLine: string | null = null;
  /** A speech bubble: a character's line, or a friend's quick chat. */
  function bubble(name: string, text: string) {
    sayEl.replaceChildren(Object.assign(document.createElement('b'), { textContent: name }), `“${text}”`);
    sayEl.className = '';
    window.clearTimeout(sayTimer);
    sayTimer = window.setTimeout(() => (sayEl.className = 'hidden'), 4200);
  }

  /** Show a character's line for this moment (they may keep quiet). */
  function say(c: Character, event: LineEvent) {
    const line = lineFor(c.id, event, Math.random, lastLine);
    if (!line) return;
    lastLine = line;
    bubble(c.name, line);
  }

  let npcKey = '';
  let npcTimer = 0;
  /** When it's a character's turn, take it for them after a human-sized pause. */
  function driveNpc() {
    if (mode !== 'match' || !flow) return;
    const f = flow;
    const p = f.pitcher;
    const c = f.character(p);
    const key = `${f.phase}:${f.inningNumber}:${f.shoeIndex}`;
    if (!c || key === npcKey) return;
    npcKey = key;
    window.clearTimeout(npcTimer);
    if (f.phase === 'handoff') {
      npcTimer = window.setTimeout(() => f.acceptHandoff(), 1100);
    } else if (f.phase === 'aim') {
      const situation = f.situation(p);
      if (stress(situation) > 0.6 && Math.random() < 0.5) say(c, 'pressure');
      const season = c.id === 'rookie' ? seasonFactor(readJson<number>(ROOKIE_KEY) ?? 0) : 1;
      npcTimer = window.setTimeout(() => {
        if (flow !== f || f.phase !== 'aim') return;
        f.pitch(npcSwing(c, f.situation(p), Math.random, season));
        hint.classList.add('hidden');
        toast.classList.add('hidden');
      }, 1500);
    }
  }

  /** The opponent reacts to a shoe, theirs or yours. */
  function reactToShoe(r: ShoeResult) {
    if (mode !== 'match' || !flow) return;
    const shooter = r.shoe.owner;
    const mine = flow.character(shooter);
    const theirs = flow.character(shooter === 0 ? 1 : 0);
    const close = r.inCount && r.measure.distance <= 2 * IN;
    if (mine) {
      const e: LineEvent | null = r.foul ? 'foul' : r.measure.ringer ? 'ringer' : close ? 'close' : !r.inCount ? 'miss' : null;
      if (e && Math.random() < 0.75) say(mine, e);
    } else if (theirs) {
      if (r.measure.ringer && !r.foul) say(theirs, 'oppRinger');
      else if ((r.foul || !r.inCount) && Math.random() < 0.35) say(theirs, 'oppMiss');
    }
  }

  /** After the inning: a double, or ringers cancelling, is worth a word. */
  function reactToInning(f: MatchFlow) {
    const inn = f.lastInning;
    if (!inn) return;
    for (const p of [0, 1] as Player[]) {
      const c = f.character(p);
      if (!c) continue;
      const [r0, r1] = inn.score.ringers;
      if (inn.score.points[p] === 6) say(c, 'double');
      else if (r0 > 0 && r0 === r1) say(c, 'cancel');
    }
  }

  // ── Dusk and chalkboards ────────────────────────────────────────────

  const duskTarget = () => {
    if (!settings.look.autoTime) return settings.look.timeOfDay;
    if (mode === 'match' && view) return matchDusk(view.state);
    if (mode === 'practice' && ctl instanceof Practice) return practiceDusk(ctl.stats.thrown);
    return 0.12;
  };

  let boardKey = '';
  const updateBoards = (animate: boolean) => {
    let state: BoardState;
    if (mode === 'match' && view) {
      const f = view;
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
    const lift = canvas.clientWidth > canvas.clientHeight ? 0.36 : 0.14; // wide screens: card overlaps more
    rig.frame(position.clone().addScaledVector(normal, 3).add(new THREE.Vector3(0, 0.05, 0)), position.clone().add(new THREE.Vector3(0, lift, 0)), 2.5);
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
    if (mode === 'match' && view) {
      const v = view;
      brandSub.textContent = (online ? 'online · ' : '') + MODE_INFO[v.setup.mode].label.toLowerCase();
      const [a, b] = v.state.scores;
      const pitching = ['aim', 'flight', 'result', 'handoff'].includes(v.phase) ? v.pitcher : null;
      const cfg = v.state.config;
      const progress =
        cfg.shoeLimit !== null ? `shoe ${Math.min(cfg.shoeLimit, v.state.innings.length * 2 + 2)} of ${cfg.shoeLimit}` : `to ${cfg.pointLimit}`;
      stats.replaceChildren(
        nameChip(0, `${v.name(0)} ${a}`, pitching === 0),
        ' · ',
        nameChip(1, `${v.name(1)} ${b}`, pitching === 1),
        // Between innings, keep naming the inning just played (the card is about it).
        ` · inning ${v.phase === 'inning' || v.phase === 'over' ? v.state.innings.length : v.inningNumber} · ${progress}`,
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
    if (mode !== 'match' || !view) return;
    const v = view;
    const key = `${v.phase}:${v.inningNumber}:${v.shoeIndex}`;
    if (key === shownPhase) return;
    const prev = shownPhase;
    shownPhase = key;
    if (v.phase === 'handoff') showHandoff(v, !prev.startsWith('handoff') && v.shoeIndex === 0, () => v.acceptHandoff());
    else if (v.phase === 'inning') {
      showInning(v, () => v.nextInning());
      if (flow) reactToInning(flow);
    } else if (v.phase === 'over') {
      if (flow && !online) {
        writeJson(SAVE_KEY, null);
        for (const p of [0, 1] as Player[]) {
          const c = flow.character(p);
          if (!c) continue;
          say(c, flow.state.winner === p ? 'win' : 'lose');
          if (c.id === 'rookie') writeJson(ROOKIE_KEY, (readJson<number>(ROOKIE_KEY) ?? 0) + 1);
        }
      }
      const f = flow;
      if (online?.role === 'guest') showGameOver(v, { menu: goMenu, rematch: null, waiting: `${v.name(0)} can start a rematch.` });
      else if (online?.role === 'host') showGameOver(v, { menu: goMenu, rematch: online.link?.connected ? rematchOnline : null });
      else showGameOver(v, { menu: goMenu, rematch: () => f && toss(f.setup) });
    } else hideOverlay();
  };

  function refresh() {
    const p = ctl.phase;
    // Once a shoe is in the air the hint has done its job (an online guest's throws arrive this way).
    if (p === 'flight') hint.classList.add('hidden');
    // Someone else is pitching: the computer, or a friend online.
    const npcTurn = !!(mode === 'match' && view && !view.controlledHere(view.pitcher));
    swing.enabled = mode !== 'menu' && p === 'aim' && !npcTurn;
    rig.setAim(ctl.stance, ctl.target, ctl.line);
    if (!stage.closeCall.active) {
      if (p === 'inning' && view?.lastInning) frameBoard(view.lastInning.number % 2 === 1 ? NEAR_STAKE : FAR_STAKE);
      else rig.go(p === 'flight' ? 'flight' : p === 'result' || p === 'over' ? 'pit' : 'aim');
    }
    stage.dusk.setTarget(duskTarget());
    updateBoards(true);
    ghost.update(ctl.grip, ctl.stance, ctl.line, ctl.target);
    ghost.line.visible = settings.aids && (p === 'aim' || p === 'handoff') && mode !== 'menu' && !npcTurn;
    refreshControls();
    $('#controls').classList.toggle('npc', npcTurn);
    refreshTop();
    refreshSet();
    refreshOverlay();
    driveNpc();
    emoteBtn.hidden = !(online && mode === 'match');
    if (emoteBtn.hidden) emotes.hidden = true;
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
    reactToShoe(r);
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

  // ── Online play ─────────────────────────────────────────────────────

  const profile: OnlineProfile = readJson<OnlineProfile>(ONLINE_KEY) ?? { name: lastSetup.players[0].name, line: 'full', mode: 'cancellation' };
  const netStatusEl = $('#netStatus');
  const netStatus = (text: string | null) => {
    netStatusEl.hidden = !text;
    netStatusEl.textContent = text ?? '';
  };
  const emoteBtn = $<HTMLButtonElement>('#emote');
  const emotes = $('#emotes');
  for (const [id, text] of Object.entries(EMOTES) as [EmoteId, string][]) {
    const b = document.createElement('button');
    b.textContent = text;
    b.addEventListener('click', () => {
      emotes.hidden = true;
      if (online?.role === 'host') online.link?.sendEmote(id);
      else if (online?.role === 'guest') online.guest?.sendEmote(id);
      bubble('You', text);
    });
    emotes.append(b);
  }
  emoteBtn.addEventListener('click', () => (emotes.hidden = !emotes.hidden));

  const clearJoinParam = () => {
    const q = new URLSearchParams(location.search);
    if (!q.has('join')) return;
    q.delete('join');
    history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}`);
  };

  function openOnline() {
    showOnline(profile, { host: hostOnline, join: (code) => askJoin(code), back: goMenu });
  }

  function leaveOnline() {
    const o = online;
    online = null;
    netStatus(null);
    emotes.hidden = true;
    if (!o) return;
    if (o.role === 'host') {
      o.link?.close();
      o.room.close();
    } else {
      o.leaving = true;
      o.channel?.close();
      o.leave();
      // Back to this device's own physics and launch tuning.
      session.judging = true;
      session.rebuild(settings.sim);
      applyLaunch(settings);
      clearJoinParam();
    }
  }

  async function hostOnline() {
    writeJson(ONLINE_KEY, profile);
    showStatus('Opening a room…', 'Getting a room code.');
    try {
      const room = await RoomHost.open();
      online = { role: 'host', room, link: null, profile };
      room.onGuest = onGuestArrived;
      showRoom(room.code, room.link, { cancel: goMenu });
    } catch (e) {
      showStatus('Couldn’t open a room', message(e), [{ label: 'Back', run: openOnline, primary: true }]);
    }
  }

  const hostHooks = (guestName: string) => ({
    onChange: refresh,
    onResult,
    onSkip: () => {
      if (stage.closeCall.active) endCloseCall();
      finishResult();
    },
    onEmote: (id: EmoteId) => bubble(guestName, EMOTES[id]),
    onGuestLost: () => netStatus(`${guestName}’s connection dropped. Waiting for them to come back…`),
  });

  function onGuestArrived(ch: Channel<GuestMessage, HostMessage>, hello: Extract<GuestMessage, { t: 'hello' }>) {
    const o = online;
    if (!o || o.role !== 'host') return ch.close();
    if (o.link) {
      // A friend coming back after a dropped connection (or a stranger with the link).
      if (o.link.connected) ch.send({ t: 'reject', reason: 'This game already has two players.' });
      else if (o.link.attach(ch, hello)) {
        netStatus(null);
        bubble(hello.name, 'I’m back.');
      }
      return;
    }
    if (hello.protocol !== PROTOCOL_VERSION || hello.build !== __BUILD__) {
      ch.send({ t: 'reject', reason: 'You and the host are on different versions of the game. Reload both pages and try again.' });
      return;
    }
    const setup: MatchSetup = {
      mode: o.profile.mode,
      players: [
        { name: o.profile.name, line: o.profile.line },
        { name: hello.name, line: hello.line, remote: true },
      ],
    };
    const opening: Player = Math.random() < 0.5 ? 0 : 1;
    startMatch(setup, opening, true);
    o.link = new HostLink(flow!, { sim: settings.sim, launch: settings.launch }, __BUILD__, hostHooks(hello.name));
    o.link.attach(ch, hello);
    hideOverlay();
    shownPhase = '';
    refresh();
    bubble('Coin toss', `${setup.players[opening].name} wins the toss and pitches first.`);
  }

  function rematchOnline() {
    const o = online;
    if (!o || o.role !== 'host' || !o.link || !flow) return;
    const old = o.link;
    const setup = flow.setup;
    const opening: Player = Math.random() < 0.5 ? 0 : 1;
    startMatch(setup, opening, true);
    o.link = new HostLink(flow, { sim: settings.sim, launch: settings.launch }, __BUILD__, hostHooks(setup.players[1].name));
    old.handOver(o.link);
    shownPhase = '';
    refresh();
    bubble('Coin toss', `${setup.players[opening].name} wins the toss and pitches first.`);
  }

  function askJoin(code: string) {
    showJoin(code, profile, {
      join: () => connectGuest(code),
      back: () => {
        clearJoinParam();
        goMenu();
      },
    });
  }

  async function connectGuest(code: string) {
    writeJson(ONLINE_KEY, profile);
    showStatus('Joining…', `Connecting to room ${code}.`);
    try {
      const { channel, leave } = await joinRoom(code);
      online = { role: 'guest', code, profile, guest: null, channel, leave, leaving: false };
      greetHost(channel);
    } catch (e) {
      showStatus('Couldn’t join', message(e), [
        { label: 'Back', run: openOnline },
        { label: 'Try again', run: () => connectGuest(code), primary: true },
      ]);
    }
  }

  function greetHost(channel: Channel<HostMessage, GuestMessage>) {
    channel.onMessage = (m) => {
      if (m.t === 'welcome') beginGuest(channel, m);
      else if (m.t === 'reject') {
        leaveOnline();
        showStatus('Couldn’t join', m.reason, [{ label: 'Menu', run: goMenu, primary: true }]);
      }
    };
    channel.onClose = guestLost;
    channel.send({ t: 'hello', protocol: PROTOCOL_VERSION, build: __BUILD__, name: profile.name, line: profile.line });
  }

  function beginGuest(channel: Channel<HostMessage, GuestMessage>, m: Extract<HostMessage, { t: 'welcome' }>) {
    const o = online;
    if (!o || o.role !== 'guest') return;
    channel.onClose = guestLost;
    if (o.guest) {
      // Reconnected mid-game: carry on from where the host is.
      o.guest.rejoin(channel, m.match, m.pit);
      netStatus(null);
      return;
    }
    // Simulate with the host's physics and launch tuning so both sides see the same throws.
    session.clear();
    session.rebuild({ ...m.world.sim, clay: { ...m.world.sim.clay } });
    applyLaunchValues(m.world.launch);
    mode = 'match';
    flow = null;
    rakePits();
    toast.classList.add('hidden');
    const host = m.setup.players[m.you === 0 ? 1 : 0].name;
    const guest = new GuestMatch(session, channel, m.you, m.setup, m.match, m.pit, {
      onEmote: (id) => bubble(host, EMOTES[id]),
      onBye: () => {
        leaveOnline();
        showStatus(`${host} left the game`, 'The match is over.', [{ label: 'Menu', run: goMenu, primary: true }]);
      },
      onWelcome: (next) => {
        // Rematch: a fresh mirror for the new match.
        if (online?.role === 'guest') online.guest = null;
        beginGuest(channel, next);
      },
    });
    o.guest = guest;
    view = guest;
    attach(guest);
    hideOverlay();
    shownPhase = '';
    stage.dusk.setTarget(duskTarget(), true);
    updateBoards(false);
    refresh();
    if (m.match.saved.state.innings.length === 0) hint.classList.remove('hidden');
  }

  /** The connection to the host dropped: keep trying to get back in for a minute. */
  async function guestLost() {
    const o = online;
    if (!o || o.role !== 'guest' || o.leaving) return;
    netStatus('Lost the connection. Reconnecting…');
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      if (online !== o || o.leaving) return;
      try {
        const { channel, leave } = await joinRoom(o.code, 8000);
        o.leave();
        o.leave = leave;
        o.channel = channel;
        greetHost(channel);
        return;
      } catch {
        // Try again.
      }
    }
    if (online === o) {
      leaveOnline();
      showStatus('Lost the game', 'Couldn’t reconnect to the host.', [{ label: 'Menu', run: goMenu, primary: true }]);
    }
  }

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
    if (mode === 'match' && view && view.phase !== 'over') {
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
      // Mid-game online, both sides must keep simulating the same world.
      if (online) return;
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
  // Keep the frame-rate readout just above the controls, whatever height they wrap to.
  new ResizeObserver(() => document.documentElement.style.setProperty('--controls-h', `${$('#controls').offsetHeight}px`)).observe($('#controls'));
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
    readout.frameRate = `${Math.round(stage.fps)} fps · ${stage.tier}`;
    if (settings.look.showFps) fpsEl.textContent = readout.frameRate;
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
      get room() {
        return online?.role === 'host' ? online.room.code : null;
      },
      get scores() {
        return view ? [...view.state.scores] : null;
      },
      pitch(power = 1, aim = 0, release = 0) {
        swing.onThrow?.({ power, aim, release, wobble: 0, speedRatio: 1 });
      },
    },
  });

  goMenu();
  stage.dusk.setTarget(duskTarget(), true);
  // Opened a friend's invite link.
  const invite = new URLSearchParams(location.search).get('join');
  if (invite) askJoin(normalizeCode(invite));
  requestAnimationFrame(frame);
  $('#loading').classList.add('done');
}

start().catch((err) => {
  console.error(err);
  $('#loading').textContent = 'Something went wrong loading the game. Try reloading.';
});
