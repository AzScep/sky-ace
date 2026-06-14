import { test, expect } from '@playwright/test';
import { captureErrors, boot, startMission, tick, assertNoErrors } from './helpers.js';
import fs from 'node:fs';
import path from 'node:path';

// =====================================================
// UX suite — proves the onboarding / control-feel / accessibility work
// and the crosshair-ring removal, and saves the "after" gallery PNGs.
//   ./tests/shots/after-plane.png       (ring removed + waypoint)
//   ./tests/shots/after-onboard.png     (first-run overlay)
//   ./tests/shots/after-settings.png    (settings menu)
//   ./tests/shots/after-game-desktop.png
//   ./tests/shots/after-game-mobile.png
// =====================================================

const SHOTS = path.join(process.cwd(), 'tests', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const MIN_PNG_BYTES = 12_000;

async function grab(page, name) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  const bytes = fs.statSync(file).size;
  console.log(`[SHOT] ${name}.png  ${bytes} bytes`);
  expect(bytes, `${name} looks blank (${bytes} bytes)`).toBeGreaterThan(MIN_PNG_BYTES);
}

async function settle(page, frames = 24) {
  await page.evaluate((n) => { for (let i = 0; i < n; i++) window.__sky.tick(1 / 60); }, frames);
  await page.waitForTimeout(120);
}

// -----------------------------------------------------
// [FIX] crosshair ring / shadow disc is gone
// -----------------------------------------------------
test('[FIX] crosshair ring/disc removed (DOM) + after-plane shot', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  // The old reticle was an SVG <circle r="30"> centered over the plane.
  // Assert no crosshair circle with a non-trivial radius survives.
  const radii = await page.evaluate(() =>
    [...document.querySelectorAll('.crosshair circle')].map(c => parseFloat(c.getAttribute('r')))
  );
  expect(radii.every(r => r < 10), `found a large crosshair ring: r=${radii}`).toBe(true);
  // The crosshair element + its aiming tick marks still exist.
  const ticks = await page.evaluate(() => document.querySelectorAll('.crosshair line').length);
  expect(ticks).toBe(4);

  await page.evaluate(() => {
    const sky = window.__sky;
    sky.plane.position.set(0, 400, 0);
    sky.plane.rotation.set(0, 0, 0);
    sky.controller.velocity.set(0, 0, 0);
  });
  await settle(page, 24);
  // Waypoint arrow should be visible (points toward nearest mission).
  await expect(page.locator('#waypoint')).not.toHaveClass(/hidden/);
  await grab(page, 'after-plane');
  assertNoErrors(errors, 'Errors on FIX/plane capture');
});

// -----------------------------------------------------
// [ONBOARD] first run shows overlay; persists dismissal in localStorage
// -----------------------------------------------------
test('[ONBOARD] overlay shows on first run, hides after flag is set', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page, { firstRun: true });

  // Not shown until the mission starts.
  await expect(page.locator('#onboard-screen')).not.toHaveClass(/active/);
  const flagBefore = await page.evaluate(() => localStorage.getItem('sky_onboarded'));
  expect(flagBefore).toBeNull();

  await startMission(page);
  await expect(page.locator('#onboard-screen')).toHaveClass(/active/);
  expect(await page.evaluate(() => window.__sky.onboardingActive)).toBe(true);
  await grab(page, 'after-onboard');

  // Dismiss → overlay gone, flag persisted, sim unfrozen.
  await page.click('#btn-onboard-dismiss');
  await expect(page.locator('#onboard-screen')).not.toHaveClass(/active/);
  expect(await page.evaluate(() => window.__sky.onboardingActive)).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('sky_onboarded'))).toBe('1');

  // Reload (same context keeps localStorage) → overlay must NOT reappear.
  await page.reload();
  await page.waitForFunction(() => window.__sky && window.__sky.plane);
  await startMission(page);
  await expect(page.locator('#onboard-screen')).not.toHaveClass(/active/);
  expect(await page.evaluate(() => window.__sky.onboardingActive)).toBe(false);
  assertNoErrors(errors, 'Errors during onboarding flow');
});

// -----------------------------------------------------
// [ONBOARD] dismissible tip persists its dismissal
// -----------------------------------------------------
test('[ONBOARD] HUD tip is dismissible and stays dismissed', async ({ page }) => {
  await boot(page, { firstRun: true });
  await startMission(page);
  // Dismiss onboarding overlay first so the tip underneath is clickable.
  await page.click('#btn-onboard-dismiss');
  await expect(page.locator('#hud-tip')).not.toHaveClass(/hidden/);
  await page.click('#hud-tip-close');
  await expect(page.locator('#hud-tip')).toHaveClass(/hidden/);
  expect(await page.evaluate(() => localStorage.getItem('sky_tip_dismissed'))).toBe('1');
});

// -----------------------------------------------------
// [CONTROL]/[ACCESS] every setting persists across a reload + applies live
// -----------------------------------------------------
test('[CONTROL/ACCESS] settings persist across reload + apply', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);

  // Open settings from the main menu and change every control.
  await page.click('#btn-settings');
  await expect(page.locator('#settings-screen')).toHaveClass(/active/);
  await grab(page, 'after-settings');

  await page.check('#set-invert');
  await page.locator('#set-sens').fill('1.7');
  await page.check('#set-reduced');
  await page.check('#set-colorblind');
  await page.locator('#set-volume').fill('30');

  // Applied live before any reload.
  const live = await page.evaluate(() => ({
    s: window.__sky.settings,
    invert: window.__sky.controller.invertPitch,
    sens: window.__sky.controller.sensitivity,
    cb: document.body.classList.contains('cb-safe'),
    rm: document.body.classList.contains('reduced-motion'),
  }));
  expect(live.invert).toBe(true);
  expect(live.sens).toBeCloseTo(1.7);
  expect(live.cb).toBe(true);
  expect(live.rm).toBe(true);

  // Reload → values restored from localStorage.
  await page.reload();
  await page.waitForFunction(() => window.__sky && window.__sky.plane);
  const after = await page.evaluate(() => ({
    s: window.__sky.settings,
    invert: window.__sky.controller.invertPitch,
    sens: window.__sky.controller.sensitivity,
    cb: document.body.classList.contains('cb-safe'),
    rm: document.body.classList.contains('reduced-motion'),
    ui: {
      invert: document.getElementById('set-invert').checked,
      sens: document.getElementById('set-sens').value,
      reduced: document.getElementById('set-reduced').checked,
      colorblind: document.getElementById('set-colorblind').checked,
      volume: document.getElementById('set-volume').value,
    },
  }));
  expect(after.s.invertPitch).toBe(true);
  expect(after.s.sensitivity).toBeCloseTo(1.7);
  expect(after.s.reducedMotion).toBe(true);
  expect(after.s.colorblind).toBe(true);
  expect(after.s.volume).toBeCloseTo(0.3);
  // Restored values are wired back into the live controller + DOM.
  expect(after.invert).toBe(true);
  expect(after.sens).toBeCloseTo(1.7);
  expect(after.cb).toBe(true);
  expect(after.rm).toBe(true);
  expect(after.ui).toEqual({ invert: true, sens: '1.7', reduced: true, colorblind: true, volume: '30' });
  assertNoErrors(errors, 'Errors during settings persistence');
});

// -----------------------------------------------------
// [ACCESS] colorblind-safe accent — visual gallery shot in flight
// -----------------------------------------------------
test('[ACCESS] colorblind-safe accent gallery shot', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const sky = window.__sky;
    sky.settings.colorblind = true;
    sky.applySettings();
  });
  await startMission(page);
  await page.evaluate(() => {
    const sky = window.__sky;
    sky.plane.position.set(0, 420, 0);
    sky.plane.rotation.set(0, 0, 0);
    sky.controller.velocity.set(0, 0, 0);
  });
  await settle(page, 20);
  await grab(page, 'after-colorblind');
});

// -----------------------------------------------------
// [CONTROL] invert-pitch actually flips the pitch response
// -----------------------------------------------------
test('[CONTROL] invert pitch flips pitch sign', async ({ page }) => {
  await boot(page);
  await startMission(page);
  const out = await page.evaluate(() => {
    const sky = window.__sky;
    const sample = (invert) => {
      sky.controller.reset(new sky.THREE.Vector3(0, 400, 0));
      sky.controller.invertPitch = invert;
      // Hold "pitch up" (S) for a bit, read resulting nose direction.
      for (let i = 0; i < 40; i++) sky.controller.update(1 / 60, { pitchUp: true, pitchDown: false, rollLeft:false, rollRight:false, yawLeft:false, yawRight:false, throttleUp:false, throttleDown:false, boost:false, fire:false });
      const fwd = new sky.THREE.Vector3(0, 0, 1).applyQuaternion(sky.plane.quaternion);
      return fwd.y;
    };
    return { normal: sample(false), inverted: sample(true) };
  });
  // Same key, opposite vertical nose direction.
  expect(Math.sign(out.normal)).toBe(-Math.sign(out.inverted));
  expect(Math.abs(out.normal)).toBeGreaterThan(0.05);
});

// -----------------------------------------------------
// [CONTROL] window blur clears held keys AND pauses the flight
// -----------------------------------------------------
test('[CONTROL] blur clears inputs + pauses', async ({ page }) => {
  await boot(page);
  await startMission(page);

  await page.keyboard.down('d');           // hold a roll key
  await page.waitForFunction(() => window.__sky.heldKeys.includes('d'));
  expect(await page.evaluate(() => window.__sky.state)).toBe('playing');

  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await page.evaluate(() => window.__sky.heldKeys)).toEqual([]);  // no stuck keys
  expect(await page.evaluate(() => window.__sky.state)).toBe('paused');  // paused on blur
  await expect(page.locator('#pause-screen')).toHaveClass(/active/);
  await page.keyboard.up('d');
});

// -----------------------------------------------------
// [ACCESS] canvas + HUD resize cleanly at desktop and mobile, no overflow
// -----------------------------------------------------
test('[ACCESS] canvas resizes to fit at desktop + mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await boot(page);
  await startMission(page);
  await settle(page, 16);

  const fit = async () => page.evaluate(() => {
    const c = document.getElementById('game-canvas');
    return {
      cw: c.clientWidth, ch: c.clientHeight,
      iw: window.innerWidth, ih: window.innerHeight,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      overflowY: document.documentElement.scrollHeight - window.innerHeight,
    };
  });

  let m = await fit();
  expect(m.cw).toBe(m.iw);
  expect(m.ch).toBe(m.ih);
  expect(m.overflowX).toBeLessThanOrEqual(0);
  expect(m.overflowY).toBeLessThanOrEqual(0);
  await grab(page, 'after-game-desktop');

  // Shrink to a small/mobile viewport → resize handler must refit the canvas.
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(120);
  await settle(page, 16);
  m = await fit();
  expect(m.cw).toBe(390);
  expect(m.ch).toBe(780);
  expect(m.overflowX).toBeLessThanOrEqual(0);
  expect(m.overflowY).toBeLessThanOrEqual(0);
  await grab(page, 'after-game-mobile');
});

// -----------------------------------------------------
// Zero console errors across boot → onboarding → settings → a minigame
// -----------------------------------------------------
test('zero console errors on boot, onboarding, settings and a minigame', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page, { firstRun: true });
  await startMission(page);
  await page.click('#btn-onboard-dismiss');     // exercise onboarding path
  await page.evaluate(() => {                    // exercise a minigame
    const sky = window.__sky;
    const m = sky.forceMinigame('dogfight');
    for (let i = 0; i < 40; i++) {
      const e = m.enemies.find(x => x.userData.alive);
      if (e) { sky.plane.position.copy(e.position).add(new sky.THREE.Vector3(0, 0, -25)); m.fireBullet(sky.plane.position.clone(), sky.plane.quaternion.clone()); }
      sky.tick(1 / 60);
    }
  });
  await page.waitForTimeout(200);
  assertNoErrors(errors, 'Console errors during full UX flow');
});
