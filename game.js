// =====================================================
// Sky Ace — main game entry
// =====================================================

import * as THREE from 'three';
import { buildWorld, createMissionMarker, terrainHeight, WORLD_SIZE } from './world.js?v=7';
import { createPlane, PlaneController, Input } from './plane.js?v=7';
import { RingRun, CanyonDash, PrecisionDrop, Dogfight } from './minigames.js?v=7';
import { addScore, getScores, getOverall, clearAll, MODES, formatDate, gradeFor } from './leaderboard.js?v=7';
import { audio } from './audio.js?v=7';
import { FX } from './fx.js?v=7';

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

  world = buildWorld(scene);
  fx = new FX(scene);

  plane = createPlane();
  scene.add(plane);
  controller = new PlaneController(plane);
  controller.reset(new THREE.Vector3(0, 350, 0));

  input = new Input();
  input.onPause = togglePause;
  input.onCamera = cycleCamera;
  input.onReset = resetFlight;
  input.onFire = handleFire;

  setupMissions();

  minimapCtx = document.getElementById('minimap-canvas').getContext('2d');

  window.addEventListener('resize', onResize);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
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
function updateCamera(dt) {
  const planePos = plane.position.clone();
  const planeQuat = plane.quaternion;

  let target = new THREE.Vector3();
  let lookAt = planePos.clone();

  if (cameraMode === 0) {
    // Chase
    const offset = new THREE.Vector3(0, 6, -22).applyQuaternion(planeQuat);
    target = planePos.clone().add(offset);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(planeQuat).multiplyScalar(20);
    lookAt = planePos.clone().add(fwd);
  } else if (cameraMode === 1) {
    // Cockpit
    const offset = new THREE.Vector3(0, 0.6, 2.2).applyQuaternion(planeQuat);
    target = planePos.clone().add(offset);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(planeQuat).multiplyScalar(50);
    lookAt = target.clone().add(fwd);
  } else {
    // Cinematic side
    const offset = new THREE.Vector3(35, 8, -8).applyQuaternion(planeQuat);
    target = planePos.clone().add(offset);
    lookAt = planePos.clone();
  }

  // Smooth camera follow (lerp)
  const smooth = cameraMode === 1 ? 1 : 0.15;
  camera.position.lerp(target, smooth);
  camera.lookAt(lookAt);
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
  // Re-trigger animation
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 1800);
}

function showResult(mode, score, reason, result) {
  audio.stopAllMusic(0.5);
  const win = reason !== 'TIME UP' && result.grade !== 'D';
  if (win) audio.play('fanfare');
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
    scoreEl.style.animation = 'none';
    void scoreEl.offsetWidth;
    scoreEl.style.animation = 'scoreFlash 0.6s ease-out';
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
  const grad = ctx.createConicGradient ? ctx.createConicGradient(sweepAngle, W/2, H/2) : null;
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
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(plane.quaternion);
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
// Game loop
// =====================================================
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (state === State.PLAYING || state === State.MINIGAME) {
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

    // Animate mission marker rings
    for (const m of missions) {
      const r = m.marker.userData.ring;
      if (r) r.rotation.z += dt * 0.8;
    }

    updateCamera(dt);
    updateHUD();
    drawMinimap();
    updateAudio(dt);
    fx.update(dt);

    // Particles + radio voice emitted from inside minigame logic
    if (activeMinigame) {
      for (const e of activeMinigame._fxQueue) {
        const p = new THREE.Vector3(e.pos[0], e.pos[1], e.pos[2]);
        if (e.kind === 'explosion') fx.explosion(p, e.size || 1);
        else if (e.kind === 'ring') fx.ringBurst(p, e.color || 0x00ff88);
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

    // Water surface drifts (sky is a static equirectangular background).
    if (world.water && world.water.material.map) {
      const m = world.water.material.map;
      const t = now / 1000;
      m.offset.set((t * 0.012) % 1, (t * 0.007) % 1);
    }
  }

  renderer.render(scene, camera);
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
}

function togglePause() {
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
loop(performance.now());

// Debug / test hook
window.__sky = {
  audio,
  get fx() { return fx; },
  get scene() { return scene; },
  get camera() { return camera; },
  get state() { return state; },
  get controller() { return controller; },
  get plane() { return plane; },
  get missions() { return missions; },
  get activeMinigame() { return activeMinigame; },
  startGame,
  startMinigame,
};
