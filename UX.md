# Sky Ace — UX Pass

Onboarding/discoverability, control feel, accessibility/responsive layout, and
removal of the crosshair "shadow disc" over the plane. Synthwave look + bloom
preserved (all `[BLOOM]` tests stay green). No bundler — still Three.js via
CDN + importmap.

Each change is tagged `[FIX]` / `[ONBOARD]` / `[CONTROL]` / `[ACCESS]` with the
files touched and the before→after screenshots that prove it.

---

## [FIX] Remove the circular reticle/"shadow disc" in front of the plane

The green ring centered over the airframe was the HUD crosshair's
`<circle r="30">` SVG element (not a 3D object — `world.js`/`plane.js` have no
shadow disc). In chase cam it sat directly over the plane and read as a faint
shadow/halo. Removed the ring; kept the four aiming tick marks + center dot.

- **Files:** `index.html` (crosshair SVG), `style.css` (comment)
- **Before → After:** `tests/shots/before-plane.png` → `tests/shots/after-plane.png`
- **Proof:** `ux.spec.js` asserts no `.crosshair circle` with `r >= 10` survives,
  the 4 tick `line`s remain, and zero console errors.

---

## [ONBOARD] First-run control hints, waypoint, dismissible tip

- **First-run overlay** (`#onboard-screen`): control legend + "fly through a
  glowing marker to start" guidance. Shows once on the first `START MISSION`,
  freezes the sim behind it, and persists dismissal in
  `localStorage['sky_onboarded']` (never shown again).
- **Directional waypoint** (`#waypoint`): a `▲` arrow under the top HUD that
  rotates toward the nearest uncleared mission and shows its name + distance.
  Hidden during a minigame.
- **Dismissible tip** (`#hud-tip`): a one-line hint with an `✕`; dismissal
  persists in `localStorage['sky_tip_dismissed']`.

- **Files:** `index.html` (overlay, waypoint, tip), `style.css`
  (`.onboard-*`, `.waypoint`, `.hud-tip`), `game.js`
  (`maybeShowOnboarding`/`dismissOnboarding`, `maybeShowTip`/`dismissTip`,
  `updateWaypoint`, loop freeze while overlay is up)
- **After:** `tests/shots/after-onboard.png`, waypoint visible in
  `tests/shots/after-plane.png`
- **Proof:** `ux.spec.js` — overlay shows on first run, hides + persists after
  dismiss, does **not** reappear after reload; tip dismissal persists.

---

## [CONTROL] Settings menu, control feel, blur handling

- **Settings menu** (`#settings-screen`, opened from the main menu and the pause
  menu): **Invert Pitch** toggle + **Sensitivity** slider (0.5×–2.0×). Settings
  persist in `localStorage['sky_settings']` and apply live.
- **Invert pitch / sensitivity** are wired into `PlaneController.update` —
  invert flips the pitch sign; sensitivity scales commanded roll/pitch/yaw rates
  (auto-level springs are left untouched so the plane still self-stabilizes).
- **No stuck keys / pause-on-blur:** on `window` blur the held-key set is
  cleared and the flight pauses (`#pause-screen`), so leaving the tab can't leave
  a control jammed on.

- **Files:** `index.html` (settings modal + buttons), `style.css`
  (`.settings-grid`, `.set-toggle`, range styling), `plane.js`
  (`invertPitch`, `sensitivity`), `game.js`
  (`loadSettings`/`saveSettings`/`applySettings`/`wireSettings`, blur handler)
- **After:** `tests/shots/after-settings.png`
- **Proof:** `ux.spec.js` — every setting persists across reload and re-applies
  to the live controller + DOM; invert flips the pitch sign; blur empties
  `heldKeys` and moves state → `paused`.

---

## [ACCESS] Reduced motion, colorblind-safe accent, volume, responsive

- **Reduced Motion** toggle: adds `body.reduced-motion` (collapses CSS
  animations/transitions to a single end-state frame) and disables the radar
  sweep, score flash, and toast pop in JS hot paths.
- **Colorblind-Safe Accent** toggle: `body.cb-safe` swaps the green/orange HUD
  affordances for a blue + amber pairing that stays distinct across common CVD
  types.
- **Master Volume** slider (0–100%): persisted in settings and exposed at
  `window.__sky.settings.volume` for audio hooks.
- **Responsive:** the canvas + HUD already refit on `resize`; verified the
  canvas exactly fills the viewport with no horizontal/vertical overflow at
  desktop (1280×720) and a small/mobile (390×780) viewport. Added mobile rules
  for the waypoint, tip, and settings rows.

- **Files:** `index.html` (settings rows), `style.css` (`body.cb-safe`,
  `body.reduced-motion`, mobile `@media`), `game.js` (reduced-motion gates)
- **After:** `tests/shots/after-game-desktop.png`,
  `tests/shots/after-game-mobile.png`, `tests/shots/after-colorblind.png`
- **Proof:** `ux.spec.js` — reduced-motion + colorblind classes toggle and
  persist; canvas `clientWidth/Height` equals the viewport and overflow ≤ 0 at
  both sizes.

---

## Test harness

- Static server: `node tests/server.js` (serves the repo root on :4173);
  Playwright's `webServer` in `playwright.config.js` starts it automatically.
- Run everything: `npx playwright test`. Headless Chromium with SwiftShader WebGL
  so the Three.js scene renders in CI.
- Screenshots land in `./tests/shots` (`before-*` baseline, `after-*` gallery).
- `tests/helpers.js` `boot()` pre-dismisses onboarding by default (seeded
  localStorage) so flyover/minigame captures aren't covered; `boot(page,
  { firstRun: true })` exercises the genuine first-run path.
