# Handoff: Living Open-World Sky Ace — Plan 2, Phase B (Weather) next

## Goal
Extend Sky Ace into a living open world (Plan 2, the deferred ecosystem). Staged
**day/night → weather → bird flocks → emergent verbs**, each shipped and live-graded before
the next. **Phase A (dynamic day/night sky) is DONE, verified, reviewed, and committed.**
The next phase is **B — Weather**. Plan + full task contracts:
`docs/plans/2026-07-05-living-open-world-ecosystem.md` (read Phase B before coding).

## Current state
- Branch: `feat/open-world-foundation` (off `main`; `main` untouched). Tree is clean except
  **11 regenerated `tests/shots/*.png`** (nondeterministic screenshot artifacts, NOT logic —
  ignore or `git checkout -- tests/shots/`) and untracked `.claude/handoffs/`.
- **DONE + verified this session** (newest first):
  - `07d2428` Phase A — dynamic day/night sky. Verified: `npx playwright test` → **79 green**;
    ~11 live screenshot captures graded by the user; xhigh code-review (fixed 6 findings).
  - `dcc16b1` Plan 2 spec doc + Phase A deviations.
  - `543dbe3` start-screen layout (Plan-1 polish). `24a0311` crash death-cam (Plan-1 polish).
- **User sign-off:** the sky look is **approved** ("nice better now"). User chose to **pause**
  after Phase A — so Phase B should start with a fresh check-in, not assume "go".
- No background servers/tasks left running (test server stopped).

## Key files & artifacts
- `docs/plans/2026-07-05-living-open-world-ecosystem.md` — **the plan.** Phase B = Task B1
  (`world.setWeather(state,intensity)` atmosphere: fog/cloud/light dim) + Task B2 (`weather.js`
  `Rain` particle system). Contracts, tests, and perf notes are all there.
- `world.js` — the sky/lighting/fog live here. **`setTimeOfDay(t)`** (~L488) is the exact
  pattern Phase B's `setWeather` should mirror: mutate shared handles via **instance-held
  scratch Colors** (no per-frame alloc), return a **reused descriptor** object (`_todDesc`),
  never rebuild geometry. **`setLook(mode)`** (~L515) is the coexistence seam.
- `game.js` — the driver pattern: the day/night driver + cloud drift in `simulate()` (~L1050),
  `applyLook`/`applyTimeOfDay` (~L841) stitch world descriptors onto `renderer`/`bloomPass`.
  Weather needs its own driver here + `applySettings` wiring + `__sky` getters.
- `traffic.js` — the InstancedMesh + zero-alloc template to **clone for Phase C bird flocks**
  (not B, but relevant background).
- `tests/daynight.spec.js` — the Phase A test contract; `tests/weather.spec.js` is Phase B's.
- Memory `living-open-world-plan.md` — status + the sky decision + taste verdict.

## Landmines
- **CRITICAL for Phase B: any system that mutates shared handles must be restorable by BOTH
  looks.** The #1 review bug in Phase A was that `setTimeOfDay` mutated lights/fog/exposure but
  `setLook('synthwave')` didn't restore them → near-black synthwave. `setWeather` will mutate
  `fog.far/near/color`, `dir/ambient.intensity`, `bloom`, clouds — so (a) `setLook` must reset
  weather state too, and (b) decide the apply order: **look → time-of-day → weather** (weather
  is the outermost multiply). Add a regression test that toggles look after weather is active.
- **Fog is now time-of-day-driven** (`scene.fog.near/far` set every frame by `setTimeOfDay`:
  near `1500+5500*day`, far `4200+10800*day`). Weather must *multiply* on top (shorten fog),
  not fight it — and only when the day/night cycle isn't also writing it. Sequence carefully.
- **Materials that must ignore fog:** the star field uses `fog:false` (else night haze paints
  it out). Any new camera-anchored weather layer (rain, storm dome) likely needs `fog:false`
  too, or careful depth. Test the *rendered* result, not just a property (my first star test
  only checked opacity and missed the fog bug).
- **Transparent full-screen layers must depth-test.** The gradient `dayDome` painted over
  terrain until `depthTest:true` + radius (7900) < far plane (8000). Rain/storm overlays: same
  trap. Prefer camera-anchored `THREE.Points` with a **ring-buffer** (no per-frame spawn/alloc).
- **Perf budget** (`tests/perf.spec.js`): drawCalls<500 (~350 now), tris<130k (~113k now),
  cpuMs<16.7 (~1.4). Rain must be **one draw call** (instanced/Points). Bump a threshold only
  in the same commit with a comment.
- **Review/verify subagents mutate the shared tree** — isolate (`isolation:'worktree'`) or keep
  read-only, or they clobber uncommitted work. (Memory: `workflow-agents-mutate-worktree`.)
- **Flaky test:** `mastery.spec.js [COMBO] canyon combo … 6s gap` fails ~1/run on timing;
  passes on `--repeat-each=3`. Not a regression — don't chase it.
- **No build step; server is `no-store`** so local reloads get fresh code (no `?v` bump needed
  for dev). But **bump `?v=12`→`?v=13` in lockstep** across `index.html` + every intra-repo
  import when you change a module's interface (grep `v=12`). Screenshot PNGs regenerate on any
  full `npx playwright test` run — don't commit them.
- **Taste:** user wants a **clean CLEAR day** (not hazy/immersive); loves moody dusk/night
  ("glow needs darkness"). Weather should read as *weather*, not as the washed-out look they
  rejected. Serve live and let them grade — chat feedback is the grade, screenshots verify mechanics.

## Next steps
1. **Check in with the user first** (they paused) — confirm they want to start Phase B (weather)
   now, and whether to first tune any Phase-A day-sky dial (vivid blue / add a sun disc / cycle
   speed) they flagged interest in.
2. Re-read Phase B in the plan doc. Implement **Task B1** (`world.setWeather` atmosphere states:
   fog shorten + desaturate, cloud cover up, light dim, bloom nudge) mirroring `setTimeOfDay`'s
   zero-alloc/scratch/reused-descriptor discipline; wire a `weather` setting + driver in `game.js`
   (ease weather in over ~8s; `'auto'` retargets every 40–90s) + `__sky.weather`/`setWeather`.
   **Make `setLook` restore weather state** and add the look-after-weather regression test.
3. Then **Task B2** (`weather.js` `Rain`: one camera-anchored ring-buffer Points, `intensity`-
   scaled, disposed/recreated across sessions). Perf test it.
4. Live-grade each with the user; xhigh code-review the diff; commit per task.

## Verification
- Full suite: `npx playwright test` → expect **79 passed** (one combo test may flake; re-run
  `npx playwright test -g "canyon combo" --repeat-each=3` → 3 passed).
- Sky specs only: `npx playwright test daynight bloom look` → 13 passed.
- Live: `node tests/server.js` → `http://localhost:4173` (no-store; hard-refresh not needed).
  Drive with `window.__sky` — `setTimeOfDay(t)`, `setDayNight('auto'|'off')`, `setLook(m)`.
- Perf: `npx playwright test perf` → drawCalls<500, tris<130k, cpuMs<16.7.

## Suggested skills
- **writing-plans** is already done (the plan exists) — just read Phase B; only re-plan if scope
  shifts.
- **flight-sim-gameplay-implementer** for the `setWeather`/`Rain` implementation;
  **flight-sim-test-engineer** for `tests/weather.spec.js`.
- **code-review** via the workflow at **xhigh** before each commit (it caught 6 real bugs in
  Phase A) — scope it and ignore `tests/shots` + mechanical `?v` bumps.
- **verify** / serve-live for the taste grade (user drives; chat feedback is the grade).
