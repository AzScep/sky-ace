import { test, expect } from '@playwright/test';
import { boot, startMission, captureErrors, assertNoErrors } from './helpers.js';

// =====================================================
// [BUZZ] Task 6 — the first emergent verb. Scream past an ambient aircraft at
// speed and you're rewarded (+150 score, +25 XP, toast, FX). A per-craft cooldown
// stops you farming one plane; it only counts at high speed. Free flight only.
//
// Determinism: mutate → tick → read inside one synchronous page.evaluate() so the
// rAF loop can't interleave (see controls.spec.js). Traffic.update runs before the
// buzz check each tick and nudges the craft ~1u — still well inside BUZZ_RADIUS.
// Altitude assumption: these place a craft on the plane, which sits high (~y=400)
// right after startMission. Traffic.update lifts a craft to terrainHeight+120 if it
// dips below — harmless here since the plane is far above terrain. If this suite is
// ever reused after low-altitude flight, keep the plane clear of the ground first.
// =====================================================

test('[BUZZ] a high-speed pass awards score + XP exactly once', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    const c = sky.traffic.craft[0];
    c.position.copy(sky.plane.position);      // right on top of the player
    c.buzzedAt = -Infinity;                    // fresh (no cooldown)
    sky.controller.speed = 160;                // > BUZZ_MIN_SPEED (140)
    const scoreBefore = sky.totalScore;
    sky.tick(1 / 60);
    return {
      buzzCount: sky.buzzCount,
      scoreDelta: sky.totalScore - scoreBefore,
      toast: document.getElementById('toast').textContent,
    };
  });

  expect(out.buzzCount).toBe(1);
  expect(out.scoreDelta).toBe(150);
  expect(out.toast).toBe('BUZZ! +150');
  assertNoErrors(errors, 'Errors during buzz-award test');
});

test('[BUZZ] a second pass within the cooldown does not re-award', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    const c = sky.traffic.craft[0];
    c.buzzedAt = -Infinity;
    sky.controller.speed = 160;
    c.position.copy(sky.plane.position);
    sky.tick(1 / 60);                          // buzz #1
    const afterFirst = sky.buzzCount;
    // Re-place on top and tick again immediately — still inside the 8s cooldown.
    c.position.copy(sky.plane.position);
    sky.tick(1 / 60);
    return { afterFirst, afterSecond: sky.buzzCount };
  });

  expect(out.afterFirst).toBe(1);
  expect(out.afterSecond).toBe(1);             // cooldown blocked the re-award
  assertNoErrors(errors, 'Errors during buzz-cooldown test');
});

test('[BUZZ] a slow pass does not count', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    const c = sky.traffic.craft[0];
    c.buzzedAt = -Infinity;
    c.position.copy(sky.plane.position);       // same proximity...
    sky.controller.speed = 80;                 // ...but too slow (< 140)
    sky.tick(1 / 60);
    return { buzzCount: sky.buzzCount };
  });

  expect(out.buzzCount).toBe(0);
  assertNoErrors(errors, 'Errors during buzz-needs-speed test');
});

test('[BUZZ] grantXp crosses a level boundary and persists', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);

  // Fresh profile → level 1. Level 1→2 costs 300 + 150 = 450 XP; grant 600 to cross it.
  const out = await page.evaluate(() => {
    const sky = window.__sky;
    const before = sky.profile.level;
    const r = sky.grantXp(600, 'test');
    return { before, gained: r.gained, prevLevel: r.prevLevel, level: r.level, leveledUp: r.leveledUp, liveLevel: sky.profile.level };
  });
  expect(out.before).toBe(1);
  expect(out.gained).toBe(600);
  expect(out.prevLevel).toBe(1);
  expect(out.leveledUp).toBe(true);
  expect(out.level).toBeGreaterThanOrEqual(2);
  expect(out.liveLevel).toBe(out.level);

  // Persisted? Reload and confirm the level survived.
  await page.reload();
  await page.waitForFunction(() => window.__sky && window.__sky.plane);
  const persisted = await page.evaluate(() => window.__sky.profile.level);
  expect(persisted).toBe(out.level);

  assertNoErrors(errors, 'Errors during grantXp level-up test');
});
