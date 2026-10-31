# Dusk at the Pits

A browser-based 3D horseshoes game played by NHPA rules. See the [plan](./Dusk%20at%20the%20Pits%20—%203D%20Horseshoes%20Plan.md) for the vision and roadmap.

**Play:** every push deploys to GitHub Pages. `main` is at `https://rickmcelvana.github.io/horseshoes/`, and other branches at `…/horseshoes/preview/<branch-name-with-slashes-as-dashes>/`.

## Phase 0: practice

Pitch sets of four shoes at the stake and see how each one measures.

- **Throw:** press anywhere, pull back (down), then swing forward (up) and let go.
  - How fast you swing forward sets the power.
  - Where you let go sets the arc: level with where you pressed is a normal arc, higher is a higher arc.
  - Drifting sideways pulls the shoe left or right; a curving stroke makes it wobble.
- **Grip** changes the spin. A perfect throw with any grip arrives open and rings the stake.
- **Stance** (left/right platform) locks for the second shoe of a pair, as in the rulebook.
- **Ghost arc** shows the arc a perfect throw flies. It never changes the throw.
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
| `npm test` | Rules fixtures, physics (stake tunneling, determinism, perfect throws) and architecture checks |
| `npm run typecheck` | TypeScript |
| `npm run build` | Production build into `dist/` |
| `npm run sim -- --n 500 --noise 1` | Headless throw simulator: outcome rates per grip for noisy throws |
| `npm run smoke` | Loads a running build in headless Chromium, pitches a shoe, saves screenshots to `test-results/` |

The smoke test needs a server running first, for example `npm run build && npx vite preview --port 4173`.

## Layout

| Folder | Owns |
| --- | --- |
| `src/rules` | Court and shoe geometry, measuring, scoring, match flow. No 3D or physics imports. |
| `src/physics` | Rapier world, shoe colliders, launch math, clay, fouls, settle detection. Runs in Node. |
| `src/render` | Three.js scene, shoe mesh, cameras, aim aids |
| `src/input` | Swing gesture |
| `src/game` | Practice loop, tuning panel |
| `src/audio` | Placeholder clang and thud |
| `tools/` | Throw simulator and browser smoke test |
