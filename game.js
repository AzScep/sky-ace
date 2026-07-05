// =====================================================
// Sky Ace — main game entry
// =====================================================

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildWorld, createMissionMarker, terrainHeight, WORLD_SIZE, REALISTIC_HAZE } from './world.js?v=11';
import { createPlane, PlaneController, Input } from './plane.js?v=11';
import { RingRun, CanyonDash, PrecisionDrop, Dogfight, FluxRun } from './minigames.js?v=11';
import { addScore, getScores, getOverall, clearAll, MODES, formatDate, gradeFor } from './leaderboard.js?v=11';
import { audio } from './audio.js?v=11';
import { FX } from './fx.js?v=11';
import * as progression from './progression.js?v=11';
import { Traffic } from './traffic.js?v=11';

// --- Plane 3D model (Higgsfield-generated GLB) — swaps in over the primitive once loaded ---
const PLANE_MODEL_URL  = 'assets/models/skyace.glb';
const PLANE_MODEL_SIZE = 13;                    // normalize the model's largest horizontal extent to this (world units)
const PLANE_MODEL_ROT  = { x: 0, y: Math.PI / 2, z: 0 };  // GLB nose sits on -X; +90° about Y faces it +Z (travel dir). Verified live.
const _gltfLoader = new GLTFLoader();
function loadPlaneModel(planeGroup) {
  _gltfLoader.load(PLANE_MODEL_URL, (gltf) => {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const extent = Math.max(size.x, size.z) || 1;
    model.position.sub(center);                 // recenter the mesh on the group origin
    const pivot = new THREE.Group();
    pivot.add(model);
    pivot.scale.setScalar(PLANE_MODEL_SIZE / extent);
    pivot.rotation.set(PLANE_MODEL_ROT.x, PLANE_MODEL_ROT.y, PLANE_MODEL_ROT.z);
    // Swap the primitive visual for the model but keep the physics Group intact.
    // Dispose the primitive geometry/materials first — they were already uploaded to the GPU.
    for (let i = planeGroup.children.length - 1; i >= 0; i--) {
      const child = planeGroup.children[i];
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
      planeGroup.remove(child);
    }
    planeGroup.add(pivot);
    applyEquipped();   // re-tint: the async GLB swap replaced the primitive we'd skinned
  }, undefined, () => { /* load failed — keep the primitive fallback, no throw */ });
}

// ----- State -----
const State = {
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  MINIGAME: 'minigame',
  RESULT: 'result',
};

let state = State.MENU;
let scene, camera, renderer;
let composer, bloomPass, sunRef;
let useBloom = true;          // render through the bloom composer (toggle for perf A/B)
let plane, controller, input;
let world;
let missions = [];
let activeMission = null;     // mission marker the player is currently inside
let activeMinigame = null;
let totalScore = 0;
let cameraMode = 0;           // 0 = chase, 1 = cockpit, 2 = cinematic
let lastTime = performance.now();
let minimapCtx;
let fx;                       // particle FX system
let traffic = null;           // ambient air traffic (traffic.js)
let prevBoost = false;        // for boost-whoosh edge detection
let shake = 0;                // current camera-shake magnitude
let reducedMotion = false;       // mirrors settings.reducedMotion for hot paths
let onboardingActive = false;    // first-run overlay is up
// ---- mastery loop state ----
let _trail = null;               // wingtip Trail (fx.js)
let _hitStop = 0;                // seconds of hit-stop remaining (loop-only, not tick)
let _vignetteEl = null;          // #boost-vignette DOM element (lazy-grabbed)
let _lastMinigameMode = null;    // for Retry button
let _lastResult = null;          // { reason, win, completed } of the last minigame — read by tests
// ---- crash / terrain-collision state ----
const CRASH_MARGIN = 6;          // crash when the plane dips within this of terrain height
const CRASH_FREEZE = 0.9;        // death-cam hold: seconds the wreck burns before we respawn
let _crashCount = 0;             // free-flight crashes (respawns) — read by tests via __sky.crashCount
let _crashCooldown = 0;          // seconds; blocks re-triggering crash while respawning/recovering
let _crashFreeze = 0;            // seconds left in the explosive death-cam (plane frozen + hidden)
let _crashBurst = 0;            // secondary-explosion timer during the freeze
const _crashPos = new THREE.Vector3();    // frozen crash location — reused, no per-frame alloc
const _crashJitter = new THREE.Vector3(); // scratch for scattered secondary bursts
// ---- buzz verb (scream past ambient traffic for score + XP) ----
const BUZZ_RADIUS = 60;          // how close to a craft counts as a buzz
const BUZZ_MIN_SPEED = 140;      // must be going this fast — a buzz is a high-speed pass
const BUZZ_COOLDOWN = 8;         // seconds per craft — can't farm the same plane
let _buzzCount = 0;              // read by tests via __sky.buzzCount
let _simClock = 0;              // dt-accumulated sim time (deterministic; drives buzz cooldowns)
// ---- camera FOV smoothing (module-level, no per-frame alloc) ----
let _fovCurrent = 70;
let _fovTarget  = 70;
// ---- onboarding coach state ----
let _onboardStep = 0;  // 0=throttle, 1=bank, 2=marker, -1=done

// ----- Persisted user settings (localStorage: sky_settings) -----
const DEFAULT_SETTINGS = {
  invertPitch: false,
  sensitivity: 1.0,
  levelAssist: 0.25,
  reducedMotion: false,
  colorblind: false,
  volume: 0.7,
  look: 'realistic',
};
let settings = { ...DEFAULT_SETTINGS };

// True while the player is actively in flight (not in a menu/result screen).
function isFlying() {
  return state === State.PLAYING || state === State.MINIGAME;
}
// True while the player actually has control: flying AND not mid crash death-cam.
// During the freeze the wreck is hidden/frozen at the impact point, so flight keys
// (reset/camera/fire) and mission auto-entry must not fire against it.
function controlsLive() {
  return isFlying() && _crashFreeze <= 0;
}

// =====================================================
// Setup
// =====================================================
function setupScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.5, 8000);

  const canvas = document.getElementById('game-canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(REALISTIC_HAZE);
  // Reinhard tone mapping keeps additive FX + bloom from clipping to flat white.
  renderer.toneMapping = THREE.ReinhardToneMapping;
  renderer.toneMappingExposure = 1.15;

  world = buildWorld(scene);
  fx = new FX(scene);
  sunRef = world.sun;

  setupBloom();

  plane = createPlane();
  scene.add(plane);
  loadPlaneModel(plane);   // async: swaps the Higgsfield GLB in over the primitive when ready
  applyEquipped();         // skin the primitive now; loadPlaneModel re-applies once the GLB is in
  controller = new PlaneController(plane);
  controller.reset(new THREE.Vector3(0, 350, 0));

  input = new Input();
  // Gate flight controls so menu/result screens don't react to flight keys.
  input.onPause = togglePause;  // Esc is valid in PLAYING/MINIGAME/PAUSED (togglePause guards itself)
  input.onCamera = () => { if (controlsLive()) cycleCamera(); };
  input.onReset  = () => { if (controlsLive()) resetFlight(); };
  input.onFire   = () => { if (controlsLive()) handleFire(); };

  setupMissions();

  traffic = new Traffic(scene);   // ambient air traffic — the sky is alive

  minimapCtx = document.getElementById('minimap-canvas').getContext('2d');

  window.addEventListener('resize', onResize);
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  if (composer) composer.setSize(w, h);
}

// =====================================================
// TRUE BLOOM — EffectComposer + RenderPass + UnrealBloomPass
// Neon emissive elements glow as pure light; the bloom target runs at
// half resolution (mitigation) so the extra post pass stays in frame budget.
// =====================================================
function setupBloom() {
  const w = window.innerWidth, h = window.innerHeight;
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // Half-res bloom target: ~4x fewer pixels through the blur mip chain.
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(Math.max(1, w >> 1), Math.max(1, h >> 1)),
    0.6,    // strength — tuned for realistic base: glow the FX/sun, not the whole scene
    0.5,    // radius
    0.8     // threshold — only the brightest highlights bloom; midtones stay crisp
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());   // tone-map + sRGB after bloom
  composer.setSize(w, h);

  // The composer runs several internal render() passes per frame; with autoReset
  // on, renderer.info would only reflect the final pass. Reset manually each
  // presented frame so renderCalls/renderTris sum the WHOLE frame (scene + bloom).
  renderer.info.autoReset = false;
}

// One presentation frame: billboard the sun, then render through the bloom
// composer (or straight to screen when bloom is toggled off for A/B perf).
function renderFrame() {
  renderer.info.reset();
  if (sunRef) sunRef.lookAt(camera.position);
  if (useBloom && composer) composer.render();
  else renderer.render(scene, camera);
}

function setupMissions() {
  // Place 4 mission markers around the world
  const places = [
    { mode: 'ring',     pos: new THREE.Vector3( 1200, 0,  1800), color: 0x00d4ff, name: 'RING RUN',       desc: '12 floating rings to clear in sequence' },
    { mode: 'canyon',   pos: new THREE.Vector3(-2000, 0,  1400), color: 0xff9500, name: 'CANYON DASH',    desc: 'Low-altitude run between pylon gates' },
    { mode: 'bomb',     pos: new THREE.Vector3( 2200, 0, -1800), color: 0xff3860, name: 'PRECISION DROP', desc: 'Bomb a target with three drops' },
    { mode: 'dogfight', pos: new THREE.Vector3(-1800, 0, -2200), color: 0xaa55ff, name: 'DOGFIGHT',       desc: 'Shoot down four enemy aces' },
    { mode: 'flux',     pos: new THREE.Vector3(  900, 0, -1200), color: 0x00ffd5, name: 'FLUX RUN',       desc: 'Charge nodes, bank at the Collector' },
  ];
  for (const p of places) {
    const ground = terrainHeight(p.pos.x, p.pos.z);
    p.pos.y = Math.max(ground, 0);
    const marker = createMissionMarker(p.color);
    marker.position.copy(p.pos);
    scene.add(marker);
    missions.push({ ...p, marker });
  }
}

// =====================================================
// Camera
// =====================================================
// Reusable scratch objects (avoid per-frame allocations in the camera loop).
const _camTarget = new THREE.Vector3();
const _camLookAt = new THREE.Vector3();
const _camOffset = new THREE.Vector3();
const _camFwd    = new THREE.Vector3();
const _camRight  = new THREE.Vector3();
const _camUp     = new THREE.Vector3();   // up vector handed to lookAt (banks the view)
const _planeUp   = new THREE.Vector3();   // plane's local up in world space
// Reusable scratch for exhaust (avoid per-frame alloc in simulate hot path).
const _exhFwd  = new THREE.Vector3();
const _exhPos  = new THREE.Vector3();
const _exhBack = new THREE.Vector3();
const _buzzMid = new THREE.Vector3();   // buzz-FX midpoint (avoid per-frame alloc)
const _skinColor = new THREE.Color();   // scratch for the equipped-skin emissive tint
let _equippedTrailColor = null;         // hex or null ('off') — tints the exhaust plume

function updateCamera(dt) {
  const planePos  = plane.position;
  const planeQuat = plane.quaternion;
  const speed     = controller.speed || 0;

  // --- FOV kick from speed (70 → 84 at boost) ---
  const boostSpeed = controller.boostSpeed || 320;
  const maxSpeed   = controller.maxSpeed   || 240;
  const fovT = THREE.MathUtils.clamp((speed - maxSpeed * 0.6) / ((boostSpeed - maxSpeed * 0.6) || 1), 0, 1);
  _fovTarget = 70 + fovT * 14;
  if (Math.abs(_fovCurrent - _fovTarget) > 0.01) {
    _fovCurrent += (_fovTarget - _fovCurrent) * (1 - Math.exp(-8 * dt));
    camera.fov = _fovCurrent;
    camera.updateProjectionMatrix();
  }

  // --- Camera position target + up vector ---
  // The up vector handed to lookAt banks the view with the airframe. It blends
  // world-up toward the plane's up: any non-zero plane-up share keeps "up" from
  // ever lining up with the view direction, so steep climbs/loops never make
  // lookAt degenerate and flip. (The old `camera.rotation.z` Euler write did the
  // same job but gimbal-locked when pitched — that was the "camera off place".)
  _planeUp.set(0, 1, 0).applyQuaternion(planeQuat);
  _camUp.set(0, 1, 0);
  if (cameraMode === 0) {
    // Chase — dolly pulls back slightly on boost for wider sense of speed
    const dollZ = controller.boosting ? -28 : -22;
    const dollY = controller.boosting ?   5 :   6;
    _camOffset.set(0, dollY, dollZ).applyQuaternion(planeQuat);
    _camTarget.copy(planePos).add(_camOffset);
    _camFwd.set(0, 0, 1).applyQuaternion(planeQuat).multiplyScalar(20);
    _camLookAt.copy(planePos).add(_camFwd);
    // Lean into banks/loops — gentle under reduced-motion, fuller otherwise.
    _camUp.lerp(_planeUp, reducedMotion ? 0.18 : 0.45).normalize();
  } else if (cameraMode === 1) {
    // Cockpit — fully banks with the airframe (you're strapped into it)
    _camOffset.set(0, 0.6, 2.2).applyQuaternion(planeQuat);
    _camTarget.copy(planePos).add(_camOffset);
    _camFwd.set(0, 0, 1).applyQuaternion(planeQuat).multiplyScalar(50);
    _camLookAt.copy(_camTarget).add(_camFwd);
    _camUp.copy(_planeUp);
  } else {
    // Cinematic side — keep a level world horizon
    _camOffset.set(35, 8, -8).applyQuaternion(planeQuat);
    _camTarget.copy(planePos).add(_camOffset);
    _camLookAt.copy(planePos);
  }
  camera.up.copy(_camUp);

  // Smooth camera follow — framerate-independent exponential smoothing.
  // Cockpit snaps; chase/cinematic ease.
  const smooth = cameraMode === 1 ? 1 : 1 - Math.exp(-9 * dt);
  camera.position.lerp(_camTarget, smooth);
  camera.lookAt(_camLookAt);

  // --- G-load camera lag (chase only, skip reduced-motion) ---
  // Nudge the camera against the angular rates to convey weight. Position-only,
  // so the framed target drifts slightly behind during hard maneuvers.
  if (!reducedMotion && cameraMode === 0) {
    _camRight.set(1, 0, 0).applyQuaternion(planeQuat);  // plane right
    camera.position.addScaledVector(_camRight, controller.rollRate  *  0.12);
    camera.position.addScaledVector(_planeUp,  controller.pitchRate * -0.08);
  }

  // Impact shake (skipped under reduced-motion)
  if (shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    camera.position.z += (Math.random() - 0.5) * shake;
    shake *= Math.pow(0.0016, dt);   // fast decay (~halves every ~70ms)
  } else {
    shake = 0;
  }
}

function addShake(amount) { if (!reducedMotion) shake = Math.min(3.0, shake + amount); }

let flashEl;
function flashScreen(strength = 0.3, color = '#ffffff') {
  if (reducedMotion) return;
  if (!flashEl) flashEl = document.getElementById('screen-flash');
  if (!flashEl) return;
  flashEl.style.transition = 'none';
  flashEl.style.background = color;
  flashEl.style.opacity = String(strength);
  void flashEl.offsetWidth;            // reflow so the fade restarts
  flashEl.style.transition = 'opacity 0.4s ease-out';
  flashEl.style.opacity = '0';
}

function cycleCamera() {
  cameraMode = (cameraMode + 1) % 3;
  showToast(['CHASE CAMERA', 'COCKPIT VIEW', 'CINEMATIC'][cameraMode]);
}

function resetFlight() {
  controller.reset(new THREE.Vector3(0, 400, 0));
  showToast('FLIGHT RESET');
}

// Terrain collision. In a minigame it ends the run as CRASHED; in free flight it
// respawns you clear of the ground.
function crash() {
  if (activeMinigame) {
    // Real teeth for Canyon Dash + low passes: fly into terrain and you fail the run.
    // No cooldown needed — endMinigame fires THIS same tick and leaves the MINIGAME state,
    // so the crash check can't re-fire (arming it here would leak into the next free session).
    fx.explosion(plane.position.clone(), 1.8);
    audio.play('explosion');
    addShake(1.8);
    flashScreen(0.35, '#ff6a4d');
    audio.playVoice('failed');
    activeMinigame.finish('CRASHED');
    return;
  }
  // Free flight — no score to lose, so make it a spectacle: a big fireball, a boom, a
  // white-hot flash + max shake, then a brief death-cam hold on the wreck before we
  // respawn clear of the ground (respawnCrash() ends the hold). The plane is hidden and
  // frozen at the impact point during the hold so the camera actually sees the explosion.
  if (_crashFreeze > 0) return;      // already dying — don't restack
  _crashCount++;
  _crashPos.copy(plane.position);
  fx.explosion(_crashPos, 2.8);
  audio.play('explosion');
  audio.playVoice('failed');
  addShake(3.0);
  flashScreen(0.55, '#ffe6c0');
  plane.visible = false;             // the jet is gone — it blew apart
  controller.velocity.set(0, 0, 0);
  controller.speed = 0;
  _crashFreeze = CRASH_FREEZE;
  _crashBurst = 0;
  showToast('CRASHED — RECOVERING');
}

// End the death-cam: lift the plane clear of the ground, level, at cruise, and re-show it.
function respawnCrash() {
  const ground = terrainHeight(plane.position.x, plane.position.z);
  plane.position.y = ground + 250;
  plane.quaternion.identity();
  plane.visible = true;
  controller.velocity.set(0, 0, 0);
  controller.speed = 120;            // re-derived into velocity next controller.update
  _crashCooldown = 1.2;              // brief grace so we don't instantly re-crash
}

// =====================================================
// Mission detection & minigame lifecycle
// =====================================================
function checkMissions() {
  if (activeMinigame) {
    hidePrompt();
    return;
  }
  let nearest = null;
  let nearestDist = Infinity;
  for (const m of missions) {
    const d = plane.position.distanceTo(m.pos);
    if (d < 250 && d < nearestDist) {
      nearest = m;
      nearestDist = d;
    }
  }
  if (nearest && nearestDist < 100) {
    // Enter minigame
    startMinigame(nearest);
    hidePrompt();
    return;
  }
  if (nearest) {
    showPrompt(nearest);
  } else {
    hidePrompt();
  }
}

function startMinigame(mission) {
  const Klass = { ring: RingRun, canyon: CanyonDash, bomb: PrecisionDrop, dogfight: Dogfight, flux: FluxRun }[mission.mode];
  if (!Klass) return;
  activeMinigame = new Klass(scene, plane, mission.pos);
  activeMinigame._mission = mission;
  state = State.MINIGAME;
  const hud = document.getElementById('minigame-hud');
  hud.classList.remove('hidden');
  document.getElementById('mg-title').textContent = mission.name;
  document.getElementById('mg-objective').textContent = activeMinigame.objective;
  showToast(`▶ ${mission.name}`);
  // Choose music per mode; updateAudio handles ongoing crossfade/intensity
  const musicTrack = (mission.mode === 'dogfight' || mission.mode === 'flux') ? 'music_dogfight' : 'music_action';
  audio.playMusic(musicTrack);
  if (mission.mode === 'dogfight' || mission.mode === 'bomb') audio.playVoice('combat');
}

function endMinigame() {
  if (!activeMinigame) return;
  const mode = activeMinigame.mode;
  const score = activeMinigame.score;
  const reason = activeMinigame.finishReason || 'COMPLETE';
  // Single source of truth: a run counts as completed only if it neither timed out nor
  // crashed. `win` (showResult) and the mission-cleared marking both derive from this, so
  // the landmine-#1 "CRASHED reads as a win" bug can't recur in one place but not another.
  const completed = reason !== 'TIME UP' && reason !== 'CRASHED';
  const mgSummary = activeMinigame.getSummary();

  const result = addScore(mode, score);
  totalScore += score;
  _lastMinigameMode = mode;

  // Mark the mission cleared + give its marker the "done" look ONLY on a genuine completion.
  // A crash or timeout must NOT retire the mission (waypoint keeps guiding you back to retry).
  const mission = activeMinigame._mission;
  if (mission && completed) {
    mission.cleared = true;
    const mk = mission.marker;
    if (mk.userData.beam) {
      mk.userData.beam.material.color.setHex(0x2effa8);  // dim teal "done" glow
      mk.userData.beam.material.opacity = 0.15;
    }
    if (mk.userData.ring) mk.userData.ring.material.color.setHex(0x2effa8);
    if (mk.userData.halo) mk.userData.halo.material.color.setHex(0x2effa8);
  }

  // Build progression summary and record the run.
  const summary = {
    mode,
    score,
    grade: result.grade,
    completed,
    finishReason: reason,
    ...mgSummary,
  };
  const prog = progression.addRun(summary);

  activeMinigame.cleanup();
  activeMinigame = null;
  document.getElementById('minigame-hud').classList.add('hidden');

  state = State.RESULT;
  showResult(mode, score, reason, result, prog, completed);
}

function handleFire() {
  if (!activeMinigame) return;
  if (activeMinigame.mode === 'bomb') {
    activeMinigame.dropBomb(plane.position.clone(), controller.velocity.clone());
  } else if (activeMinigame.mode === 'dogfight') {
    activeMinigame.fireBullet(plane.position.clone(), plane.quaternion.clone());
    audio.play('cannon', { rate: 0.95 + Math.random() * 0.1 });
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(plane.quaternion);
    fx.muzzle(plane.position.clone().addScaledVector(fwd, 6), fwd);
    addShake(0.13);
  }
}

// =====================================================
// UI
// =====================================================
function showPrompt(mission) {
  const el = document.getElementById('mission-prompt');
  document.getElementById('mp-name').textContent = mission.name;
  document.getElementById('mp-desc').textContent = mission.desc;
  el.classList.remove('hidden');
}
function hidePrompt() {
  document.getElementById('mission-prompt').classList.add('hidden');
}

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  // Re-trigger the pop animation (skipped under reduced-motion).
  if (!reducedMotion) {
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 1800);
}

// Helper: total XP required to reach a given level (cumulative from level 1).
// Cost(L-1→L) = 300 + 150*(L-1).  Closed form: 300*(N-1) + 150*(N-1)*N/2.
function _xpForLevel(level) {
  if (level <= 1) return 0;
  const n = level - 1;
  return 300 * n + 75 * n * (n + 1);  // 75 = 150/2
}

function showResult(mode, score, reason, result, prog, completed = reason !== 'TIME UP' && reason !== 'CRASHED') {
  audio.stopAllMusic(0.5);
  const win = completed && result.grade !== 'D';   // a crashed/timed-out run is never a win
  _lastResult = { reason, win, completed };         // exposed via __sky.lastResult for regression tests
  if (win) { audio.play('fanfare'); flashScreen(0.28, '#00ff88'); }
  if (prog && prog.leveledUp) { audio.play('fanfare'); flashScreen(0.22, '#b14bff'); }
  audio.playVoice(win ? 'complete' : 'failed');
  const el = document.getElementById('result-screen');
  document.getElementById('rank-display').textContent = result.grade;
  document.getElementById('rank-display').className = `rank-display grade-${result.grade}`;
  document.getElementById('result-title').textContent = `${MODES[mode].name.toUpperCase()} • ${reason}`;
  const stats = document.getElementById('result-stats');

  // XP / level row
  let xpHtml = '';
  if (prog) {
    const lvCost = 300 + 150 * prog.level;  // cost for current level → next
    const xpIntoLevel = Math.max(0, prog.xp - _xpForLevel(prog.level));
    const pct = Math.min(100, Math.round(xpIntoLevel / lvCost * 100));
    xpHtml = `
      <div class="stat-label">XP GAINED</div><div class="stat-value">+${prog.gained}</div>
      <div class="xp-bar-row">
        <span class="xp-level">LV ${prog.level} • ${prog.rankTitle}</span>
        <div class="xp-bar"><div class="xp-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
    if (prog.isPB)      xpHtml += `<div class="pb-banner">★ NEW PERSONAL BEST</div>`;
    if (prog.leveledUp) xpHtml += `<div class="levelup-banner">▲ LEVEL UP → LV ${prog.level} • ${prog.rankTitle}</div>`;
  }

  stats.innerHTML = `
    <div class="stat-label">SCORE</div><div class="stat-value">${Math.round(score).toLocaleString()}</div>
    <div class="stat-label">GRADE</div><div class="stat-value">${result.grade}</div>
    <div class="stat-label">PERSONAL RANK</div><div class="stat-value">#${result.rank}</div>
    <div class="stat-label">TOTAL SCORE</div><div class="stat-value">${Math.round(totalScore).toLocaleString()}</div>
    ${xpHtml}
  `;

  // Medal toasts — one per medal, staggered so they don't stomp each other.
  if (prog && prog.earnedMedals.length > 0) {
    let delay = 800;
    for (const m of prog.earnedMedals) {
      setTimeout(() => showToast(`\u{1F3C5} ${m.name.toUpperCase()} +${m.xp} XP`), delay);
      delay += 2200;
    }
  }

  // Refresh start-screen LV chip
  _updateLvChip();

  el.classList.add('active');
}

function updateHUD() {
  document.getElementById('hud-speed').textContent = controller.getSpeedKts();
  document.getElementById('hud-alt').textContent = controller.getAltitudeFt().toLocaleString();
  document.getElementById('hud-hdg').textContent = controller.getHeadingDeg().toFixed(0).padStart(3, '0');
  document.getElementById('hud-throttle').style.width = `${Math.round(controller.throttle * 100)}%`;
  const liveScore = totalScore + (activeMinigame ? activeMinigame.score : 0);
  const scoreEl = document.getElementById('hud-score');
  const newText = Math.round(liveScore).toLocaleString();
  if (scoreEl.textContent !== newText) {
    scoreEl.textContent = newText;
    if (!reducedMotion) {
      scoreEl.style.animation = 'none';
      void scoreEl.offsetWidth;
      scoreEl.style.animation = 'scoreFlash 0.6s ease-out';
    }
  }

  if (activeMinigame) {
    document.getElementById('mg-stats').textContent = activeMinigame.getStats();
    if (activeMinigame._toast) {
      showToast(activeMinigame._toast);
      activeMinigame._toast = null;
    }
    // Combo / streak chip near score
    const combo  = activeMinigame.combo  || 0;
    const streak = activeMinigame.streak || 0;
    const multi  = Math.max(combo, streak);
    const comboEl = document.getElementById('hud-combo');
    if (comboEl) {
      if (multi > 1) {
        comboEl.textContent = `x${multi} ${combo > streak ? 'COMBO' : 'STREAK'}`;
        comboEl.classList.remove('hidden');
      } else {
        comboEl.classList.add('hidden');
      }
    }
    // BEST ghost (from progression profile)
    const bestEl = document.getElementById('hud-best');
    if (bestEl) {
      const prof = progression.getProfile();
      const best = prof.best[activeMinigame.mode];
      if (best) {
        bestEl.textContent = `BEST ${Math.round(best).toLocaleString()}`;
        bestEl.classList.remove('hidden');
      } else {
        bestEl.classList.add('hidden');
      }
    }
  } else {
    // Hide combo/best when not in a minigame
    const c = document.getElementById('hud-combo');
    const b = document.getElementById('hud-best');
    if (c) c.classList.add('hidden');
    if (b) b.classList.add('hidden');
  }
}

function drawMinimap() {
  const ctx = minimapCtx;
  if (!ctx) return;
  const W = 200, H = 200;
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = 'rgba(8, 22, 45, 0.7)';
  ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = 'rgba(0, 255, 136, 0.2)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(i * W / 5, 0); ctx.lineTo(i * W / 5, H);
    ctx.moveTo(0, i * H / 5); ctx.lineTo(W, i * H / 5);
    ctx.stroke();
  }
  // Radar sweep
  const t = performance.now() / 1000;
  const sweepAngle = (t * 1.5) % (Math.PI * 2);
  const grad = (!reducedMotion && ctx.createConicGradient) ? ctx.createConicGradient(sweepAngle, W/2, H/2) : null;
  if (grad) {
    grad.addColorStop(0, 'rgba(0, 255, 136, 0.4)');
    grad.addColorStop(0.1, 'rgba(0, 255, 136, 0)');
    grad.addColorStop(1, 'rgba(0, 255, 136, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // Compute scale: show ~3000 units around player
  const range = 3000;
  const scale = (W / 2) / range;
  const px = plane.position.x;
  const pz = plane.position.z;

  // Plane heading - rotate map so up=forward
  const forward = _camFwd.set(0, 0, 1).applyQuaternion(plane.quaternion);
  const heading = Math.atan2(forward.x, forward.z);

  function worldToMap(wx, wz) {
    const dx = wx - px;
    const dz = wz - pz;
    // Rotate by -heading
    const cos = Math.cos(-heading);
    const sin = Math.sin(-heading);
    const rx = dx * cos - dz * sin;
    const rz = dx * sin + dz * cos;
    return { x: W/2 + rx * scale, y: H/2 - rz * scale };
  }

  // Mission markers
  for (const m of missions) {
    const p = worldToMap(m.pos.x, m.pos.z);
    if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) {
      // Edge arrow
      const dx = p.x - W/2, dy = p.y - H/2;
      const ang = Math.atan2(dy, dx);
      const ex = W/2 + Math.cos(ang) * 90;
      const ey = H/2 + Math.sin(ang) * 90;
      ctx.fillStyle = '#' + m.color.toString(16).padStart(6, '0');
      ctx.beginPath();
      ctx.arc(ex, ey, 4, 0, Math.PI*2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#' + m.color.toString(16).padStart(6, '0');
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Ambient traffic — small gold blips (no edge arrows; they're just flavor)
  if (traffic) {
    ctx.fillStyle = '#ffcf4d';   // NEON.gold
    for (const c of traffic.craft) {
      const p = worldToMap(c.position.x, c.position.z);
      if (p.x < 3 || p.x > W - 3 || p.y < 3 || p.y > H - 3) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Player at center
  ctx.fillStyle = '#00ff88';
  ctx.save();
  ctx.translate(W/2, H/2);
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(6, 6);
  ctx.lineTo(-6, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// =====================================================
// Audio — engine drone reacts to speed/throttle; drains minigame SFX
// =====================================================
function updateAudio(dt) {
  if (!audio.ready) return;
  if (state === State.PLAYING || state === State.MINIGAME) {
    audio.resume();
    if (!audio.isLoopActive('engine')) audio.startLoop('engine');
    const t = THREE.MathUtils.clamp((controller.speed - 30) / (320 - 30), 0, 1);
    // Subtler pitch bend + lower gain so the short engine loop doesn't read as a
    // repeated "whoosh" pulse. ponytail: blind tune — can't audition audio here; re-judged live.
    const rate = 0.92 + t * 0.5;
    const gain = 0.12 + controller.throttle * 0.13 + (controller.boosting ? 0.14 : 0);
    audio.setLoopParams('engine', gain, rate, 0.12);

    if (controller.boosting && !prevBoost) audio.play('boost');
    prevBoost = controller.boosting;

    // Drain minigame SFX — entries are EITHER a string OR {name,rate,gain} object.
    if (activeMinigame && activeMinigame._sfxQueue && activeMinigame._sfxQueue.length) {
      for (const s of activeMinigame._sfxQueue) {
        if (typeof s === 'string') audio.play(s);
        else audio.play(s.name, { rate: s.rate, gain: s.gain });
      }
      activeMinigame._sfxQueue.length = 0;
    }

    // Adaptive music: select track + modulate intensity from combo/streak/urgency.
    if (state === State.MINIGAME && activeMinigame) {
      const m        = activeMinigame.mode;
      const combo    = activeMinigame.combo  || 0;
      const streak   = activeMinigame.streak || 0;
      const timeLeft = activeMinigame.timeLeft || 0;
      let intensity  = (m === 'dogfight' || m === 'bomb') ? 0.5 : (m === 'flux' ? 0.35 : 0.2);
      intensity += Math.min(0.3, Math.max(combo, streak) * 0.06);
      if (timeLeft < 10) intensity = Math.min(1, intensity + 0.3);
      const urgency   = timeLeft < 10;
      const trackName = (m === 'dogfight' || m === 'flux') ? 'music_dogfight' : 'music_action';
      audio.setLoopParams(trackName, 0.40 + intensity * 0.18, urgency ? 1.03 : 1.0, 0.4);
    } else if (state === State.PLAYING) {
      // Free flight — calm music
      audio.setLoopParams('music_action', 0.34, 1.0, 0.8);
    }
  }
}

// =====================================================
// Settings (persisted) + accessibility
// =====================================================
function loadSettings() {
  try {
    const raw = localStorage.getItem('sky_settings');
    if (raw) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore corrupt/blocked storage */ }
  applySettings();
  syncSettingsUI();
}
function saveSettings() {
  try { localStorage.setItem('sky_settings', JSON.stringify(settings)); } catch { /* ignore */ }
}
// Push settings into the live game (controller feel, body classes for CSS).
function applySettings() {
  reducedMotion = settings.reducedMotion;
  document.body.classList.toggle('reduced-motion', settings.reducedMotion);
  document.body.classList.toggle('cb-safe', settings.colorblind);
  audio.setVolume(settings.volume);
  if (controller) {
    controller.invertPitch = settings.invertPitch;
    controller.sensitivity = settings.sensitivity;
    controller.levelAssist = settings.levelAssist;
  }
  if (world) applyLook(settings.look);
}
// world.js owns terrain/sky/fog; the clear color + bloom strength live in game.js
// (renderer + bloomPass), so this stitches world's descriptor back onto both.
function applyLook(mode) {
  const d = world.setLook(mode);
  renderer.setClearColor(d.clearColor);
  if (bloomPass) bloomPass.strength = d.bloomStrength;
}
// Reflect current settings onto the menu controls.
function syncSettingsUI() {
  const inv = document.getElementById('set-invert');
  if (!inv) return;
  inv.checked = settings.invertPitch;
  document.getElementById('set-sens').value = settings.sensitivity;
  document.getElementById('set-sens-val').textContent = `${settings.sensitivity.toFixed(1)}×`;
  document.getElementById('set-assist').value = settings.levelAssist;
  document.getElementById('set-assist-val').textContent = settings.levelAssist.toFixed(2);
  document.getElementById('set-reduced').checked = settings.reducedMotion;
  document.getElementById('set-colorblind').checked = settings.colorblind;
  const look = document.getElementById('set-look');
  if (look) look.checked = settings.look === 'synthwave';
  const volPct = Math.round(settings.volume * 100);
  document.getElementById('set-volume').value = volPct;
  document.getElementById('set-volume-val').textContent = `${volPct}%`;
}
function commitSettings() { applySettings(); syncSettingsUI(); saveSettings(); }

function wireSettings() {
  const inv = document.getElementById('set-invert');
  const sens = document.getElementById('set-sens');
  const assist = document.getElementById('set-assist');
  const red = document.getElementById('set-reduced');
  const cb = document.getElementById('set-colorblind');
  const vol = document.getElementById('set-volume');
  const look = document.getElementById('set-look');
  inv.addEventListener('change', () => { settings.invertPitch = inv.checked; commitSettings(); });
  sens.addEventListener('input', () => { settings.sensitivity = parseFloat(sens.value); commitSettings(); });
  assist.addEventListener('input', () => { settings.levelAssist = parseFloat(assist.value); commitSettings(); });
  red.addEventListener('change', () => { settings.reducedMotion = red.checked; commitSettings(); });
  cb.addEventListener('change', () => { settings.colorblind = cb.checked; commitSettings(); });
  vol.addEventListener('input', () => { settings.volume = parseInt(vol.value, 10) / 100; commitSettings(); });
  look.addEventListener('change', () => { settings.look = look.checked ? 'synthwave' : 'realistic'; commitSettings(); });
  const openSettings = () => setActiveScreen('settings-screen');
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-pause-settings').addEventListener('click', openSettings);
}

// =====================================================
// First-run onboarding + dismissible tip
// =====================================================
// Onboarding coach steps — text shown at top of modal
const _ONBOARD_STEPS = [
  'STEP 1/3 — Hold SHIFT to throttle up and get airborne.',
  'STEP 2/3 — Bank with A/D toward the ▲ waypoint arrow.',
  'STEP 3/3 — Fly through the glowing mission marker. GO!',
];

function _tickOnboardCoach() {
  if (!onboardingActive || _onboardStep < 0) return;
  const stepEl = document.getElementById('onboard-step');
  if (!stepEl) return;
  // Advance step based on player action (sim is already running underneath)
  if (_onboardStep === 0 && controller && controller.throttle > 0.35) {
    _onboardStep = 1;
    stepEl.textContent = _ONBOARD_STEPS[1];
  } else if (_onboardStep === 1 && controller && Math.abs(controller.rollRate) > 0.4) {
    _onboardStep = 2;
    stepEl.textContent = _ONBOARD_STEPS[2];
  } else if (_onboardStep === 2 && state === State.MINIGAME) {
    // Player entered a mission — auto-dismiss
    dismissOnboarding();
  }
}

function maybeShowOnboarding() {
  if (localStorage.getItem('sky_onboarded')) return;
  onboardingActive = true;
  _onboardStep = 0;
  // Inject a step-hint element into the onboard modal if not already present
  const box = document.querySelector('#onboard-screen .onboard-box');
  if (box && !document.getElementById('onboard-step')) {
    const hint = document.createElement('p');
    hint.id = 'onboard-step';
    hint.style.cssText = 'color:#00ffd5;font-size:13px;letter-spacing:2px;margin-bottom:12px;';
    hint.textContent = _ONBOARD_STEPS[0];
    box.insertBefore(hint, box.querySelector('#btn-onboard-dismiss'));
  } else if (document.getElementById('onboard-step')) {
    document.getElementById('onboard-step').textContent = _ONBOARD_STEPS[0];
  }
  document.getElementById('onboard-screen').classList.add('active');
}

function dismissOnboarding() {
  try { localStorage.setItem('sky_onboarded', '1'); } catch { /* ignore */ }
  onboardingActive = false;
  _onboardStep = -1;
  document.getElementById('onboard-screen').classList.remove('active');
  lastTime = performance.now();   // swallow any accumulated dt so no jump
}
function maybeShowTip() {
  const el = document.getElementById('hud-tip');
  if (localStorage.getItem('sky_tip_dismissed')) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
}
function dismissTip() {
  try { localStorage.setItem('sky_tip_dismissed', '1'); } catch { /* ignore */ }
  document.getElementById('hud-tip').classList.add('hidden');
}

// =====================================================
// Waypoint — directional arrow toward the nearest open mission
// =====================================================
const _wpFwd = new THREE.Vector3();
function updateWaypoint() {
  const el = document.getElementById('waypoint');
  if (activeMinigame) { el.classList.add('hidden'); return; }
  let nearest = null, best = Infinity;
  for (const m of missions) {
    if (m.cleared) continue;
    const d = plane.position.distanceTo(m.pos);
    if (d < best) { best = d; nearest = m; }
  }
  if (!nearest) { el.classList.add('hidden'); return; }
  const fwd = _wpFwd.set(0, 0, 1).applyQuaternion(plane.quaternion);
  const heading = Math.atan2(fwd.x, fwd.z);
  const targetAng = Math.atan2(nearest.pos.x - plane.position.x, nearest.pos.z - plane.position.z);
  let rel = targetAng - heading;                 // 0 rad = dead ahead (arrow points up)
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  document.getElementById('wp-arrow').style.transform = `rotate(${rel}rad)`;
  document.getElementById('wp-name').textContent = nearest.name;
  document.getElementById('wp-dist').textContent = `${Math.round(best)} m`;
  el.classList.remove('hidden');
}

// =====================================================
// Game loop
// =====================================================
// Advance the simulation by one fixed step. Extracted so headless tests can
// drive the game deterministically without depending on rAF timing.
function simulate(dt) {
  // Death-cam: while the wreck burns, freeze the plane, hold the camera on the fireball,
  // and roll secondary bursts — no flight, no ground-check (the plane is buried at the
  // impact point → it would re-crash). respawnCrash() lifts us clear when the hold ends.
  if (_crashFreeze > 0) {
    _crashFreeze -= dt;
    _crashBurst -= dt;
    if (_crashBurst <= 0) {
      _crashBurst = 0.11;
      _crashJitter.set((Math.random() - 0.5) * 16, (Math.random() - 0.2) * 12, (Math.random() - 0.5) * 16).add(_crashPos);
      fx.explosion(_crashJitter, 1.4);
    }
    if (_crashFreeze <= 0) respawnCrash();
  } else {
    controller.update(dt, input.read());
    // Advance onboarding coach (sim runs under the overlay)
    if (onboardingActive) _tickOnboardCoach();

    // Terrain collision — the ground can kill you now (soft-floor removed).
    // Cooldown prevents re-triggering every frame while the respawn lifts us clear.
    if (_crashCooldown > 0) _crashCooldown -= dt;
    const ground = terrainHeight(plane.position.x, plane.position.z);
    if (_crashCooldown <= 0 && plane.position.y < ground + CRASH_MARGIN) crash();
    // Soft world bounds
    const lim = WORLD_SIZE * 0.45;
    plane.position.x = Math.max(-lim, Math.min(lim, plane.position.x));
    plane.position.z = Math.max(-lim, Math.min(lim, plane.position.z));
  }

  if (activeMinigame) {
    activeMinigame.update(dt);
    if (activeMinigame.done) endMinigame();
  } else if (_crashFreeze <= 0) {
    // No mission auto-entry mid death-cam: the wreck is buried near the ground and
    // would proximity-trigger a minigame before respawnCrash() lifts us clear.
    checkMissions();
  }

  if (traffic) traffic.update(dt, plane.position);   // ambient flock wanders the sky

  // Buzz verb — scream past an ambient craft at speed for score + XP. Free flight only;
  // per-craft cooldown stops you farming one plane. _buzzMid scratch avoids per-frame alloc.
  _simClock += dt;
  if (traffic && !activeMinigame && controller.speed > BUZZ_MIN_SPEED) {
    // Indexed loop (not for..of) to match the codebase's zero-alloc hot-path convention.
    for (let i = 0; i < traffic.craft.length; i++) {
      const c = traffic.craft[i];
      if (_simClock - c.buzzedAt < BUZZ_COOLDOWN) continue;
      if (plane.position.distanceTo(c.position) >= BUZZ_RADIUS) continue;
      c.buzzedAt = _simClock;
      _buzzCount++;
      totalScore += 150;
      _buzzMid.copy(plane.position).add(c.position).multiplyScalar(0.5);
      fx.ringBurst(_buzzMid, 0xffcf4d);   // NEON.gold
      audio.play('chime');
      const prog = progression.grantXp(25, 'buzz');
      if (prog.leveledUp) { audio.play('fanfare'); flashScreen(0.22, '#b14bff'); }
      showToast('BUZZ! +150');
    }
  }

  // Animate mission marker rings + pulse the halo / beam.
  const pulse = 0.7 + Math.sin(performance.now() / 350) * 0.3;
  for (const m of missions) {
    const ud = m.marker.userData;
    if (ud.ring) ud.ring.rotation.z += dt * 0.8;
    if (ud.halo) { ud.halo.rotation.z -= dt * 0.5; ud.halo.scale.setScalar(pulse); }
    if (ud.beam && !m.cleared) ud.beam.material.opacity = 0.22 + pulse * 0.14;
  }

  updateCamera(dt);
  updateHUD();
  drawMinimap();
  updateWaypoint();
  updateAudio(dt);
  fx.update(dt);

  // Particles + radio voice emitted from inside minigame logic
  if (activeMinigame) {
    for (const e of activeMinigame._fxQueue) {
      const p = new THREE.Vector3(e.pos[0], e.pos[1], e.pos[2]);
      if (e.kind === 'explosion') {
        const size = e.size || 1;
        fx.explosion(p, size);
        const atten = THREE.MathUtils.clamp(1 - p.distanceTo(camera.position) / 700, 0.12, 1);
        addShake(1.3 * size * atten);
        if (size >= 1.4) {
          flashScreen(0.2 * atten, '#ffd9a0');
          // Hit-stop: large explosions (dogfight kills size 1.7) → 130ms; others → 90ms
          triggerHitStop(size >= 1.7 ? 0.13 : 0.09);
        } else {
          triggerHitStop(0.07);
        }
      } else if (e.kind === 'ring') {
        fx.ringBurst(p, e.color || 0x00ff88);
      }
    }
    activeMinigame._fxQueue.length = 0;
    for (const v of activeMinigame._voQueue) audio.playVoice(v);
    activeMinigame._voQueue.length = 0;
  }

  // Exhaust plume — proportional to throttle at all times (boost = full intensity).
  // Uses pre-allocated scratch vectors to avoid per-frame alloc in hot path.
  const exhaustIntensity = controller.boosting ? 1.0 : controller.throttle * 0.4;
  if (exhaustIntensity > 0.05 && _crashFreeze <= 0) {
    _exhFwd.set(0, 0, 1).applyQuaternion(plane.quaternion);
    _exhPos.copy(plane.position).addScaledVector(_exhFwd, -5);
    _exhBack.copy(_exhFwd).multiplyScalar(-26);
    fx.exhaust(_exhPos, _exhBack, exhaustIntensity, _equippedTrailColor);
  }

  // Trail — wingtip ribbon (skipped + hidden under reduced-motion)
  if (_trail) {
    if (reducedMotion) {
      _trail.visible = false;
    } else {
      _trail.visible = true;
      _trail.push(plane.position);
      _trail.update();
    }
  }

  // Water surface drifts (sky is a static equirectangular background)
  if (world.water && world.water.material.map) {
    const m = world.water.material.map;
    const t = performance.now() / 1000;
    m.offset.set((t * 0.012) % 1, (t * 0.007) % 1);
  }
}

// Hit-stop: slow the simulation to 6% speed for a brief moment on big impacts.
// Only in loop() — __sky.tick() bypasses it so tests remain deterministic.
function triggerHitStop(sec) {
  if (reducedMotion) return;
  _hitStop = Math.max(_hitStop, sec);
}

// Rolling frame-time stats for perf measurement (exposed to the page).
// Records both CPU work time and the true wall-clock frame interval.
const frameStats = { count: 0, cpu: [], frame: [], prev: 0 };
function recordFrame(cpuMs, frameMs) {
  frameStats.count++;
  frameStats.cpu.push(cpuMs);
  if (frameMs > 0) frameStats.frame.push(frameMs);
  if (frameStats.cpu.length > 600) frameStats.cpu.shift();
  if (frameStats.frame.length > 600) frameStats.frame.shift();
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  // Hit-stop: slow the sim to 6% speed while active (loop-only; tick() bypasses it).
  const simDt = (_hitStop > 0 && !reducedMotion) ? dt * 0.06 : dt;
  if (_hitStop > 0) _hitStop = Math.max(0, _hitStop - dt);

  const t0 = performance.now();
  // NOTE: onboardingActive no longer gates the sim — it runs under the overlay.
  if (state === State.PLAYING || state === State.MINIGAME) {
    simulate(simDt);
  }
  renderFrame();
  const t1 = performance.now();

  // Boost vignette opacity — driven by speed each frame, never under reduced-motion.
  if (!reducedMotion) {
    if (!_vignetteEl) _vignetteEl = document.getElementById('boost-vignette');
    if (_vignetteEl && controller) {
      const bSpeed = controller.boostSpeed || 320;
      let vOp = 0;
      if (controller.boosting) {
        vOp = 0.7;
      } else {
        const t2 = THREE.MathUtils.clamp((controller.speed - bSpeed * 0.6) / (bSpeed * 0.4), 0, 1);
        vOp = t2 * 0.4;
      }
      _vignetteEl.style.opacity = (isFlying() ? vOp : 0).toFixed(3);
    }
  }

  recordFrame(t1 - t0, frameStats.prev ? t1 - frameStats.prev : 0);
  frameStats.prev = t1;
}

// =====================================================
// Menu / screen wiring
// =====================================================
// Apply the equipped cosmetics to the live scene: the skin becomes a neon emissive
// tint on every lit plane material (GLB meshes or the primitive fallback), and the
// trail becomes the exhaust-plume tint. Called on startGame, after the async GLB
// swap (loadPlaneModel), and whenever the player equips something in the hangar.
function applyEquipped() {
  if (!plane) return;
  const eq = progression.getUnlocks().equipped;
  const skin = progression.UNLOCKS.skins.find(s => s.id === eq.skin) || progression.UNLOCKS.skins[0];
  _skinColor.setHex(skin.color);
  plane.traverse(o => {
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m.emissive) { m.emissive.copy(_skinColor); m.emissiveIntensity = 0.45; }
    }
  });
  const trail = progression.UNLOCKS.trails.find(t => t.id === eq.trail);
  _equippedTrailColor = trail ? trail.color : null;   // null ('off') → default plume
}

function startGame() {
  setActiveScreen(null);
  document.getElementById('game-hud').classList.remove('hidden');
  state = State.PLAYING;
  lastTime = performance.now();
  controller.reset(new THREE.Vector3(0, 400, 0));
  totalScore = 0;
  _crashCooldown = 0;   // clear any cooldown left armed by a crash in a prior session
  _crashFreeze = 0;     // clear any death-cam left mid-hold; make sure the jet is visible
  plane.visible = true;

  // Recycle ambient traffic for a fresh session (reset positions), like the trail.
  if (traffic) traffic.dispose();
  traffic = new Traffic(scene);

  applyEquipped();   // paint the equipped skin/trail onto the plane for this session

  // Init / recycle the wingtip trail for this session
  if (_trail) { _trail.dispose(); _trail = null; }
  // ponytail: wingtip trail removed — user disliked it. To restore: re-import Trail from fx.js and add `_trail = new Trail(scene);` here.

  audio.init().then(() => {
    audio.resume();
    audio.stopAllMusic(0.4);
    setTimeout(() => audio.playVoice('takeoff'), 700);
  });
  updateWaypoint();        // position the arrow before the first frame
  maybeShowTip();
  maybeShowOnboarding();   // first run: show coach overlay (sim runs underneath)
}

function togglePause() {
  if (onboardingActive) return;   // Esc is inert while the welcome overlay is up
  if (state === State.PLAYING || state === State.MINIGAME) {
    state = State.PAUSED;
    setActiveScreen('pause-screen');
    audio.setMuffle(true);   // keep engine droning but muffled
  } else if (state === State.PAUSED) {
    state = activeMinigame ? State.MINIGAME : State.PLAYING;
    setActiveScreen(null);
    audio.setMuffle(false);  // unmuffled on resume
  }
}

function quitToMenu() {
  _crashFreeze = 0; plane.visible = true;   // never leave the jet hidden after a mid-death quit
  if (activeMinigame) { activeMinigame.cleanup(); activeMinigame = null; }
  if (traffic) { traffic.dispose(); traffic = null; }
  if (_trail) { _trail.dispose(); _trail = null; }
  document.getElementById('minigame-hud').classList.add('hidden');
  document.getElementById('game-hud').classList.add('hidden');
  state = State.MENU;
  setActiveScreen('start-screen');
  audio.setMuffle(false);   // ensure no lingering muffle
  audio.resume();
  audio.stopLoop('engine', 0.2);
  prevBoost = false;
  audio.playMusic('music_menu');
  _updateLvChip();
}

function setActiveScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  if (id) document.getElementById(id).classList.add('active');
}

function renderLeaderboard(mode = 'all') {
  const list = document.getElementById('leaderboard-list');
  let rows = [];
  if (mode === 'all') {
    rows = getOverall().map(r => ({ ...r, modeName: MODES[r.mode]?.name || r.mode }));
  } else {
    rows = getScores(mode).map(r => ({ ...r, modeName: MODES[mode].name }));
  }

  if (rows.length === 0) {
    list.innerHTML = `<div class="lb-empty">NO SCORES YET — FLY YOUR FIRST MISSION</div>`;
    return;
  }

  let html = `<div class="lb-row header"><div>#</div><div>GRADE</div><div>MODE</div><div>DATE</div><div>SCORE</div></div>`;
  rows.forEach((r, i) => {
    const rk = `lb-rank ${i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : ''}`;
    html += `
      <div class="lb-row">
        <div class="${rk}">#${i + 1}</div>
        <div class="lb-grade grade-${r.grade}">${r.grade}</div>
        <div>${r.modeName}</div>
        <div>${formatDate(r.date)}</div>
        <div><b>${r.score.toLocaleString()}</b></div>
      </div>`;
  });
  list.innerHTML = html;
}

// =====================================================
// LV chip helper — update start-screen rank display
// =====================================================
function _updateLvChip() {
  const prof = progression.getProfile();
  const chip = document.getElementById('lv-chip');
  if (chip) chip.textContent = `LV ${prof.level} • ${prof.rankTitle}`;
}

// =====================================================
// forceMinigame — exposed as a named function so result-Retry can call it
// =====================================================
function forceMinigame(mode) {
  const m = missions.find(x => x.mode === mode);
  if (!m) return null;
  plane.position.copy(m.pos).add(new THREE.Vector3(0, 150, -250));
  plane.quaternion.identity();
  controller.velocity.set(0, 0, 0);
  state = State.PLAYING;
  startMinigame(m);
  return activeMinigame;
}

// =====================================================
// Result screen — Retry / Next / Continue handlers
// =====================================================
function resultContinue() {
  document.getElementById('result-screen').classList.remove('active');
  state = State.PLAYING;
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(plane.quaternion);
  plane.position.addScaledVector(fwd, 250);
  plane.position.y += 100;
  // Never resume free flight buried in terrain: a CRASHED minigame leaves the plane at
  // ground level, and the +100 nudge over tall terrain (Canyon Dash) can still be
  // underground — which would instantly re-crash. Guarantee clear airspace.
  const ground = terrainHeight(plane.position.x, plane.position.z);
  plane.position.y = Math.max(plane.position.y, ground + 150);
}

function resultRetry() {
  if (!_lastMinigameMode) return;
  document.getElementById('result-screen').classList.remove('active');
  forceMinigame(_lastMinigameMode);
}

function resultNext() {
  // Diegetic: no more teleport-skip. "Fly on" drops you back into open sky exactly
  // like Continue — the #waypoint arrow guides you to the nearest uncleared mission,
  // which you must actually fly to (checkMissions auto-enters at <100 m).
  resultContinue();
}

// Equip a cosmetic from the hangar: persist it, repaint the plane, refresh the panel.
function hangarEquip(kind, id) {
  const equipped = progression.equip(kind, id);
  applyEquipped();
  renderHangar();
  return equipped;
}

// Build the hangar panel from the current unlocks. Locked items are greyed + LV-tagged.
function renderHangar() {
  const u = progression.getUnlocks();
  const cards = (kind, items, equippedId) => items.map(it => {
    const locked = !it.unlocked;
    const isEq = it.id === equippedId;
    const swatch = it.color == null ? 'transparent' : '#' + it.color.toString(16).padStart(6, '0');
    const tag = locked ? `LV ${it.level}` : (isEq ? 'EQUIPPED' : 'EQUIP');
    return `<button class="hangar-card${locked ? ' locked' : ''}${isEq ? ' equipped' : ''}" ${locked ? 'disabled' : ''} data-kind="${kind}" data-id="${it.id}">
      <span class="hangar-swatch" style="--sw:${swatch}"></span>
      <span class="hangar-name">${it.name}</span>
      <span class="hangar-tag">${tag}</span>
    </button>`;
  }).join('');
  document.getElementById('hangar-skins').innerHTML  = cards('skins',  u.skins,  u.equipped.skin);
  document.getElementById('hangar-trails').innerHTML = cards('trails', u.trails, u.equipped.trail);
}

function wireUI() {
  document.getElementById('btn-start').addEventListener('click', startGame);
  document.getElementById('btn-leaderboard').addEventListener('click', () => {
    renderLeaderboard('all');
    setActiveScreen('leaderboard-screen');
  });
  document.getElementById('btn-hangar').addEventListener('click', () => {
    renderHangar();
    setActiveScreen('hangar-screen');
  });
  document.getElementById('hangar-screen').addEventListener('click', (e) => {
    const card = e.target.closest('.hangar-card');
    if (card && !card.classList.contains('locked')) hangarEquip(card.dataset.kind, card.dataset.id);
  });
  document.getElementById('btn-controls').addEventListener('click', () => setActiveScreen('controls-screen'));
  document.getElementById('btn-about').addEventListener('click', () => setActiveScreen('about-screen'));

  document.querySelectorAll('.close-modal').forEach(b => {
    b.addEventListener('click', () => {
      if (state === State.MENU) setActiveScreen('start-screen');
      else if (state === State.PAUSED) setActiveScreen('pause-screen');
      else setActiveScreen(null);
    });
  });

  document.getElementById('btn-resume').addEventListener('click', togglePause);
  document.getElementById('btn-pause-controls').addEventListener('click', () => setActiveScreen('controls-screen'));
  document.getElementById('btn-quit').addEventListener('click', quitToMenu);

  // Result screen actions
  document.getElementById('btn-result-continue').addEventListener('click', resultContinue);
  document.getElementById('btn-result-retry').addEventListener('click', resultRetry);
  document.getElementById('btn-result-next').addEventListener('click', resultNext);
  document.getElementById('btn-result-menu').addEventListener('click', () => {
    document.getElementById('result-screen').classList.remove('active');
    quitToMenu();
  });
  // Keyboard shortcuts for result screen (R=Retry, N=Next) — gated to State.RESULT
  document.addEventListener('keydown', (e) => {
    if (state !== State.RESULT) return;
    if (e.key.toLowerCase() === 'r') resultRetry();
    else if (e.key.toLowerCase() === 'n') resultNext();
  });

  document.querySelectorAll('.lb-tabs .tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.lb-tabs .tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      renderLeaderboard(t.dataset.tab);
    });
  });

  document.getElementById('btn-clear-lb').addEventListener('click', () => {
    if (confirm('Clear ALL saved scores?')) {
      clearAll();
      renderLeaderboard(document.querySelector('.lb-tabs .tab.active').dataset.tab);
    }
  });

  // Onboarding + dismissible tip
  document.getElementById('btn-onboard-dismiss').addEventListener('click', dismissOnboarding);
  document.getElementById('hud-tip-close').addEventListener('click', dismissTip);

  // Pause-on-blur + drop any held keys so the plane doesn't fly off on a
  // stuck input when the tab/window loses focus. (Input also clears keys.)
  window.addEventListener('blur', () => {
    if (input) input.keys.clear();
    if (!onboardingActive && isFlying()) togglePause();
  });

  wireAudioUI();
}

// =====================================================
// Audio UI — unlock on first gesture, click ticks, mute toggle
// =====================================================
function updateMuteUI() {
  document.querySelectorAll('.btn-mute').forEach(b => {
    b.classList.toggle('muted', audio.muted);
    b.textContent = audio.muted ? '🔇' : '🔊';
    b.title = audio.muted ? 'Sound off (M)' : 'Sound on (M)';
  });
}

function wireAudioUI() {
  // Browsers require a user gesture before audio can start.
  const unlock = () => {
    audio.init().then(() => {
      audio.resume();
      if (state === State.MENU) audio.playMusic('music_menu');
      updateMuteUI();
    });
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  // Subtle tick on any button / tab press.
  document.addEventListener('click', (e) => {
    if (e.target.closest('.btn, .tab, .btn-mute')) audio.click();
  });

  const toggle = () => { audio.toggleMute(); updateMuteUI(); };
  document.querySelectorAll('.btn-mute').forEach(b => b.addEventListener('click', toggle));
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'm') { toggle(); }
  });
  updateMuteUI();
}

// =====================================================
// Boot
// =====================================================
setupScene();
wireUI();
wireSettings();
loadSettings();
_updateLvChip();   // show level on start screen at boot
loop(performance.now());

// =====================================================
// Test / debug hook — lets the Playwright suite drive the sim
// deterministically and read out live state & frame timing.
// =====================================================
window.__sky = {
  State,
  audio,
  get fx() { return fx; },
  get camera() { return camera; },
  startMinigame,
  get state() { return state; },
  get cameraMode() { return cameraMode; },
  get totalScore() { return totalScore; },
  get activeMinigame() { return activeMinigame; },
  get settings() { return settings; },
  get onboardingActive() { return onboardingActive; },
  get heldKeys() { return input ? [...input.keys] : []; },
  applySettings,
  get plane() { return plane; },
  get controller() { return controller; },
  get missions() { return missions; },
  get crashCount() { return _crashCount; },
  get crashFreeze() { return _crashFreeze; },   // >0 while the death-cam is holding on the wreck
  get buzzCount() { return _buzzCount; },
  get lastResult() { return _lastResult; },   // { reason, win, completed } — guards landmine #1
  get traffic() { return traffic; },
  grantXp: (n, reason) => progression.grantXp(n, reason),   // test hook for the progression unit
  getUnlocks: () => progression.getUnlocks(),
  equip: (kind, id) => hangarEquip(kind, id),   // equips + repaints the plane + refreshes the hangar UI
  get renderCalls() { return renderer.info.render.calls; },
  get renderTris() { return renderer.info.render.triangles; },
  get world() { return world; },
  terrainHeight,   // module fn — tests use it to place the plane relative to the ground
  get scene() { return scene; },
  // Debug handle the test suite reads to confirm the bloom pass is live.
  get bloom() {
    return {
      active: !!(useBloom && composer && bloomPass),
      composer,
      pass: bloomPass,
      isUnrealBloomPass: bloomPass ? bloomPass.constructor.name === 'UnrealBloomPass' : false,
      isEffectComposer: composer ? composer.constructor.name === 'EffectComposer' : false,
      strength: bloomPass ? bloomPass.strength : 0,
      radius: bloomPass ? bloomPass.radius : 0,
      threshold: bloomPass ? bloomPass.threshold : 0,
      passes: composer ? composer.passes.map(p => p.constructor.name) : [],
    };
  },
  // Toggle bloom on/off so perf.spec can A/B frame time (no-bloom vs bloom).
  setBloom(on) { useBloom = !!on; },
  // Live look A/B for the demo + look.spec: swaps terrain/sky/fog/clear/bloom together.
  setLook(m) { settings.look = m; commitSettings(); },   // applies + syncs the toggle + persists (one code path)
  THREE,
  startGame,
  // Advance the simulation deterministically by `dt` seconds (no rAF needed).
  // NOTE: hit-stop is NOT applied here — tick() is always full speed for determinism.
  tick(dt = 1 / 60) {
    if (isFlying()) simulate(dt);
    renderFrame();
  },
  // Teleport to a mission and start its minigame immediately.
  forceMinigame,
  // Mastery loop: progression profile / medals (read-only)
  get profile() { return progression.getProfile(); },
  get medals()  { return progression.getMedals();  },
  // Hit-stop (readable + triggerable for tests)
  get hitStop() { return _hitStop; },
  triggerHitStop,
  frameStats() {
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    return {
      count: frameStats.count,
      cpuMs: avg(frameStats.cpu),
      frameMs: avg(frameStats.frame),
      samples: frameStats.cpu.length,
    };
  },
  resetFrameStats() {
    frameStats.count = 0;
    frameStats.cpu.length = 0;
    frameStats.frame.length = 0;
    frameStats.prev = 0;
  },
};
