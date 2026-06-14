// =====================================================
// Plane — model, controls, arcade physics
// =====================================================

import * as THREE from 'three';

export function createPlane() {
  const plane = new THREE.Group();

  // Neon-jet palette: dark airframe with self-lit cyan trim + magenta canopy
  // so the plane reads as pure light under the bloom pass.
  const bodyMat = new THREE.MeshPhongMaterial({ color: 0x1b1140, emissive: 0x0a0820, shininess: 80 });
  const accentMat = new THREE.MeshBasicMaterial({ color: 0x00ffd5 });           // glowing cyan trim
  const darkMat = new THREE.MeshPhongMaterial({ color: 0x0d0a22 });
  const glassMat = new THREE.MeshBasicMaterial({
    color: 0xff2e88, transparent: true, opacity: 0.7,                            // magenta canopy glow
  });

  // Fuselage
  const fuselage = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 0.6, 9, 12),
    bodyMat
  );
  fuselage.rotation.x = Math.PI / 2;
  plane.add(fuselage);

  // Nose cone
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2, 12), bodyMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = 5.5;
  plane.add(nose);

  // Cockpit canopy
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    glassMat
  );
  canopy.position.set(0, 0.5, 1.8);
  canopy.scale.set(1, 1, 2.2);
  plane.add(canopy);

  // Main wings
  const wingGeo = new THREE.BoxGeometry(11, 0.2, 2.2);
  const wing = new THREE.Mesh(wingGeo, bodyMat);
  wing.position.y = -0.1;
  plane.add(wing);

  // Wing accent stripes
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(11, 0.22, 0.4), accentMat);
  stripe.position.set(0, -0.09, 0.8);
  plane.add(stripe);

  // Tail vertical fin
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, 1.6), bodyMat);
  fin.position.set(0, 0.8, -4);
  plane.add(fin);

  // Tail horizontal
  const hStab = new THREE.Mesh(new THREE.BoxGeometry(4, 0.15, 1.2), bodyMat);
  hStab.position.set(0, 0.1, -4);
  plane.add(hStab);

  // Engine pods on wings
  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 2, 8), darkMat);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(side * 2.8, -0.3, 0.5);
    plane.add(pod);

    // Propeller disc (visual blur)
    const propDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 16),
      new THREE.MeshBasicMaterial({
        color: 0xcccccc, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
      })
    );
    propDisc.position.set(side * 2.8, -0.3, 1.6);
    plane.add(propDisc);
    plane.userData[side === -1 ? 'propL' : 'propR'] = propDisc;
  }

  // Bottom landing skids
  const skidMat = new THREE.MeshPhongMaterial({ color: 0x444444 });
  for (const side of [-1, 1]) {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 1.5), skidMat);
    skid.position.set(side * 0.8, -1, 0);
    plane.add(skid);
  }

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
    this.throttleResponse = 0.4;
    this.turnAuthority = 1.6;

    // Player control preferences (driven by the Settings menu).
    this.invertPitch = false;   // swap pitch-up / pitch-down
    this.sensitivity = 1;       // scales commanded roll/pitch/yaw rates

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
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 0.8);

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
    const rollTarget = tRoll * 2.6 * s;
    // Pitch with comfortable rate
    const pitchTarget = tPitch * 1.4 * s;
    // Rudder yaw (Q/E) is gentle
    const yawTarget = tYaw * 0.8 * s;

    // Critical fix: when no roll input, auto-level the wings.
    // Spring-damp the bank angle back to zero.
    let rollCorrection = 0;
    if (tRoll === 0) {
      // Strong pull back to level when player isn't actively rolling
      rollCorrection = -bankSin * 3.0;
    }

    // When no pitch input, very gently level pitch (so nose doesn't drift up/down forever)
    let pitchCorrection = 0;
    if (tPitch === 0) {
      pitchCorrection = -noseUpSin * 0.6;
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
    const turnFromBank = bankSin * 1.6 * Math.max(0.3, 1 - Math.abs(noseUpSin));
    this.plane.rotateY(turnFromBank * dt);

    // Recompute forward after rotation
    const newForward = this._forward.set(0,0,1).applyQuaternion(this.plane.quaternion);
    this.velocity.copy(newForward).multiplyScalar(this.speed);
    this.plane.position.addScaledVector(this.velocity, dt);

    // Propeller spin visuals
    const spin = (this.throttle * 30 + (this.boosting ? 20 : 0)) * dt;
    if (this.plane.userData.propL) this.plane.userData.propL.rotation.z += spin;
    if (this.plane.userData.propR) this.plane.userData.propR.rotation.z += spin;
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
