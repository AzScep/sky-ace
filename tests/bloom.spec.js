import { test, expect } from '@playwright/test';
import { captureErrors, boot, startMission, assertNoErrors } from './helpers.js';

// =====================================================
// [BLOOM] proof suite — addons importmap resolves, the EffectComposer +
// UnrealBloomPass are live in the render path, every new neon element is in
// the scene, and the post pass stays inside the 60fps CPU budget (A/B).
// =====================================================

test('[BLOOM] three/addons importmap resolves — no failed module loads', async ({ page }) => {
  const errors = captureErrors(page);
  const failed = [];
  const addonReqs = [];
  page.on('requestfailed', (r) => failed.push(`${r.url()} — ${r.failure()?.errorText}`));
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/examples/jsm/')) {
      addonReqs.push(`${r.status()} ${u}`);
      if (r.status() >= 400) failed.push(`${r.status()} ${u}`);
    }
  });

  await boot(page);
  await page.waitForTimeout(300);

  // The postprocessing addon modules must have actually been fetched & run.
  expect(addonReqs.length, `expected three/addons requests, saw:\n${addonReqs.join('\n')}`).toBeGreaterThan(0);
  expect(failed, `failed module/network loads:\n${failed.join('\n')}`).toEqual([]);
  assertNoErrors(errors, 'Errors while resolving addons');
});

test('[BLOOM] EffectComposer + UnrealBloomPass are active in the render path', async ({ page }) => {
  await boot(page);
  const b = await page.evaluate(() => window.__sky.bloom);
  expect(b.active).toBe(true);
  expect(b.isEffectComposer).toBe(true);
  expect(b.isUnrealBloomPass).toBe(true);
  // Pipeline order: render scene → bloom → tone-map/output.
  expect(b.passes).toEqual(['RenderPass', 'UnrealBloomPass', 'OutputPass']);
  // Tuned so neon glows but nothing blows out to flat white.
  expect(b.strength).toBeGreaterThan(0);
  expect(b.threshold).toBeGreaterThan(0);
  expect(b.threshold).toBeLessThan(1);
});

test('[MAP] dynamic sky dome, textured terrain, clouds, water and sun all render', async ({ page }) => {
  await boot(page);
  const w = await page.evaluate(() => {
    const sky = window.__sky;
    const wd = sky.world;
    return {
      hasSkyDome: !!(wd.skyDome && wd.skyDome.parent),        // dynamic atmospheric sky (replaces the static photo)
      hasStars: !!(wd.stars && wd.stars.parent),
      hasSun: !!wd.sun && !!wd.sun.parent,
      terrainMat: wd.terrain ? wd.terrain.material.type : null,
      cloudCount: wd.clouds ? wd.clouds.children.length : 0,   // billboard cloud sprites
      hasWaterMap: !!(wd.water && wd.water.material.map),
      fogColor: sky.scene.fog ? sky.scene.fog.color.getHexString() : null,
    };
  });
  expect(w.hasSkyDome).toBe(true);
  expect(w.hasStars).toBe(true);
  expect(w.hasSun).toBe(true);
  expect(w.terrainMat).toBe('MeshStandardMaterial');   // height/slope-blended texture shader
  expect(w.cloudCount).toBeGreaterThan(0);
  expect(w.hasWaterMap).toBe(true);
  expect(w.fogColor).not.toBeNull();
});

test('[JUICE] minigame FX route through the central particle + audio systems', async ({ page }) => {
  await boot(page);
  await startMission(page);
  const out = await page.evaluate(() => {
    const sky = window.__sky;
    const THREE = sky.THREE;
    const res = { hasFx: !!sky.fx };

    // RING — flying through a ring registers a pass (score up) + queues juice.
    const ring = sky.forceMinigame('ring');
    const before = ring.score;
    sky.plane.position.copy(ring.rings[0].position);
    sky.tick(1 / 60);
    res.ringScored = ring.score > before;

    // DOGFIGHT — firing spawns a glowing tracer round with a trail.
    const dog = sky.forceMinigame('dogfight');
    dog.fireBullet(sky.plane.position.clone(), sky.plane.quaternion.clone());
    res.dogTracers = dog.bullets.length;
    res.dogTrail = !!(dog.bullets[0] && dog.bullets[0].userData.trail);

    // BOMB — dropping adds a falling bomb to the sim.
    const bomb = sky.forceMinigame('bomb');
    bomb.dropBomb(new THREE.Vector3(0, 200, 0), new THREE.Vector3(0, 0, 0));
    res.bombs = bomb.bombs.length;
    return res;
  });
  expect(out.hasFx).toBe(true);
  expect(out.ringScored).toBe(true);
  expect(out.dogTracers).toBeGreaterThan(0);
  expect(out.dogTrail).toBe(true);
  expect(out.bombs).toBeGreaterThan(0);
});

test('zero console errors driving every minigame mid-action', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);
  await page.evaluate(() => {
    const sky = window.__sky;
    const THREE = sky.THREE;
    for (const mode of ['ring', 'canyon', 'bomb', 'dogfight']) {
      const m = sky.forceMinigame(mode);
      for (let i = 0; i < 30; i++) {
        if (mode === 'ring' && m.rings[m.currentRing]) sky.plane.position.copy(m.rings[m.currentRing].position);
        if (mode === 'canyon') { const g = m.gates.find(x => !x.passed); if (g) sky.plane.position.copy(g.center); }
        if (mode === 'bomb' && i === 0) m.dropBomb(new THREE.Vector3(m.targetPos.x, m.targetPos.y + 200, m.targetPos.z), new THREE.Vector3(0,0,0));
        if (mode === 'dogfight') { const e = m.enemies.find(x => x.userData.alive); if (e) { sky.plane.position.copy(e.position).add(new THREE.Vector3(0,0,-25)); m.fireBullet(sky.plane.position.clone(), sky.plane.quaternion.clone()); } }
        sky.tick(1 / 60);
      }
    }
  });
  await page.waitForTimeout(200);
  assertNoErrors(errors, 'Errors driving minigames with bloom');
});

// [PERF] A/B the post pass: ~4s of real flight with bloom OFF, then ON.
// Both must stay under the 16.7ms/frame (60fps) CPU budget; the half-res
// bloom target is the mitigation that keeps the ON case in budget.
test('[PERF] bloom A/B stays within the 60fps CPU budget', async ({ page }) => {
  await boot(page);
  await startMission(page);

  const measure = async (on) => {
    await page.evaluate((b) => window.__sky.setBloom(b), on);
    // Warm up first (shader compile + JIT) — those cold frames are discarded so
    // the SwiftShader cold-start spike doesn't pollute the steady-state average.
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__sky.resetFrameStats());
    await page.waitForTimeout(4000);
    return page.evaluate(() => ({
      ...window.__sky.frameStats(),
      drawCalls: window.__sky.renderCalls,
      tris: window.__sky.renderTris,
    }));
  };

  // Warm the pipeline once before the first window so neither case eats cold-start.
  await page.waitForTimeout(800);
  const noBloom = await measure(false);
  const bloom = await measure(true);
  await page.evaluate(() => window.__sky.setBloom(true)); // restore

  console.log('[PERF] bloom OFF:', JSON.stringify(noBloom));
  console.log('[PERF] bloom ON :', JSON.stringify(bloom));

  expect(noBloom.cpuMs).toBeLessThan(16.7);
  expect(bloom.cpuMs).toBeLessThan(16.7);
  // Budget updated for the Mastery-Loop build: horizon city (+2), Trail (+2),
  // 5th mission marker (+6), layered exhaust variable (+10-30).  See perf.spec.js
  // for detailed justification.  500 still catches any real draw-call regression.
  expect(bloom.drawCalls).toBeLessThan(500);
  expect(bloom.tris).toBeLessThan(130_000);
  expect(bloom.count).toBeGreaterThan(20);
});
