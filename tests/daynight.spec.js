import { test, expect } from '@playwright/test';
import { boot, startMission, captureErrors, assertNoErrors } from './helpers.js';

// =====================================================
// [DAYNIGHT] Plan 2 · Phase A — dynamic sky + day/night cycle.
// The static equirectangular photo is replaced by: a physically-based atmospheric Sky dome
// (dusk/night), a hand-authored blue gradient dome for a clean CLEAR DAY (fades in only in
// full daylight), a star field (fades in at night), and drifting clouds. One clock, t in
// [0,1) (0 midnight · 0.25 dawn · 0.5 noon · 0.75 dusk), drives sun direction + lights + fog
// + bloom + the two dome opacities. setTimeOfDay(t) is idempotent and per-frame-alloc-free.
//
// Determinism note (see crash.spec.js): all mutate → tick → read happens inside ONE
// synchronous page.evaluate so no rAF frame interleaves.
// =====================================================

test('[DAYNIGHT] noon is a clear blue day; night is dark with stars', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    const dayOpacity = () => sky.world.dayDome.material.uniforms.uOpacity.value;
    const starOpacity = () => sky.world.stars.material.opacity;
    const dirIntensity = () => { let v = 0; sky.scene.traverse(o => { if (o.isDirectionalLight) v = o.intensity; }); return v; };
    sky.setTimeOfDay(0.5);                        // noon → clean gradient blue day
    const dayNoon = dayOpacity(), starsNoon = starOpacity(), dirNoon = dirIntensity();
    sky.setTimeOfDay(0.0);                        // midnight → atmospheric, stars out
    const dayNight = dayOpacity(), starsNight = starOpacity(), dirNight = dirIntensity();
    return { dayNoon, starsNoon, dirNoon, dayNight, starsNight, dirNight, starFog: sky.world.stars.material.fog };
  });

  expect(out.dayNoon).toBeGreaterThan(0.9);      // clear blue day gradient fully on at noon
  expect(out.dayNight).toBeLessThan(0.05);       // faded out at night → atmospheric sky shows
  expect(out.starsNoon).toBeLessThan(0.05);      // no stars in daylight
  expect(out.starsNight).toBeGreaterThan(0.5);   // stars out at night
  expect(out.dirNoon).toBeGreaterThan(out.dirNight);  // brighter key light by day
  expect(out.starFog).toBe(false);               // stars must ignore fog or the night haze paints them out
  assertNoErrors(errors, 'Errors during noon/night day-cycle test');
});

test('[DAYNIGHT] toggling to Synthwave after night restores the neon look (no stale realistic state)', async ({ page }) => {
  // Regression (xhigh review): setTimeOfDay mutates shared handles (lights, fog near/far) that
  // setLook('synthwave') must reset — else the neon look inherits realistic night state (near-black).
  const errors = captureErrors(page);
  await boot(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    const dirI = () => { let v = 0; sky.scene.traverse(o => { if (o.isDirectionalLight) v = o.intensity; }); return v; };
    sky.setTimeOfDay(0.0);                 // realistic night — dims the shared key light
    const dirNight = dirI();
    sky.setLook('synthwave');              // must restore the fixed bright neon lighting + fog
    return { dirNight, dirSynth: dirI(), fogFar: sky.scene.fog.far };
  });

  expect(out.dirNight).toBeLessThan(0.2);        // night dimmed the key light
  expect(out.dirSynth).toBeCloseTo(1.1, 1);      // synthwave restored the bright key light
  expect(out.fogFar).toBe(6500);                 // fog depth restored, not stale realistic-night ~4200
  assertNoErrors(errors, 'Errors toggling to synthwave after night');
});

test('[DAYNIGHT] setTimeOfDay mutates only — no geometry rebuild, no draw-call blow-up', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    const before = sky.scene.children.length;
    for (const t of [0.0, 0.2, 0.4, 0.6, 0.8, 0.99]) { sky.setTimeOfDay(t); sky.tick(1 / 60); }
    return { before, after: sky.scene.children.length, renderCalls: sky.renderCalls };
  });

  expect(out.after).toBe(out.before);            // no leaked/added objects across the cycle
  expect(out.renderCalls).toBeLessThan(500);     // dome + stars stay within the draw budget
  assertNoErrors(errors, 'Errors sweeping time-of-day');
});

test('[DAYNIGHT] auto cycle advances the clock; disabling it holds the time', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    sky.setTimeOfDay(0.5);                        // known start (this also sets manual/hold)
    sky.setDayNight('auto');                      // resume the auto cycle
    const t0 = sky.timeOfDay;
    for (let i = 0; i < 120; i++) sky.tick(1 / 60);   // ~2 s of sim
    const tAuto = sky.timeOfDay;
    sky.setDayNight('off');                       // freeze
    const tFrozen0 = sky.timeOfDay;
    for (let i = 0; i < 120; i++) sky.tick(1 / 60);
    return { t0, tAuto, advanced: tAuto - t0, tFrozen0, tFrozenEnd: sky.timeOfDay };
  });

  expect(out.advanced).toBeGreaterThan(0.005);   // it moved forward under 'auto'
  expect(out.tAuto).toBeLessThan(1);             // stayed normalized in [0,1)
  expect(out.tFrozenEnd).toBeCloseTo(out.tFrozen0, 5);  // 'off' holds the clock still
  assertNoErrors(errors, 'Errors during auto/off cycle test');
});

test('[DAYNIGHT] the Day/Night Cycle setting persists across reload', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);

  await page.evaluate(() => {
    const sky = window.__sky;
    const s = { ...sky.settings, dayCycle: false };
    localStorage.setItem('sky_settings', JSON.stringify(s));
  });
  await page.reload();
  await page.waitForFunction(() => window.__sky && window.__sky.plane);

  const dayCycle = await page.evaluate(() => window.__sky.settings.dayCycle);
  expect(dayCycle).toBe(false);
  assertNoErrors(errors, 'Errors after day-cycle setting reload');
});
