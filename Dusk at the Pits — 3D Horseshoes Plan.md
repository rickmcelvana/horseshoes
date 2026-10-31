# Dusk at the Pits — 3D Horseshoes Plan

Oct 30, 2026 · @Rick

## Vision

A browser-based 3D horseshoes game played by official NHPA rules, against characterful AI opponents or a friend via a shared link. It is a just-for-fun project, so the bar is feel and charm, not feature count.

**Setting: a backyard court at golden hour that slides into night as the game goes on.**

- **Time of day tracks the score.** Sun low at 0 points; string lights flicker on mid-game; fireflies appear around the 20-point mark; full dusk for match point.
- **In-world chalkboard scoreboard** nailed to a fence post. Chalk animates in after each inning (tally marks, a little underline on a ringer). A small HUD overlay mirrors the score so it's always readable.
- **Persistent clay.** Every shoe leaves a dent, scuff or plug mark that stays. By game's end the pit is a record of the match.
- **The close-call cam.** When a shoe stops near the stake, the camera drops to ground level and a straightedge or caliper slides in to measure. This is the game's signature moment.
- **Ringer moment.** Slow-motion replay from a low angle, a proper steel *clang*, a dust puff.
- **Ambient detail.** Cicadas, a cooler by the stake, a dog that wanders past occasionally, the opponent's idle animations between throws.

## Rules engine

The rules live in a pure TypeScript module with no 3D code, fed the final resting pose of each shoe and unit-tested against fixture scenarios. Defaults follow the [NHPA Official Playing Rules](https://www.horseshoepitching.com/rules/PlayingRules.html); everything else is a toggle.

**Court** ([NHPA backyard specs](https://www.horseshoepitching.com/gameinfo/backyard.html), [court specifications](https://horseshoepitching.com/rules/Specifications.html))

| Item | Value |
| --- | --- |
| Stake to stake | 40 ft |
| Foul lines | 37 ft (full distance) and 27 ft (short distance) from the opposite stake |
| Playing area | 6 ft wide × 46 ft long |
| Stake | 1 in diameter steel |

**Scoring a shoe**

- **Ringer = 3.** Test: a straightedge laid across the two open ends must not touch the stake. In code: the segment between the heel tips clears the stake radius, and the stake lies inside the shoe's outline.
- **Within 6 in = 1.** A live non-ringer with any part within 6 in of the stake, leaners included.
- **Out of count = 0.** Farther than 6 in, or a foul shoe.
- **Backyard toggle:** leaner = 2.

**Game modes**

| Mode | How an inning scores | Default end |
| --- | --- | --- |
| Cancellation (default) | Opposing ringers cancel; only one player scores per inning; closest shoe(s) score | First to 40 |
| Count-all | Every live shoe scores for its owner, no cancellation | 40 or 50 shoes, highest total |
| Backyard 21 | Cancellation, leaner = 2 | First to 21 |

**Flow of play**

- Singles: both players pitch from the same end, two shoes each per inning, then walk to the other end.
- Cancellation: whoever scored the last inning pitches first next; the no-score case gets checked against the NHPA rulebook before Phase 1 ships.
- Doubles (stretch goal): partners stand at opposite ends.
- Foul: shoe released with a foot over the foul line. In-game, the release point is enforced by the controls, so fouls only happen if we add a step-up mechanic.

## Throwing and physics

Throwing is the whole game: if one throw doesn't feel good in Phase 0, nothing later matters.

**Grips (choose before each throw).** Each sets the shoe's spin so it arrives open at a different distance.

| Grip | Character |
| --- | --- |
| ¾ turn | Shoe held by a side, flat spin; forgiving at short distance |
| 1¼ turn | Classic; good all-rounder |
| 1¾ turn | The pro grip; most consistent when mastered |
| Flip | End-over-end; easy to learn, lower ringer ceiling |

**Controls: the swing gesture.**

1. Pick grip and stance (left/right of the stake line).
2. Drag back to start the backswing, push forward to throw.
3. Forward speed → power. Sideways drift → pull and wobble. Release timing → arc height.
4. A faint ghost arc helps at Rookie difficulty and disappears at higher ones.

Mouse and touch both work, so phones are in from day one.

**Physics setup**

- **Shoe collider:** a chain of \~8 capsules along the arc plus small boxes for the heel calks. Never a triangle mesh.
- **Stake:** a thin cylinder with continuous collision detection on the shoe, and a fixed small timestep for flight (e.g. 240 Hz substeps) to stop tunneling.
- **Clay, not trampoline:** on pit contact, apply heavy linear and angular damping, a chance to plug (stick at the landing angle), and a short slide along the travel direction. Tunable per surface (wet clay, dry clay, sand).
- **Stake hits:** high restitution steel-on-steel for the clang and spin-off; shoes can wrap, bounce off, or climb and settle as leaners.
- **Settle detection:** the inning resolves once all shoes are below a velocity threshold for \~0.5 s, then the rules engine scores the resting poses.

## AI opponent

The opponent is split in two: a classic NPC **arm** that throws, and an optional LLM **mouth** that talks and nudges strategy. The game is fully playable with the LLM off.

**The arm (NPC)**

- Uses the same physics and the same throw inputs as the player — no cheating, no scripted outcomes.
- Computes an ideal throw for its preferred grip, then adds noise from its skill profile: aim spread, power spread, release-timing spread.
- **Pressure model:** spread widens when behind late, or facing a ringer it must cancel. Some characters choke; some get better.
- Difficulty = profile tuning, calibrated by simulating thousands of throws offline to hit a target ringer rate.

**The mouth (LLM, optional)**

- Trash talk and reactions after each shoe, in character.
- Light strategy calls in cancellation play: go for the ringer to cancel yours, or play a safe blocking shot.
- Runs against any OpenAI-compatible endpoint — e.g. llama.cpp serving qwen3.6-35b-a3b on the homelab. Short prompts, a game-state JSON in, one line plus an optional strategy tag out.
- Fallback: a bank of canned lines per character when the endpoint is missing or slow (>1.5 s).

**Character roster (starting set)**

| Character | Grip | Target ringer % | Personality |
| --- | --- | --- | --- |
| The Rookie | Flip | \~8% | Hopeful, apologetic; improves over a season |
| Mae | Flip, 27 ft line | \~25% | Says almost nothing; never chokes |
| Uncle Dale | 1¾ turn | \~35% | Purist, insufferable after a double |
| The Professor | 1¼ turn | \~50% | Narrates physics and probability; overthinks under pressure |

Ringer percentages are design targets for difficulty tiers, tuned in playtesting.

## Multiplayer

Two stages: hot-seat on one device first, then online play by sending a friend a link.

**Hot-seat.** Pass the mouse or phone. Comes nearly free once turns and the rules engine exist.

**Online (peer-to-peer).**

- Host clicks *Play a friend*, gets a room code and a shareable link.
- Connection: WebRTC data channel via PeerJS; its public broker handles the handshake, so there's no game server to run.
- **Send inputs, not physics.** Each throw is a tiny message (grip, stance, power, aim, release timing, seed). Both browsers simulate the same flight with Rapier's deterministic build.
- **Host is the referee.** After a shoe settles, the host sends its final pose; the guest snaps to it if anything drifted. Scores always come from the host.
- Extras: emote buttons and quick-chat lines; reconnect if a tab drops mid-game.

**Fallback:** if a strict NAT blocks the peer connection, add a TURN server or a tiny WebSocket relay on the homelab.

## Tech stack and architecture

A static TypeScript web app: Vite + Three.js for rendering, Rapier (WASM) for physics, PeerJS for online play, Vitest for tests, hosted on GitHub Pages. No game server.

&#91;embedded content: game architecture · one throw path for player, NPC and friend\]

The player, the NPC and a remote friend all produce the same kind of throw input, so physics, scoring and replays work identically for all three.

**Module layout**

| Folder | Owns |
| --- | --- |
| `src/rules` | Scoring, ringer test, game modes; no 3D imports |
| `src/physics` | Rapier world, shoe collider, clay behavior, settle detection |
| `src/render` | Scene, lighting and dusk cycle, cameras, chalkboard, effects |
| `src/input` | Swing gesture for mouse and touch, grip picker |
| `src/game` | Turn and inning state machine, match flow |
| `src/ai` | `arm` (NPC throws, skill profiles) and `mouth` (LLM client, canned lines) |
| `src/net` | PeerJS rooms, input messages, host-authoritative results |
| `src/audio` | Clang, thud, crowd and ambience via Web Audio |

## Build phases

Seven phases, each ending in something playable; Phase 0 is the gate, because nothing else matters if throwing isn't fun.

&#91;embedded content: build roadmap · 7 phases with exit criteria\]

Phases 1–4 can overlap once Phase 0 lands; Phase 6 polish can leak in anywhere it's cheap and fun.

## Development environment

Cloud works well for this project: it's a static web game with no native dependencies, so nearly everything can be built in a cloud session. The one thing cloud can't do is *play* the game, so pair it with an auto-deploy.

**Recommended loop**

1. Create a GitHub repo (e.g. `horseshoes`) and attach it to a cloud coding session.
2. Claude writes code, runs the unit tests and a headless build in the cloud, and pushes to a branch.
3. A GitHub Actions workflow deploys every push to GitHub Pages (or a preview URL per branch).
4. You play the result on any device — PC, phone, or your friend's laptop — and leave feedback.

**What runs where**

| Work | Cloud | Your PC |
| --- | --- | --- |
| Rules engine, tests, scaffolding | Yes | Yes |
| Physics tuning by feel | Via deployed preview | Faster (hot reload) |
| Online multiplayer testing | Via deployed preview | Yes |
| LLM opponent against the homelab | No — can't reach your LAN | Yes |

A good split: start in the cloud for Phases 0–4, and switch to local (Claude Code on your PC) for the feel-tuning sessions and Phase 5, where the game needs to talk to llama.cpp. The repo is the same either way.

## Risks and open questions

| Risk | Mitigation |
| --- | --- |
| Shoe tunnels through the 1 in stake | Capsule-chain collider, CCD, high substep rate; a test scene firing 1,000 shoes at the stake |
| Throwing feels floaty or random | Phase 0 is only feel; ship nothing else until it's fun |
| Clay looks like a trampoline | Custom damping and plug logic, tuned against real throw videos |
| Online clients disagree on a landing | Deterministic Rapier build plus host-authoritative final poses |
| LLM slow or unreachable | Hard timeout and canned-line fallback; LLM never blocks a turn |
| Hosted HTTPS page can't call an HTTP LAN endpoint | Run locally for LLM play, or put llama.cpp behind HTTPS on the homelab |

**Open questions**

- [✔️] Realism vs arcade: how much should physics forgive near-misses at higher difficulty? 
Answer: Let's go with realism vs arcade since this is a fun experiment.

- [✔️] Art style: stylized low-poly with painterly light, or more realistic PBR?
Answer: Again, let's try out a more realistic PBR.

- [✔️] Doubles (2v2) in v1, or a later stretch goal?
Answer: we can have that as a stretch goal.

- [✔️] Confirm the NHPA first-pitch rule after a no-score inning in cancellation play.
It's casual play but we can follow the rule book for realism. 👍

- [✔️] Name: *Dusk at the Pits* is the working title.
Answer: Great name. Let's go with that.