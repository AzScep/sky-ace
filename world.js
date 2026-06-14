// =====================================================
// World — NEON SYNTHWAVE / OUTRUN restyle
// Dusk-gradient sky · banded retro sun · dark terrain with a
// glowing cyan wireframe grid · star/haze field · neon markers.
// Palette: #1a0b2e #ff2e88 #b14bff #00ffd5 #ffcf4d
// =====================================================

import * as THREE from 'three';

export const WORLD_SIZE = 8000;

// ----- shared neon palette -----
export const NEON = {
  skyTop:  0x1a0b2e,
  skyHorizon: 0xff2e88,
  violet:  0xb14bff,
  magenta: 0xff2e88,
  cyan:    0x00ffd5,
  sun:     0xffcf4d,
};

// Deterministic value-noise for terrain
function hash(x, y) {
  const h = Math.sin(x * 374.7 + y * 921.3) * 43758.5453;
  return h - Math.floor(h);
}
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { return t * t * (3 - 2 * t); }
function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = smooth(xf), v = smooth(yf);
  return lerp(
    lerp(hash(xi, yi),     hash(xi+1, yi),   u),
    lerp(hash(xi, yi+1),   hash(xi+1, yi+1), u),
    v
  );
}
function fbm(x, y, octaves = 4) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum  += amp * noise2(x * freq, y * freq);
    norm += amp;
    amp  *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export function terrainHeight(x, z) {
  const s = 0.0007;
  let h = fbm(x * s, z * s, 5);
  // Add a ridge feature for canyons
  const ridge = 1 - Math.abs(noise2(x * 0.0015, z * 0.0015) - 0.5) * 2;
  h = h * 0.7 + ridge * 0.3;
  // Sink near origin so we always have a flat-ish takeoff bowl
  const distFromOrigin = Math.sqrt(x * x + z * z);
  const bowl = Math.max(0, 1 - distFromOrigin / 1200);
  h -= bowl * 0.5;
  return h * 800 - 100;  // -100 to ~700
}

export function buildWorld(scene) {
  // ----- SKY: vertical dusk gradient + faint star speckle -----
  const skyGeo = new THREE.SphereGeometry(WORLD_SIZE * 1.2, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor:     { value: new THREE.Color(NEON.skyTop) },
      midColor:     { value: new THREE.Color(NEON.violet) },
      horizonColor: { value: new THREE.Color(NEON.skyHorizon) },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 horizonColor;
      varying vec3 vWorldPos;
      // cheap hash for high-altitude star/haze speckle
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 dir = normalize(vWorldPos);
        float h = dir.y;
        // Dusk band: pink horizon -> violet -> deep purple top.
        vec3 col = mix(horizonColor, midColor, smoothstep(0.0, 0.28, h));
        col = mix(col, topColor, smoothstep(0.18, 0.75, h));
        // Subtle haze speckle high in the sky (extra twinkle under bloom).
        if (h > 0.15) {
          vec2 cell = floor(dir.xz * 220.0);
          float s = hash(cell);
          float tw = step(0.9975, s) * smoothstep(0.15, 0.5, h);
          col += vec3(0.6, 0.8, 1.0) * tw;
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // ----- STAR / HAZE FIELD (real Points object, blooms to a soft twinkle) -----
  const STAR_COUNT = 900;
  const starPos = new Float32Array(STAR_COUNT * 3);
  const starCol = new Float32Array(STAR_COUNT * 3);
  const cWhite = new THREE.Color(0xffffff);
  const cCyan = new THREE.Color(NEON.cyan);
  const cViolet = new THREE.Color(NEON.violet);
  const R = WORLD_SIZE * 1.05;
  for (let i = 0; i < STAR_COUNT; i++) {
    // Upper hemisphere bias so stars sit "up high".
    const u = Math.random();
    const v = 0.12 + Math.random() * 0.88;          // y in upper band
    const theta = u * Math.PI * 2;
    const y = v;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    starPos[i*3]   = Math.cos(theta) * r * R;
    starPos[i*3+1] = y * R;
    starPos[i*3+2] = Math.sin(theta) * r * R;
    const pick = Math.random();
    const c = pick < 0.7 ? cWhite : (pick < 0.88 ? cCyan : cViolet);
    starCol[i*3] = c.r; starCol[i*3+1] = c.g; starCol[i*3+2] = c.b;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    size: 22, sizeAttenuation: true, vertexColors: true,
    transparent: true, opacity: 0.95, fog: false, depthWrite: false,
  }));
  stars.frustumCulled = false;
  scene.add(stars);

  // ----- RETRO SUN: banded disc on the horizon -----
  const sunGeo = new THREE.CircleGeometry(900, 64);
  const sunMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(NEON.sun) },
      botColor: { value: new THREE.Color(NEON.magenta) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 botColor;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;        // -1..1 disc space
        float r = length(p);
        if (r > 1.0) discard;            // circular disc
        // vertical gold->magenta gradient
        vec3 col = mix(botColor, topColor, smoothstep(-1.0, 1.0, p.y));
        // retro horizontal scan bands carved out of the lower half
        float band = smoothstep(0.04, 0.08, abs(fract(p.y * 7.0) - 0.5));
        float cut = mix(1.0, band, smoothstep(0.35, -0.1, p.y));
        float alpha = cut * smoothstep(1.0, 0.82, r);
        // boost brightness so bloom flares the rim
        col *= 1.25;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
  const sun = new THREE.Mesh(sunGeo, sunMat);
  sun.position.set(2400, 360, -5600);
  sun.frustumCulled = false;
  scene.add(sun);

  // ----- LIGHTING (light touch — most surfaces are emissive/basic) -----
  const ambient = new THREE.AmbientLight(0x6a4a8a, 0.7);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffb0e0, 0.8);
  dir.position.copy(sun.position);
  scene.add(dir);
  const hemi = new THREE.HemisphereLight(0xff5fa2, 0x140826, 0.5);
  scene.add(hemi);

  // ----- TERRAIN: dark emissive base (no realtime shading) -----
  const segs = 150;
  const terrainGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segs, segs);
  terrainGeo.rotateX(-Math.PI / 2);
  const pos = terrainGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cLow  = new THREE.Color(0x0c0420);   // valleys — near black violet
  const cMid  = new THREE.Color(0x1a0b34);   // slopes
  const cHigh = new THREE.Color(0x3a0f55);   // peaks — magenta-violet
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    const t = Math.min(1, Math.max(0, (h + 100) / 800));
    if (t < 0.5) tmp.copy(cLow).lerp(cMid, t / 0.5);
    else         tmp.copy(cMid).lerp(cHigh, (t - 0.5) / 0.5);
    colors[i*3]   = tmp.r;
    colors[i*3+1] = tmp.g;
    colors[i*3+2] = tmp.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
  const terrainMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  scene.add(terrain);

  // ----- GLOWING CYAN WIREFRAME GRID (the OUTRUN signature) -----
  // A coarse heightfield grid laid over the terrain; emissive lines that bloom.
  const gridLines = buildGridLines();
  scene.add(gridLines);

  // ----- WATER: dark neon pool -----
  const waterGeo = new THREE.PlaneGeometry(WORLD_SIZE * 1.1, WORLD_SIZE * 1.1);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshBasicMaterial({
    color: 0x12063a, transparent: true, opacity: 0.85,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = -52;
  scene.add(water);

  // ----- CLOUDS → violet haze banks -----
  const cloudMat = new THREE.MeshBasicMaterial({
    color: 0x4a1f6e, transparent: true, opacity: 0.32, depthWrite: false,
  });
  const cloudPuffs = [];
  for (let i = 0; i < 50; i++) {
    const cx = (Math.random() - 0.5) * WORLD_SIZE * 0.9;
    const cy = 700 + Math.random() * 500;
    const cz = (Math.random() - 0.5) * WORLD_SIZE * 0.9;
    const count = 3 + Math.floor(Math.random() * 4);
    for (let j = 0; j < count; j++) {
      const r = 40 + Math.random() * 60;
      cloudPuffs.push({
        x: cx + (Math.random() - 0.5) * 120,
        y: cy + (Math.random() - 0.5) * 30 * 0.4,
        z: cz + (Math.random() - 0.5) * 120,
        r,
      });
    }
  }
  const clouds = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 6, 5), cloudMat, cloudPuffs.length
  );
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    cloudPuffs.forEach((c, i) => {
      p.set(c.x, c.y, c.z);
      s.set(c.r, c.r * 0.4, c.r);
      m.compose(p, q, s);
      clouds.setMatrixAt(i, m);
    });
    clouds.instanceMatrix.needsUpdate = true;
  }
  clouds.frustumCulled = false;
  scene.add(clouds);

  // ----- FOG: deep violet so distant grid melts into the dusk -----
  scene.fog = new THREE.Fog(0x2a0b40, 1600, 6800);

  // ----- TREES → dark neon-tipped silhouettes (instanced) -----
  const trunkMat = new THREE.MeshBasicMaterial({ color: 0x0a0416 });
  const leavesMat = new THREE.MeshBasicMaterial({ color: 0x180a2e });
  const trunkGeo = new THREE.CylinderGeometry(1.5, 2, 8, 5);
  const leavesGeo = new THREE.ConeGeometry(8, 22, 6);

  const treeData = [];
  for (let i = 0; i < 700; i++) {
    const x = (Math.random() - 0.5) * WORLD_SIZE * 0.85;
    const z = (Math.random() - 0.5) * WORLD_SIZE * 0.85;
    const h = terrainHeight(x, z);
    if (h < 20 || h > 380) continue;
    treeData.push({ x, z, h, scale: 0.8 + Math.random() * 1.3, rot: Math.random() * Math.PI * 2 });
  }

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeData.length);
  const leaves = new THREE.InstancedMesh(leavesGeo, leavesMat, treeData.length);
  {
    const groupM = new THREE.Matrix4();
    const localM = new THREE.Matrix4();
    const outM = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const scl = new THREE.Vector3();
    treeData.forEach((t, i) => {
      q.setFromAxisAngle(up, t.rot);
      p.set(t.x, t.h, t.z);
      scl.set(t.scale, t.scale, t.scale);
      groupM.compose(p, q, scl);
      outM.multiplyMatrices(groupM, localM.makeTranslation(0, 4, 0));
      trunks.setMatrixAt(i, outM);
      outM.multiplyMatrices(groupM, localM.makeTranslation(0, 18, 0));
      leaves.setMatrixAt(i, outM);
    });
    trunks.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
  }
  const trees = new THREE.Group();
  trees.add(trunks, leaves);
  scene.add(trees);

  return { terrain, gridLines, water, clouds, sky, sun, stars };
}

// Build a glowing cyan heightfield grid across the flyable area.
function buildGridLines() {
  const half = WORLD_SIZE * 0.46;
  const div = 60;                 // grid cells per axis
  const step = (half * 2) / div;
  const verts = [];
  const lift = 3;                 // sit just above terrain to avoid z-fighting
  // Lines running along Z (constant X)
  for (let i = 0; i <= div; i++) {
    const x = -half + i * step;
    for (let j = 0; j < div; j++) {
      const z0 = -half + j * step;
      const z1 = z0 + step;
      verts.push(x, terrainHeight(x, z0) + lift, z0,
                 x, terrainHeight(x, z1) + lift, z1);
    }
  }
  // Lines running along X (constant Z)
  for (let j = 0; j <= div; j++) {
    const z = -half + j * step;
    for (let i = 0; i < div; i++) {
      const x0 = -half + i * step;
      const x1 = x0 + step;
      verts.push(x0, terrainHeight(x0, z) + lift, z,
                 x1, terrainHeight(x1, z) + lift, z);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const mat = new THREE.LineBasicMaterial({
    color: NEON.cyan, transparent: true, opacity: 0.6, fog: true,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  return lines;
}

// ----- Mission marker (neon pillar of light) -----
export function createMissionMarker(color = NEON.cyan) {
  const group = new THREE.Group();

  // Additive cylinder of light — reads as pure light under bloom.
  const beamGeo = new THREE.CylinderGeometry(34, 44, 640, 18, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.32, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = 320;
  group.add(beam);
  group.userData.beam = beam;

  // Bright rotating ring at the base
  const ringGeo = new THREE.TorusGeometry(64, 4, 10, 36);
  const ringMat = new THREE.MeshBasicMaterial({ color, fog: false });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 6;
  group.add(ring);
  group.userData.ring = ring;

  // Second, larger halo ring for a layered neon look
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(96, 2, 8, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, fog: false })
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 6;
  group.add(halo);
  group.userData.halo = halo;

  group.userData.color = color;
  group.userData.radius = 90;
  return group;
}
