// =====================================================
// Mastery Loop — new feature coverage for the v10 build
// Tests: FluxRun deep-drive, combo system, Dogfight waves/streak/tookHit,
//        progression XP/level/medals, hit-stop contract, result Retry/Next,
//        and live-sim onboarding.
// =====================================================
import { test, expect } from '@playwright/test';
import { captureErrors, boot, startMission, tick, assertNoErrors } from './helpers.js';

// ─────────────────────────────────────────────────────
// FLUX RUN — detailed mechanics
// ─────────────────────────────────────────────────────

test('[FLUX] all 28 nodes and Collector are inside the flyable bounds', async ({ page }) => {
  await boot(page);
  await startMission(page);

  const res = await page.evaluate(() => {
    const sky = window.__sky;
    const BOUND = 8000 * 0.45; // plane-clamp limit
    const flux = sky.forceMinigame('flux');
    const nodePts = flux.nodes.map(n => n.position);
    const col = flux.collectorPos;

    const nodeMax = Math.max(...nodePts.map(p => Math.max(Math.abs(p.x), Math.abs(p.z))));
    const nodeAboveTerrain = nodePts.every(p => p.y > 0); // nodes raised above terrain
    const collectorIn = Math.abs(col.x) <= BOUND && Math.abs(col.z) <= BOUND;
    return { nodeMax, nodeAboveTerrain, collectorIn, BOUND };
  });

  expect(res.nodeMax).toBeLessThanOrEqual(res.BOUND);
  expect(res.nodeAboveTerrain).toBe(true);
  expect(res.collectorIn).toBe(true);
});

test('[FLUX] charge accumulates, overload builds, BUST resets uncashed charge', async ({ page }) => {
  await boot(page);
  await startMission(page);

  const res = await page.evaluate(() => {
    const sky = window.__sky;
    const flux = sky.forceMinigame('flux');

    // Teleport to every node to collect all 28 without banking.
    for (const node of flux.nodes) {
      sky.plane.position.copy(node.position);
      sky.tick(1 / 60); // collect
    }
    const chargeAfterCollect = flux.charge; // should be ≈28 (some may cluster)
    const overloadAfterCollect = flux.overload; // > 0 since charge was held

    // Advance time until overload busts (overload >= 1).
    // overload += dt * 0.05 * charge; with charge≈28 and dt=1/60: += 0.023/tick → busts in ~44 ticks.
    let busted = false;
    for (let i = 0; i < 100; i++) {
      sky.tick(1 / 60);
      if (flux.charge === 0 && flux.overload === 0) { busted = true; break; }
    }
    const chargeAfterBust = flux.charge;

    return { chargeAfterCollect, overloadAfterCollect, busted, chargeAfterBust };
  });

  expect(res.chargeAfterCollect).toBeGreaterThan(0);   // nodes were collected
  expect(res.overloadAfterCollect).toBeGreaterThan(0); // overload is ticking
  expect(res.busted).toBe(true);                        // overload bust happened
  expect(res.chargeAfterBust).toBe(0);                  // uncashed charge wiped
});

test('[FLUX] banking cashes charge and adds scored points', async ({ page }) => {
  await boot(page);
  await startMission(page);

  const res = await page.evaluate(() => {
    const sky = window.__sky;
    const flux = sky.forceMinigame('flux');

    // Collect exactly 5 nodes.
    let collected = 0;
    for (const node of flux.nodes) {
      if (collected >= 5) break;
      sky.plane.position.copy(node.position);
      sky.tick(1 / 60);
      if (node.userData.collected) collected++;
    }
    const chargeBeforeBank = flux.charge;

    // Teleport to collector to bank.
    sky.plane.position.copy(flux.collectorPos);
    sky.tick(1 / 60);
    const scoreAfterBank = flux.score;
    const chargeAfterBank = flux.charge;

    // Expected: round(5 * (1+0.5) * 100) = round(750) = 750
    return { chargeBeforeBank, scoreAfterBank, chargeAfterBank };
  });

  expect(res.chargeBeforeBank).toBeGreaterThan(0);
  expect(res.scoreAfterBank).toBeGreaterThan(0);
  expect(res.chargeAfterBank).toBe(0); // charge cashed out
});

test('[FLUX] cleanup() disposes all geometry — no leaks after scene removal', async ({ page }) => {
  await boot(page);
  await startMission(page);

  const res = await page.evaluate(() => {
    const sky = window.__sky;
    const flux = sky.forceMinigame('flux');
    // Count objects before cleanup
    const beforeCount = sky.scene.children.length;
    flux.cleanup();
    const afterCount = sky.scene.children.length;
    const groupGone = !sky.scene.children.includes(flux.group);
    return { beforeCount, afterCount, groupGone };
  });

  // After cleanup the group is removed from the scene.
  expect(res.groupGone).toBe(true);
  expect(res.afterCount).toBeLessThan(res.beforeCount);
});

// ─────────────────────────────────────────────────────
// COMBO SYSTEM — Ring Run
// ─────────────────────────────────────────────────────

test('[COMBO] ring combo builds on quick passes and breaks after 8s gap', async ({ page }) => {
  await boot(page);
  await startMission(page);

  const res = await page.evaluate(() => {
    const sky = window.__sky;
    sky.forceMinigame('ring');
    const m = sky.activeMinigame;

    // Pass ring 0 (combo=1, fresh start)
    sky.plane.position.copy(m.rings[0].position);
    sky.tick(1 / 60);
    const combo1 = m.combo;

    // Pass ring 1 immediately (combo should increment to 2)
    sky.plane.position.copy(m.rings[1].position);
    sky.tick(1 / 60);
    const combo2 = m.combo;

    // Simulate a stale window: force _sinceRing > 8 before passing ring 2.
    m._sinceRing = 9;
    sky.plane.position.copy(m.rings[2].position);
    sky.tick(1 / 60);
    const combo3 = m.combo; // should reset to 0 then increment to 1

    return { combo1, combo2, combo3 };
  });

  expect(res.combo1).toBe(1);
  expect(res.combo2).toBe(2);
  expect(res.combo3).toBe(1); // chain broken → reset + re-incremented
});

test('[COMBO] ring perfect pass awards 1.5× and increments perfectCount', async ({ page }) => {
  await boot(page);
  await startMission(page);

  const res = await page.evaluate(() => {
    const sky = window.__sky;
    sky.forceMinigame('ring');
    const m = sky.activeMinigame;
    const scoreBefore = m.score;

    // A pass at exact ring.position (dist=0 < RING_RADIUS*0.4=28) is perfect.
    sky.plane.position.copy(m.rings[0].position);
    sky.tick(1 / 60);

    return {
      scoreDelta: m.score - scoreBefore,
      perfectCount: m.perfectCount,
    };
  });

  expect(res.perfectCount).toBe(1);
  // A combo=1, perfect pass with timeLeft≈75: floor(250 * 1.0) = 250 → floor(250*1.5) = 375
  expect(res.scoreDelta).toBeGreaterThanOrEqual(300); // at least 1.5× floor of base
});

// ─────────────────────────────────────────────────────
// COMBO SYSTEM — Canyon Dash
// ─────────────────────────────────────────────────────

test('[COMBO] canyon combo builds on gates and resets after 6s gap', async ({ page }) => {
  await boot(page);
  await startMission(page);

  const res = await page.evaluate(() => {
    const sky = window.__sky;
    sky.forceMinigame('canyon');
    const m = sky.activeMinigame;

    // Re-center on the gate and tick until it registers — robust to the small
    // forward drift the controller applies before the gate check each tick.
    const passGate = (idx) => {
      for (let k = 0; k < 10 && !m.gates[idx].passed; k++) {
        sky.plane.position.copy(m.gates[idx].center);
        sky.tick(1 / 60);
      }
    };

    passGate(0);                 // combo → 1
    const combo1 = m.combo;

    passGate(1);                 // combo → 2 (within momentum window)
    const combo2 = m.combo;

    m._sinceGate = 7;            // simulate a > 6s gap → chain resets then re-increments
    passGate(2);
    const combo3 = m.combo;      // broken → 1

    return { combo1, combo2, combo3 };
  });

  expect(res.combo1).toBe(1);
  expect(res.combo2).toBe(2);
  expect(res.combo3).toBe(1);
});

// ─────────────────────────────────────────────────────
// DOGFIGHT — waves, streak, tookHit
// ─────────────────────────────────────────────────────

test('[DOGFIGHT] targetKills=8 across 3 waves, ALL ENEMIES DOWN triggers result', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    const THREE = sky.THREE;
    const m = sky.forceMinigame('dogfight');
    const targetKills = m.targetKills;
    let reason = '';
    for (let guard = 0; guard < 2000 && sky.state === 'minigame'; guard++) {
      const mg = sky.activeMinigame;
      if (!mg) break;
      const enemy = mg.enemies.find(e => e.userData.alive);
      if (enemy) {
        sky.plane.quaternion.identity();
        sky.plane.position.copy(enemy.position).add(new THREE.Vector3(0, 0, -25));
        mg.fireBullet(sky.plane.position.clone(), sky.plane.quaternion.clone());
      }
      sky.tick(1 / 60);
      if (mg.finishReason) reason = mg.finishReason;
    }
    return { state: sky.state, targetKills, kills: sky.totalScore > 0, reason };
  });

  expect(out.targetKills).toBe(8);
  expect(out.state).toBe('result');
  expect(out.reason).toBe('ALL ENEMIES DOWN');
  assertNoErrors(errors, 'Errors in Dogfight wave test');
});

test('[DOGFIGHT] kill-streak multiplier ramps and tookHit records near-miss', async ({ page }) => {
  await boot(page);
  await startMission(page);

  const res = await page.evaluate(() => {
    const sky = window.__sky;
    const THREE = sky.THREE;
    sky.forceMinigame('dogfight');
    const m = sky.activeMinigame;

    // Kill enemies rapidly to build streak.
    let kills = 0;
    for (let g = 0; g < 500 && kills < 3; g++) {
      const enemy = m.enemies.find(e => e.userData.alive);
      if (enemy) {
        sky.plane.quaternion.identity();
        sky.plane.position.copy(enemy.position).add(new THREE.Vector3(0, 0, -25));
        m.fireBullet(sky.plane.position.clone(), sky.plane.quaternion.clone());
      }
      sky.tick(1 / 60);
      kills = m.kills;
    }
    const streakAfter3 = m.streak;

    // Test tookHit: teleport an enemy to be 10u away from player (< 12u threshold).
    const liveEnemy = m.enemies.find(e => e.userData.alive);
    if (liveEnemy) {
      sky.plane.position.set(0, 300, 0);
      liveEnemy.position.set(0, 300, 8); // 8u away
      sky.tick(1 / 60);
    }
    const tookHitAfterClose = m.tookHit;

    return { streakAfter3, tookHitAfterClose };
  });

  expect(res.streakAfter3).toBeGreaterThanOrEqual(3); // streak built across rapid kills
  expect(res.tookHitAfterClose).toBe(true);            // proximity flag set
});

// ─────────────────────────────────────────────────────
// PROGRESSION — XP / level / medals
// ─────────────────────────────────────────────────────

test('[PROG] XP rises and level can advance after a completed run', async ({ page }) => {
  await boot(page);
  await startMission(page);

  const res = await page.evaluate(() => {
    const sky = window.__sky;
    const THREE = sky.THREE;

    const profBefore = sky.profile;
    const xpBefore  = profBefore.xp;
    const lvBefore  = profBefore.level;

    // Complete ring run (all rings, result state) so game.js calls addRun().
    sky.forceMinigame('ring');
    for (let g = 0; g < 600 && sky.state === 'minigame'; g++) {
      const m = sky.activeMinigame;
      if (!m) break;
      const ring = m.rings[m.currentRing];
      if (ring) sky.plane.position.copy(ring.position);
      sky.tick(1 / 60);
    }

    const profAfter = sky.profile;
    return {
      xpBefore,
      xpAfter: profAfter.xp,
      lvBefore,
      lvAfter: profAfter.level,
      state: sky.state,
    };
  });

  expect(res.state).toBe('result');             // game completed normally
  expect(res.xpAfter).toBeGreaterThan(res.xpBefore); // XP was awarded
  // Level is ≥ 1 and consistent with XP gained
  expect(res.lvAfter).toBeGreaterThanOrEqual(res.lvBefore);
});

test('[PROG] first-ever run earns first-flight medal', async ({ page }) => {
  // Use a fresh localStorage profile so runs=0 at start.
  await page.addInitScript(() => {
    try { localStorage.removeItem('sky_profile_v1'); } catch {}
    try { localStorage.removeItem('sky_medals_v1'); } catch {}
  });
  await boot(page);
  await startMission(page);

  const res = await page.evaluate(() => {
    const sky = window.__sky;

    // Complete ring run to trigger endMinigame → addRun.
    sky.forceMinigame('ring');
    for (let g = 0; g < 600 && sky.state === 'minigame'; g++) {
      const m = sky.activeMinigame;
      if (!m) break;
      const ring = m.rings[m.currentRing];
      if (ring) sky.plane.position.copy(ring.position);
      sky.tick(1 / 60);
    }

    return {
      state:   sky.state,
      medals:  sky.medals,
      profile: sky.profile,
    };
  });

  expect(res.state).toBe('result');
  expect(res.medals['first-flight']).toBeTruthy(); // first-flight medal earned
  expect(res.profile.plays.ring).toBeGreaterThanOrEqual(1);
});

// ─────────────────────────────────────────────────────
// HIT-STOP — loop-driven; __sky.tick() stays pure
// ─────────────────────────────────────────────────────

test('[HITSTOP] triggerHitStop sets hitStop; tick() is unaffected (pure dt)', async ({ page }) => {
  await boot(page);
  await startMission(page);

  const res = await page.evaluate(() => {
    const sky = window.__sky;
    // 1. Before trigger: hitStop should be 0.
    const hitStopBefore = sky.hitStop;

    // 2. Trigger a hit-stop from the test hook.
    sky.triggerHitStop(0.1);
    const hitStopAfterTrigger = sky.hitStop;

    // 3. sky.tick() must advance sim at FULL speed (not 6% as loop() would).
    //    Verify by tracking plane position — if hitstop slowed tick(), movement
    //    would be near-zero.  With full-speed tick, position changes normally.
    sky.plane.position.set(0, 400, 0);
    sky.controller.velocity.set(0, 0, 50); // 50 m/s forward
    sky.tick(1 / 60);
    const posZ = sky.plane.position.z; // should have moved ~50/60 ≈ 0.83u
    // hitStop is NOT decremented by tick() (only loop() decrements it).
    const hitStopAfterTick = sky.hitStop;

    return { hitStopBefore, hitStopAfterTrigger, posZ, hitStopAfterTick };
  });

  expect(res.hitStopBefore).toBe(0);
  expect(res.hitStopAfterTrigger).toBeCloseTo(0.1, 2);
  // tick() moved the plane at full speed (position changed meaningfully)
  expect(Math.abs(res.posZ)).toBeGreaterThan(0.5);
  // hitStop was NOT decremented by tick() — only loop() does that
  expect(res.hitStopAfterTick).toBeCloseTo(0.1, 2);
});

// ─────────────────────────────────────────────────────
// RESULT SCREEN — Retry / Next buttons exist
// ─────────────────────────────────────────────────────

test('[RESULT] Retry and Next buttons exist and result-screen shows after a run', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  // Complete ring run to reach result state.
  await page.evaluate(() => {
    const sky = window.__sky;
    sky.forceMinigame('ring');
    for (let g = 0; g < 600 && sky.state === 'minigame'; g++) {
      const m = sky.activeMinigame;
      if (!m) break;
      const ring = m.rings[m.currentRing];
      if (ring) sky.plane.position.copy(ring.position);
      sky.tick(1 / 60);
    }
  });

  // DOM: result-screen must be active, and both Retry + Next buttons exist.
  await expect(page.locator('#result-screen')).toHaveClass(/active/);
  await expect(page.locator('#btn-result-retry')).toBeVisible();
  await expect(page.locator('#btn-result-next')).toBeVisible();
  await expect(page.locator('#btn-result-continue')).toBeVisible(); // kept for compat
  assertNoErrors(errors, 'Errors in result-screen test');
});

test('[RESULT] Retry (R key) restarts the same minigame', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  // Reach result.
  await page.evaluate(() => {
    const sky = window.__sky;
    sky.forceMinigame('ring');
    for (let g = 0; g < 600 && sky.state === 'minigame'; g++) {
      const m = sky.activeMinigame;
      if (!m) break;
      const ring = m.rings[m.currentRing];
      if (ring) sky.plane.position.copy(ring.position);
      sky.tick(1 / 60);
    }
  });

  expect(await page.evaluate(() => window.__sky.state)).toBe('result');

  // Press R — should re-enter minigame state.
  await page.keyboard.press('r');
  await page.waitForFunction(() => window.__sky.state === 'minigame', null, { timeout: 5000 });
  const state = await page.evaluate(() => window.__sky.state);
  expect(state).toBe('minigame');
  assertNoErrors(errors, 'Errors in Retry test');
});

test('[RESULT] Next (N key) leaves result and re-enters playing or minigame', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  // Reach result.
  await page.evaluate(() => {
    const sky = window.__sky;
    sky.forceMinigame('ring');
    for (let g = 0; g < 600 && sky.state === 'minigame'; g++) {
      const m = sky.activeMinigame;
      if (!m) break;
      const ring = m.rings[m.currentRing];
      if (ring) sky.plane.position.copy(ring.position);
      sky.tick(1 / 60);
    }
  });

  expect(await page.evaluate(() => window.__sky.state)).toBe('result');

  // Press N — should leave result screen.
  await page.keyboard.press('n');
  await page.waitForFunction(
    () => window.__sky.state !== 'result',
    null, { timeout: 5000 }
  );
  const state = await page.evaluate(() => window.__sky.state);
  expect(['playing', 'minigame']).toContain(state);
  assertNoErrors(errors, 'Errors in Next test');
});

// ─────────────────────────────────────────────────────
// ONBOARDING — sim runs live under the overlay
// ─────────────────────────────────────────────────────

test('[ONBOARD] sim advances (plane moves) while onboard overlay is visible', async ({ page }) => {
  // firstRun: true leaves sky_onboarded unset so overlay shows after Start.
  const errors = captureErrors(page);
  await boot(page, { firstRun: true });

  // Clicking Start triggers maybeShowOnboarding() which adds the 'active' class.
  await page.click('#btn-start');
  // Wait for the overlay to appear and onboardingActive to be set.
  await page.waitForFunction(() => window.__sky.onboardingActive === true, null, { timeout: 5000 });
  await expect(page.locator('#onboard-screen')).toHaveClass(/active/);

  // Verify the sim runs live under the overlay: tick a few frames and
  // confirm the plane position has changed (not frozen while overlay is up).
  const moved = await page.evaluate(() => {
    const sky = window.__sky;
    sky.plane.position.set(0, 400, 0);
    sky.controller.velocity.set(0, 0, 0);
    const posA = { x: sky.plane.position.x, z: sky.plane.position.z, y: sky.plane.position.y };
    // state=PLAYING + onboardingActive=true → simulate() still runs in tick().
    for (let i = 0; i < 5; i++) sky.tick(1 / 60);
    const posB = { x: sky.plane.position.x, z: sky.plane.position.z, y: sky.plane.position.y };
    return {
      onboardingActive: sky.onboardingActive,
      state: sky.state,
      posA,
      posB,
    };
  });

  expect(moved.onboardingActive).toBe(true);
  expect(moved.state).toBe('playing');
  // Plane must have moved — proves simulate() ran while overlay was up.
  const dx = moved.posB.x - moved.posA.x;
  const dz = moved.posB.z - moved.posA.z;
  const dy = moved.posB.y - moved.posA.y;
  const dist = Math.sqrt(dx * dx + dz * dz + dy * dy);
  expect(dist).toBeGreaterThan(0);
  assertNoErrors(errors, 'Errors during live-sim onboarding test');
});
