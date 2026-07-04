import { test, expect } from '@playwright/test';
import { captureErrors, boot, startMission, assertNoErrors } from './helpers.js';
import fs from 'node:fs';
import path from 'node:path';

// =====================================================
// Screenshot harness — captures before/after PNGs for the
// map flyover and each minigame mid-action into ./tests/shots.
//
//   SHOT_PHASE=before npx playwright test screenshots   # baseline (old art)
//   SHOT_PHASE=after  npx playwright test screenshots   # synthwave + bloom
//
// PHASE defaults to "after". Each capture also asserts the canvas
// produced a non-trivial (non-blank) PNG and the boot/minigame ran
// clean (zero console errors), so the gallery can't silently rot.
// =====================================================

const PHASE = process.env.SHOT_PHASE || 'after';
const SHOTS = path.join(process.cwd(), 'tests', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

// A PNG of a uniform color compresses to almost nothing. Real rendered
// frames (terrain, neon, HUD) are many KB. Use file size as a cheap
// "did anything actually render" guard.
const MIN_PNG_BYTES = 12_000;

function shotPath(name) {
  return path.join(SHOTS, `${PHASE}-${name}.png`);
}

async function grab(page, name) {
  const file = shotPath(name);
  await page.screenshot({ path: file });
  const bytes = fs.statSync(file).size;
  console.log(`[SHOT] ${PHASE}-${name}.png  ${bytes} bytes`);
  expect(bytes, `${name} screenshot looks blank (${bytes} bytes)`).toBeGreaterThan(MIN_PNG_BYTES);
  return file;
}

// Let real animation frames run so VFX (bursts, tracers, fades) animate
// into a photogenic state before the shutter.
async function settle(page, frames = 30) {
  await page.evaluate((n) => {
    for (let i = 0; i < n; i++) window.__sky.tick(1 / 60);
  }, frames);
  await page.waitForTimeout(120);
}

test('SHOT — world / map flyover', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);
  // Bank into a gentle climbing turn so the flyover frames horizon + sun + grid.
  await page.evaluate(() => {
    const sky = window.__sky;
    sky.plane.position.set(-400, 520, -1400);
    sky.plane.rotation.set(0.05, 0.6, 0.12);
    sky.controller.velocity.set(0, 0, 0);
  });
  await settle(page, 40);
  await grab(page, 'map');
  assertNoErrors(errors, 'Errors during map flyover capture');
});

test('SHOT — Ring Run mid-action', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);
  await page.evaluate(() => {
    const sky = window.__sky;
    const m = sky.forceMinigame('ring');
    // Pass two rings so the combo counter + passthrough burst are live.
    sky.plane.position.copy(m.rings[0].position);
    sky.tick(1 / 60);
    sky.plane.position.copy(m.rings[1].position);
    sky.tick(1 / 60);
    // Park just short of ring 3 looking down the tube.
    const r = m.rings[m.currentRing];
    sky.plane.position.copy(r.position).addScaledVector(r.normal, -160);
    sky.plane.lookAt(r.position);
  });
  await settle(page, 16);
  await grab(page, 'ring');
  assertNoErrors(errors, 'Errors during Ring Run capture');
});

test('SHOT — Canyon Dash mid-action', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);
  await page.evaluate(() => {
    const sky = window.__sky;
    const m = sky.forceMinigame('canyon');
    // Sit just before the first gate, low, nose through the pylons. T3 removed the
    // soft-floor, so this still must fly LEVEL with a little clearance — nosing down
    // toward the gate over rising canyon terrain now crashes the run mid-capture.
    const g = m.gates[0];
    sky.controller.speed = 0;                 // don't fly forward into terrain during settle
    sky.plane.position.copy(g.center).addScaledVector(g.dir, -120);
    // Clear the terrain UNDER the plane (120u behind the gate, over different ground than the
    // gate) — the crash check samples terrain at the plane's own XZ, not the gate's.
    const groundHere = sky.terrainHeight(sky.plane.position.x, sky.plane.position.z);
    sky.plane.position.y = Math.max(g.center.y + 40, groundHere + 60);
    const aim = g.center.clone().addScaledVector(g.dir, 200);
    aim.y = sky.plane.position.y;             // level gaze — no downward pitch into the ground
    sky.plane.lookAt(aim);
  });
  await settle(page, 4);
  await grab(page, 'canyon');
  assertNoErrors(errors, 'Errors during Canyon Dash capture');
});

test('SHOT — Precision Drop mid-action', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);
  await page.evaluate(() => {
    const sky = window.__sky;
    const THREE = sky.THREE;
    const m = sky.forceMinigame('bomb');
    const t = m.targetPos;
    // Drop a near-bullseye bomb and let it detonate for the light burst + blast ring.
    m.dropBomb(new THREE.Vector3(t.x + 6, t.y + 120, t.z + 6), new THREE.Vector3(0, 0, 0));
    for (let i = 0; i < 90 && m.bombs.length; i++) sky.tick(1 / 60);
    // Frame the target reticle from a banking dive.
    sky.plane.position.set(t.x - 220, t.y + 260, t.z - 220);
    sky.plane.lookAt(t.x, t.y, t.z);
  });
  await settle(page, 10);
  await grab(page, 'bomb');
  assertNoErrors(errors, 'Errors during Precision Drop capture');
});

test('SHOT — Dogfight mid-action', async ({ page }) => {
  const errors = captureErrors(page);
  await boot(page);
  await startMission(page);
  await page.evaluate(() => {
    const sky = window.__sky;
    const THREE = sky.THREE;
    const m = sky.forceMinigame('dogfight');
    const e = m.enemies[0];
    // Get on an enemy's six and pour tracers until it pops.
    for (let k = 0; k < 120 && m.kills < 1; k++) {
      sky.plane.quaternion.identity();
      sky.plane.position.copy(e.position).add(new THREE.Vector3(0, 5, -42));
      sky.plane.lookAt(e.position);
      m.fireBullet(sky.plane.position.clone(), sky.plane.quaternion.clone());
      sky.tick(1 / 60);
    }
    // Now pull BACK and frame the burst from distance so it reads as a contained
    // light flare (not a white-out), with a fresh tracer streaking down range.
    const burst = e.position.clone();
    sky.plane.position.copy(burst).add(new THREE.Vector3(90, 36, -190));
    sky.plane.lookAt(burst);
    sky.controller.velocity.set(0, 0, 0);
    m.fireBullet(sky.plane.position.clone(), sky.plane.quaternion.clone());
  });
  await settle(page, 2);
  await grab(page, 'dogfight');
  assertNoErrors(errors, 'Errors during Dogfight capture');
});
