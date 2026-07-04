import { test, expect } from '@playwright/test';
import { captureErrors, boot, startMission, tick, assertNoErrors } from './helpers.js';

// REGRESSION for [BUG] "course elements spawn outside the flyable world bounds".
// On the old code Ring Run / Canyon Dash placed rings & gates beyond ±(WORLD_SIZE*0.45),
// where the flight loop clamps the plane — making those courses impossible to finish.
test('[BUG] ring & gate courses stay inside the flyable bounds', async ({ page }) => {
  await boot(page);
  await startMission(page);

  const res = await page.evaluate(() => {
    const sky = window.__sky;
    const LIMIT = 8000 * 0.45; // WORLD_SIZE * 0.45, the plane clamp
    const check = (positions) =>
      positions.every(p => Math.abs(p.x) <= LIMIT && Math.abs(p.z) <= LIMIT);

    const ring = sky.forceMinigame('ring');
    const ringPts = ring.rings.map(r => r.position);
    const ringOk = check(ringPts);
    const ringMax = Math.max(...ringPts.map(p => Math.max(Math.abs(p.x), Math.abs(p.z))));

    const canyon = sky.forceMinigame('canyon');
    const gatePts = canyon.gates.map(g => g.center);
    const gateOk = check(gatePts);
    const gateMax = Math.max(...gatePts.map(p => Math.max(Math.abs(p.x), Math.abs(p.z))));

    // Flux Run nodes use the same BOUND = WORLD_SIZE * 0.42 clamp.
    const flux = sky.forceMinigame('flux');
    const fluxPts = flux.nodes.map(n => n.position);
    const fluxOk = check(fluxPts);
    const fluxMax = Math.max(...fluxPts.map(p => Math.max(Math.abs(p.x), Math.abs(p.z))));

    return { LIMIT, ringOk, gateOk, ringMax, gateMax, fluxOk, fluxMax };
  });

  expect(res.ringMax).toBeLessThanOrEqual(res.LIMIT);
  expect(res.gateMax).toBeLessThanOrEqual(res.LIMIT);
  expect(res.ringOk).toBe(true);
  expect(res.gateOk).toBe(true);
  expect(res.fluxMax).toBeLessThanOrEqual(res.LIMIT);
  expect(res.fluxOk).toBe(true);
});

// REGRESSION for [BUG] "flight control keys react while in menu/result screens".
// On the old code, pressing C/R in the menu cycled the camera and teleported the plane.
test('[BUG] flight keys do nothing while in the menu', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);

  const before = await page.evaluate(() => {
    const p = window.__sky.plane.position;
    return { cam: window.__sky.cameraMode, state: window.__sky.state, x: p.x, y: p.y, z: p.z };
  });
  expect(before.state).toBe('menu');

  await page.keyboard.press('c'); // camera cycle — should be ignored in menu
  await page.keyboard.press('r'); // reset — should be ignored in menu

  const after = await page.evaluate(() => {
    const p = window.__sky.plane.position;
    return { cam: window.__sky.cameraMode, x: p.x, y: p.y, z: p.z };
  });
  expect(after.cam).toBe(0);              // camera did NOT change
  expect(after.x).toBeCloseTo(before.x);  // plane did NOT move
  expect(after.z).toBeCloseTo(before.z);

  // And in flight the same keys DO work (proves we didn't just disable them).
  await startMission(page);
  await page.keyboard.press('c');
  expect(await page.evaluate(() => window.__sky.cameraMode)).toBe(1);

  assertNoErrors(errors, 'Errors in input-gating test');
});

// [POLISH] completing a mission flags it cleared and restyles its marker.
test('[POLISH] completing a mission marks it cleared', async ({ page }) => {
  await boot(page);
  await startMission(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    const before = sky.missions.find(m => m.mode === 'ring').cleared || false;
    sky.forceMinigame('ring');
    for (let g = 0; g < 400 && sky.state === 'minigame'; g++) {
      const m = sky.activeMinigame;
      if (!m) break;
      const ring = m.rings[m.currentRing];
      if (ring) sky.plane.position.copy(ring.position);
      sky.tick(1 / 60);
    }
    const mission = sky.missions.find(m => m.mode === 'ring');
    return { before, after: !!mission.cleared, beamOpacity: mission.marker.userData.beam.material.opacity };
  });

  expect(out.before).toBe(false);
  expect(out.after).toBe(true);
  expect(out.beamOpacity).toBeCloseTo(0.15);
});
