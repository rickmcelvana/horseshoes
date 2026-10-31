// Feel-tuning panel. Values persist in this browser, and "Copy settings" puts
// them on the clipboard so they can be pasted back into the code as new defaults.

import GUI from 'lil-gui';
import { IN } from '../rules';
import { CLAY_PRESETS, DEFAULT_PARAMS, type SimParams } from '../physics/sim';
import { LAUNCH } from '../physics/throw';
import { DEFAULT_SWING, type SwingTuning } from '../input/swing';
import type { TierSetting } from '../render/quality';

const KEY = 'dusk.tuning.v1';

export interface Settings {
  sim: SimParams;
  swing: SwingTuning;
  launch: { aimHeightIn: number; aimShortIn: number; releaseHeight: number };
  aids: boolean;
  look: { quality: TierSetting; autoTime: boolean; timeOfDay: number; showFps: boolean };
}

function defaults(): Settings {
  return {
    sim: { ...DEFAULT_PARAMS, clay: { ...DEFAULT_PARAMS.clay } },
    swing: { ...DEFAULT_SWING },
    launch: { aimHeightIn: LAUNCH.aimHeight / IN, aimShortIn: LAUNCH.aimShort / IN, releaseHeight: LAUNCH.releaseHeight },
    aids: true,
    look: { quality: 'auto', autoTime: true, timeOfDay: 0.2, showFps: false },
  };
}

export function loadSettings(): Settings {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      sim: { ...d.sim, ...s.sim, clay: { ...d.sim.clay, ...s.sim?.clay } },
      swing: { ...d.swing, ...s.swing },
      launch: { ...d.launch, ...s.launch },
      aids: s.aids ?? d.aids,
      look: { ...d.look, ...s.look },
    };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode or storage blocked: settings just won't persist.
  }
}

export function applyLaunch(s: Settings) {
  LAUNCH.aimHeight = s.launch.aimHeightIn * IN;
  LAUNCH.aimShort = s.launch.aimShortIn * IN;
  LAUNCH.releaseHeight = s.launch.releaseHeight;
}

export function buildTuningPanel(s: Settings, hooks: { rebuild: () => void; changed: () => void; look: () => void }): GUI {
  const gui = new GUI({ title: 'Tuning' });
  const save = () => {
    saveSettings(s);
    hooks.changed();
  };

  const look = gui.addFolder('Look');
  const onLook = () => (saveSettings(s), hooks.look());
  look.add(s.look, 'quality', ['auto', 'low', 'medium', 'high']).name('Quality').onChange(onLook);
  look.add(s.look, 'autoTime').name('Dusk follows the score').onChange(onLook);
  look.add(s.look, 'timeOfDay', 0, 1, 0.01).name('Time of day').onChange(onLook);
  look.add(s.look, 'showFps').name('Show frame rate').onChange(onLook);

  const clay = gui.addFolder('Clay');
  const preset = { preset: 'wet' as keyof typeof CLAY_PRESETS };
  clay
    .add(preset, 'preset', Object.keys(CLAY_PRESETS))
    .name('Preset')
    .onChange((k: keyof typeof CLAY_PRESETS) => {
      Object.assign(s.sim.clay, CLAY_PRESETS[k]);
      clay.controllersRecursive().forEach((c) => c.updateDisplay());
      save();
      hooks.rebuild();
    });
  clay.add(s.sim.clay, 'absorb', 0, 1, 0.01).name('Absorb on landing').onChange(save);
  clay.add(s.sim.clay, 'linearDamping', 0, 40, 0.5).name('Slide damping').onChange(save);
  clay.add(s.sim.clay, 'angularDamping', 0, 40, 0.5).name('Spin damping').onChange(save);
  clay.add(s.sim.clay, 'plugChance', 0, 1, 0.01).name('Plug chance').onChange(save);
  clay.add(s.sim.clay, 'plugSteepness', 0, 1, 0.01).name('Plug steepness').onChange(save);
  clay.add(s.sim.clay, 'friction', 0, 2, 0.05).name('Friction *').onFinishChange(() => (save(), hooks.rebuild()));

  const steel = gui.addFolder('Steel *');
  steel.add(s.sim, 'stakeRestitution', 0, 1, 0.01).name('Stake bounce').onFinishChange(() => (save(), hooks.rebuild()));
  steel.add(s.sim, 'stakeFriction', 0, 1, 0.01).name('Stake friction').onFinishChange(() => (save(), hooks.rebuild()));
  steel.add(s.sim, 'shoeRestitution', 0.05, 1, 0.01).name('Shoe bounce').onFinishChange(() => (save(), hooks.rebuild()));
  steel.add(s.sim, 'shoeFriction', 0, 1.5, 0.01).name('Shoe friction').onFinishChange(() => (save(), hooks.rebuild()));

  const swing = gui.addFolder('Swing');
  swing.add(s.swing, 'nominalSpeed', 0.8, 5, 0.05).name('100% speed (screens/s)').onChange(save);
  swing.add(s.swing, 'powerSensitivity', 0.05, 1, 0.01).name('Power sensitivity').onChange(save);
  swing.add(s.swing, 'releaseSensitivity', 0.2, 4, 0.05).name('Release sensitivity').onChange(save);
  swing.add(s.swing, 'aimSensitivity', 0.2, 6, 0.05).name('Aim sensitivity').onChange(save);
  swing.add(s.swing, 'wobbleSensitivity', 0, 5, 0.05).name('Wobble sensitivity').onChange(save);

  const launch = gui.addFolder('Launch');
  const onLaunch = () => (applyLaunch(s), save());
  launch.add(s.launch, 'aimHeightIn', 0, 14, 0.25).name('Aim height (in)').onChange(onLaunch);
  launch.add(s.launch, 'aimShortIn', -6, 12, 0.25).name('Aim short of stake (in)').onChange(onLaunch);
  launch.add(s.launch, 'releaseHeight', 0.3, 1.2, 0.01).name('Release height (m)').onChange(onLaunch);

  const actions = {
    copy: () => {
      const text = JSON.stringify(s, null, 2);
      navigator.clipboard?.writeText(text).catch(() => window.prompt('Copy these settings:', text));
    },
    reset: () => {
      const d = defaults();
      Object.assign(s.sim, d.sim);
      Object.assign(s.sim.clay, d.sim.clay);
      Object.assign(s.swing, d.swing);
      Object.assign(s.launch, d.launch);
      applyLaunch(s);
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      save();
      hooks.rebuild();
    },
  };
  gui.add(actions, 'copy').name('Copy settings');
  gui.add(actions, 'reset').name('Reset to defaults');
  gui.add({ note: '* clears the pit' }, 'note').name('').disable();
  return gui;
}
