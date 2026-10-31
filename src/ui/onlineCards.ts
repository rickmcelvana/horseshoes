// Cards for playing online: host or join, the waiting room, joining by link or code.

import type { FoulLine } from '../physics/throw';
import { MODE_INFO, type ModeKey } from '../game/matchFlow';
import { normalizeCode } from '../net/peer';
import { button, h, show } from './overlay';

export interface OnlineProfile {
  name: string;
  line: FoulLine;
  mode: ModeKey;
}

function nameAndLine(profile: OnlineProfile) {
  const input = h('input', { type: 'text', value: profile.name, maxLength: 16, ariaLabel: 'Your name' });
  input.addEventListener('input', () => (profile.name = input.value.trim() || 'Player'));
  const lines = h('div', { class: 'seg', role: 'radiogroup', ariaLabel: 'Pitching distance' });
  const draw = () => lines.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.line === profile.line)));
  for (const [line, label] of [
    ['full', '40 ft'],
    ['short', '30 ft'],
  ] as [FoulLine, string][]) {
    const b = button(label, () => ((profile.line = line), draw()));
    b.dataset.line = line;
    b.setAttribute('role', 'radio');
    lines.append(b);
  }
  draw();
  return h('div', { class: 'player' }, input, lines);
}

/** Host or join. */
export function showOnline(profile: OnlineProfile, opts: { host: () => void; join: (code: string) => void; back: () => void }) {
  const mode = h('div', { class: 'modes', role: 'radiogroup', ariaLabel: 'Game' });
  const drawModes = () => mode.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === profile.mode)));
  for (const [key, info] of Object.entries(MODE_INFO) as [ModeKey, (typeof MODE_INFO)[ModeKey]][]) {
    const b = h('button', { class: 'mode' }, h('strong', { textContent: info.label }), h('span', { textContent: info.blurb }));
    b.dataset.mode = key;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => ((profile.mode = key), drawModes()));
    mode.append(b);
  }
  drawModes();

  const code = h('input', { type: 'text', placeholder: 'Room code', maxLength: 8, ariaLabel: 'Room code', autocapitalize: 'characters' } as never);
  const join = () => {
    const c = normalizeCode(code.value);
    if (c.length >= 4) opts.join(c);
    else code.focus();
  };
  code.addEventListener('keydown', (e) => e.key === 'Enter' && join());

  show(
    h(
      'div',
      { class: 'card setup online' },
      h('h2', { textContent: 'Play online' }),
      h('div', { class: 'players' }, nameAndLine(profile)),
      h('div', { class: 'eyebrow section', textContent: 'Host a game' }),
      mode,
      h('div', { class: 'actions' }, button('Host and get a link', opts.host, true)),
      h('div', { class: 'eyebrow section', textContent: 'Or join a friend’s game' }),
      h('div', { class: 'player' }, code, button('Join', join)),
      h('div', { class: 'actions' }, button('Back', opts.back)),
    ),
  );
}

/** The host waits for their friend. */
export function showRoom(code: string, link: string, opts: { cancel: () => void }) {
  const status = h('p', { class: 'sub', textContent: 'Send your friend the link. The game starts when they join.' });
  const copy = button('Copy link', () => {
    navigator.clipboard
      ?.writeText(link)
      .then(() => (status.textContent = 'Link copied. Paste it to your friend.'))
      .catch(() => window.prompt('Copy this link:', link));
  });
  const actions = [copy];
  if (typeof navigator.share === 'function') {
    actions.push(button('Share…', () => navigator.share({ title: 'Dusk at the Pits', text: `Pitch horseshoes with me. Room ${code}.`, url: link }).catch(() => {}), true));
  }
  show(
    h(
      'div',
      { class: 'card room' },
      h('div', { class: 'eyebrow', textContent: 'Your room' }),
      h('div', { class: 'code', textContent: code }),
      h('div', { class: 'link', textContent: link }),
      status,
      h('div', { class: 'actions' }, ...actions),
      h('div', { class: 'waiting', textContent: 'Waiting for your friend…' }),
      h('div', { class: 'actions' }, button('Cancel', opts.cancel)),
    ),
  );
}

/** Opened a join link: confirm a name and go. */
export function showJoin(code: string, profile: OnlineProfile, opts: { join: () => void; back: () => void }) {
  show(
    h(
      'div',
      { class: 'card setup' },
      h('div', { class: 'eyebrow', textContent: `Room ${code}` }),
      h('h2', { textContent: 'Join your friend’s game' }),
      h('div', { class: 'players' }, nameAndLine(profile)),
      h('div', { class: 'actions' }, button('Back', opts.back), button('Join', opts.join, true)),
    ),
  );
}

/** A plain status card: connecting, errors, the other side leaving. */
export function showStatus(title: string, text: string, actions: { label: string; run: () => void; primary?: boolean }[] = []) {
  show(
    h(
      'div',
      { class: 'card' },
      h('h2', { textContent: title }),
      h('p', { class: 'sub', textContent: text }),
      actions.length ? h('div', { class: 'actions' }, ...actions.map((a) => button(a.label, a.run, a.primary))) : '',
    ),
  );
}
