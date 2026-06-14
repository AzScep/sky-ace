# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Sky Ace** — a browser-based 3D flight simulator (Three.js) with an open world, four
minigames, and a localStorage leaderboard. Neon-synthwave / OUTRUN art style.

## No build step

There is no bundler, transpiler, or `npm run build`. `index.html` loads Three.js and its
addons from a CDN via an **importmap** (`three` + `three/addons/`), and the game's own ES
modules are plain `<script type="module">`. To run the game, just serve the repo root over
HTTP (e.g. `node tests/server.js`, then open `http://localhost:4173`) — opening the file
directly with `file://` will not work (ES module + importmap requirements).

**Cache-busting convention:** local module imports carry a `?v=N` query string
(`./world.js?v=5`, `./leaderboard.js?v=4`, `game.js?v=5` in `index.html`). When you change
a module's public interface and need to force browsers/CDN caches to reload, bump that
number — but bump it **consistently** across every import of that module and the
`<script src>` in `index.html`, or the importmap will load two different versions.

## Commands

```bash
npm install                      # installs @playwright/test (the only dependency)
npx playwright install chromium  # one-time browser download
npx playwright test              # full suite (auto-starts tests/server.js on :4173)
npx playwright test minigames    # one spec file by name substring
npx playwright test -g "RING RUN"   # one test by title
npx playwright test --repeat-each=3 # flush out nondeterminism in flight/minigame runs

# Regenerate the before/after screenshot gallery in tests/shots/
SHOT_PHASE=before npx playwright test screenshots
SHOT_PHASE=after  npx playwright test screenshots   # default
```

Note: `npm test` is **not** wired up (`package.json` `test` script is a placeholder). Use
the `npx playwright` commands above.

Tests run headless Chromium with the **SwiftShader** software WebGL rasterizer (configured
in `playwright.config.js`) so the Three.js scene actually renders in CI. Consequence:
wall-clock frame time (`frameMs`) is fill-rate bound and **not** representative of real GPU
hardware — perf assertions key off deterministic counts (`renderCalls`, `renderTris`, CPU
`frameStats`), not wall-clock fps. The suite is serial (`workers: 1`, `fullyParallel: false`).

## Architecture

Five ES modules, one orchestrator:

- **`game.js`** — entry point and orchestrator. Owns the `state` machine
  (`MENU / PLAYING / PAUSED / MINIGAME / RESULT`), the Three.js scene/camera/renderer, the
  bloom composer, mission markers, the rAF loop, camera modes, HUD, minimap, waypoint, and
  all menu/settings/onboarding wiring. Imports from every other module.
- **`plane.js`** — `createPlane()` (the mesh), `PlaneController` (arcade flight physics:
  throttle, rates, bank-induced yaw, auto-leveling springs), and `Input` (keyboard → action
  flags). Physics is the hot path and allocates nothing per frame (reusable scratch
  Vector3/Quaternion held on the instance).
- **`world.js`** — `buildWorld()` (sky shader, banded sun, value-noise terrain heightfield,
  cyan wireframe grid, stars, fog, water, instanced trees/clouds), `terrainHeight(x,z)`,
  `createMissionMarker()`, and the exported `WORLD_SIZE` + `NEON` palette.
- **`minigames.js`** — a `Minigame` base class plus `RingRun`, `CanyonDash`, `PrecisionDrop`,
  `Dogfight`. Each owns a `THREE.Group`, a `score`, `objective`/`getStats()` text, an
  `update(dt)`, sets `done = true` when finished, and must `cleanup()` (disposes geometry +
  materials). They communicate one-shot toast text up to `game.js` via `this._toast`.
- **`leaderboard.js`** — pure localStorage scoring. `MODES`, per-mode grade `THRESHOLDS`
  (D/C/B/A/S/SS), `addScore`, `getScores`, `getOverall`, `clearAll`. No Three.js / DOM.

### Game loop is split for testability

`loop(now)` (rAF-driven) computes `dt` and calls `simulate(dt)` then `renderFrame()`.
**`simulate(dt)` contains all game logic and takes `dt` as a parameter** — it does not read
the clock itself. This is deliberate: the Playwright suite drives the sim deterministically
by calling `window.__sky.tick(dt)` instead of waiting on real frames. When adding game
logic, put it inside `simulate()` (or a function it calls), never directly in `loop()`.

### `window.__sky` is the test contract

`game.js` exposes a debug/test hook on `window.__sky` (state getters, `tick(dt)`,
`forceMinigame(mode)`, `startGame`, `frameStats()`, `bloom` introspection, `setBloom(on)`,
`plane`/`controller`/`missions`/`scene`, `renderCalls`/`renderTris`). The entire test suite
depends on this surface — `tests/helpers.js` `boot()` waits for `window.__sky.plane`. If you
rename or remove a field here, update the specs in `tests/`.

### Persisted state (localStorage keys)

- `sky_settings` — user settings (invert pitch, sensitivity, reduced motion, colorblind,
  volume). Loaded/applied at boot; `applySettings()` pushes them into the live controller and
  toggles `body.reduced-motion` / `body.cb-safe`.
- `sky_ace_leaderboard_v1` — scores.
- `sky_onboarded`, `sky_tip_dismissed` — first-run overlay/tip dismissal flags.
  `helpers.js boot()` pre-seeds these so captures aren't covered; pass `{ firstRun: true }`
  to exercise the genuine first-run path.

## Invariants worth knowing (lessons already paid for)

These are encoded in regression tests; breaking them re-breaks shipped fixes.

- **Spawn inside the flyable world.** The flight loop hard-clamps the plane to
  `±(WORLD_SIZE * 0.45)`. Any minigame course element placed beyond that wall is physically
  unreachable. `minigames.js` `keepInBounds()` clamps spawns to `COURSE_BOUND = WORLD_SIZE*0.4`
  and reflects the course direction inward. Also raise course elements to at least
  `terrainHeight(x,z) + ~120` or they bury inside mountain peaks (the soft-floor then lifts
  the plane above them). Covered by `tests/regression.spec.js` + `tests/minigames.spec.js`.
- **Gate flight keys behind `isFlying()`.** Camera/reset/fire callbacks must do nothing in
  menus/result screens. They are wired in `setupScene()` behind an `isFlying()` check.
- **No per-frame allocations in hot paths** (`PlaneController.update`, `updateCamera`,
  `drawMinimap`). Use the existing reusable scratch objects; don't `new THREE.Vector3()` in a
  loop body.
- **Bloom render accounting.** The bloom path sets `renderer.info.autoReset = false` and
  resets manually in `renderFrame()` so `renderCalls`/`renderTris` sum *all* composer passes,
  not just the last one. The bloom target runs at half resolution on purpose.
- **Locked palette.** The synthwave look uses a fixed 5-color palette (the `NEON` export in
  `world.js`): `#1a0b2e #ff2e88 #b14bff #00ffd5 #ffcf4d`. Reuse it rather than introducing new
  colors.

## Reference docs

`IMPROVEMENTS.md`, `POLISH.md`, `UX.md` are development logs (each change tagged and tied to
the test that proves it). They are background/reference, not specs to keep in sync — read
them for the *why* behind a fix, but the tests in `tests/` are the source of truth.
