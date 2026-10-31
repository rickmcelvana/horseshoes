# Dusk at the Pits

A browser-based 3D horseshoes game played by NHPA rules. See the [plan](./Dusk%20at%20the%20Pits%20—%203D%20Horseshoes%20Plan.md) for the vision and roadmap.

**Play:** every push deploys to GitHub Pages. `master` is at `https://rickmcelvana.github.io/horseshoes/`, and other branches at `…/horseshoes/preview/<branch-name-with-slashes-as-dashes>/`.

## Playing

The menu offers **Play a match** and **Practice**.

**Matches (Phase 1)** are hot-seat: two players share one phone or computer.

- Pick names, each player's distance (40 ft, or the 30 ft short line), and a game: cancellation to 40 (NHPA standard), count-all over 40 shoes, or backyard 21 (leaner = 2).
- A coin toss decides who chooses the first pitcher. After that the rulebook decides: in cancellation whoever scored pitches first next; after a no-score inning, whoever pitched last.
- Each inning both players pitch two shoes from the same end, then walk to the other end. A card says whose turn it is, so you know when to pass the phone.
- After four shoes the inning is called the way pitchers call it ("Dale scores 4: a ringer and a point").
- A match saves after every inning; if the tab reloads, **Resume** from the menu.

**Practice** pitches sets of four shoes at one stake and keeps running stats.

**Computer opponents (Phase 3).** Pick one in match setup instead of a friend. They throw through the same physics with the same kind of throw input a player makes, aiming for a perfect throw and missing by their own calibrated scatter. Pressure (behind late, or a ringer to answer) widens or tightens it.

| Opponent | Grip | Ringers | Under pressure |
| --- | --- | --- | --- |
| The Rookie | Flip | ~8%, improving each game you play them | Chokes a little |
| Mae | Flip, 30 ft line | ~25% | Never flinches |
| Uncle Dale | 1¾ turn | ~35% | Gets sharper |
| The Professor | 1¼ turn | ~50% | Overthinks badly |

Each has a bank of canned lines; Phase 5 adds an optional LLM voice on top.

**Play a friend online (Phase 4).** Menu → **Play online** → **Host and get a link**, then send the link (or the five-letter room code) to a friend. When they open it and tap **Join**, the game starts. There's no game server: PeerJS's free public broker introduces the two browsers, then they talk directly.

- Throws travel as inputs, not physics: each side simulates every throw itself, so flights look smooth on both screens.
- The host is the referee. After each shoe the host sends where every shoe ended up, and the guest snaps to match; scores and rulings come only from the host. The guest borrows the host's physics and launch tuning for the game.
- Both players must be on the same build (the page checks); if one of you just got an update, reload both.
- 💬 sends quick-chat lines. If a guest's connection drops, they reconnect on their own for about a minute, or can reopen the link.
- If a strict network blocks the direct connection, a TURN relay will be needed (not set up yet).

**The court at dusk (Phase 2).** The sun sets as the game goes on: string lights come on mid-game, fireflies past the halfway mark, full dark at match point. The clay keeps every dent, scuff and imprint for the whole match. A chalkboard at each end keeps score in tally marks, with ringer innings underlined. When a shoe stops near the stake, the camera drops to the clay and a caliper or straightedge measures it, showing the same number the rules engine scored.

### Controls

- **Throw:** press anywhere, pull back (down), then swing forward (up) and let go.
  - How fast you swing forward sets the power.
  - Where you let go sets the arc: level with where you pressed is a normal arc, higher is a higher arc.
  - Drifting sideways pulls the shoe left or right; a curving stroke makes it wobble.
- **Grip** changes the spin. A perfect throw with any grip arrives open and rings the stake.
- **Stance** (left/right platform) locks for the second shoe of a pair, as in the rulebook.
- **Ghost arc** shows the arc a perfect throw flies. It never changes the throw.
- **⚙ → Look** sets quality (auto, low, medium, high), lets you pin the time of day, and can show the frame rate.
- **⚙** opens the tuning panel (or add `?tune` to the URL). Settings save in your browser; **Copy settings** puts them on the clipboard so they can become the new defaults.

## Development

```bash
npm install
```

```bash
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm test` | Rules fixtures, physics (stake tunneling, determinism, perfect throws), full headless matches, an online host and guest over an in-memory channel, architecture checks |
| `npm run typecheck` | TypeScript |
| `npm run build` | Production build into `dist/` |
| `npm run sim -- --n 500 --noise 1` | Headless throw simulator: outcome rates per grip for noisy throws |
| `npm run calibrate` | Tunes each computer opponent's scatter to its target ringer rate with the real physics (`-- --check` just measures) |
| `npm run smoke:online` | Starts a local PeerJS broker and plays an online inning between two browser pages, including quick chat and a guest reload |
| `npm run smoke` | Loads a running build in headless Chromium, pitches in practice, plays one hot-seat inning, saves screenshots to `test-results/` |

The smoke test needs a server running first, for example `npm run build && npx vite preview --port 4173`.

Textures in `public/textures` are CC0 from Poly Haven; see the credits file there.

## Layout

| Folder | Owns |
| --- | --- |
| `src/rules` | Court and shoe geometry, measuring, scoring, match flow. No 3D or physics imports. |
| `src/physics` | Rapier world, shoe colliders, launch math, clay, fouls, settle detection. Runs in Node. |
| `src/render` | Stage (renderer, bloom, quality tiers), dusk lighting, court and props, clay marks, chalkboards, close-call cam, cameras, aim aids |
| `src/input` | Swing gesture |
| `src/game` | Throw session, practice, hot-seat match flow, tuning panel |
| `src/ui` | Menu and match cards |
| `src/ai` | Computer opponents: roster, the throwing arm and its pressure model, canned lines |
| `src/net` | Online play: protocol, host link, guest mirror, PeerJS rooms |
| `src/audio` | Placeholder clang and thud |
| `tools/` | Throw simulator and browser smoke test |
