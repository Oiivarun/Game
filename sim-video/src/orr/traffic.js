// Outer Ring Road traffic with the Intelligent Driver Model (Treiber, Hennecke
// & Helbing, 2000). Each vehicle only looks at the one ahead in its lane. At
// rush-hour density the flow is "string unstable": a small disturbance grows
// as it passes backwards from car to car, which is how phantom jams form.
//
// The road is a loop (it is a ring road), so the jam can circulate the way it
// did on the 230 m track in Sugiyama et al. (2008).

const TYPES = {
  scooter: { len: 1.9, v0: 15.5, T: 1.0, a: 1.3, b: 2.0, s0: 1.5, w: 0.75 },
  auto: { len: 2.9, v0: 12.8, T: 1.2, a: 0.8, b: 1.6, s0: 1.8, w: 1.35 },
  car: { len: 4.3, v0: 16.7, T: 1.2, a: 1.0, b: 1.6, s0: 2.0, w: 1.75 },
  cab: { len: 4.4, v0: 16.7, T: 1.1, a: 1.0, b: 1.6, s0: 2.0, w: 1.75 },
  tempo: { len: 5.5, v0: 13.5, T: 1.4, a: 0.7, b: 1.4, s0: 2.2, w: 1.9 },
  bus: { len: 12, v0: 13.9, T: 1.5, a: 0.6, b: 1.3, s0: 2.5, w: 2.55 },
};
const MIX = [['scooter', 0.27], ['auto', 0.14], ['car', 0.33], ['cab', 0.13], ['tempo', 0.07], ['bus', 0.06]];

export { TYPES };

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

function pick(r) {
  let x = r();
  for (const [k, p] of MIX) {
    if ((x -= p) < 0) return k;
  }
  return 'car';
}

// Equilibrium gap for speed v: the IDM acceleration is zero there.
function gapAt(p, v) {
  const free = 1 - (v / p.v0) ** 4;
  return free <= 0 ? Infinity : (p.s0 + v * p.T) / Math.sqrt(free);
}

function idm(p, v, gap, dv) {
  const s = Math.max(0.1, gap);
  const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.a * p.b)));
  return p.a * (1 - (v / p.v0) ** 4 - (sStar / s) ** 2);
}

/**
 * Runs the loop and records a snapshot at each requested time.
 * brakes: [{ lane, at, t0, dur, decel }], at = road position of the driver
 * who brakes (the vehicle nearest it at t0).
 */
export function simulate({ L = 5000, lanes = 3, density = 0.04, seed = 3, times, brakes = [], dt = 0.1, aScale = 1, TScale = 1 }) {
  const r = rng(seed);
  const laneData = [];
  for (let l = 0; l < lanes; l++) {
    const n = Math.round(L * density);
    const kind = [], p = [];
    for (let i = 0; i < n; i++) {
      kind.push(pick(r));
      const base = TYPES[kind[i]];
      p.push({ ...base, a: base.a * aScale, T: base.T * TScale });
    }
    // Find the common speed at which the evenly spaced queue exactly fills
    // the loop, so the flow starts in perfect equilibrium.
    let lo = 0, hi = 16;
    for (let k = 0; k < 60; k++) {
      const v = (lo + hi) / 2;
      let total = 0;
      for (const q of p) total += q.len + gapAt(q, v);
      if (total > L) hi = v; else lo = v;
    }
    const v = lo;
    const x = new Float64Array(n), vel = new Float64Array(n), acc = new Float64Array(n);
    let pos = 0;
    // Vehicle i follows vehicle i+1; place from the back of the queue forward.
    for (let i = 0; i < n; i++) {
      x[i] = pos;
      vel[i] = v;
      pos += gapAt(p[i], v) + p[(i + 1) % n].len;
    }
    // Spread any rounding left over evenly.
    const slack = (L - pos) / n;
    for (let i = 0; i < n; i++) x[i] += slack * i;
    laneData.push({ n, kind, p, x, v: vel, a: acc, veq: v, phase: r() * L });
    for (let i = 0; i < n; i++) x[i] = (x[i] + laneData[l].phase) % L;
  }

  // Resolve who brakes: the vehicle nearest the given spot when it happens.
  const pending = brakes.map(b => ({ ...b, who: -1 }));

  const order = times.map((t, i) => [t, i]).sort((a, b) => a[0] - b[0]);
  const snaps = new Array(times.length);
  let k = 0, t = 0;
  const steps = Math.ceil(order[order.length - 1][0] / dt) + 1;
  const take = () => snaps[order[k][1]] = laneData.map(d => ({ x: Float32Array.from(d.x), v: Float32Array.from(d.v), a: Float32Array.from(d.a) }));
  for (let step = 0; step <= steps && k < order.length; step++) {
    for (const b of pending) {
      if (b.who < 0 && t >= b.t0) {
        const d = laneData[b.lane];
        let best = Infinity;
        for (let i = 0; i < d.n; i++) {
          const dd = Math.abs(d.x[i] - b.at);
          if (dd < best) { best = dd; b.who = i; }
        }
      }
    }
    for (let l = 0; l < lanes; l++) {
      const d = laneData[l];
      for (let i = 0; i < d.n; i++) {
        const j = (i + 1) % d.n;
        let gap = d.x[j] - d.x[i] - d.p[j].len;
        if (gap < -L / 2) gap += L;
        d.a[i] = idm(d.p[i], d.v[i], gap, d.v[i] - d.v[j]);
      }
      for (const b of pending) {
        if (b.lane === l && b.who >= 0 && t >= b.t0 && t < b.t0 + b.dur) d.a[b.who] = Math.min(d.a[b.who], -b.decel);
      }
    }
    while (k < order.length && order[k][0] <= t + 1e-9) {
      take();
      k++;
    }
    for (const d of laneData) {
      for (let i = 0; i < d.n; i++) {
        const v1 = Math.max(0, d.v[i] + d.a[i] * dt);
        d.x[i] = (d.x[i] + (d.v[i] + v1) * 0.5 * dt + L) % L;
        d.v[i] = v1;
      }
    }
    t += dt;
  }
  while (k < order.length) {
    take();
    k++;
  }
  return {
    L,
    lanes: laneData.map(d => ({ n: d.n, kind: d.kind, veq: d.veq })),
    snaps,
    culprit: pending[0] ? { lane: pending[0].lane, index: pending[0].who } : null,
  };
}
