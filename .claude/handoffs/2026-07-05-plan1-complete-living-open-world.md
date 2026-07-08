# Handoff: Living Open-World Sky Ace — Plan 1 COMPLETE (T1–T7)

## Status
All seven tasks of `docs/plans/2026-07-04-living-open-world-foundation.md` are **implemented,
tested, adversarially reviewed, and committed** on branch `feat/open-world-foundation`
(off `main` `ba234fd`; `main` untouched). **73 Playwright tests green.** Tree clean.

Supersedes the prior handoff `2026-07-04-2331-phase1-onward-living-open-world.md`.

## Commits (newest first)
- `17a0bd9` T7 — level-gated hangar (skins + trails)
- `46657ec` T6 — buzz verb (score + XP for passing traffic)
- `bc43fe6` T5 — ambient air traffic (InstancedMesh flock)
- `7261746` Phase 1 — T3 crash consequence + T4 diegetic missions
- (`a4b8c84` Phase 0 — T1 feel + T2 look, from the prior session)

## What shipped this session (Phase 1–3)
- **T3 crash:** soft-floor gone; `crash()` on terrain (CRASH_MARGIN=6). Free flight → explosion +
  respawn clear at ground+250, cooldown-gated (1.2s) so no crash-loop; minigame → CRASHED end.
  Root-fix for landmine #1: a single `completed` (`reason !== 'TIME UP' && !== 'CRASHED'`) drives
  win + progression + mission-clear, so it can't regress in one branch but not another. A crash/
  timeout no longer marks a mission cleared. `resultContinue` clamps resume to ground+150.
- **T4 diegetic:** `resultNext` resumes free flight (no teleport-skip); button NEXT→FLY ON.
  `forceMinigame` keeps its teleport (Retry + the whole test suite depend on it).
- **T5 traffic (`traffic.js`):** 6 low-poly craft as ONE InstancedMesh (~2 draw calls), waypoint
  wander + bank, clamped in-bounds/above-terrain (never crash), gold radar blips, zero per-frame
  alloc. Created in setupScene, recycled in startGame, disposed in quitToMenu. `craft[].buzzedAt`.
- **T6 buzz:** free-flight pass within 60u at >140 speed → +150 score, +25 XP, chime, gold
  ringburst, BUZZ! toast, level-up flash. 8s per-craft cooldown via dt-accumulated `_simClock`.
  `progression.grantXp(n, reason)`.
- **T7 hangar:** `progression.UNLOCKS`/`getUnlocks`/`equip` (unlock derived from level, no currency).
  Start-screen HANGAR panel (matches the synthwave modals). Skins = neon emissive tint on the jet
  (GLB or primitive); trails = exhaust-plume tint (the wingtip trail stays removed — user disliked
  it — so "trail" is repurposed onto the kept exhaust via an optional `fx.exhaust` tint).

## New `window.__sky` surface (test contract additions)
`crashCount`, `buzzCount`, `lastResult` ({reason,win,completed}), `traffic`, `terrainHeight`,
`getUnlocks`, `equip`, `grantXp`. New specs: `crash`, `diegetic`, `traffic`, `buzz`, `hangar`.

## OPEN — needs the USER (live gates; can't self-grade taste)
Serve `node tests/server.js` → `http://localhost:4173` (server sends `no-store`, so a normal
reload gets fresh code — no `?v` bump needed). Let the user drive and grade:
1. **Crash fairness** — fly into a mountain; fair or rage-inducing? Tune `CRASH_MARGIN`/respawn.
2. **Diegetic flow** — finish a mission, confirm you're dropped into open sky and must fly on.
3. **Buzz feel** — dive on a passing aircraft at speed; does BUZZ! feel good? Tune radius/speed.
4. **Hangar/skin look** — the **default skin is magenta @ 0.45 emissive** (tints the Phase-0-approved
   jet by default). Confirm, or set a neutral default / lower intensity (one line in `applyEquipped`).
5. Carried-over Phase-0 items: engine "whoosh" audio + steering speed (never user-confirmed).

## Landmines carried forward
- **Review/verify subagents mutate the shared working tree.** A workflow verify agent reverted
  game.js (to prove a test gap) and ran playwright IN PLACE, wiping the uncommitted Phase-1 impl.
  Rebuilt it. Always spawn file-touching/test-running review agents with `isolation: 'worktree'`
  OR make them strictly read-only. (Memory: [[workflow-agents-mutate-worktree]].)
- **Perf is tight:** ~113k/130k tris, draw calls peak ~431/500 (traffic is instanced = ~2 calls).
  Any new geometry must be instanced/shared. `tests/perf.spec.js` guards it.
- **No build step; server is `no-store`** so `?v=N` bumps aren't required for freshness (all still
  uniform `?v=11`). Only bump if you deploy behind a caching CDN.

## Next: Plan 2 (deferred by design)
Weather / day-night cycle / bird flocks / more emergent activities. The plan defers this until the
look is graded and traffic MVP proves the feel — i.e. until the user runs the live gates above.
Day/night is heavy (the sky is a static JPG today). Re-spec Plan 2 after the live grade.

## Verification
- `npx playwright test` → **73 passing**.
- `npx playwright test perf` → drawCalls<500 (431 peak), tris<130k (113k), cpuMs<16.7 (1.2).
- Screenshots regenerate with `SHOT_PHASE=after npx playwright test screenshots` (revert after; the
  suite regenerates them as a side effect — they are NOT part of the logic commits).
