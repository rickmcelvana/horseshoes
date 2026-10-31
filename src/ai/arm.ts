// The NPC arm: it throws through the same physics with the same throw inputs a
// player produces, with no scripted outcomes. It aims for the perfect throw for
// its grip and misses by its own scatter, widened or tightened by pressure.

import type { SwingResult } from '../input/swing';
import type { Rng } from '../physics/rng';
import { BASE_SPREAD, type Character } from './roster';

export interface Situation {
  myScore: number;
  oppScore: number;
  /** How far the game has gone, 0 … 1. */
  progress: number;
  /** The opponent has an uncancelled ringer on the stake this inning. */
  mustAnswerRinger: boolean;
}

export const CALM: Situation = { myScore: 0, oppScore: 0, progress: 0, mustAnswerRinger: false };

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** 0 (relaxed) … 1 (everything on the line). */
export function stress(s: Situation): number {
  const deficit = clamp01((s.oppScore - s.myScore) / 10);
  return clamp01(s.progress * (0.35 + deficit) + (s.mustAnswerRinger ? 0.35 : 0));
}

/** How much wider (or tighter) a character's scatter is in this situation. */
export function scatterFactor(c: Character, s: Situation): number {
  return Math.max(0.5, 1 + c.pressure * stress(s));
}

/** The Rookie improves a little with every game played against them, up to a point. */
export function seasonFactor(gamesPlayed: number): number {
  return Math.max(0.75, 1 - 0.025 * gamesPlayed);
}

function gaussian(rng: Rng): number {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** One throw's worth of inputs, as if from a swing. */
export function npcSwing(c: Character, s: Situation, rng: Rng, extraScale = 1): SwingResult {
  const k = c.scale * scatterFactor(c, s) * extraScale;
  return {
    power: 1 + k * BASE_SPREAD.power * gaussian(rng),
    aim: k * BASE_SPREAD.aim * gaussian(rng),
    release: k * BASE_SPREAD.release * gaussian(rng),
    wobble: k * BASE_SPREAD.wobble * gaussian(rng),
    speedRatio: 1,
  };
}
