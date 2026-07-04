import { test, expect } from '@playwright/test';
import { boot, startMission, captureErrors, assertNoErrors } from './helpers.js';

// =====================================================
// [CONTROL] Task 1 (flight feel) — bank holds after release, throttle is
// snappy, and a weakened auto-level still doesn't let the nose wander.
// Real key map (plane.js Input.read()): rollLeft='a', throttleUp='shift',
// boost=' ' (space) — boost is NOT throttle-up, they're separate paths.
// Bank has no getter; derive it from the plane quaternion in-page:
// right.y === sin(bank angle) (see PlaneController.update `bankSin`).
// =====================================================

// NOTE on driver choice: an earlier version of this test drove input via real
// `page.keyboard.down/up` calls split across separate `page.evaluate()` round
// trips. That is non-deterministic here: `game.js`'s own rAF `loop()` keeps
// calling `simulate(realDt)` in the background whenever `state` is PLAYING,
// so real wall-clock time between the keydown and the first `tick()` (or
// between the two evaluate calls) lets extra, uncontrolled sim steps run
// with real dt — measured bank retention drifted 56.6% / 47.5% / ... across
// repeat runs. Fix: dispatch the real KeyboardEvent AND drive every tick
// inside a single synchronous `page.evaluate()` — JS is single-threaded, so
// no rAF callback can interleave mid-loop. This keeps the real key mapping
// (Input.read()) but makes the measurement reproducible.
test('[CONTROL] bank holds after release instead of auto-snapping level', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const { peak, post, ratio } = await page.evaluate(() => {
    const sky = window.__sky;
    const bank = () => new sky.THREE.Vector3(1, 0, 0).applyQuaternion(sky.plane.quaternion).y;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })); // rollLeft
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      sky.tick(1 / 60);
      const b = bank();
      if (Math.abs(b) > Math.abs(peak)) peak = b;
    }
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'a' }));
    for (let i = 0; i < 60; i++) sky.tick(1 / 60);
    const post = bank();
    return { peak, post, ratio: Math.abs(post) / Math.abs(peak) };
  });

  // eslint-disable-next-line no-console
  console.log(`[BANK] levelAssist retention: peak=${peak.toFixed(4)} post=${post.toFixed(4)} ratio=${(ratio * 100).toFixed(1)}%`);

  // Invariant: a released bank HOLDS a substantial fraction (old auto-snap decayed to ~0).
  // Measured ~52% at the user-approved levelAssist=0.25; 0.45 guards the "banks hold" fix
  // with margin and stays robust if the Flight-Assist default is nudged. Retune if that default changes.
  expect(ratio).toBeGreaterThanOrEqual(0.45);
  assertNoErrors(errors, 'Errors during bank-hold test');
});

test('[CONTROL] throttle reaches full within 1s and speed approaches max cruise', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })); // throttleUp (boost is Space, a separate path)
    for (let i = 0; i < 60; i++) sky.tick(1 / 60);
    const result = { throttle: sky.controller.throttle, speedKts: sky.controller.getSpeedKts(), maxSpeed: sky.controller.maxSpeed };
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
    return result;
  });

  // eslint-disable-next-line no-console
  console.log(`[THROTTLE] throttle=${out.throttle} speedKts=${out.speedKts} maxSpeed=${out.maxSpeed} pctOfMax=${(out.speedKts / out.maxSpeed * 100).toFixed(1)}%`);

  // Throttle LEVER snaps full within 1s (throttleResponse=1.0). Airspeed physically lags the
  // lever — it reaches ~84% of max cruise in 1s at the snappier dt*1.6 lerp (was much slower).
  // 0.80 guards "throttle is snappy" without demanding instant terminal velocity.
  expect(out.throttle).toBe(1);
  expect(out.speedKts).toBeGreaterThanOrEqual(out.maxSpeed * 0.80);
  assertNoErrors(errors, 'Errors during throttle test');
});

test('[CONTROL] no input still flies straight (weak auto-level does not wander)', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    const headingBefore = sky.controller.getHeadingDeg();
    for (let i = 0; i < 120; i++) sky.tick(1 / 60);
    const headingAfter = sky.controller.getHeadingDeg();
    let drift = Math.abs(headingAfter - headingBefore);
    if (drift > 180) drift = 360 - drift; // wrap-around
    return { headingBefore, headingAfter, drift };
  });

  // eslint-disable-next-line no-console
  console.log(`[HEADING] before=${out.headingBefore.toFixed(2)} after=${out.headingAfter.toFixed(2)} drift=${out.drift.toFixed(2)}deg`);

  expect(out.drift).toBeLessThan(3);
  assertNoErrors(errors, 'Errors during no-input straight-flight test');
});
