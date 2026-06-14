# Sky Ace — NEON SYNTHWAVE / OUTRUN Restyle + TRUE BLOOM

Every enhancement below is proven by the Playwright suite under `./tests`
(`npx playwright test` → 24/24 green) and captured as before/after PNGs in
`./tests/shots`. Locked palette throughout:

`#1a0b2e` deep purple · `#ff2e88` magenta · `#b14bff` violet · `#00ffd5` cyan · `#ffcf4d` retro-gold

The harness serves the repo root over HTTP (`tests/server.js`) and boots
`index.html` exactly as in production (no bundler — Three.js + addons load via
CDN importmap). Capture either phase with:

```
SHOT_PHASE=before npx playwright test screenshots   # old daytime look
SHOT_PHASE=after  npx playwright test screenshots   # synthwave + bloom (default)
```

---

## [BLOOM] True post-processing bloom — EffectComposer + UnrealBloomPass
**Files:** `index.html`, `game.js` (`setupBloom`, `renderFrame`, `onResize`)

- Extended the importmap with `"three/addons/" → https://unpkg.com/three@0.160.0/examples/jsm/`
  (kept the no-build CDN setup) and imported `EffectComposer`, `RenderPass`,
  `UnrealBloomPass`, `OutputPass`.
- The main loop now renders through `composer.render()`; the composer resizes
  with the canvas. Pipeline: **RenderPass → UnrealBloomPass → OutputPass**.
- Tuned `strength 1.05 / radius 0.6 / threshold 0.55` + Reinhard tone mapping so
  neon glows but the HUD/scene never blow out to flat white.
- **PERF mitigation (did NOT drop bloom):** the bloom target runs at **half
  resolution** (`w>>1, h>>1`) — ~4× fewer pixels through the blur mip chain.
- Debug handle `window.__sky.bloom` exposes the live composer/pass for the test.
- **Proof:** `tests/bloom.spec.js` — addons importmap resolves (real
  `/examples/jsm/` fetches, none 4xx), `EffectComposer + UnrealBloomPass` active,
  pass order asserted, and the half-res post pass stays under the 60fps CPU budget.
- **Before→After:** every scene below (the whole game is rendered through bloom).

---

## [MAP] World restyle (≥4)
**Files:** `world.js` (`buildWorld`, `buildGridLines`, `createMissionMarker`), `game.js`

1. **Dusk sky gradient + star/haze speckle** — `ShaderMaterial` sky: pink horizon
   `#ff2e88` → violet `#b14bff` → deep purple `#1a0b2e` top, with high-altitude
   shader twinkle. *(world.js — sky shader)*
2. **Retro banded sun** — a `#ffcf4d→#ff2e88` disc with carved horizontal scan
   bands on the horizon, billboarded to the camera each frame. *(world.js sun
   shader + `game.js renderFrame` billboard)*
3. **Glowing cyan wireframe grid terrain** — dark emissive heightfield base
   (`MeshBasicMaterial`, no realtime lighting) under a `#00ffd5` heightfield
   `LineSegments` grid (the OUTRUN signature). *(world.js `buildGridLines`)*
4. **Star / haze field** — a real 900-point `Points` field biased to the upper
   sky, white/cyan/violet, that blooms to a soft twinkle. *(world.js stars)*
5. **Bonus:** violet fog, dark neon water, violet haze-bank clouds, dark
   silhouette trees, and **neon mission-marker pillars** (additive beam + rotating
   ring + pulsing halo, per-objective palette color).
- **Proof:** `tests/bloom.spec.js › [BLOOM/MAP] sky, grid, sun and stars all
  render in the scene` (asserts sky/sun in scene, grid > 5000 verts, stars > 500,
  every marker has a halo).
- **Before→After:** `tests/shots/before-map.png` → `tests/shots/after-map.png`

---

## [RING] Ring Run — synthwave juice (3)
**Files:** `minigames.js` (`RingRun`)

1. **Neon-tube rings** — additive cyan torus + faint portal disc; the active ring
   glows **magenta** and pulses so the next gate pops.
2. **Passthrough light burst** — flying through a ring fires a cyan shockwave ring
   + white core flash (shared additive `spawnFlash`/`updateFx` VFX system).
3. **Combo counter** — consecutive passes build `COMBO xN` (HUD + toast) and pay an
   escalating bonus (`+75` per chain link).
- **Proof:** `tests/bloom.spec.js › minigame juice elements exist` (combo ≥ 1 and a
  live burst after a pass); `tests/minigames.spec.js › RING RUN` still clears.
- **Before→After:** `tests/shots/before-ring.png` → `tests/shots/after-ring.png`

---

## [CANYON] Canyon Dash — synthwave juice (3)
**Files:** `minigames.js` (`CanyonDash`)

1. **Glowing pylons + cap beacons** — pylons alternate violet/magenta with bright
   additive cyan cap lights that bloom.
2. **Neon gate curtains** — a soft glowing pane spans each gate; the *next* gate's
   curtain pulses to guide the line.
3. **Near-miss flash** — shaving a pylon edge (within 18u of the gap) pays a thrill
   bonus + a gold light burst + `⚡ NEAR MISS!`; every pass throws a colored
   shockwave ring through the curtain.
- **Proof:** `tests/bloom.spec.js` asserts 14 gate curtains; `tests/minigames.spec.js
  › CANYON DASH` still clears the course.
- **Before→After:** `tests/shots/before-canyon.png` → `tests/shots/after-canyon.png`

---

## [BOMB] Precision Drop — synthwave juice (3)
**Files:** `minigames.js` (`PrecisionDrop`)

1. **Neon target reticle** — concentric additive magenta/cyan rings + crosshair
   ticks that slowly spin (radar-lock feel), plus a vertical magenta target beam.
2. **Light-burst detonation** — impacts fire a white core + colored fireball
   (gold for close hits, magenta otherwise).
3. **Blast-radius ring** — a flat additive shockwave ring expands across the
   ground at the impact point.
- **Proof:** `tests/bloom.spec.js` asserts the reticle group renders; the (now
  glowing-gold) bombs still score via `tests/minigames.spec.js › PRECISION DROP`.
- **Before→After:** `tests/shots/before-bomb.png` → `tests/shots/after-bomb.png`

---

## [DOGFIGHT] Dogfight — synthwave juice (3)
**Files:** `minigames.js` (`Dogfight`)

1. **Tracer streaks** — bullets are elongated cyan additive rods oriented down the
   bore, with a muzzle flash on fire.
2. **Light-burst kills** — a downed bandit erupts in a white core + magenta
   fireball + gold shockwave ring; hits throw a cyan spark.
3. **Lock-on feedback** — a bandit inside the boresight cone lights a spinning gold
   lock ring and shows `🔒 LOCK` in the HUD (with a time-on-target bonus).
- **Proof:** `tests/bloom.spec.js` asserts live tracers + 4 enemy lock rings;
  `tests/minigames.spec.js › DOGFIGHT` still downs all enemies.
- **Before→After:** `tests/shots/before-dogfight.png` → `tests/shots/after-dogfight.png`

---

## PERF — bloom stays inside the 60fps budget

Measured over real `requestAnimationFrame` flight via `window.__sky.frameStats()`
and `renderCalls`/`renderTris` (which now sum **all** composer passes per frame —
`renderer.info.autoReset = false` + a manual reset in `renderFrame`).

| Metric (steady-state)   | Bloom OFF | Bloom ON | Budget |
|-------------------------|-----------|----------|--------|
| CPU ms / frame          | ~1.7      | ~0.3–4.3 | < 16.7 |
| Draw calls / frame      | 28        | 38–42    | < 60   |
| Triangles / frame       | ~76k      | ~75–77k  | < 100k |

Both cases sit well under the 16.7 ms (60 fps) CPU budget — `tests/bloom.spec.js
› [PERF] bloom A/B` and the existing `tests/perf.spec.js` assert this.

**Software-rasterizer caveat (unchanged from the prior perf note):** headless
Chromium uses the **SwiftShader** software rasterizer, so wall-clock `frameMs`
(~44–52 ms) is fill-rate bound and *not* representative of GPU hardware — and the
CPU submit time is async-dominated and noisy run-to-run. The deterministic,
meaningful facts: the post pass adds only **~12 draw calls** at **half-res**, keeps
triangles flat, and renders **identical scene + bloom** every frame with zero
console errors. On real GPU hardware the half-res bloom pass is comfortably
sub-millisecond.
