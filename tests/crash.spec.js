import { test, expect } from '@playwright/test';
import { boot, startMission, captureErrors, assertNoErrors } from './helpers.js';

// =====================================================
// [CRASH] Task 3 — the terrain can kill you now (soft floor removed).
// Free flight: crashing respawns you clear of the ground (no score to lose).
// Minigame: crashing ends the run as CRASHED (a non-completion).
// A cooldown prevents re-triggering the crash every frame during recovery.
//
// Determinism: as controls.spec.js documents, game.js's rAF loop keeps calling
// simulate(realDt) in the background whenever state is PLAYING. So each test does
// ALL of its mutate → tick → read inside ONE synchronous page.evaluate() — JS is
// single-threaded, so no rAF callback can interleave mid-function.
// __sky.terrainHeight lets us place the plane relative to the ground.
// =====================================================

test('[CRASH] free-flight crash respawns above the ground, still playing', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    const p = sky.plane.position;
    // Stabilize (kill any residual bank/pitch from the rAF flight) then bury the
    // plane below the terrain at its current XZ.
    sky.plane.quaternion.identity();
    sky.controller.speed = 80;
    const g0 = sky.terrainHeight(p.x, p.z);
    p.y = g0 - 50;
    sky.tick(1 / 60);
    const g1 = sky.terrainHeight(sky.plane.position.x, sky.plane.position.z);
    return { crashCount: sky.crashCount, y: sky.plane.position.y, ground: g1, state: sky.state };
  });

  expect(out.crashCount).toBe(1);
  expect(out.y).toBeGreaterThan(out.ground);   // respawned clear of the ground
  expect(out.state).toBe('playing');           // free-flight crash keeps you flying
  assertNoErrors(errors, 'Errors during free-flight crash test');
});

test('[CRASH] cooldown prevents a crash-loop (single trigger while buried)', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    const p = sky.plane.position;
    sky.plane.quaternion.identity();
    sky.controller.speed = 80;
    p.y = sky.terrainHeight(p.x, p.z) - 50;
    sky.tick(1 / 60);                 // crash #1 → respawn, cooldown armed
    const after1 = sky.crashCount;
    // Re-bury and keep ticking WITHIN the cooldown window — must NOT crash again.
    for (let i = 0; i < 3; i++) {
      const pp = sky.plane.position;
      pp.y = sky.terrainHeight(pp.x, pp.z) - 50;
      sky.tick(1 / 60);
    }
    return { after1, after4: sky.crashCount };
  });

  expect(out.after1).toBe(1);
  expect(out.after4).toBe(1);         // cooldown blocked the re-trigger
  assertNoErrors(errors, 'Errors during crash-cooldown test');
});

test('[CRASH] flying into terrain during a minigame ends the run as CRASHED', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    sky.forceMinigame('canyon');      // state → minigame, activeMinigame set
    const p = sky.plane.position;
    sky.plane.quaternion.identity();
    sky.controller.speed = 80;
    p.y = sky.terrainHeight(p.x, p.z) - 50;
    sky.tick(1 / 60);                 // crash → finish('CRASHED') → endMinigame same tick
    return {
      state: sky.state,
      title: document.getElementById('result-title').textContent,
      lastResult: sky.lastResult,     // { reason, win, completed }
      canyonCleared: !!(sky.missions.find(m => m.mode === 'canyon') || {}).cleared,
    };
  });

  expect(out.state).toBe('result');
  expect(out.title).toContain('CRASHED');
  // Landmine #1: a CRASHED run must read as a NON-completion — not a win. Asserting on the
  // title alone would pass even if the win/completed discriminators regressed (the title is
  // built from `reason` regardless). These assert the real progression-facing outcome.
  expect(out.lastResult.reason).toBe('CRASHED');
  expect(out.lastResult.win).toBe(false);
  expect(out.lastResult.completed).toBe(false);
  // A crash must NOT retire the mission (marker stays live; waypoint keeps guiding you back).
  expect(out.canyonCleared).toBe(false);
  assertNoErrors(errors, 'Errors during minigame-crash test');
});

test('[CRASH] resuming free flight after a crash lands clear of terrain (no instant re-crash)', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    sky.forceMinigame('canyon');
    const p = sky.plane.position;
    sky.plane.quaternion.identity();
    sky.controller.speed = 80;
    p.y = sky.terrainHeight(p.x, p.z) - 50;
    sky.tick(1 / 60);                 // crash → CRASHED result (state=result)
    // Worst case: plane still deeply buried when the player resumes. The flat +100 nudge in
    // resultContinue would leave it underground → instant free-flight re-crash. The clamp must prevent that.
    p.y = sky.terrainHeight(p.x, p.z) - 500;
    const crashesBefore = sky.crashCount;
    document.getElementById('btn-result-next').click();   // Fly On → resultContinue
    const yResume = sky.plane.position.y;
    const groundResume = sky.terrainHeight(sky.plane.position.x, sky.plane.position.z);
    sky.tick(1 / 60);                 // first free-flight tick back — must NOT crash
    return { state: sky.state, clearedGround: yResume > groundResume, crashDelta: sky.crashCount - crashesBefore };
  });

  expect(out.state).toBe('playing');
  expect(out.clearedGround).toBe(true);   // resumed above terrain, not buried
  expect(out.crashDelta).toBe(0);         // no instant re-crash on resume
  assertNoErrors(errors, 'Errors during crash-resume test');
});
