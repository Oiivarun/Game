import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, facadeTextures, moonTexture, glowTexture, lightPoolTexture } from './textures.js';
import { skyUniforms, makeSkyMaterial, makeWaterMaterial, makeMoonMaterial } from './shaders.js';
import { trafficClock } from './timeline.js';

// World axes: x east, y up, z south. Marine Drive runs south from the
// camera and curves west (to the right) towards Nariman Point.
export const LAND_Y = 4.5;
const SEA_OFF = -20; // shoreline, as an offset from the road's centre line

const PATH = [
  [34, -420], [26, -120], [18, 80], [8, 300], [-14, 560], [-56, 840],
  [-126, 1120], [-232, 1380], [-372, 1590], [-512, 1712], [-640, 1782],
];

const PALETTES = {
  sunset: { zenith: '#6f8fc4', horizon: '#f2b691', sun: '#ffb27a', sunI: 2.6, glow: 1.2, hemiSky: '#b4c0dc', hemiGround: '#8a6e5c', hemiI: 1.05, fog: '#eab79c', fogD: 0.00026, water: '#3a6886', exposure: 1.0, stars: 0, keyColor: '#ffb27a' },
  day: { zenith: '#4d87c9', horizon: '#c3d9ea', sun: '#fff2df', sunI: 2.9, glow: 0.6, hemiSky: '#d2e2f5', hemiGround: '#8f8a78', hemiI: 1.15, fog: '#c7d9e9', fogD: 0.00022, water: '#2f6d8e', exposure: 0.95, stars: 0, keyColor: '#fff2df' },
  dusk: { zenith: '#2c4174', horizon: '#e39274', sun: '#ff8c5a', sunI: 0.5, glow: 1.4, hemiSky: '#7480ad', hemiGround: '#4a3a40', hemiI: 0.75, fog: '#a67f86', fogD: 0.00026, water: '#1f3a58', exposure: 1.1, stars: 0.15, keyColor: '#ff9a6a' },
  night: { zenith: '#050a18', horizon: '#1b2947', sun: '#7f9bd8', sunI: 0.45, glow: 0.0, hemiSky: '#33437a', hemiGround: '#161a24', hemiI: 0.45, fog: '#172340', fogD: 0.00024, water: '#0b1a2e', exposure: 1.25, stars: 1, keyColor: '#a9bdff' },
  storm: { zenith: '#5a636e', horizon: '#9ba4ab', sun: '#d8dde0', sunI: 0.9, glow: 0.2, hemiSky: '#a7b0b8', hemiGround: '#5a5a58', hemiI: 1.05, fog: '#8f989f', fogD: 0.00045, water: '#3b4b54', exposure: 1.0, stars: 0, keyColor: '#d8dde0' },
  twilight: { zenith: '#0d1838', horizon: '#56679c', sun: '#ff9b78', sunI: 0.35, glow: 0.5, hemiSky: '#46558c', hemiGround: '#1d2030', hemiI: 0.55, fog: '#3d4975', fogD: 0.00022, water: '#10223f', exposure: 1.2, stars: 0.7, keyColor: '#9fb6ff' },
};

for (const p of Object.values(PALETTES)) {
  for (const k of Object.keys(p)) if (typeof p[k] === 'string') p[k] = new THREE.Color(p[k]);
}

function blendPalette({ a, b, k }) {
  const A = PALETTES[a], B = PALETTES[b];
  const out = {};
  for (const key of Object.keys(A)) {
    out[key] = A[key].isColor ? A[key].clone().lerp(B[key], k) : A[key] + (B[key] - A[key]) * k;
  }
  return out;
}

export function dirFrom(az, el) {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  return new THREE.Vector3(-Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
}

// --- the road's centre line, sampled by arc length ------------------------

function makePath() {
  const curve = new THREE.CatmullRomCurve3(PATH.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const L = curve.getLength();
  const N = 1600;
  const P = [], T = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    P.push(curve.getPointAt(u));
    T.push(curve.getTangentAt(u));
  }
  function at(s, off = 0) {
    const f = Math.min(N, Math.max(0, (s / L) * N));
    const i = Math.min(N - 1, Math.floor(f)), k = f - i;
    const x = P[i].x + (P[i + 1].x - P[i].x) * k;
    const z = P[i].z + (P[i + 1].z - P[i].z) * k;
    const tx = T[i].x + (T[i + 1].x - T[i].x) * k;
    const tz = T[i].z + (T[i + 1].z - T[i].z) * k;
    const l = Math.hypot(tx, tz);
    const t = { x: tx / l, z: tz / l };
    const n = { x: t.z, z: -t.x }; // land side
    return { x: x + n.x * off, z: z + n.z * off, t, n, yaw: Math.atan2(-t.z, t.x) };
  }
  // Signed offset of a point from the road (positive = land side).
  function offsetOf(x, z) {
    let best = Infinity, bi = 0;
    for (let i = 0; i <= N; i += 4) {
      const d = (P[i].x - x) ** 2 + (P[i].z - z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    const t = T[bi];
    return (x - P[bi].x) * t.z + (z - P[bi].z) * -t.x;
  }
  return { L, at, offsetOf };
}

function ribbon(path, off0, off1, y, { s0 = 0, s1 = path.L, step = 4, uLen = 0 } = {}) {
  const pos = [], uv = [], idx = [];
  let i = 0;
  for (let s = s0; ; s += step) {
    const ss = Math.min(s, s1);
    const a = path.at(ss, off0), b = path.at(ss, off1);
    pos.push(a.x, y, a.z, b.x, y, b.z);
    const u = uLen ? ss / uLen : ss / 10;
    uv.push(u, 0, u, 1);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
    i++;
    if (ss >= s1) break;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Winding can come out facing down; normals must point up for lighting.
  const n = g.attributes.normal;
  if (n.getY(0) < 0) {
    for (let k = 0; k < n.count; k++) n.setXYZ(k, 0, 1, 0);
    g.index.array.reverse();
  }
  return g;
}

// Box whose side UVs tile the facade atlas at one cell per window.
function facadeBox(w, h, d, r, cellW = 3.4, cellH = 3.3) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const N = 8;
  const u0 = Math.floor(r() * N) / N, v0 = Math.floor(r() * N) / N;
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

function tetrapodGeometry() {
  const parts = [];
  const dirs = [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]].map(v => new THREE.Vector3(...v).normalize());
  for (const d of dirs) {
    const c = new THREE.CylinderGeometry(0.2, 0.55, 1.5, 6);
    c.translate(0, 0.75, 0);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
    parts.push(c);
  }
  return mergeGeometries(parts.map(p => p.toNonIndexed()));
}

export function buildWorld(renderer) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1080 / 1920, 1, 60000);
  const path = makePath();
  const r = rng(19);
  const shared = skyUniforms();

  scene.fog = new THREE.FogExp2(0xffffff, 0.0002);

  // --- lights ---
  const hemi = new THREE.HemisphereLight(0xffffff, 0x777777, 1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  const sc = key.shadow.camera;
  sc.left = -900; sc.right = 900; sc.top = 900; sc.bottom = -900; sc.near = 100; sc.far = 8000;
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.8;
  key.target.position.set(-150, 0, 800);
  scene.add(key, key.target);

  // --- sky ---
  const skyMat = makeSkyMaterial(shared);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 64, 32), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);

  // --- sea and seabed ---
  const shore = [];
  for (let s = 0; s <= path.L; s += 8) shore.push(path.at(s, SEA_OFF));
  function shoreDist(x, z) {
    let best = Infinity;
    for (const p of shore) best = Math.min(best, (p.x - x) ** 2 + (p.z - z) ** 2);
    return Math.sqrt(best);
  }
  function seabedY(x, z) {
    const d = shoreDist(x, z);
    const n = Math.sin(x * 0.013) * Math.cos(z * 0.011) * 1.2 + Math.sin(x * 0.041 + z * 0.03) * 0.5;
    return Math.max(-38, -1.5 - d * 0.032 - d * d * 0.000012) + n;
  }

  const bedGeo = new THREE.PlaneGeometry(2800, 3200, 140, 160);
  bedGeo.rotateX(-Math.PI / 2);
  bedGeo.translate(-700, 0, 1100);
  {
    const p = bedGeo.attributes.position;
    const col = [];
    const shallow = new THREE.Color('#a39272'), deep = new THREE.Color('#5d5444'), weed = new THREE.Color('#5f6b45');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const y = seabedY(x, z);
      p.setY(i, y);
      const c = shallow.clone().lerp(deep, Math.min(1, -y / 20));
      if (Math.sin(x * 0.05) * Math.sin(z * 0.043) > 0.55) c.lerp(weed, 0.5);
      col.push(c.r, c.g, c.b);
    }
    bedGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    bedGeo.computeVertexNormals();
  }
  const seabed = new THREE.Mesh(bedGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 }));
  seabed.receiveShadow = true;
  scene.add(seabed);

  const waterMat = makeWaterMaterial(shared);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(120000, 120000).rotateX(-Math.PI / 2), waterMat);
  water.position.set(0, 0, 20000);
  scene.add(water);

  // --- land, with the sea wall as its side ---
  {
    const pts = shore.map(p => new THREE.Vector2(p.x, -p.z));
    const end = shore[shore.length - 1];
    pts.push(new THREE.Vector2(end.x - 60, -(end.z + 90)));
    pts.push(new THREE.Vector2(end.x - 40, -(end.z + 400)));
    pts.push(new THREE.Vector2(end.x + 60, -3600));
    pts.push(new THREE.Vector2(4000, -3600));
    pts.push(new THREE.Vector2(4000, 900));
    pts.push(new THREE.Vector2(shore[0].x, 900));
    const shape = new THREE.Shape(pts);
    const depth = 60;
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
    g.rotateX(-Math.PI / 2);
    const land = new THREE.Mesh(g, [
      new THREE.MeshStandardMaterial({ color: '#bdb5a5', roughness: 0.95 }),
      new THREE.MeshStandardMaterial({ color: '#a9a397', roughness: 0.9 }),
    ]);
    land.position.y = LAND_Y - depth;
    land.receiveShadow = true;
    scene.add(land);
  }

  // --- promenade, wall, road, footpath ---
  const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
  const add = (g, m, { shadow = true } = {}) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = shadow;
    scene.add(mesh);
    return mesh;
  };
  add(ribbon(path, SEA_OFF, -11.4, LAND_Y + 0.06), mat('#d6ccb8'));           // promenade
  add(ribbon(path, SEA_OFF, SEA_OFF + 0.9, LAND_Y + 0.65), mat('#e4dccb'));    // the wall people sit on
  add(ribbon(path, -11.4, 11.4, LAND_Y + 0.12), mat('#3b3d44'));               // carriageways
  add(ribbon(path, -1.0, 1.0, LAND_Y + 0.4), mat('#6d8752'));                  // median
  add(ribbon(path, 11.4, 17, LAND_Y + 0.18), mat('#cbc2b1'));                  // footpath
  add(ribbon(path, -10.9, -10.7, LAND_Y + 0.14), mat('#e8e4d8'));
  add(ribbon(path, 10.7, 10.9, LAND_Y + 0.14), mat('#e8e4d8'));
  {
    // dashed lane lines
    const dash = new THREE.BoxGeometry(3, 0.02, 0.16);
    const lanes = [-7.4, -3.8, 3.8, 7.4];
    const n = Math.floor(path.L / 9) * lanes.length;
    const im = new THREE.InstancedMesh(dash, new THREE.MeshStandardMaterial({ color: '#e9e6dc', roughness: 0.8 }), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    let k = 0;
    for (let s = 0; s + 9 <= path.L; s += 9) {
      for (const off of lanes) {
        const a = path.at(s, off);
        q.setFromEuler(e.set(0, a.yaw, 0));
        m.compose(new THREE.Vector3(a.x, LAND_Y + 0.14, a.z), q, new THREE.Vector3(1, 1, 1));
        im.setMatrixAt(k++, m);
      }
    }
    im.count = k;
    im.receiveShadow = true;
    scene.add(im);
  }

  // --- tetrapods ---
  {
    const geo = tetrapodGeometry();
    const rows = [[-21.6, 2.6], [-23.6, 1.3], [-25.8, -0.1], [-28, -1.4]];
    const n = Math.ceil(path.L / 1.3) * rows.length;
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#b5afa3', roughness: 0.95, flatShading: true }), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    let k = 0;
    for (let s = 0; s < path.L; s += 1.3) {
      for (const [off, y] of rows) {
        const a = path.at(s + r() * 0.8, off + (r() - 0.5) * 1.2);
        q.setFromEuler(e.set(r() * 6.28, r() * 6.28, r() * 6.28));
        const sz = 1.25 + r() * 0.35;
        m.compose(new THREE.Vector3(a.x, y + r() * 0.5, a.z), q, new THREE.Vector3(sz, sz, sz));
        im.setMatrixAt(k++, m);
      }
    }
    im.count = k;
    im.castShadow = true;
    im.receiveShadow = true;
    scene.add(im);
  }

  // --- buildings ---
  const deco = facadeTextures(7, { deco: true });
  const modern = facadeTextures(11, { glass: '#4c6070' });
  const glassT = facadeTextures(23, { glass: '#5f7a8f' });
  const buildingMats = [];
  const groups = new Map();
  function addBuilding(tex, color, x, z, yaw, w, h, d, cell) {
    const keyName = tex === deco ? 'd' : tex === modern ? 'm' : 'g';
    const k = `${keyName}${color}`;
    if (!groups.has(k)) groups.set(k, { tex, color, geos: [] });
    const g = facadeBox(w, h, d, r, ...(cell || []));
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, LAND_Y + h / 2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)));
    groups.get(k).geos.push(g);
  }
  const DECO = ['#efe6d2', '#f3dcc0', '#e8d3b8', '#f0e2cf', '#dccab0', '#f4ead9', '#ecccb4', '#e3e4dc', '#f1d9ab', '#d9e0d4'];
  const MODERN = ['#e8e6e0', '#d7d4cc', '#c9ccce', '#efe9dd', '#d2c7b8', '#bfc6cb'];
  const GLASS = ['#b9c8d4', '#a9bccb', '#cfd7dc', '#9fb1bf', '#dfe2e2'];

  // Row one: the Art Deco wall along the drive.
  for (let s = 30; s < path.L - 40;) {
    const w = 16 + r() * 12, d = 16 + r() * 6, h = 16 + r() * 11;
    const a = path.at(s + w / 2, 18.5 + d / 2);
    const c = DECO[Math.floor(r() * DECO.length)];
    addBuilding(deco, c, a.x, a.z, a.yaw, w, h, d);
    if (r() < 0.45) {
      const ch = 2.5 + r() * 3;
      const g = path.at(s + w / 2, 18.5 + d / 2 + 1.5);
      addBuilding(deco, c, g.x, g.z, a.yaw, w * 0.55, h + ch, d * 0.6);
    }
    s += w + 1.5 + r() * 3.5;
  }
  // Row two and three: taller blocks behind.
  for (let s = 20; s < path.L - 20;) {
    const w = 18 + r() * 16, d = 18 + r() * 10, h = 24 + r() * 34;
    const a = path.at(s + w / 2, 50 + d / 2 + r() * 10);
    addBuilding(modern, MODERN[Math.floor(r() * MODERN.length)], a.x, a.z, a.yaw, w, h, d);
    s += w + 4 + r() * 8;
  }
  for (let s = 0; s < path.L;) {
    const w = 20 + r() * 18, h = 40 + Math.pow(r(), 1.6) * 110;
    const a = path.at(s + w / 2, 105 + r() * 90);
    const tex = r() < 0.5 ? glassT : modern;
    addBuilding(tex, (tex === glassT ? GLASS : MODERN)[Math.floor(r() * 5)], a.x, a.z, a.yaw + (r() - 0.5) * 0.3, w, h, w * (0.7 + r() * 0.5));
    s += w + 10 + r() * 30;
  }
  // The city behind, and the Nariman Point cluster at the end of the curve.
  for (let i = 0; i < 260; i++) {
    const x = -200 + r() * 2400, z = 200 + r() * 3200;
    const off = path.offsetOf(x, z);
    if (off < 230) continue;
    const w = 22 + r() * 22, h = 50 + Math.pow(r(), 1.8) * 200;
    const tex = r() < 0.55 ? glassT : modern;
    addBuilding(tex, (tex === glassT ? GLASS : MODERN)[Math.floor(r() * 5)], x, z, r() * 3, w, h, w * (0.6 + r() * 0.6));
  }
  for (let i = 0; i < 70; i++) {
    const x = -700 + r() * 520, z = 1760 + r() * 700;
    const off = path.offsetOf(x, z);
    if (off < 30) continue;
    const w = 20 + r() * 20, h = 45 + Math.pow(r(), 1.4) * 120;
    const tex = r() < 0.6 ? glassT : modern;
    addBuilding(tex, (tex === glassT ? GLASS : MODERN)[Math.floor(r() * 5)], x, z, 0.5 + (r() - 0.5) * 0.4, w, h, w * (0.6 + r() * 0.5));
  }
  for (const { tex, color, geos } of groups.values()) {
    const m = new THREE.MeshStandardMaterial({ color, map: tex.map, emissiveMap: tex.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.82, metalness: 0 });
    buildingMats.push(m);
    const mesh = new THREE.Mesh(mergeGeometries(geos), m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // --- trees and palms ---
  {
    const canopyPos = [], palmPos = [];
    for (let s = 40; s < path.L - 40; s += 19 + r() * 10) {
      const a = path.at(s, 14.2 + (r() - 0.5));
      (r() < 0.45 ? palmPos : canopyPos).push(a);
    }
    for (let s = 60; s < path.L; s += 34 + r() * 20) canopyPos.push(path.at(s, 44 + r() * 4));
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.4, 1, 5).translate(0, 0.5, 0), mat('#6b5544'), canopyPos.length + palmPos.length);
    const canopy = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), canopyPos.length * 3);
    const leaf = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.12, 0.22).translate(0.5, 0, 0), new THREE.MeshStandardMaterial({ color: '#4f7a3a', roughness: 0.9, flatShading: true }), palmPos.length * 8);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const greens = ['#5d8d48', '#6e9c4f', '#4f7f3f', '#7aa356', '#8aa94d'].map(c => new THREE.Color(c));
    let ti = 0, ci = 0, li = 0;
    for (const a of canopyPos) {
      const h = 3.5 + r() * 2.5;
      m.compose(v.set(a.x, LAND_Y, a.z), q.identity(), sc.set(1, h, 1));
      trunk.setMatrixAt(ti++, m);
      for (let j = 0; j < 3; j++) {
        const s = 2.6 + r() * 1.8;
        q.setFromEuler(e.set(r() * 3, r() * 3, r() * 3));
        m.compose(v.set(a.x + (r() - 0.5) * 2.4, LAND_Y + h + 1.2 + r() * 1.6, a.z + (r() - 0.5) * 2.4), q, sc.set(s, s * 0.85, s));
        canopy.setMatrixAt(ci, m);
        canopy.setColorAt(ci++, greens[Math.floor(r() * greens.length)]);
      }
    }
    for (const a of palmPos) {
      const h = 9 + r() * 4;
      const lean = (r() - 0.5) * 0.12;
      q.setFromEuler(e.set(lean, 0, lean));
      m.compose(v.set(a.x, LAND_Y, a.z), q, sc.set(0.7, h, 0.7));
      trunk.setMatrixAt(ti++, m);
      const top = new THREE.Vector3(0, h, 0).applyQuaternion(q).add(new THREE.Vector3(a.x, LAND_Y, a.z));
      for (let j = 0; j < 8; j++) {
        q.setFromEuler(e.set(0, (j / 8) * Math.PI * 2 + r() * 0.4, -0.35 - r() * 0.35, 'YZX'));
        m.compose(top, q, sc.set(4 + r() * 1.2, 1, 1.4));
        leaf.setMatrixAt(li++, m);
      }
    }
    for (const im of [trunk, canopy, leaf]) {
      im.castShadow = true;
      im.receiveShadow = true;
      scene.add(im);
    }
  }

  // --- street lights: the Queen's Necklace ---
  const lampPositions = [];
  {
    const S = 32;
    const n = Math.floor(path.L / S);
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.18, 10, 6).translate(0, 5, 0), mat('#59606a'), n);
    const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.18, 0.18).translate(1.3, 0, 0), mat('#59606a'), n);
    const headMat = new THREE.MeshStandardMaterial({ color: '#f3e6c8', emissive: '#ffcf86', emissiveIntensity: 0 });
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.3, 0.45), headMat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < n; i++) {
      const a = path.at(i * S + 8, -11.8);
      m.compose(v.set(a.x, LAND_Y, a.z), q.identity(), one);
      pole.setMatrixAt(i, m);
      // arm reaches towards the road (the +offset direction)
      q.setFromEuler(e.set(0, Math.atan2(-a.n.z, a.n.x), 0));
      m.compose(v.set(a.x, LAND_Y + 9.9, a.z), q, one);
      arm.setMatrixAt(i, m);
      const hpos = path.at(i * S + 8, -9.4);
      m.compose(v.set(hpos.x, LAND_Y + 9.75, hpos.z), q, one);
      head.setMatrixAt(i, m);
      lampPositions.push(hpos.x, LAND_Y + 9.55, hpos.z);
    }
    pole.castShadow = arm.castShadow = true;
    scene.add(pole, arm, head);
    var lampHeadMat = headMat;
  }
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampPositions, 3));
  const glowMat = new THREE.PointsMaterial({ size: 9, map: glowTexture('rgba(255,236,190,1)', 'rgba(255,190,110,0.35)'), color: '#ffd9a0', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false });
  const glows = new THREE.Points(glowGeo, glowMat);
  scene.add(glows);
  const poolMat = new THREE.MeshBasicMaterial({ map: lightPoolTexture(), color: '#ffc77a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false });
  {
    const g = ribbon(path, -11.3, 3, LAND_Y + 0.2, { uLen: 32, step: 2 });
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) - 8 / 32 + 0.5);
    scene.add(new THREE.Mesh(g, poolMat));
  }

  // --- traffic: kaali-peeli taxis, cars, red double-deckers ---
  const vehicles = [];
  {
    const lanesS = [2.6, 6.1, 9.3], lanesN = [-2.6, -6.1, -9.3];
    for (let i = 0; i < 150; i++) {
      const south = r() < 0.5;
      const lane = (south ? lanesS : lanesN)[Math.floor(r() * 3)];
      const kind = r() < 0.06 ? 'bus' : r() < 0.42 ? 'taxi' : 'car';
      vehicles.push({ s0: r() * path.L, v: (kind === 'bus' ? 10 : 12 + r() * 6) * (south ? 1 : -1), lane, kind, c: r() });
    }
  }
  const nCars = vehicles.filter(v => v.kind !== 'bus').length;
  const nBus = vehicles.length - nCars;
  const carBody = new THREE.InstancedMesh(new THREE.BoxGeometry(4.1, 0.95, 1.75).translate(0, 0.72, 0), new THREE.MeshStandardMaterial({ roughness: 0.45 }), nCars);
  const carTop = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.62, 1.6).translate(-0.2, 1.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.4 }), nCars);
  const busBody = new THREE.InstancedMesh(new THREE.BoxGeometry(11, 4.1, 2.55).translate(0, 2.35, 0), new THREE.MeshStandardMaterial({ color: '#c3322b', roughness: 0.6 }), nBus);
  const busWin = new THREE.InstancedMesh(new THREE.BoxGeometry(10.4, 0.75, 2.6).translate(0, 2.0, 0), new THREE.MeshStandardMaterial({ color: '#2b3038', roughness: 0.3 }), nBus * 2);
  {
    const CAR = ['#f2f2ee', '#b9bcc0', '#7d8288', '#2f4f7a', '#8c2a2a', '#e8e3d6'].map(c => new THREE.Color(c));
    const black = new THREE.Color('#1b1b1d'), yellow = new THREE.Color('#f2c230'), glass = new THREE.Color('#3a4250');
    let ci = 0;
    for (const v of vehicles) {
      if (v.kind === 'bus') continue;
      v.idx = ci;
      if (v.kind === 'taxi') {
        carBody.setColorAt(ci, black);
        carTop.setColorAt(ci, yellow);
      } else {
        carBody.setColorAt(ci, CAR[Math.floor(v.c * CAR.length)]);
        carTop.setColorAt(ci, glass.clone().lerp(CAR[Math.floor(v.c * CAR.length)], 0.15));
      }
      ci++;
    }
    let bi = 0;
    for (const v of vehicles) if (v.kind === 'bus') v.idx = bi++;
  }
  for (const im of [carBody, carTop, busBody, busWin]) {
    im.castShadow = true;
    im.receiveShadow = true;
    scene.add(im);
  }

  // --- people sitting on the wall ---
  const people = [];
  for (let s = 40; s < 1000; s += 1.6 + r() * 5) people.push({ s, off: SEA_OFF + 0.45, th: r(), c: r() });
  const peopleIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 1.15, 0.4).translate(0, 0.58, 0), new THREE.MeshStandardMaterial({ roughness: 0.9 }), people.length);
  {
    const CL = ['#f4f1ea', '#d9534f', '#3e6fb0', '#f0ad4e', '#5cb85c', '#2d2d34', '#e8c4a0', '#9b59b6', '#f7e1a0'].map(c => new THREE.Color(c));
    people.forEach((p, i) => peopleIM.setColorAt(i, CL[Math.floor(p.c * CL.length)]));
    peopleIM.castShadow = true;
    scene.add(peopleIM);
  }

  // --- fishing boats ---
  const boats = [];
  {
    const hullCols = ['#2e66b3', '#d23c3c', '#f0b62f', '#2f9a7a', '#e9e6dd'];
    for (let i = 0; i < 12; i++) {
      const a = path.at(160 + r() * 1150, SEA_OFF - 60 - r() * 380);
      const g = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(9, 1.5, 2.6).translate(0, 0.4, 0), mat(hullCols[i % hullCols.length]));
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 1.9).translate(-1.6, 1.8, 0), mat('#f1ede4'));
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 5).translate(1.5, 3.6, 0), mat('#5a4b3c'));
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7).translate(2.1, 5.6, 0), new THREE.MeshStandardMaterial({ color: ['#e5432f', '#f2a81d', '#2c7be5'][i % 3], side: THREE.DoubleSide }));
      g.add(hull, cabin, mast, flag);
      g.rotation.y = r() * 6.28;
      g.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
      scene.add(g);
      boats.push({ g, x: a.x, z: a.z, bed: seabedY(a.x, a.z), ph: r() * 6.28, tilt: (r() - 0.5) * 0.5 });
    }
  }

  // --- the Moon ---
  const moonMat = makeMoonMaterial(shared, moonTexture(3));
  const moon = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), moonMat);
  moon.renderOrder = -5;
  moon.frustumCulled = false;
  scene.add(moon);
  const moonGlowMat = new THREE.SpriteMaterial({ map: glowTexture('rgba(255,255,255,0.9)', 'rgba(200,215,255,0.22)'), color: '#dfe7ff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const moonGlow = new THREE.Sprite(moonGlowMat);
  moonGlow.renderOrder = -6;
  scene.add(moonGlow);

  // Fragments that fly apart at the Roche limit.
  const chunkMat = new THREE.ShaderMaterial({
    uniforms: { uLight: { value: new THREE.Vector3(0, 0, 1) }, uHeat: { value: 1 }, uAlpha: { value: 1 } },
    transparent: true,
    vertexShader: /* glsl */ `
      varying vec3 vN;
      void main() {
        mat4 m = modelMatrix * instanceMatrix;
        vN = normalize(mat3(m) * normal);
        gl_Position = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uLight; uniform float uHeat, uAlpha;
      varying vec3 vN;
      void main() {
        float l = max(dot(normalize(vN), normalize(uLight)), 0.0);
        vec3 c = vec3(0.78, 0.76, 0.72) * (0.08 + 1.2 * l);
        c += vec3(1.0, 0.42, 0.12) * uHeat * (1.0 - l) * 0.9;
        gl_FragColor = vec4(c, uAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const chunkGeo = new THREE.IcosahedronGeometry(1, 1);
  {
    const p = chunkGeo.attributes.position;
    const jr = rng(5);
    for (let i = 0; i < p.count; i++) {
      const k = 0.75 + jr() * 0.5;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    chunkGeo.computeVertexNormals();
  }
  const NCH = 140;
  const chunks = new THREE.InstancedMesh(chunkGeo, chunkMat, NCH);
  chunks.frustumCulled = false;
  chunks.renderOrder = -4;
  scene.add(chunks);
  const chunkData = [];
  for (let i = 0; i < NCH; i++) {
    const d = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    chunkData.push({ d, size: 0.07 + Math.pow(r(), 2.2) * 0.28, along: (r() - 0.5) * 2, out: 0.2 + r() * 0.9, spin: new THREE.Vector3(r(), r(), r()) });
  }

  // --- meteors: thin additive streaks drawn on the sky ---
  const NMET = 140;
  const metGeo = new THREE.BufferGeometry();
  metGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(NMET * 4 * 3), 3));
  metGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(NMET * 4 * 4), 4));
  {
    const idx = [];
    for (let i = 0; i < NMET; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2);
    metGeo.setIndex(idx);
  }
  const meteors = new THREE.Mesh(metGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }));
  meteors.frustumCulled = false;
  meteors.renderOrder = -3;
  scene.add(meteors);
  const metData = [];
  for (let i = 0; i < NMET; i++) {
    metData.push({ t0: 51.5 + r() * 9, dur: 0.45 + r() * 0.8, az: -6 + r() * 34, el: 6 + r() * 20, dAz: (r() - 0.35) * 14, dEl: -(6 + r() * 12), w: 0.0012 + Math.pow(r(), 3) * 0.006 });
  }

  // ------------------------------------------------------------------------

  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3();
  const CAM_POS = new THREE.Vector3(24, 34, -20);

  function update(st) {
    const pal = blendPalette(st.look);
    const t = st.t;

    // camera, with a little shake when the ground heaves
    camera.position.copy(CAM_POS);
    if (st.quake > 0) {
      const q = st.quake;
      camera.position.x += (Math.sin(t * 23.1) + Math.sin(t * 37.7)) * 0.35 * q;
      camera.position.y += (Math.sin(t * 29.3) + Math.sin(t * 17.9)) * 0.3 * q;
    }
    if (camera.fov !== st.fov) {
      camera.fov = st.fov;
      camera.updateProjectionMatrix();
    }
    const fwd = dirFrom(st.camYaw, st.camPitch);
    camera.lookAt(tmpV.copy(camera.position).add(fwd));
    if (st.quake > 0) camera.rotateZ(Math.sin(t * 19.3) * 0.004 * st.quake);
    camera.updateMatrixWorld();

    renderer.toneMappingExposure = pal.exposure;

    const sunDir = dirFrom(st.sun.az, st.sun.el);
    const moonDir = dirFrom(st.moon.az, st.moon.el);
    shared.uZenith.value.copy(pal.zenith);
    shared.uHorizon.value.copy(pal.horizon);
    shared.uSunDir.value.copy(sunDir);
    shared.uSunColor.value.copy(pal.sun);
    shared.uSunGlow.value = pal.glow;
    shared.uFogColor.value.copy(pal.fog);
    shared.uFogDensity.value = pal.fogD;
    scene.fog.color.copy(pal.fog);
    scene.fog.density = pal.fogD;

    hemi.color.copy(pal.hemiSky);
    hemi.groundColor.copy(pal.hemiGround);
    hemi.intensity = pal.hemiI;

    // Key light follows the sun by day, a high moonlight by night.
    const dayness = THREE.MathUtils.smoothstep(st.sun.el, -4, 6);
    const keyDir = sunDir.y > 0.02 ? sunDir.clone() : dirFrom(-20, 38);
    key.position.copy(key.target.position).addScaledVector(keyDir, 3000);
    key.color.copy(pal.keyColor);
    key.intensity = pal.sunI;

    skyMat.uniforms.uStars.value = pal.stars;
    skyMat.uniforms.uSunDisc.value = dayness;
    skyMat.uniforms.uRing.value = st.ring > 0 ? 0.95 : 0;
    skyMat.uniforms.uRingSpread.value = st.ring;
    skyMat.uniforms.uRingBright.value = 1.15 + (1 - dayness) * 0.6;

    // Moon: its true angular size, placed far away along its direction.
    const D = 20000;
    const R = D * Math.tan(st.moonAngle / 2);
    const mpos = tmpV.copy(camera.position).addScaledVector(moonDir, D);
    const b = st.breakup;
    moon.position.copy(mpos);
    moon.scale.setScalar(R * (1 - 0.6 * b));
    moon.lookAt(camera.position);
    moon.rotateY(Math.PI);
    const flatSun = new THREE.Vector3(sunDir.x, 0, sunDir.z).normalize();
    const moonLight = moonDir.clone().negate().addScaledVector(flatSun, 0.45).normalize();
    moonMat.uniforms.uLight.value.copy(moonLight);
    moonMat.uniforms.uDay.value = dayness;
    moonMat.uniforms.uCrack.value = st.crack;
    moonMat.uniforms.uBright.value = 1.25 + (1 - dayness) * 0.5;
    moonMat.uniforms.uAlpha.value = 1 - THREE.MathUtils.smoothstep(b, 0.55, 0.95);
    moon.visible = moonMat.uniforms.uAlpha.value > 0.001;
    moonGlow.position.copy(mpos).addScaledVector(moonDir, -10);
    moonGlow.scale.setScalar(R * 7 + 300);
    moonGlowMat.opacity = (0.12 + (1 - dayness) * 0.5) * moonMat.uniforms.uAlpha.value * (st.moonAngle > 0.03 ? 1 : 0.8);

    // Fragments drift apart along the orbit (screen-left, the way it moves).
    chunks.visible = b > 0;
    if (b > 0) {
      const along = new THREE.Vector3().crossVectors(moonDir, new THREE.Vector3(0, 1, 0)).normalize().negate();
      const up = new THREE.Vector3().crossVectors(along, moonDir).normalize();
      chunkData.forEach((c, i) => {
        const spread = b * b;
        tmpS.copy(mpos)
          .addScaledVector(c.d, R * (0.7 + c.out * b * 1.6))
          .addScaledVector(along, R * c.along * spread * 9)
          .addScaledVector(up, R * c.along * spread * 1.2);
        tmpQ.setFromEuler(tmpE.set(c.spin.x * t, c.spin.y * t, c.spin.z * t));
        const s = R * c.size * Math.min(1, b * 4) * (1 - 0.5 * b);
        tmpM.compose(tmpS, tmpQ, new THREE.Vector3(s, s, s));
        chunks.setMatrixAt(i, tmpM);
      });
      chunks.instanceMatrix.needsUpdate = true;
      chunkMat.uniforms.uLight.value.copy(moonLight);
      chunkMat.uniforms.uHeat.value = 1 - b * 0.7;
      chunkMat.uniforms.uAlpha.value = 1 - THREE.MathUtils.smoothstep(b, 0.75, 1);
    }

    // Meteors
    {
      const pos = metGeo.attributes.position, col = metGeo.attributes.color;
      const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      metData.forEach((m, i) => {
        const k = (t - m.t0) / m.dur;
        let a = 0;
        if (k > 0 && k < 1 && st.meteors > 0) a = Math.sin(k * Math.PI) * st.meteors;
        const head = dirFrom(m.az + m.dAz * k, m.el + m.dEl * k).multiplyScalar(15000).add(camera.position);
        const tail = dirFrom(m.az + m.dAz * (k - 0.35), m.el + m.dEl * (k - 0.35)).multiplyScalar(15000).add(camera.position);
        const side = new THREE.Vector3().subVectors(head, tail).cross(tmpV.subVectors(head, camera.position)).normalize().multiplyScalar(15000 * m.w);
        if (!isFinite(side.x)) side.copy(camRight).multiplyScalar(15000 * m.w);
        const pts = [head.clone().add(side), head.clone().sub(side), tail.clone().add(side.clone().multiplyScalar(0.2)), tail.clone().sub(side.clone().multiplyScalar(0.2))];
        pts.forEach((p, j) => pos.setXYZ(i * 4 + j, p.x, p.y, p.z));
        const hc = [1.0, 0.85, 0.6], tc = [1.0, 0.5, 0.2];
        for (let j = 0; j < 4; j++) {
          const c = j < 2 ? hc : tc;
          col.setXYZW(i * 4 + j, c[0] * a * 3, c[1] * a * 3, c[2] * a * 3, j < 2 ? a : 0);
        }
      });
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }

    // Sea
    water.position.y = st.seaLevel;
    waterMat.uniforms.uTime.value = t;
    waterMat.uniforms.uWave.value = st.waves;
    waterMat.uniforms.uDeep.value.copy(pal.water);
    waterMat.uniforms.uMoonDir.value.copy(moonDir);
    waterMat.uniforms.uMoonGlint.value = (1 - dayness) * (st.breakup < 0.9 ? 0.9 : 0) * Math.min(1, st.moonAngle / 0.02 + 0.3);
    waterMat.uniforms.uMoonSize.value = st.moonAngle;

    // Lights of the city
    for (const m of buildingMats) m.emissiveIntensity = st.cityLights * 1.6;
    glowMat.opacity = st.streetLights;
    poolMat.opacity = st.streetLights * 0.55;
    lampHeadMat.emissiveIntensity = st.streetLights * 3;

    // Traffic
    const clock = trafficClock(t);
    let ci = 0, bi = 0;
    for (const v of vehicles) {
      let s = (v.s0 + v.v * clock) % path.L;
      if (s < 0) s += path.L;
      const a = path.at(s, v.lane);
      const yaw = a.yaw + (v.v < 0 ? Math.PI : 0);
      tmpQ.setFromEuler(tmpE.set(0, yaw, 0));
      tmpM.compose(tmpV.set(a.x, LAND_Y + 0.12, a.z), tmpQ, tmpS.set(1, 1, 1));
      if (v.kind === 'bus') {
        busBody.setMatrixAt(v.idx, tmpM);
        busWin.setMatrixAt(v.idx * 2, tmpM);
        const up = tmpM.clone().multiply(new THREE.Matrix4().makeTranslation(0, 1.55, 0));
        busWin.setMatrixAt(v.idx * 2 + 1, up);
        bi++;
      } else {
        carBody.setMatrixAt(v.idx, tmpM);
        carTop.setMatrixAt(v.idx, tmpM);
        ci++;
      }
    }
    for (const im of [carBody, carTop, busBody, busWin]) im.instanceMatrix.needsUpdate = true;

    // People leave as the water comes.
    people.forEach((p, i) => {
      const a = path.at(p.s, p.off);
      const vis = p.th < st.people ? 1 : 0;
      tmpQ.setFromEuler(tmpE.set(0, a.yaw, 0));
      tmpM.compose(tmpV.set(a.x, LAND_Y + 0.65, a.z), tmpQ, tmpS.set(vis, vis, vis));
      peopleIM.setMatrixAt(i, tmpM);
    });
    peopleIM.instanceMatrix.needsUpdate = true;

    // Boats float, or sit on the mud when the bay drains.
    for (const bt of boats) {
      const bob = Math.sin(t * 1.3 + bt.ph) * 0.25 * (0.5 + st.waves);
      const floatY = st.seaLevel + bob - 0.2;
      const grounded = floatY < bt.bed + 0.4;
      bt.g.position.set(bt.x, Math.max(floatY, bt.bed + 0.4), bt.z);
      bt.g.rotation.x = grounded ? bt.tilt : Math.sin(t * 1.1 + bt.ph) * 0.05 * (0.5 + st.waves);
      bt.g.rotation.z = grounded ? bt.tilt * 0.6 : Math.cos(t * 0.9 + bt.ph) * 0.06 * (0.5 + st.waves);
    }

    sky.position.copy(camera.position);
  }

  return { scene, camera, update };
}
