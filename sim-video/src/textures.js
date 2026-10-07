import * as THREE from 'three';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

// An 8×8 atlas of facade cells. The colour map is white walls (tinted by the
// material) with glass; the emissive map lights a random third of the windows.
export function facadeTextures(seed, { glass = '#41505f', frame = '#e9e4da', deco = false } = {}) {
  const N = 8, S = 64;
  const [c, g] = canvas(N * S, N * S);
  const [e, ge] = canvas(N * S, N * S);
  const r = rng(seed);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, N * S, N * S);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, N * S, N * S);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const ox = x * S, oy = y * S;
      if (deco) {
        g.fillStyle = frame;
        g.fillRect(ox, oy + S - 7, S, 7);
      }
      g.fillStyle = glass;
      const wx = deco ? 10 : 6, wy = deco ? 12 : 8;
      g.fillRect(ox + wx, oy + wy, S - wx * 2, S - wy * 2 - (deco ? 6 : 0));
      if (r() < 0.38) {
        const warm = r() < 0.8;
        ge.fillStyle = warm ? `hsl(${34 + r() * 12}, 90%, ${55 + r() * 20}%)` : `hsl(200, 40%, ${60 + r() * 20}%)`;
        ge.fillRect(ox + wx, oy + wy, S - wx * 2, S - wy * 2 - (deco ? 6 : 0));
      }
    }
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const emissive = new THREE.CanvasTexture(e);
  emissive.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, emissive]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  }
  return { map, emissive, cells: N };
}

// Equirectangular Moon: bright highlands, dark maria on the near side, craters.
export function moonTexture(seed) {
  const W = 1024, H = 512;
  const [c, g] = canvas(W, H);
  const r = rng(seed);
  g.fillStyle = '#c9c7c0';
  g.fillRect(0, 0, W, H);
  // mottling
  for (let i = 0; i < 2600; i++) {
    const x = r() * W, y = r() * H, rad = 4 + r() * 26;
    g.fillStyle = `rgba(${r() < 0.5 ? '90,88,84' : '235,233,226'},${0.05 + r() * 0.06})`;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  // maria: clustered dark blobs around the near-side centre (u = 0.75)
  const maria = [[0.72, 0.36, 70], [0.8, 0.42, 58], [0.68, 0.5, 52], [0.77, 0.58, 44], [0.86, 0.33, 38], [0.63, 0.4, 40], [0.74, 0.66, 30]];
  for (const [u, v, s] of maria) {
    for (let k = 0; k < 40; k++) {
      const x = u * W + (r() - 0.5) * s * 1.6, y = v * H + (r() - 0.5) * s * 1.2;
      g.fillStyle = `rgba(78,80,84,${0.08 + r() * 0.08})`;
      g.beginPath();
      g.arc(x, y, s * (0.25 + r() * 0.45), 0, Math.PI * 2);
      g.fill();
    }
  }
  // craters
  for (let i = 0; i < 520; i++) {
    const x = r() * W, y = 30 + r() * (H - 60);
    const rad = Math.pow(r(), 3) * 22 + 1.5;
    g.fillStyle = 'rgba(70,70,68,0.28)';
    g.beginPath();
    g.arc(x + rad * 0.15, y + rad * 0.15, rad, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(245,244,238,0.2)';
    g.lineWidth = Math.max(1, rad * 0.22);
    g.beginPath();
    g.arc(x - rad * 0.1, y - rad * 0.1, rad, Math.PI * 0.9, Math.PI * 1.9);
    g.stroke();
  }
  // a couple of ray craters
  for (const [u, v] of [[0.73, 0.78], [0.66, 0.31]]) {
    const x = u * W, y = v * H;
    for (let k = 0; k < 26; k++) {
      const a = r() * Math.PI * 2, len = 30 + r() * 70;
      g.strokeStyle = 'rgba(250,250,245,0.12)';
      g.lineWidth = 2 + r() * 3;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len * 0.6);
      g.stroke();
    }
    g.fillStyle = 'rgba(252,252,248,0.7)';
    g.beginPath();
    g.arc(x, y, 5, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function glowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.25)') {
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.18, mid);
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Soft pools of lamplight laid along the road, one per lamp spacing.
export function lightPoolTexture() {
  const [c, g] = canvas(128, 64);
  const grd = g.createRadialGradient(64, 32, 0, 64, 32, 60);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
