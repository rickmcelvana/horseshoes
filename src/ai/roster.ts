// The opponents. Each is a skill profile for the NPC arm (see arm.ts) plus a
// personality for the canned lines (see lines.ts).
//
// `scale` is calibrated by `npm run calibrate` so that, under no pressure, the
// character's ringer rate matches `targetRingerPct`. Re-run it whenever the
// physics or launch math changes.
//
// Last calibration (2,000 shoes each, no pressure): Rookie 7.0% (target 8),
// Mae 23.9% (25), Uncle Dale 34.4% (35), Professor 50.7% (50).

import type { FoulLine, Grip, Stance } from '../physics/throw';

export type CharacterId = 'rookie' | 'mae' | 'dale' | 'professor';

export interface Character {
  id: CharacterId;
  name: string;
  blurb: string;
  grip: Grip;
  line: FoulLine;
  stance: Stance;
  /** Design target for the difficulty tier, in percent. */
  targetRingerPct: number;
  /** Overall scatter, as a multiple of BASE_SPREAD. Calibrated. */
  scale: number;
  /**
   * How pressure changes scatter: positive chokes (0.8 = up to 80% wider when it
   * matters most), zero never flinches, negative gets sharper.
   */
  pressure: number;
}

/** Standard deviation of each throw input at scale 1. */
export const BASE_SPREAD = { power: 0.012, aim: 0.25, release: 0.15, wobble: 0.2 };

export const ROSTER: Record<CharacterId, Character> = {
  rookie: {
    id: 'rookie',
    name: 'The Rookie',
    blurb: 'Hopeful, apologetic, flips the shoe. Gets better the more you play.',
    grip: 'flip',
    line: 'full',
    stance: 'right',
    targetRingerPct: 8,
    scale: 1.1,
    pressure: 0.3,
  },
  mae: {
    id: 'mae',
    name: 'Mae',
    blurb: 'Pitches flip from the 30 ft line. Says almost nothing. Never chokes.',
    grip: 'flip',
    line: 'short',
    stance: 'left',
    targetRingerPct: 25,
    scale: 0.67,
    pressure: 0,
  },
  dale: {
    id: 'dale',
    name: 'Uncle Dale',
    blurb: 'A 1¾-turn purist. Insufferable after a double. Sharper when it counts.',
    grip: 'one-and-three-quarter',
    line: 'full',
    stance: 'right',
    targetRingerPct: 35,
    scale: 0.391,
    pressure: -0.2,
  },
  professor: {
    id: 'professor',
    name: 'The Professor',
    blurb: 'Classic 1¼ turn. Narrates physics and probability. Overthinks under pressure.',
    grip: 'one-and-quarter',
    line: 'full',
    stance: 'right',
    targetRingerPct: 50,
    scale: 0.281,
    pressure: 0.8,
  },
};

export const CHARACTER_IDS = Object.keys(ROSTER) as CharacterId[];
