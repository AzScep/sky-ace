// =====================================================
// Ambient air traffic — low-poly aircraft that wander the sky so the world
// reads as *alive*. One InstancedMesh (1 draw call) for the whole flock; every
// craft banks into its turns and noses along its velocity. Zero per-frame
// allocation (all scratch objects live on the instance). They never crash —
// they're ambient — so they stay clamped inside bounds and above the terrain.
//
// Exposes `this.craft` (each with `.position` + a `.buzzedAt` cooldown field) for
// the radar and for the Task-6 buzz verb.
// =====================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD_SIZE, terrainHeight } from './world.js?v=12';

const BOUND = WORLD_SIZE * 0.42;             // same flyable box the courses use
const ALT_MIN = 180, ALT_SPAN = 720;         // cruise 180..900 above terrain
const CRUISE_MIN = 60, CRUISE_SPAN = 80;     // speed 60..140 u/s
// Craft tints from the locked NEON palette (world.js) — cyan / violet / gold / pink.
const TINTS = [0x00ffd5, 0xb14bff, 0xffcf4d, 0xff2e88];

// One shared low-poly aircraft silhouette (fuselage + wings + tail), nose on +Z.
function buildCraftGeometry() {
  const fuselage = new THREE.ConeGeometry(1.8, 16, 6);
  fuselage.rotateX(Math.PI / 2);             // cone points +Y by default → aim it +Z
  const wing = new THREE.BoxGeometry(20, 0.8, 4);
  wing.translate(0, 0, -1);
  const tail = new THREE.BoxGeometry(7, 0.8, 2.5);
  tail.translate(0, 1.6, -7);
  const merged = mergeGeometries([fuselage, wing, tail]);
  fuselage.dispose(); wing.dispose(); tail.dispose();
  return merged;
}

export class Traffic {
  constructor(scene, opts = {}) {
    this.scene = scene;
    const count = opts.count ?? 6;

    this.geo = buildCraftGeometry();
    this.mat = new THREE.MeshLambertMaterial({});   // lit by the scene sun/ambient
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, count);
    this.mesh.frustumCulled = false;                // instances roam the whole map
    scene.add(this.mesh);

    // ---- per-frame scratch (never reallocated) ----
    this._m = new THREE.Matrix4();
    this._scale = new THREE.Vector3(1, 1, 1);
    this._up = new THREE.Vector3(0, 1, 0);
    this._zero = new THREE.Vector3(0, 0, 0);
    this._zAxis = new THREE.Vector3(0, 0, 1);
    this._toTarget = new THREE.Vector3();
    this._negDir = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._lookM = new THREE.Matrix4();
    this._desiredQ = new THREE.Quaternion();
    this._rollQ = new THREE.Quaternion();

    this.craft = [];
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const c = {
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        target: new THREE.Vector3(),
        speed: CRUISE_MIN + Math.random() * CRUISE_SPAN,
        retarget: 0,
        buzzedAt: -Infinity,        // last buzz time (seconds) — Task-6 per-craft cooldown
      };
      this._spawn(c);
      this._pickTarget(c);
      // Face the first target immediately so nothing spawns flying backwards.
      this._toTarget.copy(c.target).sub(c.position).normalize();
      this._negDir.copy(this._toTarget).multiplyScalar(-1);
      this._lookM.lookAt(this._zero, this._negDir, this._up);
      c.quaternion.setFromRotationMatrix(this._lookM);
      this.craft.push(c);
      this.mesh.setColorAt(i, color.setHex(TINTS[i % TINTS.length]));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this._writeMatrices();
  }

  _rand(range) { return (Math.random() * 2 - 1) * range; }

  _altAt(x, z) { return terrainHeight(x, z) + ALT_MIN + Math.random() * ALT_SPAN; }

  _spawn(c) {
    c.position.set(this._rand(BOUND), 0, this._rand(BOUND));
    c.position.y = this._altAt(c.position.x, c.position.z);
  }

  _pickTarget(c) {
    c.target.set(this._rand(BOUND), 0, this._rand(BOUND));
    c.target.y = this._altAt(c.target.x, c.target.z);
    c.retarget = 8 + Math.random() * 6;   // 8..14 s
  }

  // Advance the flock one step. playerPos is accepted for future LOD/culling; the
  // craft themselves wander independently.
  update(dt /* , playerPos */) {
    for (let i = 0; i < this.craft.length; i++) {
      const c = this.craft[i];
      c.retarget -= dt;

      this._toTarget.copy(c.target).sub(c.position);
      if (this._toTarget.length() < 120 || c.retarget <= 0) {
        this._pickTarget(c);
        this._toTarget.copy(c.target).sub(c.position);
      }
      this._toTarget.normalize();                       // desired forward direction

      // Desired orientation: nose (+Z) along toTarget. Matrix4.lookAt points -Z at
      // its target, so aim it at -toTarget to put +Z along +toTarget.
      this._negDir.copy(this._toTarget).multiplyScalar(-1);
      this._lookM.lookAt(this._zero, this._negDir, this._up);
      this._desiredQ.setFromRotationMatrix(this._lookM);

      // Bank into the turn: roll about the nose axis, proportional to how sharply the
      // current heading differs from the desired one (signed, horizontal plane).
      this._fwd.set(0, 0, 1).applyQuaternion(c.quaternion);
      const turn = this._fwd.x * this._toTarget.z - this._fwd.z * this._toTarget.x;
      const bank = THREE.MathUtils.clamp(turn * 2.2, -0.6, 0.6);
      this._rollQ.setFromAxisAngle(this._zAxis, bank);
      this._desiredQ.multiply(this._rollQ);             // roll leaves +Z fixed → travel unaffected

      // Smoothly slew toward the banked target orientation (no accumulation drift —
      // desiredQ is recomputed fresh each frame).
      c.quaternion.slerp(this._desiredQ, Math.min(1, dt * 1.2));

      // Fly along the nose.
      this._fwd.set(0, 0, 1).applyQuaternion(c.quaternion);
      c.position.addScaledVector(this._fwd, c.speed * dt);

      // Ambient craft never crash — clamp inside bounds, hold above the terrain.
      c.position.x = Math.max(-BOUND, Math.min(BOUND, c.position.x));
      c.position.z = Math.max(-BOUND, Math.min(BOUND, c.position.z));
      const minY = terrainHeight(c.position.x, c.position.z) + 120;
      if (c.position.y < minY) c.position.y = minY;
    }
    this._writeMatrices();
  }

  _writeMatrices() {
    for (let i = 0; i < this.craft.length; i++) {
      const c = this.craft[i];
      this._m.compose(c.position, c.quaternion, this._scale);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}
