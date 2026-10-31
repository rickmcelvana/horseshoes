// Menu and match cards: plain DOM in one overlay slot.

import { IN, type Player } from '../rules';
import type { FoulLine } from '../physics/throw';
import { SHOE_COLORS } from '../render/shoeMesh';
import { MODE_INFO, npcPlayer, type MatchFlow, type MatchSetup, type ModeKey, type SavedMatch } from '../game/matchFlow';
import { CHARACTER_IDS, ROSTER, type CharacterId } from '../ai/roster';
import type { ShoeResult } from '../game/session';

const root = () => document.querySelector('#overlay') as HTMLElement;

export const playerColor = (p: Player) => `#${SHOE_COLORS[p].toString(16).padStart(6, '0')}`;

type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'style'>> & { class?: string; style?: string };

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props<K> = {}, ...kids: (Node | string)[]) {
  const el = document.createElement(tag);
  const { class: cls, style, ...rest } = props;
  Object.assign(el, rest);
  if (cls) el.className = cls;
  if (style) el.setAttribute('style', style);
  el.append(...kids);
  return el;
}

function button(label: string, onClick: () => void, primary = false) {
  const b = h('button', { textContent: label, class: primary ? 'primary' : '' });
  b.addEventListener('click', onClick);
  return b;
}

function show(card: HTMLElement, modal = true) {
  const r = root();
  r.replaceChildren(card);
  r.className = modal ? 'modal' : 'banner';
  card.querySelector<HTMLElement>('button.primary, input')?.focus({ preventScroll: true });
}

export function hideOverlay() {
  const r = root();
  r.replaceChildren();
  r.className = 'hidden';
}

const name = (p: Player, n: string) => h('span', { class: 'name', textContent: n, style: `--c:${playerColor(p)}` });

// ── Menu ──────────────────────────────────────────────────────────────

export function showMenu(opts: { saved: SavedMatch | null; practice: () => void; newMatch: () => void; resume: () => void }) {
  const kids: Node[] = [
    h('h1', { textContent: 'Dusk at the Pits' }),
    h('p', { class: 'sub', textContent: 'Backyard horseshoes by the official rules.' }),
    button('Play a match', opts.newMatch, true),
  ];
  if (opts.saved) {
    const s = opts.saved;
    const [a, b] = s.state.scores;
    kids.push(button(`Resume: ${s.setup.players[0].name} ${a} – ${s.setup.players[1].name} ${b}`, opts.resume));
  }
  kids.push(button('Practice', opts.practice));
  kids.push(h('p', { class: 'fine', textContent: 'Matches are hot-seat: two players pass one phone or share one computer.' }));
  show(h('div', { class: 'card menu' }, ...kids));
}

// ── Match setup ───────────────────────────────────────────────────────

export function showSetup(initial: MatchSetup, opts: { start: (s: MatchSetup) => void; back: () => void }) {
  const setup: MatchSetup = { mode: initial.mode, players: [{ ...initial.players[0] }, { ...initial.players[1] }] };
  // Remember the friend's name if a character is picked and then un-picked.
  let friend = setup.players[1].npc ? { name: 'Player 2', line: 'full' as FoulLine } : { ...setup.players[1] };

  const playerRow = (p: Player) => {
    const input = h('input', { type: 'text', value: setup.players[p].name, maxLength: 16, ariaLabel: `Player ${p + 1} name` });
    input.addEventListener('input', () => (setup.players[p].name = input.value.trim() || `Player ${p + 1}`));
    const lines = h('div', { class: 'seg', role: 'radiogroup', ariaLabel: 'Pitching distance' });
    const draw = () =>
      lines.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.line === setup.players[p].line)));
    for (const [line, label] of [
      ['full', '40 ft'],
      ['short', '30 ft'],
    ] as [FoulLine, string][]) {
      const b = button(label, () => ((setup.players[p].line = line), draw()));
      b.dataset.line = line;
      b.setAttribute('role', 'radio');
      lines.append(b);
    }
    draw();
    return h('div', { class: 'player', style: `--c:${playerColor(p)}` }, h('span', { class: 'dot' }), input, lines);
  };

  const rows = h('div', { class: 'players' }, playerRow(0), playerRow(1));
  const friendRow = rows.lastElementChild as HTMLElement;
  const opponents = h('div', { class: 'modes', role: 'radiogroup', ariaLabel: 'Opponent' });
  const drawOpponents = () => {
    const pick = setup.players[1].npc ?? 'friend';
    opponents.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.opponent === pick)));
    friendRow.hidden = pick !== 'friend';
  };
  const choices: [CharacterId | 'friend', string, string][] = [
    ['friend', 'A friend', 'Hot-seat: pass the phone or share the computer.'],
    ...CHARACTER_IDS.map((id): [CharacterId, string, string] => [id, ROSTER[id].name, `${ROSTER[id].blurb} About ${ROSTER[id].targetRingerPct}% ringers.`]),
  ];
  for (const [key, label, blurb] of choices) {
    const b = h('button', { class: 'mode' }, h('strong', { textContent: label }), h('span', { textContent: blurb }));
    b.dataset.opponent = key;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => {
      if (!setup.players[1].npc) friend = { ...setup.players[1] };
      setup.players[1] = key === 'friend' ? { ...friend } : npcPlayer(key);
      drawOpponents();
    });
    opponents.append(b);
  }
  drawOpponents();

  const modes = h('div', { class: 'modes', role: 'radiogroup', ariaLabel: 'Game' });
  const drawModes = () => modes.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === setup.mode)));
  for (const [key, info] of Object.entries(MODE_INFO) as [ModeKey, (typeof MODE_INFO)[ModeKey]][]) {
    const b = h('button', { class: 'mode' }, h('strong', { textContent: info.label }), h('span', { textContent: info.blurb }));
    b.dataset.mode = key;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => ((setup.mode = key), drawModes()));
    modes.append(b);
  }
  drawModes();

  show(
    h(
      'div',
      { class: 'card setup' },
      h('h2', { textContent: 'New match' }),
      rows,
      h('p', { class: 'fine', textContent: '30 ft is the short-distance line for juniors, elders and anyone who wants it.' }),
      h('div', { class: 'eyebrow section', textContent: 'Opponent' }),
      opponents,
      h('div', { class: 'eyebrow section', textContent: 'Game' }),
      modes,
      h('div', { class: 'actions' }, button('Back', opts.back), button('Toss for first pitch', () => opts.start(setup), true)),
    ),
  );
}

// ── Coin toss ─────────────────────────────────────────────────────────

export function showToss(setup: MatchSetup, winner: Player, choose: (first: Player) => void) {
  const w = setup.players[winner].name;
  const l = setup.players[winner === 0 ? 1 : 0].name;
  show(
    h(
      'div',
      { class: 'card toss' },
      h('div', { class: 'coin', ariaHidden: 'true' }),
      h('h2', {}, name(winner, w), ' wins the toss'),
      h('p', { class: 'sub', textContent: 'The winner chooses who pitches first (RULE 7 A).' }),
      h('div', { class: 'actions' }, button(`${w} pitches first`, () => choose(winner), true), button(`${l} pitches first`, () => choose(winner === 0 ? 1 : 0))),
    ),
  );
}

// ── Handoff ───────────────────────────────────────────────────────────

export function showHandoff(flow: MatchFlow, newEnd: boolean, ready: () => void) {
  const p = flow.pitcher;
  const npc = flow.character(p);
  const end = flow.target.leanDir.z > 0 ? 'the near stake' : 'the far stake';
  const lines: (Node | string)[] = [
    h('div', { class: 'eyebrow', textContent: `Inning ${flow.inningNumber} · pitching at ${end}` }),
    h('h2', {}, name(p, flow.name(p)), npc ? ' is up' : '’s turn'),
  ];
  if (newEnd && flow.inningNumber > 1) lines.push(h('p', { class: 'sub', textContent: 'Shoes picked up. Walk to the other end.' }));
  if (!npc) {
    lines.push(h('p', { class: 'sub', textContent: 'Pick a grip and platform below, then pitch both shoes.' }));
    lines.push(h('div', { class: 'actions' }, button('Ready', ready, true)));
  }
  show(h('div', { class: 'card handoff' }, ...lines), false);
}

// ── Inning summary ────────────────────────────────────────────────────

function shoeLabel(r: ShoeResult, value: number): string {
  if (r.foul) return 'foul';
  const m = r.measure;
  const what = m.ringer ? 'ringer' : m.leaner ? 'leaner' : m.distance <= 6 * IN ? `${(m.distance / IN).toFixed(1)} in` : 'out';
  return value > 0 ? `${what} · ${value}` : what;
}

export function showInning(flow: MatchFlow, next: () => void) {
  const inn = flow.lastInning!;
  const chips = flow.thrown.map(({ player }, i) =>
    h('span', { class: `chip${inn.score.shoeValues[i] > 0 ? ' scored' : ''}`, style: `--c:${playerColor(player)}`, textContent: shoeLabel(inn.results[i], inn.score.shoeValues[i]) }),
  );
  const [a, b] = flow.state.scores;
  const over = flow.state.winner !== null;
  const first = flow.nextFirstPitcher;
  show(
    h(
      'div',
      { class: 'card inning' },
      h('div', { class: 'eyebrow', textContent: `Inning ${inn.number}` }),
      h('h2', { class: 'call', textContent: inn.call }),
      h('div', { class: 'chips' }, ...chips),
      h('div', { class: 'tally' }, name(0, `${flow.name(0)} ${a}`), h('span', { class: 'vs', textContent: '·' }), name(1, `${flow.name(1)} ${b}`)),
      over ? '' : h('p', { class: 'sub' }, name(first, flow.name(first)), ' pitches first next inning.'),
      h('div', { class: 'actions' }, button(over ? 'Final score' : 'Next inning', next, true)),
    ),
    false,
  );
}

// ── Game over ─────────────────────────────────────────────────────────

export function showGameOver(flow: MatchFlow, opts: { rematch: () => void; menu: () => void }) {
  const w = flow.state.winner!;
  const l: Player = w === 0 ? 1 : 0;
  const s = flow.state.scores;
  const st = flow.stats();
  const pct = (p: Player) => (st.shoes ? Math.round((100 * st.ringers[p]) / st.shoes) : 0);
  const row = (p: Player) =>
    h('tr', {}, h('td', {}, name(p, flow.name(p))), h('td', { textContent: String(s[p]) }), h('td', { textContent: `${st.ringers[p]} (${pct(p)}%)` }));
  show(
    h(
      'div',
      { class: 'card over' },
      h('div', { class: 'eyebrow', textContent: `${flow.state.innings.length} innings · ${st.shoes} shoes each` }),
      h('h1', {}, name(w, flow.name(w)), ` wins ${s[w]}–${s[l]}`),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', { textContent: '' }), h('th', { textContent: 'Points' }), h('th', { textContent: 'Ringers' }))), h('tbody', {}, row(0), row(1))),
      h('div', { class: 'actions' }, button('Menu', opts.menu), button('Rematch', opts.rematch, true)),
    ),
  );
}

export function confirmLeave(onLeave: () => void, onStay: () => void) {
  show(
    h(
      'div',
      { class: 'card' },
      h('h2', { textContent: 'Leave the match?' }),
      h('p', { class: 'sub', textContent: 'It’s saved at the end of each inning, so you can resume from the menu.' }),
      h('div', { class: 'actions' }, button('Keep playing', onStay, true), button('Leave', onLeave)),
    ),
  );
}
