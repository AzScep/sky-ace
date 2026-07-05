# Plan — Living Open-World Sky Ace: Ecosystem (Plan 2 of 2)

**Brief:** `docs/briefs/2026-07-04-living-open-world-skyace.md` — read it first.
**Plan 1 (shipped):** `docs/plans/2026-07-04-living-open-world-foundation.md` — feel, look, crash
stakes, diegetic missions, ambient traffic, the buzz verb, the level-gated hangar. All committed
on `feat/open-world-foundation`, 73 Playwright tests green.

**Scope:** Plan 2 finishes the living world — the *atmosphere* layers the brief named but deferred
(day/night, weather, wildlife) plus the *emergent verbs* they unlock. It is staged so each phase
ships and is **graded live before the next is built** (brief mandate: "build one system, prove the
feel, then layer — don't build all four blind"). The phases form a dependency chain:

> **A. Day/Night → B. Weather → C. Bird flocks → D. Emergent verbs (chase-flock, race-storm).**

Weather reads against the day/night lighting; the storm verb needs weather; the flock verb needs
flocks. Each phase is independently shippable and revertible.

**Isolation:** continue on `feat/open-world-foundation` (Plan 1's branch, off `main`). `main`
untouched until the whole open-world rework is graded and merged as one story.

---

## Cross-cutting rules (apply to every task)

- **No build step.** Plain ES modules + importmap. Never add a bundler or dependency.
- **Cache-busting.** Current version is `?v=11` (uniform across `index.html:390` and every intra-repo
  import — `game.js:11-18`, `traffic.js:14`, `minigames.js:6`). The **first** task that changes a
  module's interface bumps every `?v=11` → `?v=12` in lockstep (all imports *and* the `<script>` in
  `index.html`); later tasks reuse `v=12` unless a second coordinated bump is needed. The importmap
  block (`index.html:382-388`) maps bare `three` and carries no version — leave it.
- **`window.__sky` is the test contract** (`game.js:1464-1543`). Every new system tests must observe
  gets a getter here, mirroring `traffic`/`buzzCount`/`bloom`. Never rename/remove an existing field
  without updating `tests/`.
- **Perf budget** (`tests/perf.spec.js:31-37`): `drawCalls < 500`, `tris < 130_000`, `cpuMs < 16.7`,
  `count > 20`. Current baseline is ~24 draws / ~87.5k tris / ~5 cpuMs, so draw-call and tri headroom
  is large — **the binding guard is `cpuMs < 16.7`**: every new per-frame loop (weather, flocks) must
  follow the traffic.js zero-alloc **indexed** convention (instance/module scratch vectors, no
  `new` in `update`). If a task legitimately raises a threshold, bump it in `tests/perf.spec.js` in
  the **same commit** with a comment saying why. (SwiftShader caveat: `frameMs` is fill-rate bound
  and meaningless headless — assert on `drawCalls`/`tris`/`cpuMs`/counts, never wall-clock fps.)
- **Locked palette.** Reuse the `NEON` export (`world.js`): `#1a0b2e #ff2e88 #b14bff #00ffd5
  #ffcf4d`. Realistic-look atmosphere may use the existing realistic constants (`REALISTIC_HAZE
  = 0x88a8c8`, warm sun `0xfff0d8`, etc.) — introduce **no new arbitrary colors**; derive
  night/storm tints by scaling those.
- **The lockstep color trio.** `scene.fog.color`, `renderer` clear color, and `scene.background`
  are documented as needing to move together (`world.js:18-20`, `295-297`). Any system that shifts
  atmosphere (day/night, weather) **owns all three from one driver** and must coexist with the
  existing realistic⇄synthwave `setLook` toggle (`world.js:401-412`) rather than fight it —
  `setLook` and the cycle write the same handles, so the last writer wins; the cycle re-applies on
  every `setLook` and vice-versa (Task A1 defines the ordering).
- **Determinism / default-off.** Existing perf + screenshot specs assume today's static daytime
  look. Every new atmosphere system **defaults to its static, current-look state** (`dayNight:'day'`,
  `weather:'clear'`); auto-cycle / dynamic weather are opt-in via settings and exercised by their own
  specs with an explicit `setTimeOfDay(t)` / `setWeather(...)` call. This keeps all 73 existing tests
  valid with zero changes.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `world.js` | modify | Add `setTimeOfDay(t)` and `setWeather(state, intensity)` to the `buildWorld` return (closure access to lights/fog/sky/sun). Keyframe-lerp the lights, fog, clear-descriptor, bloom-strength, sun-disc uniforms & position. Dynamic-sky repaint (A2) reuses the existing `altSky` CanvasTexture pattern (`world.js:387-397`). |
| `game.js` | modify | The **time driver** (advance `t` in `simulate`, auto-cycle toggle) and **weather driver**; apply cycle/weather through `world.setTimeOfDay`/`setWeather`; settings wiring in `applySettings`; the two emergent verbs (chase-flock, race-storm) in `simulate` alongside buzz; instantiate/update/dispose the flock; `__sky` getters. |
| `flock.js` | **create** | `Flock` class — instanced low-altitude birds cloned from the `traffic.js` skeleton (one InstancedMesh, zero-alloc scratch, wander + light cohesion + scatter-on-approach). Exposes `.birds` for the chase verb. |
| `weather.js` | **create** | `Rain` particle emitter — one camera-anchored `THREE.Points`/instanced system, zero-alloc, driven by weather intensity. (Atmosphere *lerp* lives in `world.setWeather`; only the particle FX is heavy enough to warrant its own file.) |
| `progression.js` | modify | Reuse `grantXp(n, reason)` (already added in Plan 1 T6) for the new verbs — **no change expected**; listed only if a verb needs a new reason string. |
| `index.html` | modify | Settings UI: a **Time of Day** control (Day / Auto / and a manual slider) and a **Weather** control (Clear / Cloudy / Storm / Auto). `?v` bumps. |
| `tests/*.spec.js` | create/modify | `daynight.spec.js`, `weather.spec.js`, `flock.spec.js`, `verbs.spec.js`; extend `tests/perf.spec.js` guards; update any spec that asserts a fixed light/fog value. |

---

## Phase A — Day / Night cycle (the atmospheric backbone)

> **Design fork the plan resolves up front (the sky is a photo, not a shader).** The realistic sky
> is a `scene.background` **equirectangular JPG** (`world.js:124-131`) you approved live — you
> *cannot* attach a time-of-day shader to it, and you can't cleanly "night-ify" a daytime photo.
> So Phase A is **two tasks, laziest-first**: A1 drives day/night entirely through **lighting + fog
> + clear color + bloom** and *keeps your photo sky untouched* — a dawn/dusk/night colour-grade over
> the existing world. That may already sell it. **A2 (the dynamic sky: moving sun→moon, a night
> gradient + stars) is built only if A1's live grade says the static photo breaks the night
> illusion.** This is the ponytail bet — ship the cheap version, grade, layer only if needed.

### Task A1: Day/night driver — lighting, fog, bloom over the existing sky

**Files:**
- Modify: `world.js` (add `setTimeOfDay(t)` to the `buildWorld` return; keyframe table + lerp)
- Modify: `game.js` (time driver in `simulate`; `applySettings` seeds it; `?v=11`→`?v=12` first bump;
  `__sky` getters)
- Modify: `index.html` (Settings: Time-of-Day control; `?v` bump)
- Test: `tests/daynight.spec.js` (create)

**Contract:**
- `buildWorld(...)` returns an added `setTimeOfDay(t)` where `t ∈ [0,1)` (0 = midnight, 0.25 = dawn,
  0.5 = noon, 0.75 = dusk). It **lerps between a fixed keyframe table** — no geometry rebuild, no
  texture load, mutates existing handles only (same discipline as `setLook`, `world.js:399-400`):
  - `ambient.color`/`.intensity` (`world.js:177`), `dir.color`/`.intensity`/`dir.position` along a
    sun-elevation arc (`world.js:179-181`), `hemi.color`/`.groundColor`/`.intensity` (`world.js:182`).
  - `scene.fog.color` (`world.js:297`), and it returns/updates a `{ clearColor, bloomStrength }`
    descriptor game.js applies to `renderer.setClearColor` + `bloomPass.strength` (same seam as
    `applyLook`, `game.js:824-828`).
  - The visible **sun disc** (`world.js:133-174`) moves with `dir` (`sun.position` follows the arc)
    so the disc and the light agree; its shader uniforms are left at their current values in A1
    (recolouring the disc for dawn/dusk is A2).
- **Keyframe table** (5 stops, values are starting points — tuned live): `night(0.0)`, `dawn(0.22)`,
  `day(0.5)`, `dusk(0.78)`, back to `night(1.0)`. Each stop specifies ambient/dir/hemi colour+intensity,
  fog colour, clear colour, bloom strength. `day` == **exactly today's realistic constants**
  (ambient `0xb0c8e0`@0.55, dir `0xfff0d8`@1.1, hemi `0x88aacc`/`0x3a5a3a`@0.4, fog/clear
  `REALISTIC_HAZE`, bloom 0.6) so `t=0.5` is a pixel-identical no-op. `night` ≈ deep-blue ambient at
  ~0.25, dim cool dir at ~0.35, fog/clear scaled toward `NEON.dark`/indigo, **bloom up to ~1.0**
  (neon glow reads at night). `dawn`/`dusk` ≈ warm-orange dir, warm-tinted fog.
- Lerp uses `THREE.Color.lerpColors` into **module-scratch colours** (no per-frame alloc) and picks
  the bracketing pair by `t`. `setTimeOfDay` is idempotent and cheap enough to call every frame.
- **Coexistence with `setLook`:** `setLook(mode)` still sets the base look; `setTimeOfDay` multiplies
  on top by writing the same fog/clear/bloom handles *after* look is applied. Ordering rule:
  `applySettings` calls `applyLook(look)` **then** re-applies `setTimeOfDay(currentT)` so the cycle
  always wins the shared handles. Synthwave + night simply lerp toward the NEON dark end.
- **game.js time driver:** module `let _timeOfDay` and `let _dayNightMode` (`'day' | 'auto'`). In
  `simulate`, when `_dayNightMode === 'auto'` and `isFlying()`: `_timeOfDay = (_timeOfDay + dt /
  DAY_LENGTH) % 1` (`DAY_LENGTH = 180` s starting value — one full day per 3 min, tuned live), then
  `world.setTimeOfDay(_timeOfDay)`. In `'day'` mode `_timeOfDay` is pinned to `0.5` (noon) and
  `setTimeOfDay(0.5)` is applied once — **the current look, unchanged**. Uses no per-frame alloc.
- **Settings:** `DEFAULT_SETTINGS.dayNight = 'day'` (default off → today's look; `game.js:106-114`).
  Manual scrub: a slider writes `_timeOfDay` and sets mode to a paused manual state (`'day'` semantics
  but at the chosen `t`). `applySettings` seeds `_dayNightMode`/`_timeOfDay` from settings and calls
  `world.setTimeOfDay`. `syncSettingsUI`/`wireSettings` handle the control (mirror the `#set-look`
  wiring, `game.js:830-845`).
- **`__sky` additions:** `get timeOfDay()`, `setTimeOfDay(t)` (sets manual + applies),
  `get dayNightMode()`, `setDayNight(mode)`.

**Tests** (`tests/daynight.spec.js`):
- `test_noon_is_identity` — boot (realistic, default), read `dir.intensity`/`fog.color`/
  `bloom.strength`; call `__sky.setTimeOfDay(0.5)`; assert all three are unchanged within epsilon
  (noon == today's look, no regression).
- `test_night_dims_and_glows` — `setTimeOfDay(0.0)`; assert `dir.intensity` dropped below the noon
  value and `bloom.strength` rose above it (night is darker + glows more).
- `test_setTimeOfDay_monotonic_lerp` — sample `dir.intensity` at t = 0.0, 0.25, 0.5; assert it rises
  dawn→noon (a sanity check the lerp brackets correctly, not a flat value).
- `test_auto_cycle_advances` — `setDayNight('auto')`, tick 120×(1/60), assert `timeOfDay` advanced by
  ≈ `2/180` and stayed in `[0,1)`.
- `test_no_geometry_rebuild_no_alloc` — `setTimeOfDay` across several t values; assert `renderCalls`
  stays `< 500` and scene child count is unchanged (mutation-only, no leaked objects).
- `test_daynight_persists` — set mode via settings, reload, assert `__sky.settings.dayNight` restored.

**Verify:**
- `npx playwright test daynight perf` → pass; `npx playwright test` → still 73+ green (noon no-op
  keeps every existing spec valid).
- **Live gate (the grade):** serve, user flips to Auto and flies a full cycle. Does a lighting/fog/
  bloom colour-grade *alone* sell dawn→day→dusk→night over the photo sky? Tune `DAY_LENGTH` and the
  keyframe colours/intensities live. **If yes → Phase A is done, skip A2.** If the static photo sky
  fights the night (a bright photographed daytime sky behind a "night" world) → build A2.

**Commit:** `feat(world): day/night cycle — lighting, fog & bloom grade across a flyable day`

---

### Task A2 (conditional): Dynamic sky — moving sun/moon, night gradient, stars

**Build only if A1's live grade says the static photo sky breaks the night illusion.** If A1
suffices, mark this task "skipped — A1 sufficient" in `## Deviations` and move to Phase B.

**Files:**
- Modify: `world.js` (a repaint-driven dynamic `scene.background`; sun-disc → moon swap; star field
  visibility ramp)
- Modify: `game.js` (drive A2 handles from the same `_timeOfDay`)
- Test: extend `tests/daynight.spec.js`

**Contract:**
- Replace the static `scene.background` **only while the cycle is active** with a repainted
  `CanvasTexture` gradient sky, reusing the existing `altSky` pattern (`world.js:387-397`): a vertical
  gradient whose top/horizon colours come from the A1 keyframe table (day = a blue that approximates
  the photo's tone so `'day'` mode still reads familiar; night = indigo→black). Repaint is **CPU
  canvas, a few times per cycle** (throttled — e.g. only when `t` moves > 0.02 since last paint), not
  per frame; it adds **zero draw calls** (still one background pass). When `dayNight:'day'` (default),
  the original photo `skyTex` is restored — existing look preserved exactly.
- **Sun→moon:** the sun disc (`world.js:133-174`) drives its `uCore`/`uEdge` uniforms warm at day,
  and below the horizon it's hidden and a **moon** (reuse the same sphere with a cool cream material,
  or a second small disc) fades in at the opposite arc position. Both track `dir.position`.
- **Stars:** the existing star field (referenced in `buildWorld`) ramps opacity from 0 (day) to full
  (night) via material opacity — no new geometry.
- Everything keys off the single `_timeOfDay`; no second driver.

**Tests** (extend `tests/daynight.spec.js`):
- `test_dynamic_sky_repaint_bounded` — auto-cycle 600 ticks; assert `renderCalls < 500` throughout
  (repaint must not add passes) and background swaps happened (a repaint counter or texture-identity
  check).
- `test_day_mode_restores_photo` — set `dayNight:'day'`; assert `scene.background` is the original
  `world.sky` photo texture (not the canvas), i.e. default look is byte-for-byte preserved.
- `test_stars_fade_in_at_night` — `setTimeOfDay(0.0)` vs `0.5`; assert the star material opacity is
  higher at night.

**Verify:** `npx playwright test daynight perf` → pass. Live: fly a full cycle; sun arcs, sets, moon
+ stars come out, dawn returns. Confirm the *day* end still looks like the approved world.

**Commit:** `feat(world): dynamic sky — arcing sun→moon, night gradient & stars`

---

## Phase B — Weather

> Grade Phase A first. Weather layers on the day/night lighting (a storm dims the *current* time of
> day, it doesn't fight it). Two tasks: **B1** the atmosphere shift (fog/cloud/light — cheap, safe),
> **B2** the rain particle FX (the heavier, riskier bit). B1 alone gives "it clouded over"; B2 adds
> the downpour.

### Task B1: Weather atmosphere states (fog, cloud cover, light dimming)

**Files:**
- Modify: `world.js` (add `setWeather(state, intensity)` to the `buildWorld` return)
- Modify: `game.js` (weather driver in `simulate`; settings; `__sky` getters)
- Modify: `index.html` (Settings: Weather control; `?v` reuse of `v=12`)
- Test: `tests/weather.spec.js` (create)

**Contract:**
- `world.setWeather(state, intensity)` where `state ∈ {'clear','cloudy','storm'}` and
  `intensity ∈ [0,1]`. It lerps, over the **current day/night base** (multiplies, doesn't replace):
  - fog `far` distance **shortens** with intensity (clear far 6500 → storm far ~2500) and fog colour
    desaturates toward a grey derived from the current fog colour (scale toward `0x8a8f96`).
  - the instanced **clouds** (built in `buildWorld`) increase apparent cover: raise their material
    opacity / lower their y-spread / tint darker with intensity — **mutation only, no new clouds**.
  - overall light **dims**: scale `dir.intensity` and `ambient.intensity` down by up to ~40% at full
    storm (applied as a post-multiply after `setTimeOfDay`, so night-storm and day-storm both work).
  - `bloomStrength` nudged down slightly in heavy overcast (glow washes out in grey).
- Ordering: `applySettings` applies **look → time-of-day → weather** in that order every frame the
  driver runs, so weather is the outermost multiply on the shared handles.
- **game.js weather driver:** module `let _weather = 'clear'`, `let _weatherIntensity = 0`, and a
  target that eases in/out (weather **rolls in gradually** — `_weatherIntensity` lerps toward the
  target over ~8 s, not a snap). `'auto'` mode picks a new target state every 40–90 s (dt-accumulated
  via `_simClock`, deterministic — no `Math.random` in the per-frame path beyond the retarget tick).
  No per-frame alloc (scratch colours).
- **Settings:** `DEFAULT_SETTINGS.weather = 'clear'` (default off → today's look). Options
  Clear / Cloudy / Storm / Auto.
- **`__sky` additions:** `get weather()` → `{ state, intensity }`, `setWeather(state, intensity)`.

**Tests** (`tests/weather.spec.js`):
- `test_clear_is_identity` — `setWeather('clear',0)`; assert fog.far, dir.intensity, fog.color match
  the current-time baseline within epsilon (clear == no-op).
- `test_storm_shortens_fog_and_dims` — `setWeather('storm',1)`; assert `fog.far` decreased and
  `dir.intensity` decreased vs clear.
- `test_weather_multiplies_over_daynight` — set `setTimeOfDay(0.0)` (night) then `setWeather('storm',1)`;
  assert dir.intensity is below the *night* baseline (weather multiplies the current time, not the
  day baseline).
- `test_weather_eases_in` — `setWeather('storm',1)` as a target via the driver, tick a few frames,
  assert `weather.intensity` is between 0 and 1 (rolling in, not snapped) then reaches ~1 after ~8 s.
- `test_weather_no_alloc_no_rebuild` — several `setWeather` calls; `renderCalls < 500`, scene child
  count unchanged.
- `test_weather_persists` — set via settings, reload, assert restored.

**Verify:** `npx playwright test weather perf` → pass; full suite green. Live: switch to Storm mid-
flight; the world greys over, fog closes in, light drops — reads as weather, not a bug. Tune ranges.

**Commit:** `feat(world): weather states — fog, cloud cover & light dim from clear to storm`

---

### Task B2: Rain particle FX

**Files:**
- Create: `weather.js` (`Rain`)
- Modify: `game.js` (instantiate in `setupScene`, drive by weather intensity in `simulate`, dispose in
  `quitToMenu`; `?v` reuse; `__sky.rain` getter)
- Modify: `index.html` (import `weather.js` at `v=12`)
- Test: extend `tests/weather.spec.js`

**Contract:**
- `class Rain { constructor(scene, opts?) ; update(dt, camera, intensity) ; dispose() }`, importing
  only `three`. **One** `THREE.Points` (or one InstancedMesh of streaks) of `opts.count ?? 800`
  particles = **1 draw call**, a single shared material. Frustum culling off (it's camera-anchored).
- Particles live in a **box that follows the camera** (recycled: a particle falling below the box
  bottom or leaving the box wraps to the top — a ring buffer, **no allocation, no spawning**). Fall
  velocity + slight wind slant. `update` writes positions into the existing buffer attribute and sets
  `needsUpdate` — zero per-frame alloc (all scratch on the instance).
- `intensity` (from the weather driver) scales **visible count** (via `geometry.setDrawRange` or a
  per-point alpha threshold) and opacity — at `intensity 0` nothing draws (or the object is
  `visible=false`, skipping the draw entirely). At full storm, a convincing downpour.
- `dispose()` removes the Points, disposes geometry + material.
- **game.js:** `rain = new Rain(scene)` in `setupScene`; in `simulate` (only while `isFlying()`)
  `rain.update(dt, camera, _weatherIntensity if _weather==='storm' else 0)`; `rain.dispose()` +
  recreate across sessions like `_trail`/`traffic`; `rain.visible=false` when intensity 0.

**Tests** (extend `tests/weather.spec.js`):
- `test_rain_draw_budget` — force `storm@1`, 5 s real flight; assert `renderCalls < 500` still holds
  (rain adds ≤ ~1 draw). If the fixed addition pushes it, raise the perf threshold with a comment in
  the same commit.
- `test_rain_hidden_when_clear` — `setWeather('clear',0)`, tick; assert the rain object is not drawing
  (`visible === false` or drawRange 0).
- `test_rain_recycles_no_growth` — storm 600 ticks; assert the Points particle count is constant (ring
  buffer, no spawn/leak) and no per-frame scene-child growth.
- `test_rain_disposed_on_quit` — quit to menu; assert scene child count returns to baseline.

**Verify:** `npx playwright test weather perf` → pass. Live: Storm → visible rain that tracks the
camera and thins as the storm eases. Confirm it doesn't tank the frame on real hardware.

**Commit:** `feat(weather): camera-anchored rain that scales with storm intensity`

---

## Phase C — Bird flocks (wildlife at low altitude)

> Grade weather first. Flocks are the cheapest new system — a near-verbatim clone of `traffic.js`
> (`traffic.js:35-159`), which is already a proven instanced, zero-alloc, in-bounds wanderer. The
> value is **low-altitude life**: something to see (and later chase) when you fly close to the deck,
> where crashes now have teeth.

### Task C1: Instanced bird flock

**Files:**
- Create: `flock.js` (`Flock`)
- Modify: `game.js` (instantiate in `setupScene`, `update` in `simulate`, draw on minimap, dispose in
  `quitToMenu`; `__sky.flock` getter; `?v` reuse)
- Modify: `index.html` (import `flock.js` at `v=12`)
- Test: `tests/flock.spec.js` (create)

**Contract:**
- `class Flock { constructor(scene, opts?) ; update(dt, playerPos) ; dispose() }` in `flock.js`,
  importing only `three` and `WORLD_SIZE`/`terrainHeight` from `world.js` — same imports as
  `traffic.js:14`.
- **One `InstancedMesh`** of `opts.count ?? 40` birds, one shared low-poly geometry (a simple
  swept-wing "V" — two thin triangles, far cheaper than the traffic wedge) and one shared
  `MeshLambertMaterial` tinted from `NEON` or a natural dark — **1 draw call**, `frustumCulled=false`
  (`traffic.js:40-43` pattern). Birds cluster as a loose group around a shared **flock centroid** that
  wanders (not 40 independent wanderers): each bird steers toward `centroid + its personal offset`,
  giving cohesion without a full boids O(n²) neighbour loop. `// ponytail: centroid-cohesion, not
  full boids — upgrade to neighbour separation only if they clump ugly.`
- **Low + slow:** altitude band `terrainHeight + [40..260]` (below traffic's 180–900 — birds hug the
  terrain), speed 25–55 u/s. Nose along velocity; gentle bank (reuse the traffic bank cross-product,
  `traffic.js:119-125`). A subtle per-bird wing-flap (scale-y oscillation via the instance matrix) is
  optional polish, only if it's free.
- **Scatter-on-approach:** wire the `playerPos` argument that `traffic.js` accepts-but-ignores
  (`traffic.js:99-101`). When the player is within `SCATTER_RADIUS (90)`, birds add an outward-from-
  player steering impulse (burst away), then re-cohere after. This is both the "alive reaction" and
  the hook the Phase-D chase verb reads.
- **Bounds / above terrain / zero-alloc / dispose:** identical discipline to `traffic.js:135-158` —
  `BOUND = WORLD_SIZE*0.42` clamp, `minY = terrainHeight+…`, instance-held scratch, `dispose()`
  removes + disposes.
- Exposes `this.birds` (or reuses a `this.centroid` + a `scatteredAt` cooldown field on the flock)
  for the minimap + the chase verb.
- **game.js:** `flock = new Flock(scene)` in `setupScene`; `flock.update(dt, plane.position)` in
  `simulate` while `isFlying()`; draw the centroid (or each bird) as small dots on `drawMinimap`
  (a distinct colour, e.g. a dim `NEON.cyan`); dispose + recreate across sessions.
- **`__sky.flock`** getter.

**Tests** (`tests/flock.spec.js`):
- `test_flock_exists_and_moves` — boot, startMission, record centroid (or bird[0]) pos, tick 120×,
  assert it moved > 40 u and there are 40 birds.
- `test_flock_stays_in_bounds_above_terrain` — tick 600×; every bird within `±WORLD_SIZE*0.45` and
  `y > terrainHeight(x,z)`.
- `test_flock_scatters_near_player` — place the plane inside `SCATTER_RADIUS` of the centroid, tick a
  few frames; assert the mean bird distance from the plane **increased** (they fled).
- `test_flock_draw_budget` — 5 s flight; `renderCalls < 500` holds (flock adds ≤ ~1 draw).
- `test_flock_disposed_on_quit` — quit; scene child count returns to baseline.

**Verify:** `npx playwright test flock perf` → pass; full suite green. Live: fly low; a flock drifts
over the terrain and scatters when you dive through it. Does the deck feel alive?

**Commit:** `feat(world): low-altitude bird flocks that scatter when you fly through them`

---

## Phase D — Emergent verbs (something to *do* with the new world)

> Both verbs clone the **buzz pattern** (`game.js:999-1018`): gate on state, loop targets with a
> per-target dt-cooldown, award `totalScore` + `progression.grantXp` + `fx` + `audio` + toast, fire
> the level-up fanfare on `prog.leveledUp`, expose a `__sky` count. No new subsystems — they read the
> flock (C) and weather (B) built above.

### Task D1: "Chase the flock" verb

**Files:**
- Modify: `game.js` (verb in `simulate`; `__sky.flockChaseCount`)
- Test: `tests/verbs.spec.js` (create)

**Contract:**
- In `simulate` (free flight only, `!activeMinigame`), after `flock.update`: if the plane stays within
  `CHASE_RADIUS (110)` of the flock centroid **and** above `CHASE_MIN_SPEED (120)` for a **sustained**
  `CHASE_HOLD (2.5)` seconds (accumulate a `_chaseHeld` timer in `simulate` when in range, decay it
  when out), award once: `totalScore += 200`, `progression.grantXp(30,'chase')`, toast `FLOCK CHASE!
  +200`, `fx.ringBurst` at the centroid, `audio.play('chime')`, then set a `_chaseCooldown` (dt,
  ~12 s) before it can fire again. Level-up reuses the fanfare/flash path (`game.js:1013-1015`).
- The scatter (C1) is what makes it a *chase* — the flock flees, you keep pace. Uses the dt-based
  `_simClock`/timers, no per-frame alloc (scratch centroid vector).
- **`__sky.flockChaseCount`** getter (mirror `buzzCount`).

**Tests** (`tests/verbs.spec.js`):
- `test_chase_awards_after_hold` — pin the flock centroid near the plane, set speed 140, tick past
  `CHASE_HOLD`; assert `flockChaseCount === 1`, `totalScore` +200, toast was `FLOCK CHASE! +200`.
- `test_chase_needs_sustained` — same proximity but break contact before `CHASE_HOLD`; assert no award.
- `test_chase_needs_speed` — in range but speed 80; assert no award.
- `test_chase_respects_cooldown` — immediately after an award, re-satisfy conditions; assert count
  unchanged until cooldown elapses.

**Verify:** `npx playwright test verbs` → pass. Live: dive on a flock and stay with it as it scatters
— the reward fires and feels earned.

**Commit:** `feat(world): chase-the-flock verb — stay on a scattering flock for a reward`

---

### Task D2: "Race the storm" verb

**Files:**
- Modify: `game.js` (verb in `simulate`; `__sky.stormRaceCount`)
- Test: extend `tests/verbs.spec.js`

**Contract:**
- Meaningful only when `_weather === 'storm'` and `_weatherIntensity` is high. Reward **flying fast
  through heavy storm** — a risk/reward for the reduced-visibility, dimmed conditions the storm
  creates: if `_weather==='storm'` **and** `_weatherIntensity > 0.6` **and** `controller.speed >
  STORM_MIN_SPEED (150)` sustained for `STORM_HOLD (4)` s, award once per storm episode: `totalScore
  += 250`, `progression.grantXp(40,'storm')`, toast `STORM RUNNER! +250`, screen flash + `audio`,
  `_stormRaceArmed=false` until the storm fully clears (`intensity < 0.1`) and re-arms. Level-up
  fanfare on `prog.leveledUp`.
- One award per storm (the re-arm on clear prevents farming a standing storm); dt timers, no alloc.
- **`__sky.stormRaceCount`** getter.

**Tests** (extend `tests/verbs.spec.js`):
- `test_storm_race_awards_in_heavy_storm` — `setWeather('storm',1)`, speed 160, tick past `STORM_HOLD`;
  assert `stormRaceCount === 1`, `totalScore` +250, toast `STORM RUNNER! +250`.
- `test_storm_race_needs_heavy` — `setWeather('storm',0.3)` (light), same speed/time; assert no award.
- `test_storm_race_rearms_on_clear` — after an award, `setWeather('clear',0)` then back to
  `setWeather('storm',1)` and satisfy; assert a second award fires (re-armed).
- `test_storm_race_needs_speed` — heavy storm, speed 90; assert no award.

**Verify:** `npx playwright test verbs weather` → pass. Live: gun it through a storm; the reward lands
and the reduced-vis conditions make it feel like a run.

**Commit:** `feat(world): race-the-storm verb — outrun heavy weather at speed for a reward`

---

## Self-review

**Spec coverage (brief done-criteria / deferred items → task):**
- "World visibly alive (atmosphere)" beyond traffic → **A (day/night)**, **B (weather)**,
  **C (flocks)** ✓
- "A few emergent activities … chase a flock, race a storm" (named verbatim in the brief) →
  **D1**, **D2** ✓ (buzz from Plan 1 is the third)
- "Ecosystem staging: likely day/night → weather → traffic/wildlife, built incrementally" →
  phase order A→B→C, each live-graded before the next ✓
- "Perf budget honored / thresholds bumped deliberately" → cross-cutting + every task's perf test ✓
- Look already committed (realistic, Plan 1 T2) → A1 keeps the photo sky; the dynamic-sky
  replacement (A2) is explicitly gated on a live grade so the approved look isn't regressed blind ✓

**Deferred beyond Plan 2 (named, not placeheld):** per-biome weather, seasons, migratory flock
routes, ground wildlife, a full boids separation model (C1 ships centroid-cohesion with the upgrade
path noted), and the brief's open "minigame keep-set" decision (cut/rework Precision Drop + Flux Run)
— that's a product call for the user during Phase C/D live grades, not an ecosystem task.

**Placeholder scan:** none — every referenced symbol (`setTimeOfDay`, `setWeather`, `Rain`, `Flock`,
`timeOfDay`, `dayNightMode`, `weather`, `flock`, `rain`, `flockChaseCount`, `stormRaceCount`,
`DAY_LENGTH`, `CHASE_*`, `STORM_*`, `SCATTER_RADIUS`) is defined by a task. Every numeric tunable has
a starting value flagged "tuned live." A2 and (implicitly) B2 are the two *conditional* tasks, each
with an explicit build/skip criterion and a `## Deviations` note if skipped.

**Consistency:** `?v=11`→`?v=12` bumped once in A1 and reused (A2/B/C/D touch the same modules, no
second bump unless a later interface change forces it — note it if so). `setTimeOfDay`/`timeOfDay`,
`setWeather`/`weather`, `Flock`/`flock`, `Rain`/`rain` naming consistent across the tasks that define
and consume them. The verb tasks reuse `progression.grantXp` (Plan 1 T6) and the exact buzz award
shape (`totalScore` + `grantXp` + `fx.ringBurst` + `audio.play` + `showToast` + `prog.leveledUp`
fanfare) — no new progression surface.

**Risks:** (1) **The sky fork (A)** — driving day/night over a photo `scene.background` you can't
shade is the structural unknown; A1 sidesteps it (lighting/fog/bloom only) and A2 is gated on the
grade, so the approved look is never regressed without your say-so. (2) **`cpuMs < 16.7`** is the
binding perf guard — flocks (40 instances) and rain (800 particles) must hold the traffic.js zero-alloc
indexed convention; each has a perf test. (3) **Handle contention** — day/night, weather, and
`setLook` all write fog/clear/bloom; the documented apply order (look → time → weather, every driver
frame) is the single source of truth and is asserted by `test_weather_multiplies_over_daynight`.

## Deviations

_(append here as reality forces changes: planned → what happened → why)_

- **A1 sky: "preserve the photo, replace only if night fails" → replaced outright, live-graded.**
  The user said up front they disliked the static cloud photo, so the A1-first "keep the JPG" bet was
  moot. Shipped: the static `scene.background` photo is gone; the sky is now **dynamic** — a
  physically-based Three.js `Sky` dome (dusk/night) + a **hand-authored blue gradient dome for a
  clean CLEAR DAY** (`dayDome`, fades in only in full daylight) + a star field (fades in at night) +
  the existing clouds now drifting. One clock `setTimeOfDay(t)` drives sun direction, all three
  lights, fog (time-dependent near/far: crisp by day, hazy at dusk/night), bloom, and both dome
  opacities. `world.js` no longer loads `sky.jpg` (dropped `sky` from the return; added `skyDome`,
  `dayDome`, `stars`, `setTimeOfDay`).
- **Why the gradient day dome (not the physical sky for day):** the physically-based `Sky` desaturates
  to pale grey in daylight under the existing Reinhard tone-mapping and reads "hazy/immersive," which
  the user rejected ("clear day style for daylight"). Hand-authoring the day blue in a gradient dome
  is the only thing that held a clean clear blue — the physical sky was never going to. (User's taste
  law: *two rejected passes = wrong foundation; adjectives don't converge, element specs do.*)
- **Renderer exposure 1.15 → 0.75** (`game.js` `toneMappingExposure`): the old value blew the
  atmospheric daytime sky to white and washed the backlit plane out. Global change; dusk/night (which
  the user liked) stayed good and the neon actually reads better in the darker frame.
- **A2 (dynamic sky, sun→moon, stars) folded into A1** — stars + dynamic sky shipped as part of the
  A1 build, so there is no separate A2 task. Sun disc: the atmospheric dome renders its own sun;
  the synthwave banded disc is hidden in the realistic look.
- **Rendering bug caught in live grade:** the transparent `dayDome` with `depthTest:false` painted
  over the opaque terrain (transparent objects draw after opaque). Fixed with `depthTest:true` +
  larger radius so terrain occludes it. (Lesson: a transparent full-screen sky layer must depth-test.)
- **Settings:** added a "Day / Night Cycle" toggle (`dayCycle`, default on) instead of the planned
  Auto/Fixed + manual-slider control — YAGNI; the toggle + the `__sky.setTimeOfDay` scrub cover it.
  The cycle **freezes under Reduced Motion** (accessibility: a moving sky is motion); cloud drift too.
