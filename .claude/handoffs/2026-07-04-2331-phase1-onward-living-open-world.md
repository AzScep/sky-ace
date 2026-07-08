# Handoff: Living Open-World Sky Ace — Phase 1 onward

## Goal
Execute the "Living Open-World Sky Ace: Foundation" plan
(`docs/plans/2026-07-04-living-open-world-foundation.md`, from
`docs/briefs/2026-07-04-living-open-world-skyace.md`). Seven tasks in four phases:
- **Phase 0 (T1 feel, T2 look) — DONE & committed.**
- **Phase 1 (T3 crash consequence, T4 diegetic missions) — NEXT.**
- Phase 2 (T5 ambient traffic, T6 buzz verb), Phase 3 (T7 hangar) — after.
- Plan 2 (weather/day-night/flocks) is deliberately deferred until Plan 1 lands.

The plan is the source of truth for contracts/tests. **Read it, and pass its path to
every subagent.** This handoff carries only what's not already in the plan/commits.

## Current state
- **Branch:** `feat/open-world-foundation` (off `main` `ba234fd`; `main` untouched).
- **Commits (newest first):**
  - `a4b8c84` feat: Phase 0 — flight feel, look toggle, 3D jet (code + tests)
  - `0f60d41` chore(assets): Higgsfield jet GLB
  - `5f5b5a6` chore: WIP base snapshot (the pre-existing higgsfield/ux merge reconciliation)
- **Tree: clean.**
- **DONE + verified** (25 passing specs + live user approval "looks really good" + screenshots):
  T1 flight feel (banks hold, snappier throttle, faster steering, Flight-Assist slider),
  T2 look toggle (default **realistic** per user; synthwave kept as a toggle),
  the plane model (real Higgsfield 3D jet via GLTFLoader), wingtip trail removed.
- **Done but NOT user-confirmed:** the engine-loop audio tweak (blind tune — I can't
  audition audio; user hasn't yet said whether the "whoosh" is fixed). Steering was
  bumped after the user asked for "a bit faster" — they approved the plane but re-confirm
  the steering amount if you get the chance.
- **Background:** a `node tests/server.js` is serving `http://localhost:4173` (leftover
  from this session). Reuse it or restart.

## Key files & artifacts
- `docs/plans/2026-07-04-living-open-world-foundation.md` — the plan (T3/T4 are next).
- `game.js` — orchestrator: `State` machine, `simulate(dt)` (all game logic; tests drive
  it via `window.__sky.tick(dt)`), `loadPlaneModel()` (GLB swap), `applyLook()`,
  `resultNext/resultContinue/resultRetry/forceMinigame`, the soft-floor block, `__sky`.
- `plane.js` — `PlaneController` (`levelAssist`, `turnAuthority`), `createPlane()` (primitive fallback).
- `world.js` — `setLook`, `REALISTIC_HAZE`, `terrainHeight(x,z)`, `WORLD_SIZE`, `NEON`.
- `minigames.js` — `Minigame` base (`finish(reason)` sets `finishReason`), the 5 minigames.
- `progression.js` — profile/XP/levels; **T6 adds `grantXp`, T7 adds `UNLOCKS/getUnlocks/equip`**.
  Dead `unlocked`/`equipped` profile fields already exist for T7 to wire.
- `assets/models/skyace.glb` — the jet (5.3 MB, texture-heavy — compress before any prod deploy).
- `tests/controls.spec.js`, `tests/look.spec.js` — Phase 0 specs (patterns to copy).

## Landmines (hard-won this session — do not re-derive)
1. **T3 PLAN BUG — the plan's crash-in-minigame premise is WRONG.** The plan says setting
   `activeMinigame.finishReason='CRASHED'` renders as a non-completion because "the grade path
   handles `reason !== 'COMPLETE'`". It does **not**: the real discriminator is
   `reason !== 'TIME UP'` — see `game.js` `win = reason !== 'TIME UP' && grade !== 'D'` (~L432)
   and `completed: reason !== 'TIME UP'` (~L367). So `'CRASHED'` currently reads as a **win**
   (victory fanfare + green flash + `playVoice('complete')` + `completed:true`). **T3 must also
   patch those two lines to exclude `'CRASHED'`.** The plan's own test only checks the result
   *title* text, which passes even with the bug — add an assertion on `win`/`completed`.
2. **Perf budget is tight: tris ~113k of the 130k cap** (the GLB adds ~10k). **T5 traffic MUST
   use shared/instanced geometry** (the plan's hard contract) or it blows the budget. Bump a
   perf threshold ONLY in the same commit with a comment saying why (`tests/perf.spec.js`).
3. **Soft-floor removal (T3) is the highest-blast-radius change.** The perf spec flies ~5s of
   real frames straight from spawn `(0,350,0)`; terrain peaks reach ~700, so without the
   soft-floor the plane dives into a peak and `crash()`+FX+respawn can crash-LOOP and blow the
   perf budget. Respawn altitude (`ground+250`) + a `_crashCooldown` must prevent that.
   **Margin-sensitive minigame specs:** Canyon gates sit at `terrainHeight+30`, Dogfight enemies
   are clamped `y>=200` but spread over peaks — if `CRASH_MARGIN` is tuned above ~24 these specs
   flip to `CRASHED`. Audit every flying spec (the plan's T3 test-maintenance section lists them).
4. **GLB orientation is correct — don't "fix" it.** `PLANE_MODEL_ROT.y = +π/2` renders the jet
   nose-forward (user-verified). The GLB nose sits on **−X**. A code-review flagged the sign as
   "may fly tail-first" — that was reasoning from a since-corrected comment; the code is right.
5. **Live gates need the USER.** Feel/look/crash-fairness/buzz-feel are graded by the user flying
   (chat feedback is the grade); screenshots verify *mechanics*, not taste. Serve
   `node tests/server.js` → `http://localhost:4173` and let them drive.
6. **Committing:** a PreToolUse quality-gate hook blocks `git commit` unless `QGATE=ok` is the
   **first token** of the command AND a `/code-review` + verify (drive the real flow) happened
   this session. Use `git -C "<repo>" commit …` so `QGATE=ok` can lead (no `cd` prefix). The hook
   blocks the *whole* Bash call, so stage in a separate call first.
7. **`window.__sky` is the test contract.** New systems get a getter (plan names `crashCount`,
   `traffic`, `buzzCount`, `getUnlocks`, `equip`). `helpers.js boot()` waits on `__sky.plane`.
8. **No build step. `?v=11` is uniform now.** On any module interface change bump `?v` across
   *every* importer + `index.html` consistently. `world.js` has **two** importers
   (`game.js` and `minigames.js`) — easy to miss.

## Next steps (ordered)
1. (Optional, quick) Get the user's read on the engine-audio whoosh and steering speed — both
   are still open live-gate items from Phase 0.
2. **Phase 1 / Task 3 — real crash consequence.** Follow the plan's Task 3, but apply landmine #1
   (also patch the `win`/`completed` discriminators) and #3 (respawn/cooldown to protect perf +
   audit the margin-sensitive minigame specs). Live-grade crash fairness with the user.
3. **Task 4 — diegetic missions** (kill the teleport-skip in `resultNext`; keep `forceMinigame`'s
   teleport for Retry + tests).
4. Then Phase 2 (T5 traffic → T6 buzz) and Phase 3 (T7 hangar).
   Recommended: one Workflow per phase (understand → implement → review), or
   subagent-driven-development; pass the plan path to each subagent.

## Verification
- `npx playwright test` — full suite; **expect 25 passing** on the current commit.
- `npx playwright test perf` — `drawCalls<500`, `tris<130_000`, `cpuMs<16.7` (currently 362 / 113k / 1.15ms).
- Live: `node tests/server.js` → `http://localhost:4173`.
- Regenerate screenshots gallery if needed: `SHOT_PHASE=after npx playwright test screenshots`.

## Suggested skills
- **Workflow (ultracode)** for phase orchestration (the session used: parallel plan-anchor
  verification → sequential implement → adversarial review — very effective; the plan-anchor
  pass caught landmine #1).
- **/code-review** (xhigh workflow) on each diff before commit; **/verify** to drive the real flow.
- The **flight-sim-gameplay-implementer** and **flight-sim-test-engineer** subagents exist
  (`.claude/agents/`) and are tuned for this repo — use them for code and specs respectively.
- **Higgsfield MCP** — the user granted full discretion to use it to improve the game (it
  produced the 3D jet: `generate_image` → `generate_3d` → `gltf-transform simplify` → GLTFLoader).
