import { test, expect } from '@playwright/test';
import { captureErrors, boot, startMission, tick, assertNoErrors } from './helpers.js';

test('clean boot — zero console errors / unhandled rejections on load', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  // Let a few real animation frames run so any deferred error surfaces.
  await page.waitForTimeout(500);
  assertNoErrors(errors, 'Errors during boot');

  // Scene actually built.
  const ok = await page.evaluate(() => {
    return !!(window.__sky.plane && window.__sky.missions.length === 5);
  });
  expect(ok).toBe(true);
});

test('START MISSION enters the game HUD', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  await expect(page.locator('#game-hud')).not.toHaveClass(/hidden/);
  await expect(page.locator('#start-screen')).not.toHaveClass(/active/);

  const state = await page.evaluate(() => window.__sky.state);
  expect(state).toBe('playing');
  assertNoErrors(errors, 'Errors entering game');
});

test('pause/resume (Esc) toggles cleanly', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sky.state === 'paused');
  await expect(page.locator('#pause-screen')).toHaveClass(/active/);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__sky.state === 'playing');
  await expect(page.locator('#pause-screen')).not.toHaveClass(/active/);

  assertNoErrors(errors, 'Errors during pause/resume');
});

test('reset (R) returns the plane near spawn', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  // Move the plane slightly so it's no longer at the exact spawn origin.
  // Using a small tick count to stay well under the 60s test timeout when
  // SwiftShader renders the full bloom compositor per tick.
  await tick(page, 5);
  await page.keyboard.press('r');
  await tick(page, 1);

  const pos = await page.evaluate(() => {
    const p = window.__sky.plane.position;
    return { x: p.x, y: p.y, z: p.z };
  });
  // reset() places the plane at (0, 400, 0); one tick nudges it forward slightly.
  expect(Math.abs(pos.x)).toBeLessThan(50);
  expect(Math.abs(pos.z)).toBeLessThan(50);
  expect(pos.y).toBeGreaterThan(300);
  assertNoErrors(errors, 'Errors during reset');
});

test('camera cycle (C) advances through 3 modes', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  expect(await page.evaluate(() => window.__sky.cameraMode)).toBe(0);
  await page.keyboard.press('c');
  expect(await page.evaluate(() => window.__sky.cameraMode)).toBe(1);
  await page.keyboard.press('c');
  expect(await page.evaluate(() => window.__sky.cameraMode)).toBe(2);
  await page.keyboard.press('c');
  expect(await page.evaluate(() => window.__sky.cameraMode)).toBe(0);
  assertNoErrors(errors, 'Errors during camera cycle');
});
