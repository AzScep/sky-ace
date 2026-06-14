import { test, expect } from '@playwright/test';
import { boot, startMission } from './helpers.js';

// [PERF] Guard the draw-call / triangle / frame-time budget. The instancing +
// terrain + allocation work cut draw calls from ~370 to ~24 and trim triangles.
// This test also prints the live numbers so the perf claim is reproducible.
test('[PERF] ~5s headless flight stays within the draw-call & CPU budget', async ({ page }) => {
  await boot(page);
  await startMission(page);

  await page.evaluate(() => window.__sky.resetFrameStats());
  await page.waitForTimeout(5000);

  const m = await page.evaluate(() => ({
    ...window.__sky.frameStats(),
    drawCalls: window.__sky.renderCalls,
    tris: window.__sky.renderTris,
  }));

  console.log('[PERF] flight metrics:', JSON.stringify(m));

  // Draw calls: instancing collapses trees+clouds; whole scene should be tiny.
  expect(m.drawCalls).toBeLessThan(60);
  // CPU work per frame well under the 16.7ms (60fps) budget.
  expect(m.cpuMs).toBeLessThan(16.7);
  // Triangle budget — terrain trim keeps us under 100k.
  expect(m.tris).toBeLessThan(100_000);
  // We actually rendered frames.
  expect(m.count).toBeGreaterThan(20);
});
