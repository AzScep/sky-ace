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

  // Draw-call budget updated for the Mastery-Loop build which legitimately adds:
  //   • Horizon city cylinder  (+2 calls with bloom)
  //   • Wingtip Trail mesh     (+2 calls with bloom)
  //   • 5th mission marker     (+6 calls with bloom: beam+ring+halo × 2 passes)
  //   • 3-sprite layered exhaust (variable, ~10-30 at steady state × 2)
  // Previous budget was 450 for the pre-mastery scene.  The new fixed additions
  // alone account for ~10 extra calls; particle variability adds ~30 at the
  // worst snapshot moment.  500 still catches meaningful regressions (runaway
  // FX, accidental geometry duplication).  CPU / tris guards remain unchanged.
  expect(m.drawCalls).toBeLessThan(500);
  // CPU work per frame well under the 16.7ms (60fps) budget.
  expect(m.cpuMs).toBeLessThan(16.7);
  // Triangle budget — terrain + props.
  expect(m.tris).toBeLessThan(130_000);
  // We actually rendered frames.
  expect(m.count).toBeGreaterThan(20);
});
