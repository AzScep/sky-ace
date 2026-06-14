// =====================================================
// Sky Ace — main game entry
// =====================================================

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildWorld, createMissionMarker, terrainHeight, WORLD_SIZE } from './world.js?v=9';
import { createPlane, PlaneController, Input } from './plane.js?v=9';
import { RingRun, CanyonDash, PrecisionDrop, Dogfight } from './minigames.js?v=9';
import { addScore, getScores, getOverall, clearAll, MODES, formatDate, gradeFor } from './leaderboard.js?v=9';
import { audio } from './audio.js?v=9';
import { FX } from './fx.js?v=9';

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
let prevBoost = false;        // for boost-whoosh edge detection
let shake = 0;                // current camera-shake magnitude
let reducedMotion = false;       // mirrors settings.reducedMotion for hot paths
let onboardingActive = false;    // first-run overlay is up → freeze the sim

// ----- Persisted user settings (localStorage: sky_settings) -----
const DEFAULT_SETTINGS = {
  invertPitch: false,
  sensitivity: 1.0,
  reducedMotion: false,
  colorblind: false,
  volume: 0.7,
};
let settings = { ...DEFAULT_SETTINGS };

// True while the player is actively in flight (not in a menu/result screen).
function isFlying() {
  return state === State.PLAYING || state === State.MINIGAME;
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
  renderer.setClearColor(0x88a8c8);
  // Reinhard tone mapping keeps additive FX + bloom from clipping to flat white.
  renderer.toneMapping = THREE.ReinhardToneMapping;
  renderer.toneMappingExposure = 1.15;

  world = buildWorld(scene);
  fx = new FX(scene);
  sunRef = world.sun;

  setupBloom();

  plane = createPlane();
  scene.add(plane);
  controller = new PlaneController(plane);
  controller.reset(new THREE.Vector3(0, 350, 0));

  input = new Input();
  // Gate flight controls so menu/result screens don't react to flight keys.
  input.onPause = togglePause;  // Esc is valid in PLAYING/MINIGAME/PAUSED (togglePause guards itself)
  input.onCamera = () => { if (isFlying()) cycleCamera(); };
  input.onReset  = () => { if (isFlying()) resetFlight(); };
  input.onFire   = () => { if (isFlying()) handleFire(); };

  setupMissions();

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
const _camFwd = new THREE.Vector3();

function updateCamera(dt) {
  const planePos = plane.position;
  const planeQuat = plane.quaternion;

  if (cameraMode === 0) {
    // Chase
    _camOffset.set(0, 6, -22).applyQuaternion(planeQuat);
    _camTarget.copy(planePos).add(_camOffset);
    _camFwd.set(0, 0, 1).applyQuaternion(planeQuat).multiplyScalar(20);
    _camLookAt.copy(planePos).add(_camFwd);
  } else if (cameraMode === 1) {
    // Cockpit
    _camOffset.set(0, 0.6, 2.2).applyQuaternion(planeQuat);
    _camTarget.copy(planePos).add(_camOffset);
    _camFwd.set(0, 0, 1).applyQuaternion(planeQuat).multiplyScalar(50);
    _camLookAt.copy(_camTarget).add(_camFwd);
  } else {
    // Cinematic side
    _camOffset.set(35, 8, -8).applyQuaternion(planeQuat);
    _camTarget.copy(planePos).add(_camOffset);
    _camLookAt.copy(planePos);
  }

  // Smooth camera follow — framerate-independent exponential smoothing so the
  // chase feel is identical at 30fps and 144fps. Cockpit stays a hard snap.
  const smooth = cameraMode === 1 ? 1 : 1 - Math.exp(-9 * dt);
  camera.position.lerp(_camTarget, smooth);
  camera.lookAt(_camLookAt);

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
  const Klass = { ring: RingRun, canyon: CanyonDash, bomb: PrecisionDrop, dogfight: Dogfight }[mission.mode];
  if (!Klass) return;
  activeMinigame = new Klass(scene, plane, mission.pos);
  activeMinigame._mission = mission;
  state = State.MINIGAME;
  const hud = document.getElementById('minigame-hud');
  hud.classList.remove('hidden');
  document.getElementById('mg-title').textContent = mission.name;
  document.getElementById('mg-objective').textContent = activeMinigame.objective;
  showToast(`▶ ${mission.name}`);
  audio.playMusic('music_action');
  if (mission.mode === 'dogfight' || mission.mode === 'bomb') audio.playVoice('combat');
}

function endMinigame() {
  if (!activeMinigame) return;
  const mode = activeMinigame.mode;
  const score = activeMinigame.score;
  const stats = activeMinigame.getStats();
  const reason = activeMinigame.finishReason || 'COMPLETE';

  const result = addScore(mode, score);
  totalScore += score;

  // Mark the mission as cleared and give its marker a distinct "done" look.
  const mission = activeMinigame._mission;
  if (mission) {
    mission.cleared = true;
    const mk = mission.marker;
    if (mk.userData.beam) {
      mk.userData.beam.material.color.setHex(0x2effa8);  // dim teal "done" glow
      mk.userData.beam.material.opacity = 0.15;
    }
    if (mk.userData.ring) mk.userData.ring.material.color.setHex(0x2effa8);
    if (mk.userData.halo) mk.userData.halo.material.color.setHex(0x2effa8);
  }

  activeMinigame.cleanup();
  activeMinigame = null;
  document.getElementById('minigame-hud').classList.add('hidden');

  state = State.RESULT;
  showResult(mode, score, reason, result);
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

function showResult(mode, score, reason, result) {
  audio.stopAllMusic(0.5);
  const win = reason !== 'TIME UP' && result.grade !== 'D';
  if (win) { audio.play('fanfare'); flashScreen(0.28, '#00ff88'); }
  audio.playVoice(win ? 'complete' : 'failed');
  const el = document.getElementById('result-screen');
  document.getElementById('rank-display').textContent = result.grade;
  document.getElementById('rank-display').className = `rank-display grade-${result.grade}`;
  document.getElementById('result-title').textContent = `${MODES[mode].name.toUpperCase()} • ${reason}`;
  const stats = document.getElementById('result-stats');
  stats.innerHTML = `
    <div class="stat-label">SCORE</div><div class="stat-value">${Math.round(score).toLocaleString()}</div>
    <div class="stat-label">GRADE</div><div class="stat-value">${result.grade}</div>
    <div class="stat-label">PERSONAL RANK</div><div class="stat-value">#${result.rank}</div>
    <div class="stat-label">TOTAL SCORE</div><div class="stat-value">${Math.round(totalScore).toLocaleString()}</div>
  `;
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
    const rate = 0.78 + t * 0.95;
    const gain = 0.16 + controller.throttle * 0.18 + (controller.boosting ? 0.16 : 0);
    audio.setLoopParams('engine', gain, rate, 0.12);

    if (controller.boosting && !prevBoost) audio.play('boost');
    prevBoost = controller.boosting;

    // Sounds emitted from inside minigame logic
    if (activeMinigame && activeMinigame._sfxQueue && activeMinigame._sfxQueue.length) {
      for (const s of activeMinigame._sfxQueue) audio.play(s);
      activeMinigame._sfxQueue.length = 0;
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
  }
}
// Reflect current settings onto the menu controls.
function syncSettingsUI() {
  const inv = document.getElementById('set-invert');
  if (!inv) return;
  inv.checked = settings.invertPitch;
  document.getElementById('set-sens').value = settings.sensitivity;
  document.getElementById('set-sens-val').textContent = `${settings.sensitivity.toFixed(1)}×`;
  document.getElementById('set-reduced').checked = settings.reducedMotion;
  document.getElementById('set-colorblind').checked = settings.colorblind;
  const volPct = Math.round(settings.volume * 100);
  document.getElementById('set-volume').value = volPct;
  document.getElementById('set-volume-val').textContent = `${volPct}%`;
}
function commitSettings() { applySettings(); syncSettingsUI(); saveSettings(); }

function wireSettings() {
  const inv = document.getElementById('set-invert');
  const sens = document.getElementById('set-sens');
  const red = document.getElementById('set-reduced');
  const cb = document.getElementById('set-colorblind');
  const vol = document.getElementById('set-volume');
  inv.addEventListener('change', () => { settings.invertPitch = inv.checked; commitSettings(); });
  sens.addEventListener('input', () => { settings.sensitivity = parseFloat(sens.value); commitSettings(); });
  red.addEventListener('change', () => { settings.reducedMotion = red.checked; commitSettings(); });
  cb.addEventListener('change', () => { settings.colorblind = cb.checked; commitSettings(); });
  vol.addEventListener('input', () => { settings.volume = parseInt(vol.value, 10) / 100; commitSettings(); });
  const openSettings = () => setActiveScreen('settings-screen');
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-pause-settings').addEventListener('click', openSettings);
}

// =====================================================
// First-run onboarding + dismissible tip
// =====================================================
function maybeShowOnboarding() {
  if (localStorage.getItem('sky_onboarded')) return;
  onboardingActive = true;
  document.getElementById('onboard-screen').classList.add('active');
}
function dismissOnboarding() {
  try { localStorage.setItem('sky_onboarded', '1'); } catch { /* ignore */ }
  onboardingActive = false;
  document.getElementById('onboard-screen').classList.remove('active');
  lastTime = performance.now();   // swallow the frozen interval so dt doesn't spike
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
  controller.update(dt, input.read());

  // Soft floor — don't crash, just push up
  const ground = terrainHeight(plane.position.x, plane.position.z);
  if (plane.position.y < ground + 8) {
    plane.position.y = ground + 8;
    // small score penalty if in dogfight? leave alone
  }
  // Soft world bounds
  const lim = WORLD_SIZE * 0.45;
  plane.position.x = Math.max(-lim, Math.min(lim, plane.position.x));
  plane.position.z = Math.max(-lim, Math.min(lim, plane.position.z));

  if (activeMinigame) {
    activeMinigame.update(dt);
    if (activeMinigame.done) endMinigame();
  } else {
    checkMissions();
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
        if (size >= 1.4) flashScreen(0.2 * atten, '#ffd9a0');
      } else if (e.kind === 'ring') {
        fx.ringBurst(p, e.color || 0x00ff88);
      }
    }
    activeMinigame._fxQueue.length = 0;
    for (const v of activeMinigame._voQueue) audio.playVoice(v);
    activeMinigame._voQueue.length = 0;
  }

  // Afterburner exhaust while boosting
  if (controller.boosting) {
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(plane.quaternion);
    fx.exhaust(plane.position.clone().addScaledVector(fwd, -5), fwd.clone().multiplyScalar(-26));
  }

  // Water surface drifts (sky is a static equirectangular background)
  if (world.water && world.water.material.map) {
    const m = world.water.material.map;
    const t = performance.now() / 1000;
    m.offset.set((t * 0.012) % 1, (t * 0.007) % 1);
  }
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

  const t0 = performance.now();
  if ((state === State.PLAYING || state === State.MINIGAME) && !onboardingActive) {
    simulate(dt);
  }
  renderFrame();
  const t1 = performance.now();
  recordFrame(t1 - t0, frameStats.prev ? t1 - frameStats.prev : 0);
  frameStats.prev = t1;
}

// =====================================================
// Menu / screen wiring
// =====================================================
function startGame() {
  setActiveScreen(null);
  document.getElementById('game-hud').classList.remove('hidden');
  state = State.PLAYING;
  lastTime = performance.now();
  controller.reset(new THREE.Vector3(0, 400, 0));
  totalScore = 0;
  audio.init().then(() => {
    audio.resume();
    audio.stopAllMusic(0.4);
    setTimeout(() => audio.playVoice('takeoff'), 700);
  });
  updateWaypoint();        // position the arrow before the first frame
  maybeShowTip();
  maybeShowOnboarding();   // first run: overlay control hints + freeze the sim
}

function togglePause() {
  if (onboardingActive) return;   // Esc is inert while the welcome overlay is up
  if (state === State.PLAYING || state === State.MINIGAME) {
    state = State.PAUSED;
    setActiveScreen('pause-screen');
    audio.suspend();
  } else if (state === State.PAUSED) {
    state = activeMinigame ? State.MINIGAME : State.PLAYING;
    setActiveScreen(null);
    audio.resume();
  }
}

function quitToMenu() {
  if (activeMinigame) { activeMinigame.cleanup(); activeMinigame = null; }
  document.getElementById('minigame-hud').classList.add('hidden');
  document.getElementById('game-hud').classList.add('hidden');
  state = State.MENU;
  setActiveScreen('start-screen');
  audio.resume();
  audio.stopLoop('engine', 0.2);
  prevBoost = false;
  audio.playMusic('music_menu');
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

function wireUI() {
  document.getElementById('btn-start').addEventListener('click', startGame);
  document.getElementById('btn-leaderboard').addEventListener('click', () => {
    renderLeaderboard('all');
    setActiveScreen('leaderboard-screen');
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

  document.getElementById('btn-result-continue').addEventListener('click', () => {
    document.getElementById('result-screen').classList.remove('active');
    state = State.PLAYING;
    // nudge plane away from marker so the prompt doesn't re-trigger instantly
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(plane.quaternion);
    plane.position.addScaledVector(fwd, 250);
    plane.position.y += 100;
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
  get renderCalls() { return renderer.info.render.calls; },
  get renderTris() { return renderer.info.render.triangles; },
  get world() { return world; },
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
  THREE,
  startGame,
  // Advance the simulation deterministically by `dt` seconds (no rAF needed).
  tick(dt = 1 / 60) {
    if (isFlying()) simulate(dt);
    renderFrame();
  },
  // Teleport to a mission and start its minigame immediately.
  forceMinigame(mode) {
    const m = missions.find(x => x.mode === mode);
    if (!m) return null;
    plane.position.copy(m.pos).add(new THREE.Vector3(0, 150, -250));
    plane.quaternion.identity();
    controller.velocity.set(0, 0, 0);
    state = State.PLAYING;
    startMinigame(m);
    return activeMinigame;
  },
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
