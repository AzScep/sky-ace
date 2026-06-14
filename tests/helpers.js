// Shared test helpers: error capture + boot synchronization.
import { expect } from '@playwright/test';

// Attach console-error / pageerror / unhandledrejection capture to a page.
// Returns an array that accumulates error strings for assertions.
export function captureErrors(page) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  return errors;
}

// Navigate to the game and wait until the Three.js scene + test hook are ready.
// By default the first-run onboarding overlay + tip are pre-dismissed (via
// seeded localStorage) so flyover/minigame captures aren't covered by them.
// Pass { firstRun: true } to exercise the genuine first-run experience.
export async function boot(page, { firstRun = false } = {}) {
  if (!firstRun) {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('sky_onboarded', '1');
        localStorage.setItem('sky_tip_dismissed', '1');
      } catch { /* storage blocked */ }
    });
  }
  await page.goto('/');
  await page.waitForFunction(() => window.__sky && window.__sky.plane, null, { timeout: 15_000 });
}

// Enter the playing state via the START MISSION button.
export async function startMission(page) {
  await page.click('#btn-start');
  await page.waitForFunction(() => window.__sky.state === 'playing');
}

// Run N deterministic simulation ticks of dt seconds each.
export async function tick(page, n = 1, dt = 1 / 60) {
  await page.evaluate(({ n, dt }) => {
    for (let i = 0; i < n; i++) window.__sky.tick(dt);
  }, { n, dt });
}

export function assertNoErrors(errors, context = '') {
  expect(errors, `${context}\n${errors.join('\n')}`).toEqual([]);
}
