// "One driver brakes on ORR" — under 30 seconds. Video time t maps to
// simulation time through a clock that speeds up from real time to ~600×
// and back, so the brake is seen live and the hour after it in seconds.

export const FPS = 30;
export const DURATION = 29.5;
export const BRAKE_AT = 3.5;    // sim seconds
export const BRAKE_S = 1200;    // where on the loop the driver brakes (m)

const smooth = x => x * x * (3 - 2 * x);
const clamp01 = x => Math.min(1, Math.max(0, x));

// Clock speed (sim seconds per video second), linear between keys.
const RATE = [
  [0, 1], [5.8, 1], [8.5, 3], [11, 20], [13.5, 55], [15.5, 120], [18, 400], [21, 750], [22.6, 400], [23.6, 12], [24.6, 2.5], [29.5, 1.8],
];

function rateAt(t) {
  if (t <= RATE[0][0]) return RATE[0][1];
  for (let i = 1; i < RATE.length; i++) {
    const [t1, r1] = RATE[i];
    if (t <= t1) {
      const [t0, r0] = RATE[i - 1];
      return r0 + ((r1 - r0) * (t - t0)) / (t1 - t0);
    }
  }
  return RATE[RATE.length - 1][1];
}

const TABLE = (() => {
  const dt = 1 / 600;
  const out = [0];
  for (let i = 1; i * dt <= DURATION + 0.5; i++) out.push(out[i - 1] + rateAt((i - 0.5) * dt) * dt);
  return { dt, out };
})();

export function simTime(t) {
  const f = Math.max(0, t / TABLE.dt);
  const i = Math.min(TABLE.out.length - 2, Math.floor(f));
  return TABLE.out[i] + (TABLE.out[i + 1] - TABLE.out[i]) * (f - i);
}

function videoTimeOf(sim) {
  let lo = 0, hi = DURATION;
  for (let k = 0; k < 50; k++) {
    const m = (lo + hi) / 2;
    if (simTime(m) < sim) lo = m; else hi = m;
  }
  return lo;
}

export const STAMPS = [
  [videoTimeOf(BRAKE_AT + 300), '+5', 'MINUTES'],
  [videoTimeOf(BRAKE_AT + 1200), '+20', 'MINUTES'],
  [videoTimeOf(BRAKE_AT + 3600), '+1', 'HOUR'],
];

export const CAPTIONS = [
  [3.7, 6.5, 'One driver brakes. Just for a second.'],
  [6.8, 9.6, 'The car behind brakes a little harder.'],
  [9.8, 12.6, 'And the one behind that. And the one behind that.'],
  [13.0, 16.6, 'The jam travels backwards, at 15 km/h.'],
  [17.0, 20.6, 'The driver who braked never even noticed.'],
  [22.5, 25.5, 'An hour later, the jam is still here.'],
  [25.8, 28.8, 'Scientists call it a phantom jam.'],
];

const pad = n => String(n).padStart(2, '0');

export function stateAt(t) {
  const sim = simTime(t);
  const since = Math.max(0, sim - BRAKE_AT);
  const h = Math.floor(since / 3600), m = Math.floor((since % 3600) / 60), s = Math.floor(since % 60);

  let caption = null;
  for (const [t0, t1, text] of CAPTIONS) {
    if (t >= t0 && t <= t1) caption = { text, o: clamp01(Math.min((t - t0) / 0.35, (t1 - t) / 0.3)) };
  }
  let stamp = null;
  for (const [ts, value, label] of STAMPS) {
    const dt = t - ts;
    if (dt >= 0 && dt < 1.9) stamp = { value, label, o: clamp01(Math.min(dt / 0.2, (1.9 - dt) / 0.45)), s: 1 + 0.06 * (1 - smooth(clamp01(dt / 0.5))) };
  }
  const title = t < 3.4 ? { text: 'What if one driver taps the brakes on ORR?', o: clamp01(Math.min((t - 0.2) / 0.5, (3.4 - t) / 0.4)) } : null;

  return {
    t,
    sim,
    rate: rateAt(t),
    // 0 = dusk, 1 = full night; the video opens just after sunset
    night: 0.3 + 0.7 * smooth(clamp01(sim / 2400)),
    marker: clamp01(Math.min((t - 2.4) / 0.4, (8.6 - t) / 0.6)),
    fade: clamp01((t - 28.9) / 0.6),
    hud: {
      title,
      caption,
      stamp,
      counter: { label: 'TIME SINCE THE BRAKE', value: `${h}:${pad(m)}:${pad(s)}`, unit: 'HOURS : MINUTES : SECONDS' },
      show: clamp01((t - 3.2) / 0.4),
    },
  };
}
