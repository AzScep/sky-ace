// =====================================================
// World — terrain, sky, water, clouds, mission markers
// =====================================================

import * as THREE from 'three';

export const WORLD_SIZE = 8000;

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
  // ----- SKY -----
  const skyGeo = new THREE.SphereGeometry(WORLD_SIZE * 1.2, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor:    { value: new THREE.Color(0x0a3a6b) },
      midColor:    { value: new THREE.Color(0x4a8fc7) },
      botColor:    { value: new THREE.Color(0xf8c878) },
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
      uniform vec3 botColor;
      varying vec3 vWorldPos;
      void main() {
        float h = normalize(vWorldPos).y;
        vec3 col;
        if (h > 0.0) col = mix(midColor, topColor, smoothstep(0.0, 0.6, h));
        else         col = mix(midColor, botColor, smoothstep(0.0, -0.2, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // ----- SUN -----
  const sunGeo = new THREE.SphereGeometry(120, 16, 16);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });
  const sun = new THREE.Mesh(sunGeo, sunMat);
  sun.position.set(2000, 1400, -2500);
  scene.add(sun);

  // ----- LIGHTING -----
  const ambient = new THREE.AmbientLight(0xb0c8e0, 0.55);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xfff0d8, 1.1);
  dir.position.copy(sun.position);
  scene.add(dir);
  const hemi = new THREE.HemisphereLight(0x88aacc, 0x3a5a3a, 0.4);
  scene.add(hemi);

  // ----- TERRAIN -----
  const segs = 220;
  const terrainGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segs, segs);
  terrainGeo.rotateX(-Math.PI / 2);
  const pos = terrainGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    // Vertex color by elevation
    let r, g, b;
    if (h < 0)        { r = 0.18; g = 0.32; b = 0.45; } // beach/shallow
    else if (h < 100) { r = 0.55; g = 0.62; b = 0.35; } // grassland
    else if (h < 300) { r = 0.30; g = 0.45; b = 0.22; } // forest
    else if (h < 500) { r = 0.45; g = 0.42; b = 0.35; } // rocky
    else              { r = 0.85; g = 0.86; b = 0.92; } // snow
    colors[i*3]   = r;
    colors[i*3+1] = g;
    colors[i*3+2] = b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
  const terrainMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
  });
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ----- WATER PLANE -----
  const waterGeo = new THREE.PlaneGeometry(WORLD_SIZE * 1.1, WORLD_SIZE * 1.1);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshLambertMaterial({
    color: 0x1d6fa5,
    transparent: true,
    opacity: 0.75,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = -50;
  scene.add(water);

  // ----- CLOUDS -----
  const clouds = new THREE.Group();
  const cloudMat = new THREE.MeshLambertMaterial({
    color: 0xffffff, transparent: true, opacity: 0.85,
  });
  for (let i = 0; i < 60; i++) {
    const cloud = new THREE.Group();
    const count = 3 + Math.floor(Math.random() * 4);
    for (let j = 0; j < count; j++) {
      const r = 40 + Math.random() * 60;
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 5), cloudMat);
      s.position.set((Math.random()-0.5)*120, (Math.random()-0.5)*30, (Math.random()-0.5)*120);
      cloud.add(s);
    }
    cloud.position.set(
      (Math.random() - 0.5) * WORLD_SIZE * 0.9,
      600 + Math.random() * 500,
      (Math.random() - 0.5) * WORLD_SIZE * 0.9
    );
    cloud.scale.y = 0.4;
    clouds.add(cloud);
  }
  scene.add(clouds);

  // ----- FOG -----
  scene.fog = new THREE.Fog(0x88a8c8, 1500, 6500);

  // ----- SCATTERED TREES (sprite-cheap pyramids) -----
  const trees = new THREE.Group();
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a3a20 });
  const leavesMat = new THREE.MeshLambertMaterial({ color: 0x224a22 });
  const trunkGeo = new THREE.CylinderGeometry(1.5, 2, 8, 5);
  const leavesGeo = new THREE.ConeGeometry(8, 22, 6);
  for (let i = 0; i < 800; i++) {
    const x = (Math.random() - 0.5) * WORLD_SIZE * 0.85;
    const z = (Math.random() - 0.5) * WORLD_SIZE * 0.85;
    const h = terrainHeight(x, z);
    if (h < 20 || h > 380) continue;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 4;
    const leaves = new THREE.Mesh(leavesGeo, leavesMat);
    leaves.position.y = 18;
    tree.add(trunk, leaves);
    tree.position.set(x, h, z);
    tree.scale.setScalar(0.8 + Math.random() * 1.3);
    tree.rotation.y = Math.random() * Math.PI * 2;
    trees.add(tree);
  }
  scene.add(trees);

  return { terrain, water, clouds, sky, sun };
}

// ----- Mission marker (large pillar of light) -----
export function createMissionMarker(color = 0x00ff88) {
  const group = new THREE.Group();

  // Cylinder of light
  const beamGeo = new THREE.CylinderGeometry(40, 40, 600, 16, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.35, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = 300;
  group.add(beam);

  // Rotating ring at the base
  const ringGeo = new THREE.TorusGeometry(60, 4, 8, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 5;
  group.add(ring);
  group.userData.ring = ring;

  group.userData.color = color;
  group.userData.radius = 90;
  return group;
}
