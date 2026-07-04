// =====================================================
// Sky Ace — sprite particle FX (explosions, muzzle, sparks, ring bursts, exhaust)
// Textures generated with Higgsfield (soft shapes on black -> additive glow).
// =====================================================

import * as THREE from 'three';

const KINDS = {
  fire:  { src: 'assets/img/fx/fire.jpg',  additive: true  },
  smoke: { src: 'assets/img/fx/smoke.png', additive: false },
  spark: { src: 'assets/img/fx/spark.jpg', additive: true  },
  flare: { src: 'assets/img/fx/flare.jpg', additive: true  },
  ring:  { src: 'assets/img/fx/ring.jpg',  additive: true  },
};

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    scene.add(this.group);
    this.particles = [];
    const loader = new THREE.TextureLoader();
    this.mats = {};
    for (const [k, def] of Object.entries(KINDS)) {
      const t = loader.load(def.src);
      t.colorSpace = THREE.SRGBColorSpace;
      this.mats[k] = new THREE.SpriteMaterial({
        map: t,
        transparent: true,
        depthWrite: false,
        blending: def.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
    }
  }

  _spawn(kind, pos, o = {}) {
    const base = this.mats[kind];
    if (!base) return;
    const mat = base.clone();
    if (o.color) mat.color = new THREE.Color(o.color);
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    const scale = o.scale || 10;
    s.scale.setScalar(scale);
    mat.opacity = o.opacity != null ? o.opacity : 1;
    s.renderOrder = 4;
    this.group.add(s);
    this.particles.push({
      sprite: s,
      vel: o.vel ? o.vel.clone() : new THREE.Vector3(),
      grav: o.grav || 0,
      life: 0,
      maxLife: o.maxLife || 0.8,
      startScale: scale,
      grow: o.grow != null ? o.grow : 1.5,
      drag: o.drag != null ? o.drag : 0.9,
      opacity: mat.opacity,
      fadePow: o.fadePow || 1,
      spin: o.spin || 0,
    });
  }

  explosion(pos, size = 1) {
    this._spawn('flare', pos, { scale: 16 * size, maxLife: 0.28, grow: 2.2, opacity: 0.8 });
    for (let i = 0; i < 4; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6 + 0.2, Math.random() - 0.5).multiplyScalar(20 * size);
      this._spawn('fire', pos, { scale: (13 + Math.random() * 8) * size, vel: v, maxLife: 0.5 + Math.random() * 0.25, grow: 1.9, drag: 0.85, opacity: 0.92 });
    }
    for (let i = 0; i < 4; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.5 + 0.15, Math.random() - 0.5).multiplyScalar(11 * size);
      this._spawn('smoke', pos, { scale: (18 + Math.random() * 12) * size, vel: v, grav: 5, maxLife: 1.2 + Math.random() * 0.6, grow: 2.6, drag: 0.92, opacity: 0.85 });
    }
    for (let i = 0; i < 12; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.25, Math.random() - 0.5).normalize().multiplyScalar((22 + Math.random() * 34) * size);
      this._spawn('spark', pos, { scale: (4 + Math.random() * 4) * size, vel: v, grav: -28, maxLife: 0.4 + Math.random() * 0.45, grow: 0.5, drag: 0.9 });
    }
  }

  muzzle(pos, dir) {
    this._spawn('flare', pos, { scale: 8, maxLife: 0.1, grow: 1.4 });
    const v = dir ? dir.clone().multiplyScalar(40) : new THREE.Vector3();
    this._spawn('spark', pos, { scale: 6, maxLife: 0.14, grow: 0.6, vel: v, drag: 0.8 });
  }

  ringBurst(pos, color = 0x00ff88) {
    this._spawn('ring', pos, { scale: 24, maxLife: 0.55, grow: 5.5, color, fadePow: 1.6 });
    this._spawn('flare', pos, { scale: 18, maxLife: 0.3, grow: 1.8, color });
  }

  // Layered afterburner plume.  intensity=0..1 (default 1) lets game.js
  // emit faintly at low throttle and skip entirely at 0.
  // 3 sprites per call; keep call frequency LOW in game.js (every 2-3 frames).
  exhaust(pos, back, intensity = 1.0) {
    if (intensity <= 0) return;
    const i = Math.min(intensity, 1.0);
    // Hot centre: gold #ffcf4d — small, bright
    this._spawn('flare', pos, { scale: 4 * i,  maxLife: 0.18, grow: 1.8, opacity: 0.70 * i, vel: back, color: 0xffcf4d });
    // Core:        cyan #00ffd5 — medium
    this._spawn('flare', pos, { scale: 7 * i,  maxLife: 0.26, grow: 2.2, opacity: 0.48 * i, vel: back, color: 0x00ffd5 });
    // Fringe:      magenta #ff2e88 — largest, faintest
    this._spawn('flare', pos, { scale: 11 * i, maxLife: 0.36, grow: 2.8, opacity: 0.28 * i, vel: back, color: 0xff2e88 });
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      const t = p.life / p.maxLife;
      if (t >= 1) {
        this.group.remove(p.sprite);
        p.sprite.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y += p.grav * dt;
      p.vel.multiplyScalar(Math.pow(p.drag, dt * 60));
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.scale.setScalar(p.startScale * (1 + (p.grow - 1) * t));
      p.sprite.material.opacity = p.opacity * Math.pow(1 - t, p.fadePow);
      if (p.spin) p.sprite.material.rotation += p.spin * dt;
    }
  }
}

// =====================================================
// Trail — wingtip light ribbon
// Fixed-length ring-buffer Mesh: cyan #00ffd5 (newest) → purple #b14bff (oldest).
// Additive MeshBasicMaterial, depthWrite:false.  ZERO per-frame allocations.
//
// API:
//   new Trail(scene)          — creates mesh, adds to scene
//   trail.push(pos)           — record next Vector3 position (copies components)
//   trail.update()            — rewrites BufferAttribute IN PLACE + setDrawRange
//   trail.dispose()           — removes mesh, disposes geometry + material
//   trail.setWidth(w)         — adjust ribbon half-width (default 3)
//   trail.visible             — forwards to mesh.visible (reduced-motion gate)
// =====================================================
export class Trail {
  constructor(scene, segments = 48) {
    this._N = segments;
    this._head = 0;      // next write slot
    this._count = 0;     // number of valid slots (0..N)

    // Ring-buffer position storage — pre-allocated Float32 arrays, no per-frame alloc
    this._px = new Float32Array(this._N);
    this._py = new Float32Array(this._N);
    this._pz = new Float32Array(this._N);

    this._w = 3.0; // ribbon half-width (world units)

    // Pre-allocate geometry: 2 vertices per segment (top/bottom edge of ribbon)
    const vCount = this._N * 2;
    const posData = new Float32Array(vCount * 3);
    const colData = new Float32Array(vCount * 3);

    // Pre-build index buffer for triangle strip (never changes)
    // Each segment i: two CCW triangles connecting verts (2i, 2i+1, 2i+2, 2i+3)
    const idxData = new Uint16Array((this._N - 1) * 6);
    for (let i = 0; i < this._N - 1; i++) {
      const b = i * 6, v = i * 2;
      idxData[b + 0] = v;     idxData[b + 1] = v + 1; idxData[b + 2] = v + 2;
      idxData[b + 3] = v + 1; idxData[b + 4] = v + 3; idxData[b + 5] = v + 2;
    }

    const geo = new THREE.BufferGeometry();
    this._posAttr = new THREE.BufferAttribute(posData, 3);
    this._colAttr = new THREE.BufferAttribute(colData, 3);
    this._posAttr.usage = THREE.DynamicDrawUsage;
    this._colAttr.usage = THREE.DynamicDrawUsage;
    geo.setAttribute('position', this._posAttr);
    geo.setAttribute('color',    this._colAttr);
    geo.setIndex(new THREE.BufferAttribute(idxData, 1));
    geo.setDrawRange(0, 0); // nothing visible until push() + update()

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      blending:     THREE.AdditiveBlending,
      depthWrite:   false,
      transparent:  true,
      side:         THREE.DoubleSide,
    });

    this._mesh = new THREE.Mesh(geo, mat);
    this._mesh.frustumCulled = false;
    scene.add(this._mesh);

    // Scratch Color — reused every update(), no per-frame alloc
    this._cCyan   = new THREE.Color(0x00ffd5);
    this._cPurple = new THREE.Color(0xb14bff);
    this._cScratch = new THREE.Color();
  }

  get visible() { return this._mesh.visible; }
  set visible(v) { this._mesh.visible = v; }

  setWidth(w) { this._w = w; }

  // Record the next position (copies xyz; no Vector3 alloc)
  push(pos) {
    this._px[this._head] = pos.x;
    this._py[this._head] = pos.y;
    this._pz[this._head] = pos.z;
    this._head = (this._head + 1) % this._N;
    if (this._count < this._N) this._count++;
  }

  // Rewrite the existing BufferAttributes in place; called once per simulate() tick
  update() {
    const n = this._count;
    if (n < 2) { this._mesh.geometry.setDrawRange(0, 0); return; }

    const N  = this._N;
    const pa = this._posAttr;
    const ca = this._colAttr;
    const w  = this._w;

    for (let i = 0; i < n; i++) {
      // Oldest point at i=0, newest at i=n-1
      const ri = (this._head - n + i + N) % N;
      const x = this._px[ri], y = this._py[ri], z = this._pz[ri];
      const vi = i * 2;

      // Ribbon: offset top/bottom verts in world Y (simple horizontal ribbon)
      pa.setXYZ(vi,     x, y + w, z);
      pa.setXYZ(vi + 1, x, y - w, z);

      // Color: purple (oldest) → cyan (newest); alpha baked into brightness for additive blend
      const t = i / (n - 1); // 0=oldest, 1=newest
      this._cScratch.lerpColors(this._cPurple, this._cCyan, t);
      const bright = t * 0.9 + 0.05; // fade tail toward black (additive → invisible)
      ca.setXYZ(vi,     this._cScratch.r * bright, this._cScratch.g * bright, this._cScratch.b * bright);
      ca.setXYZ(vi + 1, this._cScratch.r * bright, this._cScratch.g * bright, this._cScratch.b * bright);
    }

    pa.needsUpdate = true;
    ca.needsUpdate = true;
    // Draw (n-1) segments = (n-1)*2 triangles = (n-1)*6 indices
    this._mesh.geometry.setDrawRange(0, (n - 1) * 6);
  }

  dispose() {
    this._mesh.geometry.dispose();
    this._mesh.material.dispose();
    if (this._mesh.parent) this._mesh.parent.remove(this._mesh);
  }
}
