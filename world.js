// =====================================================
// World — terrain, sky, water, clouds, mission markers
// =====================================================

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export const WORLD_SIZE = 8000;

// Locked synthwave palette (shared with fx.js, game.js, minigames.js)
export const NEON = Object.freeze({
  dark:   0x1a0b2e,
  pink:   0xff2e88,
  purple: 0xb14bff,
  cyan:   0x00ffd5,
  gold:   0xffcf4d,
});

// Realistic-look haze. Single source of truth for the daytime fog, the renderer
// clear color (game.js), and setLook()'s realistic descriptor — keep them in lockstep.
export const REALISTIC_HAZE = 0x88a8c8;

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

// ----- Neon horizon-city procedural canvas -----
// Paints a 1024×256 skyline: dark #1a0b2e buildings with #ff2e88/#00ffd5 windows.
// Top pixels stay transparent so the sky shows through above the rooftops.
function _buildCityCanvas() {
  const W = 1024, H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H); // fully transparent start

  const DARK = '#1a0b2e';
  const WIN_COLORS = ['#ff2e88', '#00ffd5'];

  // Packed buildings left→right; overshoot W slightly to avoid a right-edge gap
  let x = 0;
  while (x < W + 50) {
    const bw = 12 + Math.floor(Math.random() * 36);
    const bh = 38 + Math.floor(Math.random() * 190);
    const px = x % (W + 1); // wrap X for near-seamless join

    // Building silhouette (opaque dark mass)
    ctx.fillStyle = DARK;
    ctx.fillRect(px, H - bh, bw, bh);

    // Rooftop accent (1-px neon line)
    ctx.fillStyle = WIN_COLORS[Math.random() > 0.5 ? 0 : 1];
    ctx.fillRect(px, H - bh, bw, 2);

    // Windows
    const wCols = Math.max(1, Math.floor((bw - 6) / 9));
    const wRows = Math.floor((bh - 14) / 14);
    for (let row = 0; row < wRows; row++) {
      for (let col = 0; col < wCols; col++) {
        if (Math.random() > 0.42) continue; // ~58% dark
        ctx.fillStyle = WIN_COLORS[Math.random() > 0.5 ? 0 : 1];
        ctx.fillRect(px + 3 + col * 9, H - bh + 10 + row * 14, 5, 7);
      }
    }

    // Small random gap between buildings (gives skyline variety)
    x += bw + (Math.random() > 0.55 ? Math.floor(Math.random() * 7) : 0);
  }
  return canvas;
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

  // ----- SKY — dynamic atmospheric scattering (Three.js Sky), driven by setTimeOfDay -----
  // Replaces the old static equirectangular photo. The dome follows the camera (game.js
  // renderFrame) and renders behind everything (depthTest off, renderOrder -1) so it reads
  // as an infinite backdrop within the 8000 far-plane. The sun position sets sky colour →
  // real sunrise/sunset/night falls out of the scattering.
  const skyDome = new Sky();
  skyDome.scale.setScalar(6000);
  skyDome.material.depthTest = false;
  skyDome.material.depthWrite = false;
  skyDome.renderOrder = -1;
  skyDome.frustumCulled = false;
  scene.add(skyDome);
  const skyU = skyDome.material.uniforms;
  // Clear-day air: low turbidity = crisp clean sky (not hazy/immersive), moderate rayleigh
  // = a real blue, small mie = a contained sun (no white-out). The 0.75 exposure keeps the
  // higher daytime sun from blowing out.
  skyU.turbidity.value = 2;
  skyU.rayleigh.value = 2.0;
  skyU.mieCoefficient.value = 0.0022;
  skyU.mieDirectionalG.value = 0.7;
  scene.background = null;   // the dome is the backdrop now (realistic look)

  // ----- STARS (one Points field; opacity fades in at night via setTimeOfDay) -----
  const starGeo = new THREE.BufferGeometry();
  const STAR_N = 1400;
  const starArr = new Float32Array(STAR_N * 3);
  for (let i = 0; i < STAR_N; i++) {
    const th = 2 * Math.PI * Math.random();
    const ph = Math.acos(1 - Math.random());   // upper hemisphere (y >= 0)
    const r = 5200;
    starArr[i * 3]     = r * Math.sin(ph) * Math.cos(th);
    starArr[i * 3 + 1] = r * Math.cos(ph);
    starArr[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starArr, 3));
  // fog:false — stars are camera-followed at radius 5200; at night fog.far shrinks to ~4200,
  // which would otherwise paint the whole star field in the night haze colour (invisible).
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 18, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  scene.add(stars);

  // ----- CLEAR-DAY SKY (hand-authored blue gradient) -----
  // The physically-based Sky desaturates to pale grey in daylight, so the DAY sky is a clean
  // gradient blue we control to the exact colour. Its opacity is driven by setTimeOfDay: fully
  // on in clear daylight, faded out at dusk/night so the atmospheric Sky shows through. Follows
  // the camera (game.js renderFrame), renders over the atmospheric dome (-1) but under terrain.
  const dayMat = new THREE.ShaderMaterial({
    uniforms: {
      uHorizon: { value: new THREE.Color(0xbcd9f2) },  // pale blue at the horizon
      uZenith:  { value: new THREE.Color(0x3d7fd0) },   // clean blue overhead
      uOpacity: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform vec3 uHorizon; uniform vec3 uZenith; uniform float uOpacity;
      void main() {
        float h = clamp(vDir.y * 1.4 + 0.12, 0.0, 1.0);
        gl_FragColor = vec4(mix(uHorizon, uZenith, pow(h, 0.7)), uOpacity);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthTest: true,     // MUST be true: transparent objects draw after opaque terrain, so
    depthWrite: false,   // without depth-test this dome paints over the ground. Terrain occludes it.
  });
  // Radius 7900 sits just inside the 8000 far plane and beyond the farthest VISIBLE terrain
  // (camera clamped to ±3600, terrain edge ±4000 → max straight-across distance ~7600), so
  // terrain always occludes this transparent dome instead of the dome painting a 'sky wall'
  // over distant hills. (Diagonal far corners are already clipped by the 8000 far plane.)
  const dayDome = new THREE.Mesh(new THREE.SphereGeometry(7900, 24, 16), dayMat);
  dayDome.renderOrder = -0.5;    // over the atmospheric sky (-1), under the terrain (0)
  dayDome.frustumCulled = false;
  scene.add(dayDome);

  // ----- SUN — banded synthwave ShaderMaterial -----
  // Same sphere mesh; game.renderFrame calls sunRef.lookAt(camera.position) each frame
  // so the sphere billboards. After lookAt, the sphere's local -Z points toward camera,
  // meaning vNorm.xy is the camera-plane offset and length(vNorm.xy) is radial distance
  // from the disc centre (0=centre, 1=limb). vNorm.y = vertical position on disc.
  const sunGeo = new THREE.SphereGeometry(120, 24, 24);
  const sunMat = new THREE.ShaderMaterial({
    uniforms: {
      uCore: { value: new THREE.Color(0xffcf4d) }, // gold centre
      uEdge: { value: new THREE.Color(0xff2e88) }, // magenta limb
    },
    vertexShader: /* glsl */`
      varying vec3 vNorm;
      void main() {
        vNorm = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vNorm;
      uniform vec3 uCore;
      uniform vec3 uEdge;
      void main() {
        float r = length(vNorm.xy);           // 0=centre, 1=limb
        float alpha = 1.0 - smoothstep(0.82, 1.0, r);
        if (alpha < 0.001) discard;
        // Radial gradient: gold core → magenta edge
        vec3 col = mix(uCore, uEdge, smoothstep(0.0, 1.0, r));
        // Horizontal bands only in the lower half (classic synthwave sun)
        float bandT = clamp(-vNorm.y, 0.0, 1.0);   // >0 in lower half
        float band  = fract(bandT * 7.0);
        float gap   = step(0.78, band) * step(0.08, bandT);
        col = mix(col, col * 0.12, gap);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
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
  // Fog color = REALISTIC_HAZE, shared with the renderer clear color (game.js) and
  // setLook()'s realistic descriptor. Change the constant, not these call sites.
  scene.fog = new THREE.Fog(REALISTIC_HAZE, 2400, 7500);

  // ----- NEON HORIZON CITY -----
  // One open cylinder rendered from the inside (BackSide) at the world edge.
  // Canvas-painted skyline texture: lit neon windows on a dark mass, transparent above rooftops.
  // Sits fully inside fog (radius 3600, fog near=1500 far=6500) so it fades naturally.
  // Budget: 1 draw call (2 with bloom), ~256 tris. Opacity faded by day-factor in setTimeOfDay.
  let cityMat;
  {
    const cityCanvas = _buildCityCanvas();
    const cityTex = new THREE.CanvasTexture(cityCanvas);
    cityTex.wrapS = THREE.RepeatWrapping;
    cityTex.colorSpace = THREE.SRGBColorSpace;

    cityMat = new THREE.MeshBasicMaterial({
      map: cityTex,
      side: THREE.BackSide,      // render interior surface (player is inside the cylinder)
      transparent: true,
      alphaTest: 0.05,           // clip fully-transparent sky pixels, preserve window glow
      depthWrite: false,         // additive-friendly; city is distant decoration
      fog: true,
    });

    // 64 radial segments → ~256 tris (open, no caps)
    const cityGeo = new THREE.CylinderGeometry(
      WORLD_SIZE * 0.45, WORLD_SIZE * 0.45,  // top/bottom radius (= 3600)
      700,                                    // height
      64, 1,                                  // radial segs, height segs
      true                                    // openEnded (no caps)
    );
    const city = new THREE.Mesh(cityGeo, cityMat);
    city.position.y = 280; // centre at 280 → spans y=-70 to y=630 (above typical terrain)
    city.frustumCulled = false; // always visible from inside
    scene.add(city);
  }

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

  // ----- SYNTHWAVE ALT LOOK (built once here; toggled by setLook, never rebuilt) -----
  // ponytail: the dark ground + "grid" read reuses the terrain's existing onBeforeCompile
  // shader-injection pattern (see terrainMat above) instead of a second wireframe mesh, so
  // toggling look adds zero draw calls. The banded sun (~L129) and neon horizon city
  // (~L300) are left shared across both looks unchanged — not worth branching for now.
  const gridColor = new THREE.Color(NEON.cyan);
  const altTerrainMat = new THREE.MeshStandardMaterial({
    color: NEON.dark,
    flatShading: true,
    roughness: 0.9,
    metalness: 0.1,
  });
  altTerrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.uGridColor = { value: gridColor };
    shader.vertexShader = 'varying vec3 vWPosGrid;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vWPosGrid = (modelMatrix * vec4(transformed, 1.0)).xyz;'
    );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n varying vec3 vWPosGrid;\n uniform vec3 uGridColor;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 cell = abs(fract(vWPosGrid.xz / 200.0) - 0.5);
          float line = 1.0 - smoothstep(0.0, 0.03, min(cell.x, cell.y));
          diffuseColor.rgb = mix(diffuseColor.rgb, uGridColor, line);
        }
      `);
  };

  // Flat gradient canvas as scene.background (no equirect mapping needed for a plain
  // vertical gradient): magenta horizon fading to dark purple zenith.
  const hexStr = (n) => '#' + n.toString(16).padStart(6, '0');
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4; skyCanvas.height = 256;
  const skyCtx = skyCanvas.getContext('2d');
  const skyGrad = skyCtx.createLinearGradient(0, 256, 0, 0); // bottom (horizon) -> top (zenith)
  skyGrad.addColorStop(0, hexStr(NEON.pink));
  skyGrad.addColorStop(1, hexStr(NEON.purple));
  skyCtx.fillStyle = skyGrad;
  skyCtx.fillRect(0, 0, 4, 256);
  const altSky = new THREE.CanvasTexture(skyCanvas);
  altSky.colorSpace = THREE.SRGBColorSpace;

  // ----- DAY / NIGHT -----
  // One clock (t in [0,1): 0 midnight, 0.25 dawn, 0.5 noon, 0.75 dusk) drives the sun
  // direction (→ atmospheric sky colour), the key/ambient/hemi lights, fog, stars,
  // cloud tint and bloom. Mutates existing handles only; scratch colours below keep it
  // per-frame-alloc-free, so it's safe to call every frame.
  const ELEV_MAX = 42;   // real daytime sun (clear blue day); dusk/night still moody near the horizon
  const _sunDir = new THREE.Vector3();
  const _colDay = new THREE.Color(0xfff2d8);      // noon key light (warm white)
  const _colDusk = new THREE.Color(0xff8a4a);     // low-sun warmth
  const _colNightAmb = new THREE.Color(0x24304a);
  const _colDayAmb = new THREE.Color(0xb0c8e0);
  const _hazeDay = new THREE.Color(REALISTIC_HAZE);
  const _hazeNight = new THREE.Color(0x0a1226);
  const _hazeDusk = new THREE.Color(0xd8825a);
  const _cloudDay = new THREE.Color(0xf4f6fb);
  const _cloudNight = new THREE.Color(0x2a3350);
  const _fog = new THREE.Color();
  const _todDesc = { clearColor: 0, bloomStrength: 0 };   // reused each frame — no hot-path alloc
  function setTimeOfDay(t) {
    const elev = -Math.cos(2 * Math.PI * t) * ELEV_MAX;     // deg: -max midnight .. +max noon
    const azi = 100 + 200 * t;                              // slow east -> west drift
    _sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(azi));
    skyU.sunPosition.value.copy(_sunDir);
    sun.position.copy(_sunDir).multiplyScalar(3000);        // synthwave disc tracks the arc
    dir.position.copy(_sunDir).multiplyScalar(3000);        // key light follows the sun
    const day = THREE.MathUtils.clamp((elev + 4) / 16, 0, 1);              // 0 night .. 1 sun up
    const gold = THREE.MathUtils.clamp(1 - Math.abs(elev) / 16, 0, 1); // warm near horizon; 0 once |elev|>=16 (smooth, no step)
    dir.intensity = 0.04 + 0.85 * day;      // dimmer peak — user graded "too bright"
    dir.color.copy(_colDay).lerp(_colDusk, gold);
    ambient.intensity = 0.14 + 0.28 * day;
    ambient.color.copy(_colNightAmb).lerp(_colDayAmb, day);
    hemi.intensity = 0.08 + 0.22 * day;
    _fog.copy(_hazeNight).lerp(_hazeDay, day).lerp(_hazeDusk, gold * 0.6);
    scene.fog.color.copy(_fog);
    // Crisp/clear by day (fog pushed out past the view), hazy/moody at dusk & night.
    scene.fog.near = 1500 + 5500 * day;
    scene.fog.far = 4200 + 10800 * day;
    stars.material.opacity = THREE.MathUtils.clamp(1 - day * 1.4, 0, 1);
    dayMat.uniforms.uOpacity.value = THREE.MathUtils.smoothstep(day, 0.5, 0.95);   // clean blue only in full daylight
    cloudMat.color.copy(_cloudNight).lerp(_cloudDay, day).lerp(_hazeDusk, gold * 0.4);
    // Neon horizon city glows at night/dusk, fades out in bright day (it's out of place in a
    // clean blue sky, and the day fog no longer reaches it). Turns a fog gap into a nice beat.
    if (cityMat) cityMat.opacity = THREE.MathUtils.clamp(1 - day * 1.3, 0, 1);
    _todDesc.clearColor = _fog.getHex();
    _todDesc.bloomStrength = 1.05 - 0.5 * day;
    return _todDesc;
  }

  // Swaps material/dome/background/fog refs only — never rebuilds geometry, so it's safe
  // to call repeatedly. The day/night cycle re-applies fog/clear/bloom on top (realistic).
  function setLook(mode) {
    if (mode === 'synthwave') {
      terrain.material = altTerrainMat;
      skyDome.visible = false;
      dayDome.visible = false;
      stars.visible = false;
      sun.visible = true;
      scene.background = altSky;
      scene.fog.color.set(NEON.dark);
      // setTimeOfDay only drives the realistic look; restore the FIXED lighting/fog/city/cloud
      // state the neon look expects, else toggling to synthwave inherits stale realistic (e.g.
      // night → near-black) state on these shared handles.
      dir.intensity = 1.1; dir.color.set(0xfff0d8); dir.position.set(2000, 1400, -2500);
      ambient.intensity = 0.55; ambient.color.set(0xb0c8e0);
      hemi.intensity = 0.4;
      sun.position.set(2000, 1400, -2500);
      scene.fog.near = 1500; scene.fog.far = 6500;
      cloudMat.color.set(0xffffff);
      if (cityMat) cityMat.opacity = 1;
      return { clearColor: NEON.dark, bloomStrength: 1.1, exposure: 1.15 };
    }
    terrain.material = terrainMat;
    skyDome.visible = true;
    dayDome.visible = true;            // gradient day sky (opacity driven by setTimeOfDay)
    stars.visible = true;
    sun.visible = false;               // the atmospheric dome renders its own sun
    scene.background = null;
    scene.fog.color.set(REALISTIC_HAZE);
    // fog near/far, lights, cloud tint & city opacity are driven by setTimeOfDay (applied next).
    return { clearColor: REALISTIC_HAZE, bloomStrength: 0.6, exposure: 0.75 };
  }

  return { terrain, water, clouds, sun, skyDome, dayDome, stars, setLook, setTimeOfDay };
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
  group.userData.beam = beam;   // exposed so a cleared mission can dim its beam

  group.userData.color = color;
  group.userData.radius = 90;
  return group;
}
