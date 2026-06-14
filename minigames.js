// =====================================================
// Minigames — NEON SYNTHWAVE restyle + juice
// Ring Run · Canyon Dash · Precision Drop · Dogfight
// Palette: #1a0b2e #ff2e88 #b14bff #00ffd5 #ffcf4d
// =====================================================

import * as THREE from 'three';
import { terrainHeight, WORLD_SIZE, NEON } from './world.js?v=5';

// The flight loop clamps the plane to ±(WORLD_SIZE * 0.45). Course elements must
// spawn comfortably inside that wall or they become physically unreachable.
const COURSE_BOUND = WORLD_SIZE * 0.4;

// Clamp a spawn position into the flyable area; if it hit a wall, reflect the
// travel direction inward so the course snakes back toward the playable space.
function keepInBounds(pos, dir) {
  if (pos.x >  COURSE_BOUND) { pos.x =  COURSE_BOUND; dir.x = -Math.abs(dir.x); }
  if (pos.x < -COURSE_BOUND) { pos.x = -COURSE_BOUND; dir.x =  Math.abs(dir.x); }
  if (pos.z >  COURSE_BOUND) { pos.z =  COURSE_BOUND; dir.z = -Math.abs(dir.z); }
  if (pos.z < -COURSE_BOUND) { pos.z = -COURSE_BOUND; dir.z =  Math.abs(dir.z); }
  if (dir.lengthSq() > 1e-6) dir.normalize();
}

// Base class
class Minigame {
  constructor(scene, plane, mode) {
    this.scene = scene;
    this.plane = plane;
    this.mode = mode;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.score = 0;
    this.timeLeft = 60;
    this.done = false;
    this.objective = '';
    this.lastPlanePos = plane.position.clone();
    this._fx = [];   // transient light-burst meshes (additive, self-fading)
  }
  cleanup() {
    this.scene.remove(this.group);
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material.dispose();
      }
    });
  }
  getStats() { return ''; }
  update(dt) {
    if (this.done) return;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.finish('TIME UP');
    }
  }
  finish(reason) {
    if (this.done) return;
    this.done = true;
    this.finishReason = reason || 'COMPLETE';
  }

  // ---- Shared light-based VFX (everything reads as pure additive light) ----
  // Spawn an expanding flash — a sphere burst or a flat ring shockwave.
  spawnFlash(pos, color, { radius = 8, grow = 5, life = 0.5, ring = false, flat = false } = {}) {
    const geo = ring
      ? new THREE.RingGeometry(radius * 0.55, radius, 28)
      : new THREE.SphereGeometry(radius, 14, 10);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      depthWrite: false, fog: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos);
    if (ring && flat) m.rotation.x = -Math.PI / 2;   // shockwave lies on the ground
    m.userData._fx = { life, maxLife: life, grow };
    this.group.add(m);
    this._fx.push(m);
    return m;
  }
  updateFx(dt) {
    for (let i = this._fx.length - 1; i >= 0; i--) {
      const m = this._fx[i];
      const f = m.userData._fx;
      f.life -= dt;
      m.scale.multiplyScalar(1 + f.grow * dt);
      m.material.opacity = Math.max(0, f.life / f.maxLife);
      if (f.life <= 0) {
        this.group.remove(m);
        m.geometry.dispose();
        m.material.dispose();
        this._fx.splice(i, 1);
      }
    }
  }
}

// =====================================================
// RING RUN — neon-tube rings, passthrough light bursts, combo counter
// =====================================================
const RING_RADIUS = 50;       // visual ring size
const RING_HIT_RADIUS = 70;   // hit detection (generous)

export class RingRun extends Minigame {
  constructor(scene, plane, anchor) {
    super(scene, plane, 'ring');
    this.timeLeft = 75;
    this.currentRing = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.objective = 'Fly through each glowing ring — keep the combo alive';
    this.rings = [];

    // Spawn rings IN FRONT OF the player's current heading so they don't appear behind/above.
    const playerForward = new THREE.Vector3(0, 0, 1).applyQuaternion(plane.quaternion);
    playerForward.y *= 0.3; // damp vertical so rings don't dive into terrain
    playerForward.normalize();

    const count = 10;
    let pos = plane.position.clone().addScaledVector(playerForward, 400);
    pos.y = Math.max(pos.y, 250);   // ensure first ring is at a reasonable altitude
    let dir = playerForward.clone();
    keepInBounds(pos, dir);
    pos.y = Math.max(pos.y, terrainHeight(pos.x, pos.z) + 120);

    for (let i = 0; i < count; i++) {
      if (i > 0) {
        const turn = (Math.random() - 0.5) * 0.9;
        const vClimb = (Math.random() - 0.5) * 0.4;
        dir.applyAxisAngle(new THREE.Vector3(0,1,0), turn);
        dir.y = vClimb;
        dir.normalize();
        pos = pos.clone().addScaledVector(dir, 380 + Math.random() * 160);
        pos.y = Math.max(200, Math.min(700, pos.y));
        keepInBounds(pos, dir);
        pos.y = Math.max(pos.y, terrainHeight(pos.x, pos.z) + 120);
      }

      // Neon tube ring: bright additive torus + faint inner disc "portal".
      const torus = new THREE.Mesh(
        new THREE.TorusGeometry(RING_RADIUS, 6, 12, 36),
        new THREE.MeshBasicMaterial({
          color: NEON.cyan, transparent: true, opacity: 0.85,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        })
      );
      torus.position.copy(pos);
      torus.lookAt(pos.clone().add(dir));
      const inner = new THREE.Mesh(
        new THREE.CircleGeometry(RING_RADIUS - 4, 36),
        new THREE.MeshBasicMaterial({
          color: NEON.cyan, transparent: true, opacity: 0.12,
          side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
          depthWrite: false, fog: false,
        })
      );
      inner.position.copy(pos);
      inner.quaternion.copy(torus.quaternion);
      this.group.add(torus, inner);
      this.rings.push({
        mesh: torus, inner,
        position: pos.clone(),
        normal: dir.clone(),
        passed: false,
      });
    }
    this._highlightCurrent();

    // Big glowing arrow that hovers near the next ring
    this.arrow = new THREE.Mesh(
      new THREE.ConeGeometry(20, 50, 4),
      new THREE.MeshBasicMaterial({
        color: NEON.sun, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      })
    );
    this.group.add(this.arrow);
  }

  _highlightCurrent() {
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (r.passed) {
        r.mesh.material.color.setHex(0x224455);
        r.mesh.material.opacity = 0.25;
        r.inner.visible = false;
      } else if (i === this.currentRing) {
        // Active ring glows magenta so the next gate pops.
        r.mesh.material.color.setHex(NEON.magenta);
        r.mesh.material.opacity = 1;
        r.inner.material.color.setHex(NEON.magenta);
        r.inner.material.opacity = 0.22;
      } else {
        r.mesh.material.color.setHex(NEON.cyan);
        r.mesh.material.opacity = 0.7;
      }
    }
  }

  getStats() {
    const combo = this.combo > 1 ? `  •  COMBO x${this.combo}` : '';
    return `RING ${Math.min(this.currentRing + 1, this.rings.length)} / ${this.rings.length}  •  ⏱ ${this.timeLeft.toFixed(1)}s  •  ${this.score} PTS${combo}`;
  }

  update(dt) {
    super.update(dt);
    if (this.done) return;
    this.updateFx(dt);

    // Animate all unpassed rings + pulse the active one.
    const pulse = 1 + Math.sin(performance.now() / 140) * 0.06;
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (r.passed) continue;
      r.mesh.rotation.z += dt * 0.5;
      if (i === this.currentRing) r.mesh.scale.setScalar(pulse);
    }

    const ring = this.rings[this.currentRing];
    if (!ring) { this.finish('ALL RINGS CLEARED'); return; }
    const planePos = this.plane.position;

    if (this.arrow) {
      this.arrow.position.copy(ring.position);
      this.arrow.position.y += RING_RADIUS + 30 + Math.sin(performance.now() / 200) * 8;
      this.arrow.rotation.z = Math.PI;
      this.arrow.rotation.y = performance.now() / 500;
    }

    const dist = planePos.distanceTo(ring.position);
    this.lastPlanePos.copy(planePos);

    if (dist < RING_HIT_RADIUS) {
      ring.passed = true;
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      const timeBonus = Math.max(0, Math.floor(this.timeLeft * 3));
      const comboBonus = (this.combo - 1) * 75;       // reward unbroken chains
      const pts = 200 + timeBonus + comboBonus;
      this.score += pts;
      this.timeLeft = Math.min(this.timeLeft + 6, 90);
      this.currentRing++;
      this._toast = this.combo > 1
        ? `+${pts} • COMBO x${this.combo}`
        : `+${pts} • RING ${this.currentRing}/${this.rings.length}`;

      // Passthrough light burst: a bright shockwave ring + core flash.
      this.spawnFlash(ring.position, NEON.cyan, { radius: RING_RADIUS, grow: 6, life: 0.45, ring: true });
      this.spawnFlash(ring.position, 0xffffff, { radius: 14, grow: 7, life: 0.3 });

      if (this.currentRing >= this.rings.length) {
        this.score += 500;
        this.finish('ALL RINGS CLEARED');
      } else {
        this._highlightCurrent();
      }
    }
  }

  getNextTarget() {
    const r = this.rings[this.currentRing];
    return r ? r.position : null;
  }
}

// =====================================================
// CANYON DASH — glowing pylons, neon gate curtains, near-miss flash
// =====================================================
export class CanyonDash extends Minigame {
  constructor(scene, plane, anchor) {
    super(scene, plane, 'canyon');
    this.timeLeft = 50;
    this.objective = 'Stay low and thread the neon pylons — shave them for bonus';
    this.gates = [];
    this.passedCount = 0;
    this.bonus = 0;

    const count = 14;
    let pos = anchor.clone();
    let dir = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < count; i++) {
      const turn = (Math.random() - 0.5) * 0.8;
      dir.applyAxisAngle(new THREE.Vector3(0,1,0), turn);
      dir.y = 0;
      dir.normalize();
      pos = pos.clone().addScaledVector(dir, 400);
      keepInBounds(pos, dir);
      const ground = terrainHeight(pos.x, pos.z);
      pos.y = ground + 30;

      const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0,1,0)).normalize();
      const gap = 80 + Math.random() * 30;
      // Alternate pylon colors down the course for an outrun rhythm.
      const pcol = i % 2 === 0 ? NEON.violet : NEON.magenta;

      const pylonMat = new THREE.MeshBasicMaterial({ color: pcol });
      const leftPos = pos.clone().addScaledVector(right, -gap);
      const rightPos = pos.clone().addScaledVector(right, gap);
      const leftPylon = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 120, 8), pylonMat);
      const rightPylon = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 120, 8), pylonMat);
      leftPylon.position.copy(leftPos);
      leftPylon.position.y = terrainHeight(leftPos.x, leftPos.z) + 60;
      rightPylon.position.copy(rightPos);
      rightPylon.position.y = terrainHeight(rightPos.x, rightPos.z) + 60;

      // Bright cap lights on top of each pylon (bloom beacons).
      const capGeo = new THREE.SphereGeometry(6, 10, 8);
      const capMat = new THREE.MeshBasicMaterial({
        color: NEON.cyan, blending: THREE.AdditiveBlending, fog: false,
      });
      const capL = new THREE.Mesh(capGeo, capMat);
      capL.position.set(leftPos.x, leftPylon.position.y + 64, leftPos.z);
      const capR = new THREE.Mesh(capGeo, capMat.clone());
      capR.position.set(rightPos.x, rightPylon.position.y + 64, rightPos.z);

      // Neon gate "curtain" between the pylons — a soft glowing pane to fly through.
      const curtain = new THREE.Mesh(
        new THREE.PlaneGeometry(gap * 2, 120),
        new THREE.MeshBasicMaterial({
          color: pcol, transparent: true, opacity: 0.12,
          side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
          depthWrite: false, fog: false,
        })
      );
      curtain.position.copy(pos).setY(leftPylon.position.y);
      curtain.lookAt(pos.clone().addScaledVector(dir, 10).setY(leftPylon.position.y));

      this.group.add(leftPylon, rightPylon, capL, capR, curtain);
      this.gates.push({
        center: pos.clone(),
        dir: dir.clone(),
        right: right.clone(),
        gap,
        curtain,
        color: pcol,
        passed: false,
      });
    }
  }

  getStats() {
    const alt = this.plane.position.y;
    const altWarn = alt > 200 ? '⚠ TOO HIGH' : 'OK';
    return `GATE ${this.passedCount}/${this.gates.length} • ALT ${alt.toFixed(0)} (${altWarn}) • ⏱ ${this.timeLeft.toFixed(1)}s • ${this.score} PTS`;
  }

  update(dt) {
    super.update(dt);
    if (this.done) return;
    this.updateFx(dt);
    const planePos = this.plane.position;

    // Pulse the next gate's curtain so the player can read where to aim.
    const next = this.gates.find(g => !g.passed);
    const pulse = 0.1 + (Math.sin(performance.now() / 180) * 0.5 + 0.5) * 0.18;
    for (const g of this.gates) {
      if (g.curtain) g.curtain.material.opacity = g.passed ? 0.05 : (g === next ? pulse : 0.1);
    }

    for (let i = 0; i < this.gates.length; i++) {
      const g = this.gates[i];
      if (g.passed) continue;
      const rel = planePos.clone().sub(g.center);
      const along = rel.dot(g.dir);
      const lateral = rel.dot(g.right);
      const vert = rel.y;
      if (along > -10 && along < 30 && Math.abs(lateral) < g.gap && Math.abs(vert) < 120) {
        g.passed = true;
        this.passedCount++;
        const altBonus = planePos.y < 200 ? 100 : 0;
        // Near-miss: shaving a pylon edge (within 18u of the gap) pays a thrill bonus.
        const edge = g.gap - Math.abs(lateral);
        const nearMiss = edge < 18;
        const nmBonus = nearMiss ? 120 : 0;
        this.score += 150 + altBonus + nmBonus;
        if (altBonus) this.bonus += altBonus;
        if (nmBonus) this.bonus += nmBonus;
        this._toast = nearMiss ? `+${150 + altBonus + nmBonus} ⚡ NEAR MISS!`
                    : altBonus ? `+250 LOW PASS` : `+150 GATE`;

        // Light bursts: gate flash through the curtain + colored shockwave ring.
        this.spawnFlash(g.center, g.color, { radius: g.gap, grow: 5, life: 0.4, ring: true });
        if (nearMiss) this.spawnFlash(planePos, NEON.sun, { radius: 16, grow: 8, life: 0.4 });

        if (this.passedCount === this.gates.length) {
          this.score += 600;
          this.finish('COURSE CLEARED');
        }
      }
    }
  }
}

// =====================================================
// PRECISION DROP — neon reticle, light-burst detonation, blast-radius ring
// =====================================================
export class PrecisionDrop extends Minigame {
  constructor(scene, plane, anchor) {
    super(scene, plane, 'bomb');
    this.timeLeft = 90;
    this.objective = 'Drop bombs (F) on the neon target. Accuracy = score. 3 bombs.';
    this.bombsLeft = 3;
    this.bombs = [];
    this.hits = [];

    const tPos = anchor.clone();
    const ground = terrainHeight(tPos.x, tPos.z);
    tPos.y = ground;
    this.targetPos = tPos.clone();

    // Concentric neon reticle rings (additive, magenta/cyan alternating).
    this.reticle = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const r = 80 - i * 18;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r - 4, r, 40),
        new THREE.MeshBasicMaterial({
          color: i % 2 === 0 ? NEON.magenta : NEON.cyan,
          side: THREE.DoubleSide, transparent: true, opacity: 0.9,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(tPos.x, ground + 0.5 + i * 0.1, tPos.z);
      this.reticle.add(ring);
    }
    // Crosshair ticks
    for (let a = 0; a < 4; a++) {
      const tick = new THREE.Mesh(
        new THREE.BoxGeometry(2, 0.5, 30),
        new THREE.MeshBasicMaterial({ color: NEON.cyan, blending: THREE.AdditiveBlending, fog: false })
      );
      tick.position.set(tPos.x, ground + 1, tPos.z);
      tick.rotation.y = a * Math.PI / 2;
      tick.position.addScaledVector(new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0,1,0), a * Math.PI/2), 60);
      this.reticle.add(tick);
    }
    this.group.add(this.reticle);

    // Vertical target beam so it's findable from altitude.
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 3, 400, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: NEON.magenta, transparent: true, opacity: 0.3,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        depthWrite: false, fog: false,
      })
    );
    beam.position.set(tPos.x, ground + 200, tPos.z);
    this.group.add(beam);
  }

  dropBomb(planePos, planeVel) {
    if (this.bombsLeft <= 0 || this.done) return;
    this.bombsLeft--;
    const bomb = new THREE.Mesh(
      new THREE.SphereGeometry(2, 10, 8),
      new THREE.MeshBasicMaterial({ color: NEON.sun, blending: THREE.AdditiveBlending, fog: false })
    );
    bomb.position.copy(planePos).y -= 2;
    bomb.userData.vel = planeVel.clone();
    this.group.add(bomb);
    this.bombs.push(bomb);
    // Tracer pip falling — small flash at release
    this.spawnFlash(bomb.position, NEON.sun, { radius: 4, grow: 4, life: 0.25 });
  }

  getStats() {
    return `BOMBS: ${this.bombsLeft}  •  HITS: ${this.hits.length}/3  •  ⏱ ${this.timeLeft.toFixed(1)}s  •  ${this.score} PTS`;
  }

  update(dt) {
    super.update(dt);
    if (this.done) return;
    this.updateFx(dt);

    // Spin the reticle for that radar-lock feel.
    if (this.reticle) this.reticle.rotation.y += dt * 0.6;

    const gravity = -98;
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.userData.vel.y += gravity * dt;
      b.position.addScaledVector(b.userData.vel, dt);
      const ground = terrainHeight(b.position.x, b.position.z);
      if (b.position.y <= ground) {
        b.position.y = ground;
        const distXZ = Math.hypot(b.position.x - this.targetPos.x, b.position.z - this.targetPos.z);
        let points = 0;
        if (distXZ < 26)      points = 1000;
        else if (distXZ < 44) points = 600;
        else if (distXZ < 62) points = 300;
        else if (distXZ < 80) points = 100;
        this.score += points;
        this.hits.push({ dist: distXZ, points });
        this._toast = points > 0 ? `+${points} ${distXZ < 26 ? 'BULLSEYE!' : 'HIT'}` : 'MISS';

        // Light-burst detonation: white core + colored fireball + ground blast ring.
        const impact = b.position.clone(); impact.y += 4;
        const col = points >= 600 ? NEON.sun : NEON.magenta;
        this.spawnFlash(impact, 0xffffff, { radius: 10, grow: 9, life: 0.3 });
        this.spawnFlash(impact, col, { radius: 18, grow: 6, life: 0.5 });
        this.spawnFlash(new THREE.Vector3(b.position.x, ground + 1, b.position.z), col,
          { radius: 22, grow: 10, life: 0.6, ring: true, flat: true });

        this.group.remove(b);
        b.geometry.dispose(); b.material.dispose();
        this.bombs.splice(i, 1);
        if (this.bombsLeft === 0 && this.bombs.length === 0) {
          if (this.hits.every(h => h.dist < 26)) this.score += 700;
          this.finish('BOMBS EXPENDED');
        }
      }
    }
  }
}

// =====================================================
// DOGFIGHT — neon enemies, tracer streaks, lock-on, light-burst kills
// =====================================================
export class Dogfight extends Minigame {
  constructor(scene, plane, anchor) {
    super(scene, plane, 'dogfight');
    this.timeLeft = 90;
    this.objective = 'Get on their six and press F. Tracers + lock-on. Down 4.';
    this.enemies = [];
    this.bullets = [];
    this.kills = 0;
    this.targetKills = 4;

    for (let i = 0; i < 4; i++) {
      this.spawnEnemy(anchor);
    }
  }

  spawnEnemy(anchor) {
    const enemy = new THREE.Group();
    // Neon airframe — magenta body, violet wings (self-lit, blooms).
    const body = new THREE.Mesh(
      new THREE.ConeGeometry(2, 8, 6),
      new THREE.MeshBasicMaterial({ color: NEON.magenta, fog: false })
    );
    body.rotation.x = -Math.PI / 2;
    enemy.add(body);
    const wing = new THREE.Mesh(
      new THREE.BoxGeometry(8, 0.3, 1.6),
      new THREE.MeshBasicMaterial({ color: NEON.violet, fog: false })
    );
    enemy.add(wing);
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 1.2, 1.2),
      new THREE.MeshBasicMaterial({ color: NEON.violet, fog: false })
    );
    fin.position.set(0, 0.6, -3);
    enemy.add(fin);

    // Lock-on ring — hidden until the player has this bandit boresighted.
    const lockRing = new THREE.Mesh(
      new THREE.TorusGeometry(10, 0.6, 8, 28),
      new THREE.MeshBasicMaterial({
        color: NEON.sun, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      })
    );
    lockRing.visible = false;
    enemy.add(lockRing);

    const offset = new THREE.Vector3(
      (Math.random() - 0.5) * 800,
      300 + Math.random() * 300,
      (Math.random() - 0.5) * 800
    );
    enemy.position.copy(anchor).add(offset);
    enemy.userData = {
      speed: 60 + Math.random() * 30,
      turnT: 0,
      health: 2,
      alive: true,
      lockRing,
    };
    this.group.add(enemy);
    this.enemies.push(enemy);
  }

  fireBullet(planePos, planeQuat) {
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(planeQuat);
    // Elongated tracer streak (a glowing rod oriented down the bore).
    const tracer = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 10),
      new THREE.MeshBasicMaterial({
        color: NEON.cyan, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      })
    );
    tracer.position.copy(planePos).addScaledVector(forward, 6);
    tracer.quaternion.copy(planeQuat);
    tracer.userData.vel = forward.clone().multiplyScalar(400);
    tracer.userData.life = 2.5;
    this.group.add(tracer);
    this.bullets.push(tracer);
    // Muzzle flash
    this.spawnFlash(tracer.position, NEON.cyan, { radius: 3, grow: 5, life: 0.15 });
  }

  getStats() {
    const lock = this._locked ? '  •  🔒 LOCK' : '';
    return `ENEMIES DOWN: ${this.kills}/${this.targetKills}  •  ⏱ ${this.timeLeft.toFixed(1)}s  •  ${Math.round(this.score)} PTS${lock}`;
  }

  update(dt) {
    super.update(dt);
    if (this.done) return;
    this.updateFx(dt);

    // Enemies — wander + occasional evasion
    for (const enemy of this.enemies) {
      if (!enemy.userData.alive) continue;
      enemy.userData.turnT -= dt;
      if (enemy.userData.turnT <= 0) {
        enemy.userData.turnT = 1 + Math.random() * 2;
        enemy.userData.yawTarget = (Math.random() - 0.5) * 1.2;
        enemy.userData.pitchTarget = (Math.random() - 0.5) * 0.5;
      }
      enemy.rotateY(enemy.userData.yawTarget * dt);
      enemy.rotateX(enemy.userData.pitchTarget * dt * 0.5);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(enemy.quaternion);
      enemy.position.addScaledVector(fwd, enemy.userData.speed * dt);
      if (enemy.position.y < 200) enemy.position.y += dt * 50;
      if (enemy.position.y > 900) enemy.position.y -= dt * 50;
      if (enemy.userData.lockRing) {
        enemy.userData.lockRing.visible = false;            // reset each frame; lock pass re-enables
        enemy.userData.lockRing.rotation.z += dt * 3;
      }
    }

    // Bullets / tracers
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.userData.life -= dt;
      if (b.userData.life <= 0) {
        this.group.remove(b);
        b.geometry.dispose(); b.material.dispose();
        this.bullets.splice(i, 1);
        continue;
      }
      b.position.addScaledVector(b.userData.vel, dt);

      for (const enemy of this.enemies) {
        if (!enemy.userData.alive) continue;
        if (b.position.distanceTo(enemy.position) < 8) {
          enemy.userData.health--;
          this.group.remove(b);
          b.geometry.dispose(); b.material.dispose();
          this.bullets.splice(i, 1);
          // Hit spark feedback
          this.spawnFlash(enemy.position, NEON.cyan, { radius: 5, grow: 8, life: 0.25 });
          if (enemy.userData.health <= 0) {
            enemy.userData.alive = false;
            enemy.visible = false;
            this.kills++;
            this.score += 600;
            // Light-burst kill: white core + magenta fireball + gold shockwave.
            this.spawnFlash(enemy.position, 0xffffff, { radius: 10, grow: 10, life: 0.35 });
            this.spawnFlash(enemy.position, NEON.magenta, { radius: 18, grow: 7, life: 0.55 });
            this.spawnFlash(enemy.position, NEON.sun, { radius: 14, grow: 9, life: 0.45, ring: true });
            this._toast = `+600 SPLASH ONE!`;
            if (this.kills >= this.targetKills) {
              this.score += 1000;
              this.finish('ALL ENEMIES DOWN');
            }
          } else {
            this.score += 100;
            this._toast = '+100 HIT';
          }
          break;
        }
      }
    }

    // Lock-on: enemy inside the boresight cone gets a glowing lock ring + time bonus.
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.plane.quaternion);
    this._locked = false;
    for (const enemy of this.enemies) {
      if (!enemy.userData.alive) continue;
      const to = enemy.position.clone().sub(this.plane.position);
      const dist = to.length();
      if (dist < 320) {
        to.normalize();
        const dot = to.dot(forward);
        if (dot > 0.97) {
          this.score += 30 * dt;
          this._locked = true;
          if (enemy.userData.lockRing) {
            enemy.userData.lockRing.visible = true;
            enemy.userData.lockRing.lookAt(this.plane.position);
          }
        }
      }
    }
  }
}
