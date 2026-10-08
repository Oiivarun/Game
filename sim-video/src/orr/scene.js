import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, facadeTextures, glowTexture } from '../textures.js';
import { skyUniforms, makeSkyMaterial, makeWaterMaterial } from '../shaders.js';
import { TYPES } from './traffic.js';

// World axes: x across the road, y up, z along ORR in the direction the
// jammed traffic drives. The camera looks down +z, so +x is screen-left.
// India drives on the left: the carriageway heading away is on +x.
const LANE_X = [10.25, 6.75, 3.25]; // lane 0 kerbside … lane 2 median side
const ONCOMING_X = [-3.25, -6.75, -10.25];
const VIEW_FROM = -160, VIEW_TO = 3300; // vehicles are drawn in this z range
const LOOP_OFFSET = 600;                // loop position shown at z = 0

const PALETTES = {
  dusk: { zenith: '#41598f', horizon: '#eea47f', sun: '#ff9d66', glow: 1.3, key: '#ffb889', keyI: 1.3, hemiSky: '#a3b2d6', hemiGround: '#5d5850', hemiI: 1.25, fog: '#c99a8e', fogD: 0.00034, water: '#2f4d6d', exposure: 1.1, stars: 0, lamps: 0.75, windows: 0.9 },
  twilight: { zenith: '#1c2a58', horizon: '#9a7390', sun: '#ff8a6a', glow: 0.8, key: '#9fb0e0', keyI: 0.5, hemiSky: '#6b7aae', hemiGround: '#34343e', hemiI: 0.95, fog: '#5c5a78', fogD: 0.00034, water: '#1a2c48', exposure: 1.15, stars: 0.3, lamps: 1, windows: 1.1 },
  night: { zenith: '#060b1b', horizon: '#232c4c', sun: '#6f7fb0', glow: 0.2, key: '#8fa3e6', keyI: 0.3, hemiSky: '#46548a', hemiGround: '#202028', hemiI: 0.7, fog: '#1d2440', fogD: 0.00032, water: '#0c1729', exposure: 1.3, stars: 0.6, lamps: 1, windows: 1.25 },
};
for (const p of Object.values(PALETTES)) for (const k of Object.keys(p)) if (typeof p[k] === 'string') p[k] = new THREE.Color(p[k]);

function palette(n) {
  const [A, B, k] = n < 0.5 ? [PALETTES.dusk, PALETTES.twilight, n / 0.5] : [PALETTES.twilight, PALETTES.night, (n - 0.5) / 0.5];
  const o = {};
  for (const key of Object.keys(A)) o[key] = A[key].isColor ? A[key].clone().lerp(B[key], k) : A[key] + (B[key] - A[key]) * k;
  return o;
}

function facadeBox(w, h, d, r, cellW = 3.6, cellH = 3.6) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const N = 8, u0 = Math.floor(r() * N) / N, v0 = Math.floor(r() * N) / N;
  for (let f = 0; f < 6; f++) {
    const fw = f < 2 ? d : w;
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      if (f === 2 || f === 3) uv.setXY(k, 0.004, 0.996);
      else uv.setXY(k, u0 + (uv.getX(k) * Math.max(1, Math.round(fw / cellW))) / N, v0 + (uv.getY(k) * Math.max(1, Math.round(h / cellH))) / N);
    }
  }
  return g;
}

// Low-poly vehicle parts, each its own instanced mesh. Boxes are built with
// the length along z, the rear at z = 0 and the nose at z = +len.
const PARTS = {
  scooter: [['#2b2d33', [0.62, 0.62, 1.8], [0, 0.55, 0.9]], ['rider', [0.48, 0.78, 0.42], [0, 1.25, 0.75]], ['#1d1f24', [0.34, 0.3, 0.34], [0, 1.78, 0.78]]],
  auto: [['#2f8f3d', [1.35, 0.95, 2.7], [0, 0.72, 1.35]], ['#f2c230', [1.42, 0.62, 2.1], [0, 1.6, 1.2]]],
  car: [['body', [1.75, 0.82, 4.3], [0, 0.65, 2.15]], ['#2a313b', [1.58, 0.6, 2.2], [0, 1.35, 1.95]]],
  cab: [['#f3f3ef', [1.75, 0.82, 4.4], [0, 0.65, 2.2]], ['#2a313b', [1.58, 0.6, 2.2], [0, 1.35, 2.0]]],
  tempo: [['#e9e9e4', [1.75, 1.45, 1.5], [0, 1.0, 4.75]], ['cargo', [1.9, 1.7, 3.8], [0, 1.25, 1.9]]],
  bus: [['bus', [2.55, 2.75, 12], [0, 1.75, 6]], ['#20252d', [2.6, 0.8, 11.2], [0, 2.2, 6.1]]],
};
const RIDERS = ['#c0392b', '#2e86c1', '#f4d03f', '#1e1e24', '#e67e22', '#8e44ad', '#ecf0f1', '#16a085'].map(c => new THREE.Color(c));
const CARS = ['#f2f2ee', '#b9bcc0', '#7d8288', '#2f4f7a', '#8c2a2a', '#e8e3d6', '#30343a', '#c9c2b0'].map(c => new THREE.Color(c));
const CARGO = ['#2f5fa8', '#e9e9e4', '#f2c230', '#2f8f3d'].map(c => new THREE.Color(c));
const BUSES = ['#2d66b3', '#2d66b3', '#b8312b', '#f0f0ea'].map(c => new THREE.Color(c));

export function buildWorld(renderer, sim) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(31, 1080 / 1920, 20, 60000);
  const r = rng(29);
  const shared = skyUniforms();
  scene.fog = new THREE.FogExp2(0xffffff, 0.0003);
  const L = sim.L;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  const key = new THREE.DirectionalLight(0xffffff, 1);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  Object.assign(key.shadow.camera, { left: -700, right: 700, top: 900, bottom: -900, near: 50, far: 6000 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.6;
  key.target.position.set(0, 0, 900);
  scene.add(hemi, key, key.target);
  const sunDir = new THREE.Vector3(-0.83, 0.02, 0.56).normalize();

  const skyMat = makeSkyMaterial(shared);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 64, 32), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, ...extra });
  const strip = (x0, x1, y, z0, z1, m) => {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };

  // --- ground, Bellandur lake, roads ---
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), mat('#5f6a50'));
  ground.position.set(0, -0.05, 15000);
  ground.receiveShadow = true;
  scene.add(ground);

  const waterMat = makeWaterMaterial(shared);
  {
    const pts = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const rad = 1 + 0.18 * Math.sin(a * 3 + 1) + 0.1 * Math.sin(a * 7);
      pts.push(new THREE.Vector2(520 + Math.cos(a) * 420 * rad, -(1500 + Math.sin(a) * 900 * rad)));
    }
    const lake = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts)).rotateX(-Math.PI / 2), waterMat);
    lake.position.y = 0.02;
    scene.add(lake);
    // Bellandur's foam
    const foam = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mat('#eef0ee', { roughness: 1 }), 26);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 26; i++) {
      const s = 6 + r() * 22;
      m.compose(new THREE.Vector3(170 + r() * 120, 0, 900 + r() * 260), new THREE.Quaternion(), new THREE.Vector3(s, s * 0.18, s * (0.6 + r() * 0.6)));
      foam.setMatrixAt(i, m);
    }
    scene.add(foam);
  }

  const Z0 = -600, Z1 = 9000;
  strip(-25, 25, 0.0, Z0, Z1, mat('#8c877c'));                // verge and footpaths
  strip(-22, -15, 0.06, Z0, Z1, mat('#3c3e44'));              // service roads
  strip(15, 22, 0.06, Z0, Z1, mat('#3c3e44'));
  strip(-15, -12, 0.2, Z0, Z1, mat('#55703f'));               // green dividers
  strip(12, 15, 0.2, Z0, Z1, mat('#55703f'));
  strip(-12, -1.5, 0.08, Z0, Z1, mat('#4c4e55'));             // the main carriageways
  strip(1.5, 12, 0.08, Z0, Z1, mat('#4c4e55'));
  strip(-1.5, 1.5, 0.25, Z0, Z1, mat('#9a968c'));             // median, metro works
  for (const x of [-11.6, 11.6]) strip(x - 0.08, x + 0.08, 0.13, Z0, Z1, mat('#e6e2d6'));
  {
    const dash = new THREE.BoxGeometry(0.15, 0.02, 3);
    const xs = [-8.5, -5.0, 5.0, 8.5];
    const n = Math.ceil((Z1 - Z0) / 10) * xs.length;
    const im = new THREE.InstancedMesh(dash, mat('#e6e2d6'), n);
    const m = new THREE.Matrix4();
    let k = 0;
    for (let z = Z0; z < Z1; z += 10) for (const x of xs) m.makeTranslation(x, 0.13, z), im.setMatrixAt(k++, m);
    im.count = k;
    im.receiveShadow = true;
    scene.add(im);
  }

  // --- Namma Metro under construction in the median ---
  {
    const n = Math.ceil((5200 - Z0) / 30);
    const pillar = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.9, 1.0, 11, 10).translate(0, 5.5, 0), mat('#b9b4aa'), n);
    const cap = new THREE.InstancedMesh(new THREE.BoxGeometry(4.6, 1.6, 2.2).translate(0, 11.8, 0), mat('#c4bfb4'), n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      m.makeTranslation(0, 0, Z0 + i * 30);
      pillar.setMatrixAt(i, m);
      cap.setMatrixAt(i, m);
    }
    for (const im of [pillar, cap]) im.castShadow = im.receiveShadow = true;
    scene.add(pillar, cap);
    // Finished deck only far ahead, where the girders have been launched.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(4.8, 2.0, 5200 - 2300).translate(0, 13.6, 0), mat('#c9c4b9'));
    deck.position.z = (2300 + 5200) / 2;
    deck.castShadow = deck.receiveShadow = true;
    scene.add(deck);
    // Barricades along both sides of the works.
    const bn = Math.ceil((Z1 - Z0) / 2.6) * 2;
    const bar = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1.9, 2.5).translate(0, 0.95, 0), mat('#ffffff'), bn);
    const cols = [new THREE.Color('#2f5fa8'), new THREE.Color('#e7e3d8')];
    let k = 0;
    for (let z = Z0; z < Z1; z += 2.6) {
      for (const x of [-1.38, 1.38]) {
        m.makeTranslation(x, 0.12, z);
        bar.setMatrixAt(k, m);
        bar.setColorAt(k, cols[Math.floor(z / 2.6) & 1]);
        k++;
      }
    }
    bar.count = k;
    bar.receiveShadow = true;
    scene.add(bar);
  }

  // --- street lights along both kerbs ---
  const lampPos = [];
  {
    const n = Math.ceil((5200 - Z0) / 36) * 2;
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.18, 11, 6).translate(0, 5.5, 0), mat('#4f555e'), n);
    const m = new THREE.Matrix4();
    let k = 0;
    for (let z = Z0; z < 5200; z += 36) {
      for (const x of [-12.4, 12.4]) {
        m.makeTranslation(x, 0, z);
        pole.setMatrixAt(k++, m);
        lampPos.push(x * 0.86, 10.8, z);
      }
    }
    pole.count = k;
    scene.add(pole);
  }
  const lampGlowMat = new THREE.PointsMaterial({ size: 7, map: glowTexture('rgba(255,248,230,1)', 'rgba(255,230,190,0.3)'), color: '#fff0d6', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(lampPos, 3));
    scene.add(new THREE.Points(g, lampGlowMat));
  }

  // --- tech parks, apartments, cranes ---
  const glassT = facadeTextures(31, { glass: '#5b7f93' });
  const flats = facadeTextures(37, { glass: '#4a5560', deco: true });
  const groups = new Map();
  const addB = (tex, color, x, z, w, h, d, yaw = 0) => {
    const k = `${tex === glassT ? 'g' : 'f'}${color}`;
    if (!groups.has(k)) groups.set(k, { tex, color, geos: [] });
    const g = facadeBox(w, h, d, r);
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, h / 2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)));
    groups.get(k).geos.push(g);
  };
  const GLASS = ['#86b3c4', '#6f9fb3', '#a6c3cf', '#7ba7a0', '#9db4c9'];
  const FLATS = ['#efe2cf', '#e7cdbd', '#f2ead9', '#d9d2c5', '#e9d6b4'];
  const inLake = (x, z) => ((x - 520) / 470) ** 2 + ((z - 1500) / 980) ** 2 < 1;
  for (const side of [-1, 1]) {
    for (let z = -260; z < 4200;) {
      const w = 50 + r() * 50, d = 26 + r() * 22, h = 28 + r() * 48;
      const x = side * (52 + d / 2 + r() * 14);
      if (!inLake(x, z)) addB(glassT, GLASS[Math.floor(r() * GLASS.length)], x, z + w / 2, d, h, w);
      z += w + 14 + r() * 26;
    }
    for (let i = 0; i < 230; i++) {
      const x = side * (130 + Math.pow(r(), 0.8) * 1300), z = -200 + r() * 5200;
      if (inLake(x, z)) continue;
      const glass = r() < 0.55;
      const w = 30 + r() * 45, h = glass ? 30 + r() * 70 : 25 + r() * 50;
      addB(glass ? glassT : flats, glass ? GLASS[Math.floor(r() * 5)] : FLATS[Math.floor(r() * 5)], x, z, w, h, w * (0.5 + r() * 0.6), (r() - 0.5) * 0.4);
    }
  }
  const buildingMats = [];
  for (const { tex, color, geos } of groups.values()) {
    const m = new THREE.MeshStandardMaterial({ color, map: tex.map, emissiveMap: tex.emissive, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.75 });
    buildingMats.push(m);
    const mesh = new THREE.Mesh(mergeGeometries(geos), m);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
  for (const [x, z, h] of [[-120, 640, 70], [190, 2300, 80], [-260, 1500, 60]]) {
    const yellow = mat('#e9b81f');
    const mast = new THREE.Mesh(new THREE.BoxGeometry(2, h, 2).translate(0, h / 2, 0), yellow);
    const jib = new THREE.Mesh(new THREE.BoxGeometry(48, 1.6, 1.6).translate(14, h, 0), yellow);
    const g = new THREE.Group();
    g.add(mast, jib);
    g.position.set(x, 0, z);
    g.rotation.y = r() * 6;
    g.traverse(o => (o.castShadow = true));
    scene.add(g);
  }

  // --- rain trees on the dividers and around the campuses ---
  {
    const spots = [];
    for (let z = Z0; z < 5200; z += 9 + r() * 8) for (const x of [-13.5, 13.5]) spots.push([x + (r() - 0.5) * 0.6, z + (r() - 0.5) * 4, 1.1 + r() * 0.6]);
    for (let z = Z0; z < 5200; z += 14 + r() * 10) for (const x of [-27, 27]) spots.push([x + (r() - 0.5) * 2, z, 3 + r() * 2.5]);
    for (let i = 0; i < 1400; i++) {
      const side = r() < 0.5 ? -1 : 1;
      const x = side * (26 + Math.pow(r(), 1.3) * 700), z = -300 + r() * 5000;
      if (!inLake(x, z)) spots.push([x, z, 2.5 + r() * 4]);
    }
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.4, 1, 5).translate(0, 0.5, 0), mat('#5d4a3a'), spots.length);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), spots.length);
    const greens = ['#4f7f3f', '#5d8d48', '#3f6b35', '#6e9c4f', '#7aa356'].map(c => new THREE.Color(c));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    spots.forEach(([x, z, s], i) => {
      const h = 3 + s;
      m.compose(new THREE.Vector3(x, 0, z), q.identity(), new THREE.Vector3(1, h, 1));
      trunk.setMatrixAt(i, m);
      q.setFromEuler(e.set(r() * 3, r() * 3, 0));
      m.compose(new THREE.Vector3(x, h + s * 0.45, z), q, new THREE.Vector3(s * 1.25, s * 0.7, s * 1.25));
      crown.setMatrixAt(i, m);
      crown.setColorAt(i, greens[Math.floor(r() * greens.length)]);
    });
    for (const im of [trunk, crown]) {
      im.castShadow = im.receiveShadow = true;
      scene.add(im);
    }
  }

  // --- vehicles ---
  // Every jammed-side vehicle comes from the simulation; the oncoming side
  // flows freely and is just moved along at a steady speed.
  const vehicles = [];
  sim.lanes.forEach((lane, l) => lane.kind.forEach((kind, i) => vehicles.push({ kind, l, i, jitter: (r() - 0.5) * 0.9, wob: r() * 6.28, c: r() })));
  const kinds = Object.keys(TYPES);
  const oncoming = [];
  for (const x of ONCOMING_X) {
    for (let z = -300; z < 3400; z += 22 + r() * 30) {
      const kind = kinds[Math.min(kinds.length - 1, Math.floor(Math.pow(r(), 1.3) * kinds.length))];
      oncoming.push({ kind, x: x + (r() - 0.5) * 0.8, z0: z, v: 9 + r() * 4, c: r() });
    }
  }
  const all = [...vehicles, ...oncoming];
  const meshes = {};
  for (const kind of kinds) {
    const list = all.filter(v => v.kind === kind);
    meshes[kind] = PARTS[kind].map(([color, size, off]) => {
      const g = new THREE.BoxGeometry(...size).translate(...off);
      const fixed = color.startsWith('#');
      const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: fixed ? color : '#ffffff', roughness: 0.55 }), list.length);
      if (!fixed) {
        list.forEach((v, j) => {
          const pal = color === 'rider' ? RIDERS : color === 'body' ? CARS : color === 'cargo' ? CARGO : BUSES;
          im.setColorAt(j, pal[Math.floor(v.c * pal.length)]);
        });
      }
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      scene.add(im);
      return im;
    });
    list.forEach((v, j) => (v.slot = j));
  }

  // Tail lights (jammed side, glowing brighter on the brake) and headlights.
  const tailGeo = new THREE.BufferGeometry();
  tailGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(vehicles.length * 3), 3));
  tailGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(vehicles.length * 3), 3));
  const tailMat = new THREE.PointsMaterial({ size: 13, map: glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.5)'), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const tails = new THREE.Points(tailGeo, tailMat);
  tails.frustumCulled = false;
  scene.add(tails);
  const poolGeo = new THREE.BufferGeometry();
  poolGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(vehicles.length * 3), 3));
  poolGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(vehicles.length * 3), 3));
  const poolMat = new THREE.PointsMaterial({ size: 30, map: glowTexture('rgba(255,255,255,0.6)', 'rgba(255,255,255,0.22)'), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const pools = new THREE.Points(poolGeo, poolMat);
  pools.frustumCulled = false;
  scene.add(pools);
  const headGeo = new THREE.BufferGeometry();
  headGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(oncoming.length * 3), 3));
  const headMat = new THREE.PointsMaterial({ size: 8, map: glowTexture('rgba(255,255,255,1)', 'rgba(255,250,235,0.3)'), color: '#fff3dc', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const heads = new THREE.Points(headGeo, headMat);
  heads.frustumCulled = false;
  scene.add(heads);

  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1), ZERO = new THREE.Vector3(0, 0, 0);
  const CAM = new THREE.Vector3(5, 125, -190);
  const wrapZ = s => {
    let z = (((s - LOOP_OFFSET) % L) + L) % L;
    if (z > VIEW_TO + 200) z -= L;
    return z;
  };

  function update(st, snap) {
    const pal = palette(st.night);
    camera.position.copy(CAM);
    camera.lookAt(3, 0, 360);
    camera.updateMatrixWorld();
    renderer.toneMappingExposure = pal.exposure;

    shared.uZenith.value.copy(pal.zenith);
    shared.uHorizon.value.copy(pal.horizon);
    shared.uSunDir.value.copy(sunDir);
    shared.uSunColor.value.copy(pal.sun);
    shared.uSunGlow.value = pal.glow;
    shared.uFogColor.value.copy(pal.fog);
    shared.uFogDensity.value = pal.fogD;
    scene.fog.color.copy(pal.fog);
    scene.fog.density = pal.fogD;
    skyMat.uniforms.uStars.value = pal.stars;
    skyMat.uniforms.uSunDisc.value = 0;
    hemi.color.copy(pal.hemiSky);
    hemi.groundColor.copy(pal.hemiGround);
    hemi.intensity = pal.hemiI;
    key.color.copy(pal.key);
    key.intensity = pal.keyI;
    key.position.copy(key.target.position).add(new THREE.Vector3(-0.7, 0.45, 0.55).normalize().multiplyScalar(3000));
    waterMat.uniforms.uTime.value = st.sim;
    waterMat.uniforms.uWave.value = 0.18;
    waterMat.uniforms.uDeep.value.copy(pal.water);
    lampGlowMat.opacity = pal.lamps;
    for (const m of buildingMats) m.emissiveIntensity = pal.windows;

    // Jammed side, straight from the simulation snapshot.
    const tp = tailGeo.attributes.position, tc = tailGeo.attributes.color;
    const pp = poolGeo.attributes.position, pc = poolGeo.attributes.color;
    let culprit = null;
    let sum = 0, cnt = 0;
    vehicles.forEach((v, k) => {
      const d = snap[v.l];
      const p = TYPES[v.kind];
      const front = wrapZ(d.x[v.i]);
      const visible = front > VIEW_FROM && front < VIEW_TO;
      const speed = d.v[v.i], acc = d.a[v.i];
      // Scooters weave; everyone drifts a little off the lane line.
      const x = LANE_X[v.l] + v.jitter + (v.kind === 'scooter' ? Math.sin(front * 0.03 + v.wob) * 0.9 : 0);
      const rear = front - p.len;
      tmpM.compose(tmpV.set(x, 0.1, rear), tmpQ.identity(), visible ? ONE : ZERO);
      for (const im of meshes[v.kind]) im.setMatrixAt(v.slot, tmpM);
      const brake = Math.min(1, Math.max(0, (-acc - 0.35) / 1.6));
      const held = speed < 0.6 ? 0.85 : 0;
      const glow = visible ? 0.12 + 2.2 * Math.max(brake, held) : 0;
      tp.setXYZ(k, x, v.kind === 'bus' ? 1.3 : 0.95, rear - 0.35);
      tc.setXYZ(k, glow * 1.0, glow * 0.07, glow * 0.03);
      const pool = visible ? 0.55 * Math.max(brake, held) : 0;
      pp.setXYZ(k, x, 0.3, rear - 2.5);
      pc.setXYZ(k, pool, pool * 0.05, pool * 0.02);
      if (visible && front > 40 && front < 900) {
        sum += speed;
        cnt++;
      }
      if (sim.culprit && v.l === sim.culprit.lane && v.i === sim.culprit.index) culprit = new THREE.Vector3(x, 2.2, rear + p.len / 2);
    });
    tp.needsUpdate = tc.needsUpdate = pp.needsUpdate = pc.needsUpdate = true;

    // Oncoming side flows freely.
    const hp = headGeo.attributes.position;
    oncoming.forEach((v, k) => {
      const span = 3700;
      let z = (((v.z0 - v.v * st.sim + 300) % span) + span) % span - 300;
      const p = TYPES[v.kind];
      tmpQ.setFromAxisAngle(tmpV.set(0, 1, 0), Math.PI);
      tmpM.compose(tmpV.set(v.x, 0.1, z + p.len), tmpQ, ONE);
      for (const im of meshes[v.kind]) im.setMatrixAt(v.slot, tmpM);
      hp.setXYZ(k, v.x, 0.85, z - 0.3);
    });
    hp.needsUpdate = true;
    for (const list of Object.values(meshes)) for (const im of list) im.instanceMatrix.needsUpdate = true;

    sky.position.copy(camera.position);
    return { avgSpeed: cnt ? sum / cnt : 0, culprit };
  }

  // What the soundtrack listens to: how fast the visible traffic moves, how
  // much of it is stopped, and how much is braking close to the camera.
  function stats(snap) {
    let sum = 0, cnt = 0, stopped = 0, nearBrake = 0, near = 0;
    for (const v of vehicles) {
      const d = snap[v.l];
      const front = wrapZ(d.x[v.i]);
      if (front < 40 || front > 900) continue;
      cnt++;
      sum += d.v[v.i];
      if (d.v[v.i] < 1) stopped++;
      if (front < 300) {
        near++;
        if (d.a[v.i] < -0.8 || d.v[v.i] < 1) nearBrake++;
      }
    }
    return { speed: cnt ? sum / cnt : 0, stopped: cnt ? stopped / cnt : 0, nearBrake: near ? nearBrake / near : 0 };
  }

  return { scene, camera, update, stats };
}
