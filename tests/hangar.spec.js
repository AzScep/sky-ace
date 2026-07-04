import { test, expect } from '@playwright/test';
import { boot, startMission, captureErrors, assertNoErrors } from './helpers.js';

// =====================================================
// [HANGAR] Task 7 — leveling finally *buys* something. Level-gated skins (a neon
// emissive tint on the jet) and trails (the exhaust-plume colour) unlock by level
// and equip from the start-screen hangar, persisted in the profile.
// Unlocks are DERIVED from level (no currency, no persisted "unlocked" list), so a
// newly-crossed threshold shows immediately. Level costs (levelFromXp): cumulative
// XP for L2=450, L3=1050, L7=4950, L8=6300, L12=13200.
// =====================================================

const find = (arr, id) => arr.find(x => x.id === id);

test('[HANGAR] unlocks gate by level', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);

  // Fresh profile → level 1: only level-1 items unlocked.
  const lv1 = await page.evaluate(() => {
    const u = window.__sky.getUnlocks();
    const f = (arr, id) => arr.find(x => x.id === id);
    return {
      magenta:   f(u.skins, 'magenta').unlocked,   // lv 1
      cyanSkin:  f(u.skins, 'cyan').unlocked,       // lv 3
      offTrail:  f(u.trails, 'off').unlocked,       // lv 1
      pinkTrail: f(u.trails, 'pink').unlocked,      // lv 5
    };
  });
  expect(lv1.magenta).toBe(true);
  expect(lv1.cyanSkin).toBe(false);
  expect(lv1.offTrail).toBe(true);
  expect(lv1.pinkTrail).toBe(false);

  // Grant enough XP to reach level 8: gold (lv 7) unlocks, void (lv 12) stays locked.
  const lv8 = await page.evaluate(() => {
    window.__sky.grantXp(7000, 'seed');
    const u = window.__sky.getUnlocks();
    const f = (arr, id) => arr.find(x => x.id === id);
    return { level: window.__sky.profile.level, gold: f(u.skins, 'gold').unlocked, voidSkin: f(u.skins, 'void').unlocked };
  });
  expect(lv8.level).toBeGreaterThanOrEqual(8);
  expect(lv8.level).toBeLessThan(12);
  expect(lv8.gold).toBe(true);
  expect(lv8.voidSkin).toBe(false);

  assertNoErrors(errors, 'Errors during unlock-gating test');
});

test('[HANGAR] equipping a locked item is rejected', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);

  const out = await page.evaluate(() => {
    const sky = window.__sky;
    const before = sky.getUnlocks().equipped.skin;   // default 'magenta'
    const r = sky.equip('skins', 'void');            // void = lv 12, locked at lv 1
    return { before, returned: r.skin, after: sky.getUnlocks().equipped.skin };
  });

  expect(out.before).toBe('magenta');
  expect(out.returned).toBe('magenta');   // rejected — unchanged
  expect(out.after).toBe('magenta');
  assertNoErrors(errors, 'Errors during locked-equip test');
});

test('[HANGAR] equipping an unlocked skin repaints the plane', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);

  const emissive = await page.evaluate(() => {
    const sky = window.__sky;
    sky.grantXp(1200, 'seed');        // → level 3, unlocks Ion Cyan (lv 3)
    sky.equip('skins', 'cyan');       // applies immediately (repaints the live plane)
    let hit = null;
    sky.plane.traverse(o => {
      if (!o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m.emissive && m.emissive.getHex() === 0x00ffd5) hit = m.emissive.getHex();
    });
    return hit;
  });

  expect(emissive).toBe(0x00ffd5);   // Ion Cyan glow is on the jet
  assertNoErrors(errors, 'Errors during equip-applies test');
});

test('[HANGAR] equipped cosmetic persists across reload', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);

  await page.evaluate(() => {
    const sky = window.__sky;
    sky.grantXp(1200, 'seed');        // level 3 → Ion Cyan unlocked
    sky.equip('skins', 'cyan');
  });

  await page.reload();
  await page.waitForFunction(() => window.__sky && window.__sky.plane);
  const equipped = await page.evaluate(() => window.__sky.getUnlocks().equipped.skin);

  expect(equipped).toBe('cyan');
  assertNoErrors(errors, 'Errors during equip-persist test');
});
