# Plan — Living Open-World Sky Ace: Foundation (Plan 1 of 2)

**Brief:** `docs/briefs/2026-07-04-living-open-world-skyace.md` — read it first.
**Scope:** This plan lands the *foundation* — feel, look, stakes, connection, one living-world
system, one emergent verb, and a progression payoff. The **fuller ecosystem** (weather,
day/night, bird flocks, more emergent activities) is deliberately split into **Plan 2**,
which can't be well-specified until the look is chosen (Task 2) and the traffic MVP proves the
feel (Tasks 5–6). Splitting per the writing-plans rule: two subsystems, each shippable alone.

**Isolation:** Execute on a branch, not `main` — e.g. `feat/open-world-foundation`.
⚠️ The working tree is currently **dirty** (uncommitted higgsfield/ux merge reconciliation on
many files). Before starting: commit or stash that so this plan's diffs are clean and
reviewable. Branch from that committed state.

**Cross-cutting rules (apply to every task):**
- **No build step.** Plain ES modules + importmap. Never add a bundler/dependency.
- **Cache-busting.** Any task that changes a module's public interface bumps its `?v=N` in
  **every** importer *and* the `<script>` in `index.html`, consistently. Current version: `?v=10`.
  This plan bumps to `?v=11` once (Task 1, first module change); later tasks reuse `v=11` unless
  a second coordinated bump is needed.
- **`window.__sky` is the test contract.** New systems that tests must see get a getter here.
- **Perf budget.** Hot paths (`simulate`, `updateCamera`, `PlaneController.update`, traffic
  `update`, `drawMinimap`) allocate **nothing** per frame — use module/instance scratch objects.
  Keep `renderCalls < 500`, `tris < 130_000`, `cpuMs < 16.7`. If a task legitimately raises a
  budget, bump the threshold in `tests/perf.spec.js` **in the same commit** with a comment saying why.
- **Locked palette.** Reuse the `NEON` export (`world.js`): `#1a0b2e #ff2e88 #b14bff #00ffd5 #ffcf4d`.

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `plane.js` | modify | `PlaneController.update` — weaken auto-level so banks *hold*; snappier throttle; expose `levelAssist` tunable. |
| `world.js` | modify | Add `setLook(mode)` to swap realistic ⇄ synthwave (terrain/sky/fog/clear). Returned from `buildWorld`. |
| `traffic.js` | **create** | `Traffic` class — ambient aircraft that wander waypoints, cull/LOD, expose positions for radar + buzz. Zero per-frame alloc. |
| `progression.js` | modify | `grantXp(n, reason)` (free-flight XP), `UNLOCKS` table, `getUnlocks()`, `equip(kind,id)` wiring the dead `unlocked`/`equipped` fields. |
| `game.js` | modify | Crash+respawn (replace soft-floor); diegetic `resultNext` (no teleport); look toggle wiring; traffic integration + buzz verb; apply equipped skin/trail; `__sky` getters. |
| `index.html` | modify | Settings UI: look toggle + hangar (equip skin/trail). `?v` bumps. |
| `tests/*.spec.js` | modify/create | New specs (hold-turn, crash/respawn, diegetic, traffic, buzz, equip); update perf threshold + any spec that flew on the soft-floor. |

---

## Phase 0 — Feel & Look (cheap, high-signal, user-graded)

### Task 1: Flight holds a turn + snappier throttle

**Files:**
- Modify: `plane.js` (`PlaneController` constructor + `update`, the `rollCorrection` block ~L180 and throttle block ~L146–152)
- Modify: `game.js` (`applySettings` — pass a `levelAssist` from settings if we add the slider; otherwise default), `?v=10`→`?v=11` on the `plane.js` import
- Modify: `index.html` (`?v` bump for `plane.js`; optional "Flight Assist" slider in settings)
- Test: `tests/controls.spec.js` (create)

**Contract:**
- Add `this.levelAssist = 0.25` to the constructor (0 = no auto-level, 1 = today's aggressive
  snap). Starting value **0.25**; final value tuned live with the user flying.
- Replace the roll auto-level with an assist-scaled, weaker spring:
  ```js
  let rollCorrection = 0;
  if (tRoll === 0) rollCorrection = -bankSin * 3.0 * this.levelAssist; // was -bankSin * 3.0
  ```
  Pitch self-centering likewise scaled: `pitchCorrection = -noseUpSin * 0.6 * this.levelAssist`.
- Throttle response: `this.throttleResponse = 0.4 → 1.0` (full sweep ≤ ~1s) and speed lerp
  `dt * 0.8 → dt * 1.6` in `update`. Boost unchanged. Starting values; tuned live.
- **Do NOT change the W/S pitch mapping.** The user's control complaint was "won't hold a
  turn," not "pitch is backwards"; pitch inversion already ships as a settings toggle
  (`invertPitch`). Leave default; revisit only if the user says so while driving.
- No new per-frame allocations. `getHeadingDeg`/`getSpeedKts`/`getAltitudeFt` unchanged.

**Tests** (`tests/controls.spec.js`):
- `test_bank_holds_after_release` — `keyboard.down('a')`, tick 30×(1/60), `keyboard.up('a')`,
  tick 60×(1/60). Read bank from plane quaternion (`right.y`). Assert the post-release bank is
  **≥ 60% of the peak held bank** (today's code decays to ~0 → this fails pre-fix, passes post-fix).
- `test_throttle_reaches_full_within_1s` — `keyboard.down('Shift')`, tick 60×(1/60), assert
  `controller.throttle === 1` and `controller.getSpeedKts()` within 5% of target max.
- `test_no_input_still_flies_straight` — no keys, tick 120×, assert heading drift < 3° (a
  weakened assist must still not let the nose wander uncontrollably).

**Verify:**
- `npx playwright test controls` → all pass.
- **Live gate (the real grade):** `node tests/server.js`, user flies, confirms by hand the
  plane holds a bank and throttle feels responsive. Tune `levelAssist`/throttle constants with
  the user until they approve. Record the final numbers in the commit message.

**Commit:** `feat(flight): banks hold instead of auto-snapping level; snappier throttle`

---

### Task 2: Look A/B — synthwave vs realistic, chosen live

**Files:**
- Modify: `world.js` (add `setLook`, return it from `buildWorld`)
- Modify: `game.js` (call `world.setLook(settings.look)` in `applySettings`; default in `DEFAULT_SETTINGS`)
- Modify: `index.html` (Settings: a `look` toggle: "Realistic / Synthwave"; `?v` bump)
- Test: `tests/look.spec.js` (create)

**Contract:**
- `buildWorld` returns an added `setLook(mode)` where `mode ∈ {'realistic','synthwave'}`:
  - `'realistic'` — today's look exactly (grass/rock/snow terrain, painterly sky JPG,
    fog `0x88a8c8`, clear `0x88a8c8`, bloom strength 0.6).
  - `'synthwave'` — dark ground (`NEON.dark`) with a cyan wireframe/emissive grid overlay on
    the terrain, sky → dark vertical gradient (magenta horizon → indigo zenith), fog +
    clear color → `NEON.dark`, bloom strength → ~1.1. Reuse `NEON` only; introduce no new colors.
  - Switching must not rebuild geometry (toggle material/uniform/visibility only) and must not leak
    (dispose any swapped-in textures on re-toggle, or build both once and toggle visibility).
- `DEFAULT_SETTINGS.look = 'realistic'` until the user picks; persisted in `sky_settings`.
- `applySettings` calls `world.setLook(settings.look)`; `syncSettingsUI`/`wireSettings` handle the toggle.
- Expose `window.__sky.setLook = (m) => world.setLook(m)` for the live demo + test.

**Tests** (`tests/look.spec.js`):
- `test_setLook_no_errors_no_geometry_rebuild` — boot, `setLook('synthwave')` then
  `setLook('realistic')`, assert no console/page errors and `renderCalls` stays `< 500` in both.
- `test_look_persists` — set look via settings toggle, reload, assert `__sky.settings.look` restored.

**Verify:**
- `npx playwright test look` → pass.
- **Live gate (the decision):** serve the game, user toggles both looks in-flight and **picks
  one**. Set `DEFAULT_SETTINGS.look` to the pick. Keep the toggle as a retained setting (built,
  cheap) unless the user wants the loser ripped out — if so, a follow-up commit deletes the
  unused branch. Update the brief's "look" done-criterion + note the pick in `## Deviations`.

**Commit:** `feat(world): live-switchable synthwave/realistic look; default <pick>`

---

## Phase 1 — Stakes & Connection

### Task 3: Real crash consequence (replace the soft floor)

**Files:**
- Modify: `game.js` (`simulate` soft-floor block L825–834 → crash logic; add `crashAndRespawn`;
  `__sky` getter for crash count)
- Test: `tests/crash.spec.js` (create); update `tests/regression.spec.js`, `tests/perf.spec.js`

**Contract:**
- Remove the soft-floor lift (`if (plane.position.y < ground + 8) plane.position.y = ground + 8`).
  **Keep** the world-bounds XZ clamp (`WORLD_SIZE * 0.45`) — regression test + open-world wall depend on it.
- Add crash detection in `simulate`, gated to `isFlying()`:
  ```js
  const ground = terrainHeight(plane.position.x, plane.position.z);
  if (plane.position.y < ground + CRASH_MARGIN && _crashCooldown <= 0) { crash(); }
  ```
  `CRASH_MARGIN = 6`. `_crashCooldown` (module-level, seconds) prevents re-triggering every
  frame during recovery; set to `1.2` on crash, decremented in `simulate`.
- `crash()` behavior:
  - Free flight (`state === PLAYING`): `fx.explosion` at plane pos (size 1.6), `addShake`,
    `flashScreen(0.3,'#ff6a4d')`, `audio.playVoice('failed')`, then **respawn**: `plane.position.y
    = ground + 250`, `plane.quaternion.identity()`, `controller.speed = 120`, velocity re-derived.
    Toast `CRASHED — RECOVERING`. No score/XP loss (nothing to lose in free flight). `_crashCount++`.
  - Minigame (`state === MINIGAME`): set `activeMinigame.finishReason = 'CRASHED'`,
    `activeMinigame.done = true` → existing `endMinigame` flow shows the result as a non-completion
    (grade path already handles `reason !== 'COMPLETE'`). This gives Canyon Dash + low passes real
    teeth (brief: terrain-can-kill synergy). Explosion FX + shake as above before ending.
- Crash must not spam FX (cooldown covers it) so perf stays bounded.
- `window.__sky.crashCount` getter (read `_crashCount`) for tests.

**Tests** (`tests/crash.spec.js`):
- `test_free_flight_crash_respawns_above_ground` — boot, startMission, force plane to
  `y = terrainHeight - 50` at some XZ, tick, assert `crashCount === 1` and
  `plane.position.y > terrainHeight(x,z)` (respawned up), state still `playing`.
- `test_crash_cooldown_single_trigger` — after a crash, tick 3× while still below ground within
  cooldown window, assert `crashCount` did not increment more than once.
- `test_minigame_crash_ends_as_crashed` — `forceMinigame('canyon')`, drive plane into terrain,
  tick, assert `state === 'result'` and last result title contains `CRASHED`.

**Test maintenance (same task):**
- `tests/regression.spec.js` `[POLISH] completing a mission` copies the plane onto ring
  positions (elevated, safe) — verify it still passes; rings sit at `terrainHeight+~120`.
- `tests/perf.spec.js` flies 5s of real frames from spawn — confirm the straight-ahead path
  doesn't now crash-loop into a peak and spike draw calls. If it does, spawn/heading or the
  crash cooldown covers it; only if genuinely needed, bump the `drawCalls` threshold **with a
  comment**. Re-run and record the observed numbers.
- Grep all specs for reliance on "plane never goes below terrain"; fix any that assumed the floor.

**Verify:**
- `npx playwright test crash regression perf minigames boot bloom mastery` → all green.
- **Live gate:** serve, user flies into a mountain, confirms the crash reads as fair (clear
  feedback, respawn near, not rage-inducing). Tune `CRASH_MARGIN`/respawn altitude live.

**Commit:** `feat(flight): terrain can crash you now — fair respawn in free flight, CRASHED end in minigames`

---

### Task 4: Diegetic missions (kill the teleport-skip)

**Files:**
- Modify: `game.js` (`resultNext` L1095–1117; relabel button in `index.html`)
- Modify: `index.html` (result button text: "NEXT" → "BACK TO FLIGHT" or keep "NEXT")
- Test: `tests/diegetic.spec.js` (create)

**Contract:**
- `resultNext` must **not** teleport to the next mission. Instead it resumes free flight exactly
  like `resultContinue` (nudge forward + up, `state = PLAYING`), leaving the `#waypoint` arrow to
  guide the player to the nearest uncleared marker — which they must **fly to** (auto-enter at
  <100 m still works via `checkMissions`). Keep the `else`/all-cleared branch behavior.
- `forceMinigame` (used by `resultRetry` and the whole test suite) **keeps** its teleport — Retry
  re-entering the same activity you just played is fine, and tests depend on it. Only the "Next →
  next mission" auto-skip is removed.
- Optional: relabel the result button so it no longer implies teleport.

**Tests** (`tests/diegetic.spec.js`):
- `test_next_does_not_teleport` — complete a mission (drive ring like the regression test),
  record plane XZ, click/`resultNext()`, assert plane XZ is within a small nudge (< 400 u) of
  where it finished — **not** at another marker's coordinates, and `state === 'playing'`
  (not `'minigame'`).
- `test_retry_still_enters_same_mode` — after a run, `resultRetry()`, assert `state ===
  'minigame'` and `activeMinigame.mode` equals the just-played mode (forceMinigame teleport intact).

**Verify:** `npx playwright test diegetic regression` → pass. Live: complete a mission, confirm
you're dropped back into open sky with the waypoint pointing at the next one, and must fly there.

**Commit:** `feat(flow): completing a mission returns you to open flight — no more teleport-skip`

---

## Phase 2 — Living world MVP (atmosphere + the first verb)

> **Ecosystem MVP choice:** *ambient air traffic* sells "alive" for the least work and is the
> only option that is **both** atmosphere **and** the seed of an emergent activity (buzz/tail).
> It reuses existing patterns (plane mesh, Dogfight-style wander, radar markers) and fits the
> no-combat stakes (you buzz them, you don't shoot them). Weather / day-night / flocks are
> Plan 2 — they're pure atmosphere and heavier (the sky is a static JPG background today, so
> day/night means replacing the sky system).

### Task 5: Ambient air traffic

**Files:**
- Create: `traffic.js`
- Modify: `game.js` (instantiate in `setupScene`, `update` in `simulate`, draw on minimap,
  dispose in `quitToMenu`; `__sky.traffic` getter; `?v` for `traffic.js`)
- Modify: `index.html` (`<script>`/import `?v` for `traffic.js`)
- Test: `tests/traffic.spec.js` (create)

**Contract:**
- `class Traffic { constructor(scene, opts?) ; update(dt, playerPos) ; dispose() }` in `traffic.js`,
  importing only `three` and `WORLD_SIZE`/`terrainHeight` from `world.js`.
- Spawns `opts.count ?? 6` low-poly aircraft (a shared simplified geometry — a stretched wedge +
  wings, **not** the full `createPlane` group; keep tris low). Reuse one shared material per
  color; **instanced or shared-geometry** so total added draw calls stay `< 40`.
- Each craft flies a smooth waypoint wander: pick a random target within `±WORLD_SIZE*0.42`, at
  altitude `terrainHeight + [180..900]`, cruise toward it, retarget on arrival or every 8–14 s;
  bank into turns visually. Speed 60–140 u/s. Nose points along velocity.
- Keeps craft inside bounds and above terrain (they never crash — they're ambient).
- Exposes `this.craft` (array with `.position` and a `.buzzedAt` cooldown field) for radar + Task 6.
- **Zero per-frame allocation** in `update` — instance-held scratch vectors/quaternions.
- `dispose()` removes meshes + disposes geometry/material.
- `game.js`: `traffic = new Traffic(scene)` in `setupScene`; `traffic.update(dt, plane.position)`
  in `simulate` (only while `isFlying()`); draw craft as small dots on `drawMinimap` (distinct
  color, e.g. `NEON.gold`); `traffic.dispose()` + recreate across sessions like `_trail`.
- `window.__sky.traffic` getter.

**Tests** (`tests/traffic.spec.js`):
- `test_traffic_exists_and_moves` — boot, startMission, record craft[0] pos, tick 120×, assert it
  moved > 50 u and there are 6 craft.
- `test_traffic_stays_in_bounds_above_terrain` — tick 600×, assert every craft is within
  `±WORLD_SIZE*0.45` and `y > terrainHeight(x,z)`.
- `test_traffic_draw_budget` — after 5s real flight, `renderCalls < 500` still holds (extends the
  perf guard; if the fixed additions push it, raise the perf threshold with a comment in the same commit).
- `test_traffic_disposed_on_quit` — quit to menu, assert scene child count returns to baseline
  (no leaked craft).

**Verify:** `npx playwright test traffic perf` → pass. Live: fly around, confirm the sky reads as
*alive* — other aircraft crossing, visible on radar.

**Commit:** `feat(world): ambient air traffic — the sky is alive now`

---

### Task 6: The verb — buzz / tail traffic for a reward

**Files:**
- Modify: `progression.js` (add `grantXp`)
- Modify: `game.js` (buzz detection in `simulate`; toast + score + XP; `__sky` buzz count)
- Test: `tests/buzz.spec.js` (create); `tests/progression`-style unit if one exists

**Contract:**
- `progression.grantXp(n, reason)` — adds `n` XP to the profile, recomputes level/rankTitle,
  persists, returns `{ gained, xp, level, prevLevel, leveledUp, rankTitle }` (same level-up shape
  `addRun` returns, minus medals). Ad-hoc free-flight XP, distinct from the minigame `addRun` path.
- Buzz detection in `simulate` (free flight only): for each `traffic.craft`, if
  `plane.position.distanceTo(craft.position) < BUZZ_RADIUS (60)` **and** `controller.speed >
  BUZZ_MIN_SPEED (140)` **and** the craft's `buzzedAt` cooldown has elapsed (`> 8 s`):
  award — `totalScore += 150`, `progression.grantXp(25,'buzz')`, toast `BUZZ! +150`, small FX
  (`fx.ringBurst` at midpoint), `audio` cue, set `craft.buzzedAt = now`. If the grant `leveledUp`,
  reuse the existing level-up flash/fanfare path.
- Cooldown per craft prevents farming one plane; global rate is naturally bounded by 6 craft.
- No per-frame allocation (reuse a scratch vector for the midpoint).
- `window.__sky.buzzCount` getter for tests.

**Tests** (`tests/buzz.spec.js`):
- `test_buzz_awards_once` — place a craft next to the plane, set `controller.speed = 160`, tick,
  assert `buzzCount === 1`, `totalScore` increased by 150, toast text was `BUZZ! +150`.
- `test_buzz_respects_cooldown` — immediately tick again within cooldown, assert `buzzCount` unchanged.
- `test_buzz_needs_speed` — same proximity but `controller.speed = 80`, tick, assert no buzz.
- `test_grantXp_levels_up` (progression unit) — `grantXp` enough to cross a level boundary returns
  `leveledUp: true` and persists the new level.

**Verify:** `npx playwright test buzz` → pass. Live: dive on a passing aircraft at speed, confirm
the `BUZZ!` reward fires and feels good — the first real "something to do" between missions.

**Commit:** `feat(world): buzz passing aircraft for score + XP — the first emergent verb`

---

## Phase 3 — Progression payoff (make leveling *do* something)

### Task 7: Wire the dead unlock/equip system to a visible reward

**Files:**
- Modify: `progression.js` (`UNLOCKS`, `getUnlocks`, `equip`, auto-unlock in `addRun`/`grantXp`)
- Modify: `game.js` (apply `equipped` skin → plane material color + trail color on `startGame`;
  hangar menu wiring; `__sky` getters)
- Modify: `index.html` (a "HANGAR" panel on the start screen: pick unlocked skin + trail)
- Test: `tests/hangar.spec.js` (create)

**Contract:**
- `UNLOCKS` in `progression.js`:
  ```js
  export const UNLOCKS = {
    skins: [ // id, name, plane body color, unlockLevel
      { id: 'magenta', name: 'Magenta',  color: 0xff2e88, level: 1 },
      { id: 'cyan',    name: 'Ion Cyan',  color: 0x00ffd5, level: 3 },
      { id: 'gold',    name: 'Gold Ace',  color: 0xffcf4d, level: 7 },
      { id: 'void',    name: 'Void',      color: 0xb14bff, level: 12 },
    ],
    trails: [
      { id: 'off',    name: 'Off',        color: null,     level: 1 },
      { id: 'cyan',   name: 'Cyan',       color: 0x00ffd5, level: 1 },
      { id: 'pink',   name: 'Pink',       color: 0xff2e88, level: 5 },
      { id: 'gold',   name: 'Gold',       color: 0xffcf4d, level: 10 },
    ],
  };
  ```
  (Colors from the locked `NEON` palette only.)
- `getUnlocks()` → `{ skins:[{...,unlocked:bool}], trails:[...], equipped }` resolving `unlocked`
  by `profile.level >= item.level` (level-gated; no currency). `equip(kind, id)` validates the id
  is unlocked, writes `profile.equipped[kind]`, persists, returns updated equipped. Reject
  equipping a locked item (return current unchanged).
- `addRun`/`grantXp`: on level-up, no explicit unlock write needed (unlock is derived from level),
  but ensure `getUnlocks` reflects newly-crossed thresholds immediately.
- `game.js`: on `startGame` (and after equip), apply `equipped.skin` color to the plane's body
  material and `equipped.trail` color to the wingtip `Trail`. A `Trail` with `trail:'off'` stays hidden.
- Hangar UI: start-screen panel lists skins/trails with locked ones greyed + "LV N" label;
  clicking an unlocked one equips it (persists). `__sky.getUnlocks`, `__sky.equip` exposed.

**Tests** (`tests/hangar.spec.js`):
- `test_unlocks_gate_by_level` — seed profile xp for level 1, assert only level-1 skins/trails are
  `unlocked`; seed for level 8, assert gold skin unlocked, void still locked.
- `test_equip_locked_rejected` — at level 1, `equip('skins','void')`, assert equipped skin unchanged.
- `test_equip_applies_to_plane` — unlock + `equip('skins','cyan')`, start game, assert the plane
  body material color equals `0x00ffd5`.
- `test_equipped_persists` — equip, reload, assert `getUnlocks().equipped` restored.

**Verify:** `npx playwright test hangar` → pass. Live: level up, see a new skin unlock in the
hangar, equip it, confirm the plane changes. Leveling now visibly *buys* something.

**Commit:** `feat(progression): level-gated hangar — skins & trails you unlock and equip`

---

## Self-review

**Spec coverage (brief done-criteria → task):**
- Flight holds a turn → **T1** ✓ · Pitch/throttle feel → **T1** ✓ (pitch left default by design, noted)
- Art direction committed live → **T2** ✓
- World visibly alive (atmosphere) → **T5** ✓ · Emergent activities (verb) → **T6** ✓ (more in Plan 2)
- Real crash consequence, soft-floor gone → **T3** ✓
- Diegetic minigames, no teleport → **T4** ✓
- Leveling changes something visible → **T7** ✓
- Perf budget honored / thresholds bumped deliberately → cross-cutting + **T3/T5** ✓

**Deferred to Plan 2 (named, not placeheld):** weather, day/night cycle, bird flocks, additional
emergent activities (escort/intercept/storm-race), minigame culling of Precision Drop + Flux Run
(a brief-flagged decision — kept live as diegetic destinations in Plan 1, re-evaluated once the
open-world frame shows which fit). Crash-loop fairness knobs and session-shape are validated live
during T3/T6.

**Placeholder scan:** none — every referenced symbol (`levelAssist`, `setLook`, `crash`,
`grantXp`, `UNLOCKS`, `getUnlocks`, `equip`, `Traffic`, `buzzCount`, `crashCount`) is defined by a
task. Numeric starting values are given for every tunable, each flagged "tuned live."

**Consistency:** `?v=11` bump introduced in T1 and reused; `Traffic`/`traffic` naming consistent
T5↔T6; `equipped`/`unlocked` fields match the existing `progression._defaultProfile`;
`finishReason='CRASHED'` flows through the existing `endMinigame`→`showResult` `reason` path.

**Risks:** (1) removing the soft-floor is the highest-blast-radius change — T3 explicitly audits
every flying spec. (2) Perf: T5 traffic is the main draw-call risk — instancing/shared-geometry is
a hard contract, and the perf threshold moves only with a commented commit.
