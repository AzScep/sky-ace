// =====================================================
// Minigames — Ring Run, Canyon Dash, Precision Drop, Dogfight
// =====================================================

import * as THREE from 'three';
import { terrainHeight, WORLD_SIZE } from './world.js?v=5';

// Swept ring intersection: did segment p0→p1 cross the disc at (center, normal, radius)?
function sweptRingHit(p0, p1, center, normal, radius) {
  const seg = new THREE.Vector3().subVectors(p1, p0);
  const denom = seg.dot(normal);
  if (Math.abs(denom) < 1e-6) {
    // Parallel — fall back to proximity check at p1
    return p1.distanceTo(center) < radius;
  }
  const t = new THREE.Vector3().subVectors(center, p0).dot(normal) / denom;
  if (t < -0.05 || t > 1.05) {
    // Plane crossing didn't happen this frame; also check proximity as safety
    return p1.distanceTo(center) < radius * 0.7;
  }
  const cross = new THREE.Vector3().copy(p0).addScaledVector(seg, t);
  return cross.distanceTo(center) < radius;
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
    this._sfxQueue = [];   // drained by the main loop -> audio.play()
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
}

// =====================================================
// RING RUN — fly through rings in order under a timer
// =====================================================
const RING_RADIUS = 50;       // visual ring size
const RING_HIT_RADIUS = 70;   // hit detection (generous)

export class RingRun extends Minigame {
  constructor(scene, plane, anchor) {
    super(scene, plane, 'ring');
    this.timeLeft = 75;
    this.currentRing = 0;
    this.objective = 'Fly through each glowing ring in order';
    this.rings = [];

    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
    const innerMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.15, side: THREE.DoubleSide });

    // Spawn rings IN FRONT OF the player's current heading so they don't appear behind/above.
    const playerForward = new THREE.Vector3(0, 0, 1).applyQuaternion(plane.quaternion);
    playerForward.y *= 0.3; // damp vertical so rings don't dive into terrain
    playerForward.normalize();

    const count = 10;
    let pos = plane.position.clone().addScaledVector(playerForward, 400);
    pos.y = Math.max(pos.y, 250);   // ensure first ring is at a reasonable altitude
    let dir = playerForward.clone();

    for (let i = 0; i < count; i++) {
      if (i > 0) {
        const turn = (Math.random() - 0.5) * 0.9;
        const vClimb = (Math.random() - 0.5) * 0.4;
        dir.applyAxisAngle(new THREE.Vector3(0,1,0), turn);
        dir.y = vClimb;
        dir.normalize();
        pos = pos.clone().addScaledVector(dir, 380 + Math.random() * 160);
        pos.y = Math.max(200, Math.min(700, pos.y));
      }

      const torus = new THREE.Mesh(
        new THREE.TorusGeometry(RING_RADIUS, 5, 10, 32),
        ringMat.clone()
      );
      torus.position.copy(pos);
      torus.lookAt(pos.clone().add(dir));
      const inner = new THREE.Mesh(new THREE.CircleGeometry(RING_RADIUS, 32), innerMat.clone());
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
    const arrowGeo = new THREE.ConeGeometry(20, 50, 4);
    this.arrow = new THREE.Mesh(
      arrowGeo,
      new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.9 })
    );
    this.group.add(this.arrow);
  }

  _highlightCurrent() {
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (r.passed) {
        r.mesh.material.color.setHex(0x333333);
        r.mesh.material.opacity = 0.2;
        r.inner.visible = false;
      } else if (i === this.currentRing) {
        r.mesh.material.color.setHex(0x00ff88);
        r.mesh.material.opacity = 1;
        r.inner.material.color.setHex(0x00ff88);
        r.inner.material.opacity = 0.3;
      } else {
        r.mesh.material.color.setHex(0x00d4ff);
        r.mesh.material.opacity = 0.65;
      }
    }
  }

  getStats() {
    return `RING ${Math.min(this.currentRing + 1, this.rings.length)} / ${this.rings.length}  •  ⏱ ${this.timeLeft.toFixed(1)}s  •  ${this.score} PTS`;
  }

  update(dt) {
    super.update(dt);
    if (this.done) return;

    // Animate all unpassed rings
    for (const r of this.rings) {
      if (r.passed) continue;
      r.mesh.rotation.z += dt * 0.5;
    }

    const ring = this.rings[this.currentRing];
    if (!ring) { this.finish('ALL RINGS CLEARED'); return; }
    const planePos = this.plane.position;

    // Hovering arrow above the next ring
    if (this.arrow) {
      this.arrow.position.copy(ring.position);
      this.arrow.position.y += RING_RADIUS + 30 + Math.sin(performance.now() / 200) * 8;
      this.arrow.rotation.z = Math.PI; // tip pointing down at the ring
      this.arrow.rotation.y = performance.now() / 500;
    }

    // SIMPLE hit detection: distance to ring center.
    // Generous radius so passing through at any speed always counts.
    const dist = planePos.distanceTo(ring.position);
    this.lastPlanePos.copy(planePos);

    if (dist < RING_HIT_RADIUS) {
      ring.passed = true;
      const timeBonus = Math.max(0, Math.floor(this.timeLeft * 3));
      const pts = 200 + timeBonus;
      this.score += pts;
      this.timeLeft = Math.min(this.timeLeft + 6, 90);
      this.currentRing++;
      this._toast = `+${pts} • RING ${this.currentRing}/${this.rings.length}`;
      this._sfxQueue.push('chime');

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
// CANYON DASH — fly low between obstacle gates
// =====================================================
export class CanyonDash extends Minigame {
  constructor(scene, plane, anchor) {
    super(scene, plane, 'canyon');
    this.timeLeft = 50;
    this.objective = 'Stay below 200 ft and pass between the pylons';
    this.gates = [];
    this.passedCount = 0;
    this.bonus = 0;

    const pylonMat = new THREE.MeshPhongMaterial({ color: 0xff9500, emissive: 0x442200 });
    const flagMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });

    const count = 14;
    let pos = anchor.clone().add(new THREE.Vector3(0, 0, 0));
    let dir = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < count; i++) {
      const turn = (Math.random() - 0.5) * 0.8;
      dir.applyAxisAngle(new THREE.Vector3(0,1,0), turn);
      dir.y = 0;
      dir.normalize();
      pos = pos.clone().addScaledVector(dir, 400);
      const ground = terrainHeight(pos.x, pos.z);
      pos.y = ground + 30;

      const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0,1,0)).normalize();
      const gap = 80 + Math.random() * 30;

      const leftPylon = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 120, 8), pylonMat);
      const rightPylon = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 120, 8), pylonMat);
      const leftPos = pos.clone().addScaledVector(right, -gap);
      const rightPos = pos.clone().addScaledVector(right, gap);
      leftPylon.position.copy(leftPos);
      leftPylon.position.y = terrainHeight(leftPos.x, leftPos.z) + 60;
      rightPylon.position.copy(rightPos);
      rightPylon.position.y = terrainHeight(rightPos.x, rightPos.z) + 60;

      // Flag at the top of each pylon
      const flagL = new THREE.Mesh(new THREE.BoxGeometry(2, 10, 14), flagMat);
      flagL.position.set(leftPos.x, leftPylon.position.y + 70, leftPos.z);
      const flagR = new THREE.Mesh(new THREE.BoxGeometry(2, 10, 14), flagMat);
      flagR.position.set(rightPos.x, rightPylon.position.y + 70, rightPos.z);

      this.group.add(leftPylon, rightPylon, flagL, flagR);
      this.gates.push({
        center: pos.clone(),
        dir: dir.clone(),
        right: right.clone(),
        gap,
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
    const planePos = this.plane.position;

    for (let i = 0; i < this.gates.length; i++) {
      const g = this.gates[i];
      if (g.passed) continue;
      // Check if plane crossed gate plane
      const rel = planePos.clone().sub(g.center);
      const along = rel.dot(g.dir);
      const lateral = rel.dot(g.right);
      const vert = rel.y;
      if (along > -10 && along < 30 && Math.abs(lateral) < g.gap && Math.abs(vert) < 120) {
        g.passed = true;
        this.passedCount++;
        const altBonus = planePos.y < 200 ? 100 : 0;
        this.score += 150 + altBonus;
        if (altBonus) this.bonus += altBonus;
        this._toast = altBonus ? `+250 LOW PASS` : `+150 GATE`;
        this._sfxQueue.push('chime');
        if (this.passedCount === this.gates.length) {
          this.score += 600;
          this.finish('COURSE CLEARED');
        }
      }
    }
  }
}

// =====================================================
// PRECISION DROP — bomb a target from altitude
// =====================================================
export class PrecisionDrop extends Minigame {
  constructor(scene, plane, anchor) {
    super(scene, plane, 'bomb');
    this.timeLeft = 90;
    this.objective = 'Drop bombs (F) on target. Score by accuracy. 3 bombs.';
    this.bombsLeft = 3;
    this.bombs = [];
    this.hits = [];

    // Target reticle on ground
    const tPos = anchor.clone();
    const ground = terrainHeight(tPos.x, tPos.z);
    tPos.y = ground;
    this.targetPos = tPos.clone();

    for (let i = 0; i < 4; i++) {
      const r = 80 - i * 18;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r - 4, r, 32),
        new THREE.MeshBasicMaterial({
          color: i === 0 ? 0xff3860 : (i % 2 === 0 ? 0xffffff : 0xff3860),
          side: THREE.DoubleSide,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(tPos.x, ground + 0.5 + i * 0.1, tPos.z);
      this.group.add(ring);
    }
    const flagPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.8, 30, 8),
      new THREE.MeshPhongMaterial({ color: 0xffffff })
    );
    flagPole.position.set(tPos.x, ground + 15, tPos.z);
    this.group.add(flagPole);
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 6),
      new THREE.MeshBasicMaterial({ color: 0xff3860, side: THREE.DoubleSide })
    );
    flag.position.set(tPos.x + 5, ground + 27, tPos.z);
    this.group.add(flag);
  }

  dropBomb(planePos, planeVel) {
    if (this.bombsLeft <= 0 || this.done) return;
    this.bombsLeft--;
    const bomb = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 8, 6),
      new THREE.MeshPhongMaterial({ color: 0x222222 })
    );
    bomb.position.copy(planePos).y -= 2;
    bomb.userData.vel = planeVel.clone();
    this.group.add(bomb);
    this.bombs.push(bomb);
  }

  getStats() {
    return `BOMBS: ${this.bombsLeft}  •  HITS: ${this.hits.length}/3  •  ⏱ ${this.timeLeft.toFixed(1)}s  •  ${this.score} PTS`;
  }

  update(dt) {
    super.update(dt);
    if (this.done) return;

    // Update bombs (simple gravity)
    const gravity = -98;
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.userData.vel.y += gravity * dt;
      b.position.addScaledVector(b.userData.vel, dt);
      const ground = terrainHeight(b.position.x, b.position.z);
      if (b.position.y <= ground) {
        // Impact
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
        this._sfxQueue.push('explosion');
        if (points >= 1000) this._sfxQueue.push('chime');
        // Explosion marker
        const ex = new THREE.Mesh(
          new THREE.SphereGeometry(8, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0xff7700, transparent: true, opacity: 0.8 })
        );
        ex.position.copy(b.position);
        ex.position.y += 4;
        ex.userData.life = 1;
        this.group.add(ex);
        this.group.remove(b);
        this.bombs.splice(i, 1);
        if (this.bombsLeft === 0 && this.bombs.length === 0) {
          // Bonus if all bullseyes
          if (this.hits.every(h => h.dist < 26)) this.score += 700;
          this.finish('BOMBS EXPENDED');
        }
      }
    }

    // Fade explosion markers
    this.group.children.forEach(c => {
      if (c.userData && c.userData.life !== undefined) {
        c.userData.life -= dt;
        c.scale.multiplyScalar(1 + dt * 2);
        c.material.opacity = Math.max(0, c.userData.life);
        if (c.userData.life <= 0) this.group.remove(c);
      }
    });
  }
}

// =====================================================
// DOGFIGHT — chase and shoot down enemy planes
// =====================================================
export class Dogfight extends Minigame {
  constructor(scene, plane, anchor) {
    super(scene, plane, 'dogfight');
    this.timeLeft = 90;
    this.objective = 'Get behind enemy and press F to fire. Down 4 enemies.';
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
    const body = new THREE.Mesh(
      new THREE.ConeGeometry(2, 8, 6),
      new THREE.MeshPhongMaterial({ color: 0xff3860, emissive: 0x441111 })
    );
    body.rotation.x = -Math.PI / 2;
    enemy.add(body);
    const wing = new THREE.Mesh(
      new THREE.BoxGeometry(8, 0.3, 1.6),
      new THREE.MeshPhongMaterial({ color: 0xaa2233 })
    );
    enemy.add(wing);
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 1.2, 1.2),
      new THREE.MeshPhongMaterial({ color: 0xaa2233 })
    );
    fin.position.set(0, 0.6, -3);
    enemy.add(fin);

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
    };
    this.group.add(enemy);
    this.enemies.push(enemy);
  }

  fireBullet(planePos, planeQuat) {
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(planeQuat);
    const bullet = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffff00 })
    );
    bullet.position.copy(planePos).addScaledVector(forward, 6);
    bullet.userData.vel = forward.clone().multiplyScalar(400);
    bullet.userData.life = 2.5;
    this.group.add(bullet);
    this.bullets.push(bullet);
  }

  getStats() {
    return `ENEMIES DOWN: ${this.kills}/${this.targetKills}  •  ⏱ ${this.timeLeft.toFixed(1)}s  •  ${Math.round(this.score)} PTS`;
  }

  update(dt) {
    super.update(dt);
    if (this.done) return;

    // Update enemies — wander + occasional evasion
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
      // Keep enemies in air
      if (enemy.position.y < 200) enemy.position.y += dt * 50;
      if (enemy.position.y > 900) enemy.position.y -= dt * 50;
    }

    // Update bullets
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.userData.life -= dt;
      if (b.userData.life <= 0) {
        this.group.remove(b);
        this.bullets.splice(i, 1);
        continue;
      }
      b.position.addScaledVector(b.userData.vel, dt);

      // Check hits
      for (const enemy of this.enemies) {
        if (!enemy.userData.alive) continue;
        if (b.position.distanceTo(enemy.position) < 8) {
          enemy.userData.health--;
          this.group.remove(b);
          this.bullets.splice(i, 1);
          if (enemy.userData.health <= 0) {
            enemy.userData.alive = false;
            enemy.visible = false;
            this.kills++;
            this.score += 600;
            // Big explosion
            const ex = new THREE.Mesh(
              new THREE.SphereGeometry(12, 10, 8),
              new THREE.MeshBasicMaterial({ color: 0xff5500, transparent: true, opacity: 0.9 })
            );
            ex.position.copy(enemy.position);
            ex.userData.life = 1;
            this.group.add(ex);
            this._toast = `+600 SPLASH ONE!`;
            this._sfxQueue.push('explosion', 'chime');
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

    // Bonus: small score for time-on-target (enemy in crosshair)
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.plane.quaternion);
    for (const enemy of this.enemies) {
      if (!enemy.userData.alive) continue;
      const to = enemy.position.clone().sub(this.plane.position);
      const dist = to.length();
      if (dist < 300) {
        to.normalize();
        const dot = to.dot(forward);
        if (dot > 0.97) {
          this.score += 30 * dt;
        }
      }
    }

    // Fade explosions
    this.group.children.forEach(c => {
      if (c.userData && c.userData.life !== undefined && !c.userData.vel && !c.userData.speed) {
        c.userData.life -= dt;
        c.scale.multiplyScalar(1 + dt * 1.5);
        if (c.material) c.material.opacity = Math.max(0, c.userData.life);
        if (c.userData.life <= 0) this.group.remove(c);
      }
    });
  }
}
