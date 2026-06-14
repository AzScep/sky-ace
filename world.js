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
  // ----- TEXTURES (Higgsfield-generated, seamless) -----
  const texLoader = new THREE.TextureLoader();
  const tiled = (path) => {
    const t = texLoader.load(path);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  const texGrass = tiled('assets/img/tex/grass.jpg');
  const texRock  = tiled('assets/img/tex/rock.jpg');
  const texSnow  = tiled('assets/img/tex/snow.jpg');
  const texSand  = tiled('assets/img/tex/sand.jpg');
  const texWater = tiled('assets/img/tex/water.jpg');

  // ----- SKY (Higgsfield painterly equirectangular backdrop) -----
  // Three's built-in background skybox handles color management + the azimuth
  // seam correctly (a raw dome shader rendered the image too dark).
  const skyTex = texLoader.load('assets/img/sky.jpg');
  skyTex.colorSpace = THREE.SRGBColorSpace;
  skyTex.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = skyTex;
  const sky = skyTex;

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
  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.95,
    metalness: 0.0,
  });
  // Blend grass / sand / rock / snow by world height + slope, keeping a faint
  // tint from the original elevation vertex colors for large-scale variation.
  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.uGrass = { value: texGrass };
    shader.uniforms.uRock  = { value: texRock };
    shader.uniforms.uSnow  = { value: texSnow };
    shader.uniforms.uSand  = { value: texSand };
    shader.uniforms.uScale = { value: 0.02 };
    shader.vertexShader = 'varying vec3 vWPos;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
    );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        '#include <common>\n varying vec3 vWPos;\n uniform sampler2D uGrass, uRock, uSnow, uSand;\n uniform float uScale;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 wn = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
          float slope = clamp(1.0 - wn.y, 0.0, 1.0);
          vec2 uv = vWPos.xz * uScale;
          vec3 cG = texture2D(uGrass, uv).rgb;
          vec3 cR = texture2D(uRock,  uv * 0.7).rgb;
          vec3 cS = texture2D(uSnow,  uv * 0.6).rgb;
          vec3 cD = texture2D(uSand,  uv * 0.9).rgb;
          float h = vWPos.y;
          float wSand  = 1.0 - smoothstep(-10.0, 45.0, h);
          float wGrass = smoothstep(15.0, 70.0, h) * (1.0 - smoothstep(230.0, 360.0, h));
          float wRock  = smoothstep(300.0, 420.0, h) * (1.0 - smoothstep(490.0, 560.0, h));
          float wSnow  = smoothstep(500.0, 600.0, h);
          float tot = wSand + wGrass + wRock + wSnow + 1e-4;
          vec3 terr = (cD*wSand + cG*wGrass + cR*wRock + cS*wSnow) / tot;
          terr = mix(terr, cR, smoothstep(0.38, 0.72, slope));   // cliffs -> rock
          diffuseColor.rgb = terr * mix(vec3(1.0), vColor.rgb * 1.5, 0.2);
        }
      `);
  };
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ----- WATER PLANE -----
  const waterGeo = new THREE.PlaneGeometry(WORLD_SIZE * 1.1, WORLD_SIZE * 1.1);
  waterGeo.rotateX(-Math.PI / 2);
  texWater.repeat.set(60, 60);
  const waterMat = new THREE.MeshLambertMaterial({
    color: 0x6fb4cf,
    map: texWater,
    transparent: true,
    opacity: 0.82,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = -50;
  scene.add(water);

  // ----- CLOUDS (billboarded sprites) -----
  const cloudTex = texLoader.load('assets/img/fx/cloud.png');
  cloudTex.colorSpace = THREE.SRGBColorSpace;
  const cloudMat = new THREE.SpriteMaterial({
    map: cloudTex, transparent: true, depthWrite: false, opacity: 0.95,
  });
  const clouds = new THREE.Group();
  for (let i = 0; i < 75; i++) {
    const cloud = new THREE.Group();
    const count = 2 + Math.floor(Math.random() * 3);
    for (let j = 0; j < count; j++) {
      const sp = new THREE.Sprite(cloudMat);
      const s = 170 + Math.random() * 230;
      sp.scale.set(s, s * 0.6, 1);
      sp.position.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 0.16, (Math.random() - 0.5) * s * 0.6);
      cloud.add(sp);
    }
    cloud.position.set(
      (Math.random() - 0.5) * WORLD_SIZE * 0.9,
      520 + Math.random() * 700,
      (Math.random() - 0.5) * WORLD_SIZE * 0.9
    );
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
