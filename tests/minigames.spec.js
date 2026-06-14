import { test, expect } from '@playwright/test';
import { captureErrors, boot, startMission, assertNoErrors } from './helpers.js';

// Each driver runs entirely in-page: force-start the minigame, then deterministically
// fly the plane through its scoring path, ticking the real simulation each step.
// Returns { state, score, done, reason } captured at completion.

test('RING RUN — triggers, passes all rings, reaches result', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    sky.forceMinigame('ring');
    let reason = '';
    for (let guard = 0; guard < 400 && sky.state === 'minigame'; guard++) {
      const m = sky.activeMinigame;
      if (!m) break;
      reason = m.finishReason || reason;
      const ring = m.rings[m.currentRing];
      if (ring) sky.plane.position.copy(ring.position);
      sky.tick(1 / 60);
      if (m.finishReason) reason = m.finishReason;
    }
    return { state: sky.state, score: sky.totalScore, reason };
  });

  expect(out.state).toBe('result');
  expect(out.score).toBeGreaterThan(0);
  expect(out.reason).toBe('ALL RINGS CLEARED');
  await expect(page.locator('#result-screen')).toHaveClass(/active/);
  assertNoErrors(errors, 'Errors during Ring Run');
});

test('CANYON DASH — triggers, clears all gates, reaches result', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    sky.forceMinigame('canyon');
    let reason = '';
    let gi = 0;
    for (let guard = 0; guard < 400 && sky.state === 'minigame'; guard++) {
      const m = sky.activeMinigame;
      if (!m) break;
      // Walk to the next unpassed gate center.
      const g = m.gates.find(x => !x.passed);
      if (g) sky.plane.position.copy(g.center);
      sky.tick(1 / 60);
      if (m.finishReason) reason = m.finishReason;
    }
    return { state: sky.state, score: sky.totalScore, reason };
  });

  expect(out.state).toBe('result');
  expect(out.score).toBeGreaterThan(0);
  expect(out.reason).toBe('COURSE CLEARED');
  await expect(page.locator('#result-screen')).toHaveClass(/active/);
  assertNoErrors(errors, 'Errors during Canyon Dash');
});

test('PRECISION DROP — triggers, bombs target, reaches result', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    const THREE = sky.THREE;
    const m = sky.forceMinigame('bomb');
    const target = m.targetPos.clone();
    let reason = '';
    let dropped = 0;
    for (let guard = 0; guard < 1200 && sky.state === 'minigame'; guard++) {
      const mg = sky.activeMinigame;
      if (!mg) break;
      // Drop straight down onto the target (zero horizontal velocity = bullseye).
      if (dropped < 3 && mg.bombs.length === 0) {
        const dropPos = new THREE.Vector3(target.x, target.y + 350, target.z);
        mg.dropBomb(dropPos, new THREE.Vector3(0, 0, 0));
        dropped++;
      }
      sky.tick(1 / 60);
      if (mg.finishReason) reason = mg.finishReason;
    }
    return { state: sky.state, score: sky.totalScore, reason, dropped };
  });

  expect(out.dropped).toBe(3);
  expect(out.state).toBe('result');
  expect(out.score).toBeGreaterThan(0);
  expect(out.reason).toBe('BOMBS EXPENDED');
  await expect(page.locator('#result-screen')).toHaveClass(/active/);
  assertNoErrors(errors, 'Errors during Precision Drop');
});

test('DOGFIGHT — triggers, downs all enemies, reaches result', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    const THREE = sky.THREE;
    const m = sky.forceMinigame('dogfight');
    let reason = '';
    for (let guard = 0; guard < 2000 && sky.state === 'minigame'; guard++) {
      const mg = sky.activeMinigame;
      if (!mg) break;
      const enemy = mg.enemies.find(e => e.userData.alive);
      if (enemy) {
        // Park the plane 25 units behind the enemy, nose on it (forward = +z).
        sky.plane.quaternion.identity();
        sky.plane.position.copy(enemy.position).add(new THREE.Vector3(0, 0, -25));
        mg.fireBullet(sky.plane.position.clone(), sky.plane.quaternion.clone());
      }
      sky.tick(1 / 60);
      if (mg.finishReason) reason = mg.finishReason;
    }
    return { state: sky.state, score: sky.totalScore, reason, kills: 4 };
  });

  expect(out.state).toBe('result');
  expect(out.score).toBeGreaterThan(0);
  expect(out.reason).toBe('ALL ENEMIES DOWN');
  await expect(page.locator('#result-screen')).toHaveClass(/active/);
  assertNoErrors(errors, 'Errors during Dogfight');
});
