import { test, expect } from '@playwright/test';
import { boot, startMission, tick, captureErrors, assertNoErrors } from './helpers.js';

// =====================================================
// [TRAFFIC] Task 5 — ambient air traffic makes the sky read as alive.
// One InstancedMesh flock that wanders waypoints, stays in bounds + above
// terrain (never crashes), and shows on the radar. Budget: it must not blow
// the draw-call ceiling (instanced → ~1 mesh).
// =====================================================

test('[TRAFFIC] 6 craft exist and move', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    const c0 = sky.traffic.craft[0].position;
    const start = { x: c0.x, y: c0.y, z: c0.z };
    for (let i = 0; i < 120; i++) sky.tick(1 / 60);
    const end = sky.traffic.craft[0].position;
    const moved = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
    return { count: sky.traffic.craft.length, moved };
  });

  expect(out.count).toBe(6);
  expect(out.moved).toBeGreaterThan(50);   // flying, not frozen
  assertNoErrors(errors, 'Errors during traffic-moves test');
});

test('[TRAFFIC] craft stay inside bounds and above terrain', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    const LIMIT = 8000 * 0.45;   // WORLD_SIZE * 0.45 — the plane clamp / open-world wall
    for (let i = 0; i < 600; i++) sky.tick(1 / 60);
    let allInBounds = true, allAboveGround = true;
    for (const c of sky.traffic.craft) {
      if (Math.abs(c.position.x) > LIMIT || Math.abs(c.position.z) > LIMIT) allInBounds = false;
      if (c.position.y <= sky.terrainHeight(c.position.x, c.position.z)) allAboveGround = false;
    }
    return { allInBounds, allAboveGround };
  });

  expect(out.allInBounds).toBe(true);
  expect(out.allAboveGround).toBe(true);
  assertNoErrors(errors, 'Errors during traffic-bounds test');
});

test('[TRAFFIC] flock stays within the draw-call budget', async ({ page }) => {
  await boot(page);
  await startMission(page);
  await page.waitForTimeout(5000);   // ~5s of real frames with the flock live
  const calls = await page.evaluate(() => window.__sky.renderCalls);
  console.log(`[TRAFFIC] draw calls with flock: ${calls}`);
  expect(calls).toBeLessThan(500);   // instanced → the flock adds ~2 calls, not ~12
});

test('[TRAFFIC] disposed on quit — no leaked craft mesh', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    // Reach a result screen so the Menu button (→ quitToMenu) is wired.
    sky.forceMinigame('canyon');
    const p = sky.plane.position;
    p.y = sky.terrainHeight(p.x, p.z) - 50;
    sky.tick(1 / 60);                       // crash → result
    const mesh = sky.traffic.mesh;          // the flock's InstancedMesh
    const inSceneBefore = sky.scene.children.includes(mesh);
    document.getElementById('btn-result-menu').click();   // → quitToMenu (disposes traffic)
    return {
      inSceneBefore,
      trafficNull: sky.traffic === null,
      inSceneAfter: sky.scene.children.includes(mesh),
    };
  });

  expect(out.inSceneBefore).toBe(true);
  expect(out.trafficNull).toBe(true);
  expect(out.inSceneAfter).toBe(false);    // mesh removed from the scene — no leak
  assertNoErrors(errors, 'Errors during traffic-dispose test');
});
