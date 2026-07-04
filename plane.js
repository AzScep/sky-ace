// =====================================================
// Plane — model, controls, arcade physics
// =====================================================

import * as THREE from 'three';

export function createPlane() {
  const plane = new THREE.Group();

  // Arcade jet: a light metallic airframe (reads against both the realistic sky
  // and the dark synthwave grid) with self-lit cyan trim + a gold afterburner so
  // the silhouette pops under the bloom pass. Nose points +Z.
  // Low metalness on purpose: the scene has no environment map, so a high-metalness
  // PBR surface would render dark/dull (nothing to reflect). Low metal = properly lit.
  const bodyMat  = new THREE.MeshStandardMaterial({ color: 0xc4cdda, metalness: 0.15, roughness: 0.55 });
  const darkMat  = new THREE.MeshStandardMaterial({ color: 0x2a3040, metalness: 0.2,  roughness: 0.6 });
  const trimMat  = new THREE.MeshBasicMaterial({ color: 0x00ffd5 });                 // self-lit cyan trim (NEON.cyan)
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x1a2740, metalness: 0.1, roughness: 0.15,
    emissive: 0xff2e88, emissiveIntensity: 0.35,                                     // tinted canopy, faint magenta glow
  });
  const glowMat  = new THREE.MeshBasicMaterial({ color: 0xffcf4d, side: THREE.DoubleSide }); // afterburner core

  // Fuselage — tapered body, fatter at the tail
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 7, 14), bodyMat);
  fuselage.rotation.x = Math.PI / 2;
  plane.add(fuselage);

  // Nose cone
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.4, 14), bodyMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = 4.7;
  plane.add(nose);

  // Cockpit canopy — small + integrated near the nose (not a floating blob)
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    glassMat
  );
  canopy.position.set(0, 0.42, 2.0);
  canopy.scale.set(1, 0.85, 1.8);
  plane.add(canopy);

  // Delta wing — wide + thick enough to stay readable from the chase cam
  const wing = new THREE.Mesh(new THREE.BoxGeometry(13, 0.35, 3.6), bodyMat);
  wing.position.set(0, -0.15, -0.4);
  plane.add(wing);
  // Cyan leading-edge trim across the full span — this is what makes the wing pop
  const wingTrim = new THREE.Mesh(new THREE.BoxGeometry(13, 0.16, 0.5), trimMat);
  wingTrim.position.set(0, -0.02, 1.3);
  plane.add(wingTrim);

  // Twin canted tail fins — highly readable from behind
  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.7, 1.7), bodyMat);
    fin.position.set(side * 1.3, 0.75, -3.1);
    fin.rotation.z = side * 0.34;   // cant outward
    plane.add(fin);
    const finTrim = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.4, 0.16), trimMat);
    finTrim.position.set(side * 1.55, 0.95, -3.65);
    finTrim.rotation.z = side * 0.34;
    plane.add(finTrim);
  }

  // Horizontal stabilizers
  const hStab = new THREE.Mesh(new THREE.BoxGeometry(5, 0.18, 1.4), bodyMat);
  hStab.position.set(0, 0.05, -3.2);
  plane.add(hStab);

  // Afterburner nozzle — dark ring + emissive core; reads as a jet from the chase view
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.68, 0.9, 14), darkMat);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.z = -3.6;
  plane.add(nozzle);
  const burn = new THREE.Mesh(new THREE.CircleGeometry(0.46, 16), glowMat);
  burn.position.z = -4.05;
  plane.add(burn);

  plane.userData.isPlane = true;
  return plane;
}

export class PlaneController {
  constructor(plane) {
    this.plane = plane;
    // Physics state
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.speed = 80;           // current forward speed (units/s ~ "knots")
    this.throttle = 0.6;       // 0..1
    this.boosting = false;

    // Angular rates (rad/s)
    this.pitchRate = 0;
    this.yawRate = 0;
    this.rollRate = 0;

    // Tunables
    this.minSpeed = 30;
    this.maxSpeed = 240;
    this.boostSpeed = 320;
    this.throttleResponse = 1.0;
    this.turnAuthority = 1.9;   // bank→heading turn rate (was 1.6, hardcoded & dead; now wired + a bit faster)

    // Player control preferences (driven by the Settings menu).
    this.invertPitch = false;   // swap pitch-up / pitch-down
    this.sensitivity = 1;       // scales commanded roll/pitch/yaw rates
    this.levelAssist = 0.25;    // 0 = holds banks/pitch perfectly, 1 = today's aggressive auto-level

    this.alive = true;

    // Reusable scratch objects so update() allocates nothing per frame.
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._qPitch = new THREE.Quaternion();
    this._qYaw = new THREE.Quaternion();
    this._qRoll = new THREE.Quaternion();
    this._axisX = new THREE.Vector3(1, 0, 0);
    this._axisY = new THREE.Vector3(0, 1, 0);
    this._axisZ = new THREE.Vector3(0, 0, 1);
  }

  reset(pos) {
    this.plane.position.copy(pos);
    this.plane.quaternion.identity();
    this.velocity.set(0, 0, 0);
    this.speed = 80;
    this.throttle = 0.6;
    this.alive = true;
  }

  update(dt, input) {
    if (!this.alive) return;

    // ----- Throttle -----
    if (input.throttleUp)   this.throttle = Math.min(1, this.throttle + this.throttleResponse * dt);
    if (input.throttleDown) this.throttle = Math.max(0, this.throttle - this.throttleResponse * dt);
    this.boosting = input.boost;

    const targetSpeed = (this.boosting ? this.boostSpeed
                                       : this.minSpeed + (this.maxSpeed - this.minSpeed) * this.throttle);
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 1.6);

    // ----- Inputs -----
    const pitchSign = this.invertPitch ? -1 : 1;
    const tPitch = ((input.pitchUp ? 1 : 0) - (input.pitchDown ? 1 : 0)) * pitchSign;
    const tRoll  = (input.rollLeft ? 1 : 0) - (input.rollRight ? 1 : 0);
    const tYaw   = (input.yawLeft  ? 1 : 0) - (input.yawRight  ? 1 : 0);

    // Current orientation basis vectors (reuse scratch vectors)
    const right   = this._right.set(1,0,0).applyQuaternion(this.plane.quaternion);
    const forward = this._forward.set(0,0,1).applyQuaternion(this.plane.quaternion);

    // Bank angle: how much we're rolled. right.y > 0 = banked left.
    const bankSin = right.y;          // -1..1, sin of bank angle
    const noseUpSin = forward.y;      // -1..1, sin of pitch angle

    // ----- Rate targets (rad/s) -----
    // Player sensitivity scales the commanded rates (not the auto-level springs).
    const s = this.sensitivity;
    // Rolling is snappy (immediate feedback)
    const rollTarget = tRoll * 2.85 * s;
    // Pitch with comfortable rate
    const pitchTarget = tPitch * 1.4 * s;
    // Rudder yaw (Q/E) is gentle
    const yawTarget = tYaw * 0.8 * s;

    // Critical fix: when no roll input, auto-level the wings.
    // Spring-damp the bank angle back to zero.
    let rollCorrection = 0;
    if (tRoll === 0) {
      // Strong pull back to level when player isn't actively rolling
      rollCorrection = -bankSin * 3.0 * this.levelAssist;
    }

    // When no pitch input, very gently level pitch (so nose doesn't drift up/down forever)
    let pitchCorrection = 0;
    if (tPitch === 0) {
      pitchCorrection = -noseUpSin * 0.6 * this.levelAssist;
    }

    // Smooth rate (responsive but not jittery)
    this.rollRate  += ((rollTarget  + rollCorrection)  - this.rollRate)  * Math.min(1, dt * 12);
    this.pitchRate += ((pitchTarget + pitchCorrection) - this.pitchRate) * Math.min(1, dt * 8);
    this.yawRate   += (yawTarget - this.yawRate) * Math.min(1, dt * 6);

    // Apply rotations in local space (pitch X, yaw Y, roll Z)
    const qPitch = this._qPitch.setFromAxisAngle(this._axisX, this.pitchRate * dt);
    const qYaw   = this._qYaw.setFromAxisAngle(this._axisY, this.yawRate * dt);
    const qRoll  = this._qRoll.setFromAxisAngle(this._axisZ, this.rollRate * dt);
    this.plane.quaternion.multiply(qPitch).multiply(qYaw).multiply(qRoll);

    // Banking induces yaw — this is what makes A/D actually TURN the plane.
    // bankSin > 0 (banked left) → yaw left (positive rotateY in this convention)
    // Scaled by how level the nose is so it doesn't spin when pointing straight up/down.
    const turnFromBank = bankSin * this.turnAuthority * Math.max(0.3, 1 - Math.abs(noseUpSin));
    this.plane.rotateY(turnFromBank * dt);

    // Recompute forward after rotation
    const newForward = this._forward.set(0,0,1).applyQuaternion(this.plane.quaternion);
    this.velocity.copy(newForward).multiplyScalar(this.speed);
    this.plane.position.addScaledVector(this.velocity, dt);
  }

  // Public state for HUD
  getHeadingDeg() {
    const forward = this._forward.set(0, 0, 1).applyQuaternion(this.plane.quaternion);
    let deg = Math.atan2(forward.x, forward.z) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    return deg;
  }
  getAltitudeFt() { return Math.max(0, Math.round(this.plane.position.y * 3.28)); }
  getSpeedKts()   { return Math.round(this.speed); }
}

// =====================================================
// Input — keyboard
// =====================================================
export class Input {
  constructor() {
    this.keys = new Set();
    this.onPause = null;
    this.onCamera = null;
    this.onReset = null;
    this.onFire = null;
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'escape') { if (this.onPause) this.onPause(); return; }
      if (k === 'c')      { if (this.onCamera) this.onCamera(); return; }
      if (k === 'r')      { if (this.onReset) this.onReset(); return; }
      if (k === 'f')      { if (this.onFire) this.onFire(); return; }
      if (k === ' ')      { e.preventDefault(); this.keys.add(' '); return; }
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (e.key === ' ') this.keys.delete(' ');
    });
    window.addEventListener('blur', () => this.keys.clear());
  }
  read() {
    const k = this.keys;
    return {
      pitchUp:    k.has('s'),
      pitchDown:  k.has('w'),
      rollLeft:   k.has('a'),
      rollRight:  k.has('d'),
      yawLeft:    k.has('q'),
      yawRight:   k.has('e'),
      throttleUp:   k.has('shift'),
      throttleDown: k.has('control'),
      boost:      k.has(' '),
      fire:       k.has('f'),
    };
  }
}
