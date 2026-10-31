// How far into dusk the court is, 0 (golden hour) … 1 (full dark), from how far the game has gone.

import type { MatchState } from '../rules';

/** Full dark arrives a few points before the limit, so match point is played under the lights. */
const MATCH_POINT_MARGIN = 3;

export function matchDusk(state: MatchState): number {
  const cfg = state.config;
  let t = 0;
  if (cfg.pointLimit !== null) {
    const lead = Math.max(state.scores[0], state.scores[1]);
    t = lead / Math.max(1, cfg.pointLimit - MATCH_POINT_MARGIN);
  }
  if (cfg.shoeLimit !== null) {
    const shoes = state.innings.length * 2;
    t = Math.max(t, shoes / Math.max(1, cfg.shoeLimit - 2));
  }
  return Math.min(1, Math.max(0, t));
}

/** Practice drifts toward dark over a session of 60 shoes. */
export function practiceDusk(shoesThrown: number): number {
  return Math.min(1, shoesThrown / 60);
}

/** Milestones along the way. */
export const DUSK = {
  stringLightsOn: 0.38,
  fireflies: 0.5,
};
