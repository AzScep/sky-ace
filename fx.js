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

  exhaust(pos, back) {
    this._spawn('flare', pos, { scale: 4, maxLife: 0.45, grow: 2.4, opacity: 0.45, vel: back, color: 0x9fd8ff });
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
