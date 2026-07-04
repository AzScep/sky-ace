import { test, expect } from '@playwright/test';
import { boot, tick, captureErrors, assertNoErrors } from './helpers.js';

// =====================================================
// [LOOK] Task 2 — synthwave/realistic look toggle.
// `world.setLook(mode)` is exposed as `window.__sky.setLook(mode)`; contract
// says the swap must be material/uniform/visibility only (no geometry
// rebuild) and must stay inside the perf budget (renderCalls < 500).
// =====================================================

test('[LOOK] setLook swaps look with no errors and no geometry rebuild', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);

  const before = await page.evaluate(() => ({
    calls: window.__sky.renderCalls,
    children: window.__sky.scene.children.length,
  }));
  expect(before.calls).toBeLessThan(500);

  await page.evaluate(() => window.__sky.setLook('synthwave'));
  await tick(page, 5);
  const afterSynth = await page.evaluate(() => ({
    calls: window.__sky.renderCalls,
    children: window.__sky.scene.children.length,
    look: window.__sky.settings.look,
  }));
  expect(afterSynth.look).toBe('synthwave');
  expect(afterSynth.calls).toBeLessThan(500);
  expect(afterSynth.children).toBe(before.children); // toggled, not rebuilt

  await page.evaluate(() => window.__sky.setLook('realistic'));
  await tick(page, 5);
  const afterRealistic = await page.evaluate(() => ({
    calls: window.__sky.renderCalls,
    children: window.__sky.scene.children.length,
    look: window.__sky.settings.look,
  }));
  expect(afterRealistic.look).toBe('realistic');
  expect(afterRealistic.calls).toBeLessThan(500);
  expect(afterRealistic.children).toBe(before.children);

  // eslint-disable-next-line no-console
  console.log(`[LOOK] renderCalls before=${before.calls} synthwave=${afterSynth.calls} realistic=${afterRealistic.calls}`);
  assertNoErrors(errors, 'Errors during setLook A/B');
});

test('[LOOK] look choice persists across reload', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);

  await page.click('#btn-settings');
  await expect(page.locator('#settings-screen')).toHaveClass(/active/);
  expect(await page.evaluate(() => window.__sky.settings.look)).toBe('realistic');

  await page.check('#set-look'); // checked => synthwave (see wireSettings)
  expect(await page.evaluate(() => window.__sky.settings.look)).toBe('synthwave');

  await page.reload();
  await page.waitForFunction(() => window.__sky && window.__sky.plane);

  const after = await page.evaluate(() => ({
    look: window.__sky.settings.look,
    uiChecked: document.getElementById('set-look').checked,
  }));
  expect(after.look).toBe('synthwave');
  expect(after.uiChecked).toBe(true);
  assertNoErrors(errors, 'Errors during look persistence test');
});
