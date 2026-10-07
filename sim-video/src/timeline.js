// Everything that changes over the video is a pure function of t (seconds),
// so any frame can be rendered on its own, in any order.

export const FPS = 30;
export const DURATION = 76;

export const MOON_RADIUS_KM = 1737;
export const MOON_DISTANCE_KM = 384400;
export const ROCHE_KM = 18400;

const smooth = x => x * x * (3 - 2 * x);
const clamp01 = x => Math.min(1, Math.max(0, x));

// keys: [[t, value], ...]; eased between neighbours, held outside the range.
function track(keys, ease = smooth) {
  return t => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1] = keys[i];
      if (t <= t1) {
        const [t0, v0] = keys[i - 1];
        return v0 + (v1 - v0) * ease((t - t0) / (t1 - t0));
      }
    }
    return keys[keys.length - 1][1];
  };
}

// Distance eases in log space so every halving takes similar screen time.
const logDist = track([
  [0, Math.log(384400)],
  [8, Math.log(384400)],
  [12, Math.log(300000)],
  [18, Math.log(200000)],
  [26, Math.log(100000)],
  [34, Math.log(40000)],
  [42, Math.log(25000)],
  [48.5, Math.log(ROCHE_KM)],
]);

// Sea level in metres relative to today's mean. Road sits at +4.5.
const tide = track([
  [0, 0.4], [10, 0.6],
  [12.5, 6.5], [14.5, 2.0],               // spills over the wall
  [17.5, 9.0], [20, 1.0], [22.5, -14],    // floods, then the bay drains
  [24, -10], [26.5, 10], [32, 9.5],       // swallows the street
  [34, 6], [40, 8],
  [43, 26], [47, 24],
  [52, 8], [60, 0.2], [76, 0.2],
]);

// Look names blend between the palettes in scene.js.
const LOOKS = [
  [0, 'sunset'], [9, 'sunset'], [11, 'day'], [23.5, 'day'],
  [26, 'dusk'], [29, 'night'], [32, 'night'], [34, 'day'], [40, 'day'],
  [42, 'storm'], [46.5, 'storm'], [48, 'night'], [62, 'night'], [67, 'twilight'], [76, 'twilight'],
];

function lookAt(t) {
  if (t <= LOOKS[0][0]) return { a: LOOKS[0][1], b: LOOKS[0][1], k: 0 };
  for (let i = 1; i < LOOKS.length; i++) {
    if (t <= LOOKS[i][0]) {
      const [t0, a] = LOOKS[i - 1];
      const [t1, b] = LOOKS[i];
      return { a, b, k: smooth((t - t0) / (t1 - t0)) };
    }
  }
  const last = LOOKS[LOOKS.length - 1][1];
  return { a: last, b: last, k: 0 };
}

// Directions are (azimuth from south toward west, elevation), in degrees.
const sunAz = track([[0, 112], [10, 112], [11, 45], [23, 80], [26, 100], [29, 150], [32, 200], [33.9, 200], [34, 55], [40, 70], [47, 80], [48, -150], [55, -150], [55.1, 108], [76, 108]], x => x);
const sunEl = track([[0, 2.5], [9, 1.5], [11, 38], [23, 22], [26, -3], [29, -25], [33.9, -40], [34, 42], [40, 34], [47, 30], [48, -40], [55, -40], [55.1, -30], [64, -16], [72, -8], [76, -9]]);

const moonAz = track([[0, 1], [10, 0], [11, 2], [24, 3], [32, 4], [33.9, 4], [34, 20], [36.8, 20], [41, 18], [47, 12], [52, 11]]);
const moonEl = track([[0, 7], [10, 9], [11, 11], [24, 13], [32, 15], [33.9, 15], [34, -12], [36.8, -5], [41, 7], [47, 12], [52, 13]]);

// The ending tilts up and widens to find the rings arching over the sea.
const camPitch = track([[0, -3.5], [58, -3.5], [65.5, 20], [76, 21]]);
const camYaw = track([[0, 10], [58, 10], [65.5, 29], [76, 30]]);
const fov = track([[0, 50], [58, 50], [65.5, 78], [76, 79]]);

const crack = track([[0, 0], [45.5, 0], [49.5, 1]]);
const breakup = track([[0, 0], [49, 0], [55, 1]]);
const ring = track([[0, 0], [58.5, 0], [67, 1]]);
const meteors = track([[0, 0], [52, 0], [54, 1], [60, 1], [63, 0]]);
const quake = track([[0, 0], [41, 0], [42.5, 1], [47, 1], [52, 0.6], [55, 0]]);
const traffic = track([[0, 1], [12, 1], [13, 0.3], [16, 0.8], [17.5, 0]]);
const people = track([[0, 1], [11.4, 1], [12.4, 0]]);
const streetLights = track([[0, 0.25], [9, 0.6], [10.5, 0], [25, 0], [27, 1], [33, 1], [33.6, 0], [47, 0], [48, 0.15], [55, 0], [67, 0], [70, 0.8], [72, 1]]);
const cityLights = track([[0, 0.25], [9, 0.5], [10.5, 0], [25, 0], [27, 0.9], [33, 0.9], [33.6, 0], [69.5, 0], [72, 0.7]]);
const waves = track([[0, 0.25], [16, 0.3], [26, 0.4], [40, 0.45], [43, 0.8], [52, 0.6], [58, 0.3]]);

// Counter shows the Moon's distance, then switches to years since breakup.
const years = track([[0, 0], [54, 0], [57, 100], [66, 10000]], x => x * x);

// When does something get written on screen? [t0, t1, text]
export const CAPTIONS = [
  [6, 10.2, 'It drifts 3.8 cm farther away every year. Run that backwards.'],
  [12, 16, 'High tide spills over Marine Drive.'],
  [17.5, 20.6, 'Tides are now seven times higher.'],
  [20.8, 24, 'At low tide, the bay drains dry.'],
  [26, 29.4, 'Every high tide swallows the street.'],
  [29.6, 33.2, 'Moonlit nights are as bright as dusk.'],
  [34, 37.2, 'It now circles Earth faster than Earth spins.'],
  [37.4, 41, 'So the Moon rises in the west.'],
  [42.5, 47.6, 'Tides kilometres high. The ground itself heaves.'],
  [48.5, 53.6, "Earth's gravity tears the Moon apart."],
  [54.2, 59.6, 'Moon rock rains down for centuries.'],
  [61, 66.8, 'The pieces spread into a ring.'],
  [68.4, 71.4, 'Mumbai lost its Moon.'],
  [71.6, 75.2, 'It got rings instead.'],
];

// Big centred stamps: [t, value, label]
export const STAMPS = [
  [11, '300,000', 'KM AWAY'],
  [17, '200,000', 'KM AWAY'],
  [25, '100,000', 'KM AWAY'],
  [33.2, '40,000', 'KM AWAY'],
  [41.2, '25,000', 'KM AWAY'],
  [48, '18,400', 'THE ROCHE LIMIT'],
  [60.4, '+10,000', 'YEARS'],
];

const fmt = n => Math.round(n).toLocaleString('en-US');

export function stateAt(t) {
  const dist = Math.exp(logDist(t));
  const broke = t >= 54;
  const look = lookAt(t);

  const title = t < 5.4 ? { text: 'What if the Moon came closer?', o: clamp01(Math.min((t - 0.3) / 0.6, (5.4 - t) / 0.5)) } : null;

  let caption = null;
  for (const [t0, t1, text] of CAPTIONS) {
    if (t >= t0 && t <= t1) caption = { text, o: clamp01(Math.min((t - t0) / 0.45, (t1 - t) / 0.35)) };
  }

  let stamp = null;
  for (const [ts, value, label] of STAMPS) {
    const dt = t - ts;
    if (dt >= 0 && dt < 2.2) stamp = { value, label, o: clamp01(Math.min(dt / 0.25, (2.2 - dt) / 0.5)), s: 1 + 0.06 * (1 - smooth(clamp01(dt / 0.6))) };
  }

  const counter = broke
    ? { label: 'YEARS WITHOUT A MOON', value: fmt(years(t)), unit: 'YEARS' }
    : { label: 'MOON DISTANCE', value: fmt(dist), unit: 'KILOMETRES' };
  const tidesX = (MOON_DISTANCE_KM / dist) ** 3;
  const sub = broke ? null : `Tides ×${tidesX < 10 ? tidesX.toFixed(1) : fmt(tidesX)}`;

  return {
    t,
    dist,
    moonAngle: 2 * Math.atan(MOON_RADIUS_KM / dist), // radians
    seaLevel: tide(t),
    look,
    sun: { az: sunAz(t), el: sunEl(t) },
    moon: { az: moonAz(t), el: moonEl(t) },
    camPitch: camPitch(t),
    camYaw: camYaw(t),
    fov: fov(t),
    crack: crack(t),
    breakup: breakup(t),
    ring: ring(t),
    meteors: meteors(t),
    quake: quake(t),
    traffic: traffic(t),
    people: people(t),
    streetLights: streetLights(t),
    cityLights: cityLights(t),
    waves: waves(t),
    fade: clamp01((t - 75.2) / 0.8),
    hud: { title, caption, stamp, counter, sub, show: t > 5.2 && t < 75.5 ? 1 : clamp01((t - 4.8) / 0.4) },
  };
}

// Traffic only moves while there is traffic, so integrate its speed.
const trafficTable = (() => {
  const dt = 1 / 60;
  const out = [0];
  for (let i = 1; i * dt <= DURATION + 1; i++) out.push(out[i - 1] + traffic(i * dt) * dt);
  return { dt, out };
})();

export function trafficClock(t) {
  const i = Math.max(0, Math.min(trafficTable.out.length - 1, Math.floor(t / trafficTable.dt)));
  return trafficTable.out[i];
}
