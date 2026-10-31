// What the host and guest say to each other in online play.
//
// Inputs, not physics: a throw travels as its ThrowInput, and both sides
// simulate it. The host is the referee: after each shoe it sends where every
// shoe lies, and the guest snaps to that. Scores and phases come only from the host.

import { FAR_STAKE, NEAR_STAKE, type Player, type Pose, type ShoeMeasure, type Stake } from '../rules';
import type { SimParams } from '../physics/sim';
import type { FoulLine, Grip, Stance, ThrowInput } from '../physics/throw';
import type { SwingResult } from '../input/swing';
import type { Phase } from '../game/session';
import type { InningSummary, MatchSetup, SavedMatch } from '../game/matchFlow';

/** Bump when messages change shape; both sides must match. */
export const PROTOCOL_VERSION = 1;

export type End = 'near' | 'far';
export const stakeOf = (e: End): Stake => (e === 'near' ? NEAR_STAKE : FAR_STAKE);
export const endOf = (s: Stake): End => (s === NEAR_STAKE ? 'near' : 'far');

/** A shoe in the pit, with enough to recreate it on the other side. */
export interface ShoeSnapshot {
  /** The host's id for this shoe. */
  id: number;
  owner: Player;
  end: End;
  input: ThrowInput;
  pose: Pose;
  plugged: boolean;
  foulContact: boolean;
}

/** Everything the guest mirrors about the match. */
export interface MatchSnapshot {
  saved: SavedMatch;
  phase: Phase;
  shoeIndex: number;
  pitcher: Player;
  lastInning: InningSummary | null;
}

/** The host's physics and launch tuning, so both sides simulate the same world. */
export interface WorldSettings {
  sim: SimParams;
  launch: { aimHeightIn: number; aimShortIn: number; releaseHeight: number };
}

export type EmoteId = 'nice' | 'ouch' | 'ha' | 'wow' | 'gg' | 'hurry';

export const EMOTES: Record<EmoteId, string> = {
  nice: 'Nice shot!',
  wow: 'Whoa!',
  ouch: 'Ouch.',
  ha: 'Ha!',
  hurry: 'Any day now…',
  gg: 'Good game!',
};

export type GuestMessage =
  | { t: 'hello'; protocol: number; build: string; name: string; line: FoulLine }
  | { t: 'swing'; swing: SwingResult; grip: Grip; stance: Stance }
  /** Guest is ready to pitch (accepts the handoff). */
  | { t: 'ready' }
  /** Done looking at the result. */
  | { t: 'skip' }
  | { t: 'next' }
  | { t: 'emote'; id: EmoteId };

export type HostMessage =
  | { t: 'welcome'; you: Player; setup: MatchSetup; world: WorldSettings; match: MatchSnapshot; pit: ShoeSnapshot[] }
  | { t: 'reject'; reason: string }
  | { t: 'state'; match: MatchSnapshot; pit?: ShoeSnapshot[] }
  | { t: 'throw'; shoe: ShoeSnapshot; pit: ShoeSnapshot[] }
  | { t: 'settled'; id: number; measure: ShoeMeasure; foul: boolean; inCount: boolean; pit: ShoeSnapshot[] }
  | { t: 'emote'; id: EmoteId }
  /** The host left (back to the menu or closed the tab). */
  | { t: 'bye' };

export type Message = GuestMessage | HostMessage;
