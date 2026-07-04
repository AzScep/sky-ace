import { test, expect } from '@playwright/test';
import { boot, startMission, captureErrors, assertNoErrors } from './helpers.js';

// =====================================================
// [DIEGETIC] Task 4 — completing a mission returns you to open flight instead
// of teleport-skipping to the next one. "Fly on" (btn-result-next) now just
// resumes free flight; the #waypoint arrow guides you to the nearest uncleared
// marker, which you must actually fly to. Retry still teleports back into the
// same mode (forceMinigame's teleport is intentionally kept — tests rely on it).
//
// Determinism: drive the whole flow inside one synchronous page.evaluate() so the
// rAF loop can't interleave (see controls.spec.js / crash.spec.js).
// =====================================================

// Shared: drive a Ring Run to completion the way regression.spec does, landing on
// the result screen with the plane parked at the last ring.
const RUN_RING = () => {
  const sky = window.__sky;
  sky.forceMinigame('ring');
  for (let g = 0; g < 400 && sky.state === 'minigame'; g++) {
    const m = sky.activeMinigame;
    if (!m) break;
    const ring = m.rings[m.currentRing];
    if (ring) sky.plane.position.copy(ring.position);
    sky.tick(1 / 60);
  }
};

test('[DIEGETIC] "Fly on" resumes free flight — no teleport to another mission', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const out = await page.evaluate((runRingSrc) => {
    const sky = window.__sky;
    // eslint-disable-next-line no-eval
    eval(`(${runRingSrc})()`);
    const stateAfterRun = sky.state;                 // expect 'result'
    const before = { x: sky.plane.position.x, z: sky.plane.position.z };
    document.getElementById('btn-result-next').click();
    const after = { x: sky.plane.position.x, z: sky.plane.position.z };
    const dx = after.x - before.x, dz = after.z - before.z;
    return { stateAfterRun, state: sky.state, moved: Math.sqrt(dx * dx + dz * dz) };
  }, RUN_RING.toString());

  expect(out.stateAfterRun).toBe('result');
  expect(out.state).toBe('playing');   // resumed free flight, NOT 'minigame'
  expect(out.moved).toBeLessThan(400); // only a small nudge — not warped to another marker
  assertNoErrors(errors, 'Errors during diegetic no-teleport test');
});

test('[DIEGETIC] Retry still teleports back into the same mode', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const out = await page.evaluate((runRingSrc) => {
    const sky = window.__sky;
    // eslint-disable-next-line no-eval
    eval(`(${runRingSrc})()`);
    document.getElementById('btn-result-retry').click();
    return { state: sky.state, mode: sky.activeMinigame ? sky.activeMinigame.mode : null };
  }, RUN_RING.toString());

  expect(out.state).toBe('minigame');
  expect(out.mode).toBe('ring');
  assertNoErrors(errors, 'Errors during diegetic retry test');
});
