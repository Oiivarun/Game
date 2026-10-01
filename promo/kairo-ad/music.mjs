// Synthesizes the 30s soundtrack (120 BPM, B minor -> D major) with sound
// design cued to the picture in index.html. Writes out/music.wav.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SR = 48000, DUR = 30, N = SR * DUR;
const mtof = m => 440 * 2 ** ((m - 69) / 12);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
let seed = 1234567;
const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296); };
const noise = () => rand() * 2 - 1;

const bus = () => [new Float32Array(N), new Float32Array(N)];
const dry = bus(), duck = bus(), revSend = bus(), dlySend = bus();

// Topology-preserving state-variable filter
class SVF {
  constructor() { this.a = 0; this.b = 0; }
  run(x, fc, q) {
    const g = Math.tan(Math.PI * Math.min(fc, SR * 0.45) / SR), k = 1 / q;
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x - this.b, v1 = a1 * this.a + a2 * v3, v2 = this.b + a2 * this.a + a3 * v3;
    this.a = 2 * v1 - this.a; this.b = 2 * v2 - this.b;
    this.lpv = v2; this.bpv = v1; this.hpv = x - k * v1 - v2;
    return this;
  }
  lp(x, fc, q = .707) { return this.run(x, fc, q).lpv; }
  bp(x, fc, q = 1) { return this.run(x, fc, q).bpv; }
  hp(x, fc, q = .707) { return this.run(x, fc, q).hpv; }
}
const blep = (t, dt) => t < dt ? (t /= dt, t + t - t * t - 1) : t > 1 - dt ? (t = (t - 1) / dt, t * t + t + t + 1) : 0;

function put(b, i, v, pan) {
  const a = (clamp(pan, -1, 1) + 1) * Math.PI / 4;
  b[0][i] += v * Math.cos(a); b[1][i] += v * Math.sin(a);
}
// Render a voice: fn(t) is called with monotonically increasing local time.
function voice(t0, len, fn, { pan = 0, gain = 1, to = dry, rev = 0, dly = 0 } = {}) {
  const i0 = Math.max(0, Math.round(t0 * SR)), i1 = Math.min(N, Math.round((t0 + len) * SR));
  for (let i = i0; i < i1; i++) {
    const v = fn((i - t0 * SR) / SR) * gain;
    const p = typeof pan === 'function' ? pan((i - t0 * SR) / SR) : pan;
    put(to, i, v, p);
    if (rev) put(revSend, i, v * rev, p);
    if (dly) put(dlySend, i, v * dly, p);
  }
}

// ---------------------------------------------------------------- instruments
function kick(t0, g = 1) {
  let ph = 0;
  voice(t0, .55, t => {
    const f = 44 + 130 * Math.exp(-t * 30);
    ph += 2 * Math.PI * f / SR;
    const a = Math.exp(-t * 7) * Math.min(1, t / .0015);
    return Math.tanh(1.8 * Math.sin(ph)) * a * .85 + noise() * Math.exp(-t * 400) * .18;
  }, { gain: g });
}
function clap(t0, g = 1, pan = 0) {
  const f = new SVF();
  voice(t0, .45, t => {
    let e = 0;
    for (const d of [0, .011, .022]) if (t >= d) e += Math.exp(-(t - d) * 200) * .55;
    if (t >= .03) e += Math.exp(-(t - .03) * 14);
    return f.bp(noise(), 1500, 1.1) * e * 1.6;
  }, { gain: g, pan, rev: .3 });
}
function hat(t0, g = 1, pan = .25, dec = 70) {
  const f = new SVF();
  voice(t0, .25, t => f.hp(noise(), 8000, .8) * Math.exp(-t * dec), { gain: g, pan });
}
function bass(note, t0, len, g = 1) {
  let ph = 0; const f = new SVF(), fr = mtof(note), dt = fr / SR;
  voice(t0, len, t => {
    ph += dt; ph -= Math.floor(ph);
    const saw = 2 * ph - 1 - blep(ph, dt);
    const y = f.lp(saw * .55, 140 + 1000 * Math.exp(-t * 13), .9) + Math.sin(2 * Math.PI * ph) * .55;
    return y * Math.min(1, t / .004) * Math.min(1, (len - t) / .02) * (.7 + .3 * Math.exp(-t * 6));
  }, { gain: g, to: duck });
}
function pad(notes, t0, t1, cutoff, gainFn) {
  const len = t1 - t0 + .6;
  notes.forEach((n, ni) => {
    [-9, 0, 9].forEach((cents, vi) => {
      let ph = rand(); const f = new SVF(), fr = mtof(n) * 2 ** (cents / 1200), dt = fr / SR;
      voice(t0, len, t => {
        ph += dt * (1 + .0015 * Math.sin(t * 5.1 + ni + vi)); ph -= Math.floor(ph);
        const saw = 2 * ph - 1 - blep(ph, dt);
        const att = clamp(t / .25), rel = clamp((len - t) / .6);
        return f.lp(saw, cutoff(t0 + t), .8) * att * rel * gainFn(t0 + t);
      }, { pan: [-.7, 0, .7][vi], gain: .055, to: duck, rev: .25 });
    });
  });
}
function pluck(note, t0, g = 1, pan = 0, bright = 1) {
  let ph = 0; const f = new SVF(), fr = mtof(note), dt = fr / SR;
  voice(t0, .7, t => {
    ph += dt; ph -= Math.floor(ph);
    const saw = 2 * ph - 1 - blep(ph, dt);
    const sq = (ph < .5 ? 1 : -1) * .5;
    return f.lp(saw * .6 + sq * .4, 250 + 4200 * bright * Math.exp(-t * 16), 1.1) * Math.exp(-t * 7) * Math.min(1, t / .002);
  }, { gain: g, pan, to: duck, dly: .32, rev: .18 });
}
function bell(note, t0, g = 1, dec = 1.6, pan = 0, len = 4) {
  const fc = mtof(note);
  voice(t0, len, t => {
    const I = 2.2 * Math.exp(-t * 3);
    const m = Math.sin(2 * Math.PI * fc * 2 * t);
    const c = Math.sin(2 * Math.PI * fc * t + I * m) + .25 * Math.sin(2 * Math.PI * fc * 2.76 * t) * Math.exp(-t * 4);
    return c * Math.exp(-t * dec) * Math.min(1, t / .003);
  }, { gain: g, pan, rev: .55, dly: .12 });
}
function blip(note, t0, g = 1, pan = 0) {
  const fr = mtof(note); let ph = 0;
  voice(t0, .45, t => {
    ph += 2 * Math.PI * fr * (1 + .04 * Math.exp(-t * 50)) / SR;
    return (Math.sin(ph) + .2 * Math.sin(2 * ph)) * Math.exp(-t * 13) * Math.min(1, t / .002);
  }, { gain: g, pan, rev: .3, dly: .15 });
}
function tick(t0, g = 1, pan = 0) {
  const f = new SVF();
  voice(t0, .06, t => Math.sin(2 * Math.PI * 3400 * t) * Math.exp(-t * 240) * .7 + f.hp(noise(), 5000) * Math.exp(-t * 500), { gain: g, pan });
}
function riser(t0, t1, g = 1) {
  const f = new SVF(), len = t1 - t0; let ph = 0;
  voice(t0, len, t => {
    const x = t / len;
    const fc = 250 * (28 ** x);
    ph += 2 * Math.PI * (180 * (6 ** x)) / SR;
    return (f.bp(noise(), fc, 1.8) * 1.5 + Math.sin(ph) * .12) * x ** 2.2;
  }, { gain: g, pan: t => Math.sin(t * 9) * .4 * (t / len), rev: .25 });
}
function impact(t0, g = 1) {
  const f = new SVF(); let ph = 0;
  voice(t0, 3, t => {
    ph += 2 * Math.PI * (30 + 55 * Math.exp(-t * 7)) / SR;
    return Math.sin(ph) * Math.exp(-t * 1.8) * 1.1 + f.lp(noise(), 2400 * Math.exp(-t * 3) + 200) * Math.exp(-t * 6) * .7;
  }, { gain: g, rev: .5 });
}
function whoosh(tc, len, g = 1, dir = 1) {
  const f = new SVF(), t0 = tc - len * .6;
  voice(t0, len, t => {
    const x = t / len, env = Math.sin(Math.PI * x) ** 2;
    return f.bp(noise(), 400 + 3800 * Math.sin(Math.PI * x), 1.4) * env * 1.4;
  }, { gain: g, pan: t => dir * (t / len * 1.4 - .7), rev: .3 });
}
function thunk(t0, g = 1) {
  let ph = 0;
  voice(t0, .4, t => { ph += 2 * Math.PI * (60 + 110 * Math.exp(-t * 25)) / SR; return Math.sin(ph) * Math.exp(-t * 12); }, { gain: g, rev: .2 });
}

// ---------------------------------------------------------------- arrangement
const CH = {
  Bm: { root: 35, pad: [54, 59, 62, 66], arp: [71, 74, 78, 83] },
  G: { root: 31, pad: [55, 59, 62, 69], arp: [67, 71, 74, 79] },
  D: { root: 38, pad: [54, 57, 62, 64], arp: [69, 74, 78, 81] },
  A: { root: 33, pad: [52, 57, 61, 64], arp: [69, 73, 76, 81] },
};
const PROG = [[0, 2, 'Bm'], [2, 4, 'G'], [4, 6, 'D'], [6, 8, 'G'], [8, 10, 'D'], [10, 12, 'A'], [12, 14, 'Bm'], [14, 16, 'G'],
  [16, 18, 'D'], [18, 20, 'A'], [20, 22, 'Bm'], [22, 24, 'G'], [24, 26, 'A'], [26, 30, 'D']];
const chordAt = t => CH[PROG.find(([a, b]) => t >= a && t < b)[2]];
const groove = t => (t >= 6 && t < 16) || (t >= 20 && t < 26);

const cutoff = t => t < 4 ? 450 + 2000 * (t / 4) ** 2 : t < 6 ? 2300 : t < 16 ? 2600 : t < 20 ? 3400 : t < 26 ? 2900 : 3600 - 1500 * clamp((t - 26) / 4);
const padGain = t => t < 4 ? .9 + .4 * (t / 4) : t < 6 ? 1.2 : t < 16 ? .85 : t < 20 ? 1.45 : t < 26 ? .85 : 1.3;
PROG.forEach(([a, b, c]) => pad(CH[c].pad, a, b, cutoff, padGain));

// intro: word punches on the beat
[0.5, 1.0, 1.5, 2.0].forEach(t => { kick(t, .5); tick(t, .12); });
// chaos: notification pings as chips land, a riser into the logo
for (let i = 0; i < 30; i += 2) blip([86, 88, 90, 93, 95, 98][Math.floor(rand() * 6)], 2.3 + i * .036, .05, rand() * 1.6 - .8);
riser(2.3, 3.93, .5);
impact(4.0, 1.0);
[74, 78, 81, 88].forEach((n, i) => bell(n, 4.0 + i * .05, .11, 1.3, [-.4, .4, -.2, .2][i]));
bell(86, 4.72, .05, 2, .3);
riser(5.0, 5.98, .18);

// groove: kick / clap / hats / bass / arp
const kicks = [];
for (let t = 6; t < 26; t += .5) if (groove(t)) { kick(t, 1); kicks.push(t); }
for (let t = 6; t < 26; t += 2) if (groove(t)) { clap(t + .5, .32, -.1); clap(t + 1.5, .32, .1); }
for (let t = 6; t < 26; t += .5) hat(t + .25, groove(t) ? .1 : .06, .3);
for (let t = 20; t < 26; t += .25) if (Math.round(t * 4) % 2 === 0) hat(t + .125, .035, -.3, 110);
for (let t = 6; t < 26; t += .25) {
  const r = chordAt(t).root;
  if (groove(t)) bass(r + (Math.round(t * 4) % 8 === 6 ? 12 : 0), t, .22, .5);
}
for (let t = 16; t < 20; t += 2) bass(chordAt(t).root, t, 1.9, .28);
const PAT = [0, 1, 2, 3, 2, 1, 3, 2];
for (let t = 5, k = 0; t < 26; t += .125, k++) {
  const g = t < 6 ? .03 + .05 * (t - 5) : t < 16 ? .075 : t < 20 ? .12 : .075;
  pluck(chordAt(t).arp[PAT[k % 8]], t, g, k % 2 ? .35 : -.35, t < 6 ? .4 + .6 * (t - 5) : t >= 16 && t < 20 ? 1.3 : 1);
}
// build back into the drop
for (let t = 19, k = 0; t < 19.98; t += .125, k++) clap(t, .06 + .3 * (k / 8), k % 2 ? .2 : -.2);
riser(19.0, 19.98, .3);
impact(20.0, .65);

// scene 3: click, then a rising pop for each task that snaps into place
tick(8.33, .3, .3);
[74, 76, 78, 81, 83, 86, 88].forEach((n, i) => blip(n, 8.62 + i * .2 + .2, .14, -.4 + i * .13));
bell(81, 10.45, .05, 2.2, -.2); bell(86, 10.5, .04, 2.2, .2);
whoosh(12.0, .8, .45);
// scene 4: interruptions bounce off the shield
[[13.22, 86], [13.77, 88], [14.28, 90], [14.8, 93]].forEach(([t, n]) => { thunk(t, .45); bell(n, t, .05, 3.5, .3, 1.5); });
whoosh(16.05, .6, .4, -1);
// scene 5: action items get checked and scheduled
[81, 85, 88].forEach((n, i) => { const t = 18.55 + i * .26 + .22; tick(t, .15); blip(n, t, .1, .2); });
// scene 6: the count-up ticks once per hour gained
[81, 83, 86, 88, 90, 93].forEach((n, k) => {
  const p = 1 - Math.cbrt(1 - (k + 1) / 6.5);
  blip(n, 20.25 + 1.2 * p, .07, 0); tick(20.25 + 1.2 * p, .08);
});
whoosh(23.0, .6, .35);
whoosh(24.0, .5, .2, -1);
riser(25.1, 25.98, .32);
// end card
impact(26.0, .9);
kick(26.0, .9);
[62, 74, 78, 81, 88].forEach((n, i) => bell(n, 26.0 + i * .06, i ? .1 : .07, 1.0, [0, -.4, .4, -.2, .2][i]));
bell(86, 27.35, .05, 1.6, .25); bell(93, 27.4, .03, 1.6, -.25);

// ---------------------------------------------------------------- effects
function freeverb(src, room = .86, damp = .35) {
  const sc = SR / 44100;
  const ct = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], at = [556, 441, 341, 225];
  const out = bus(), pre = Math.round(.02 * SR);
  [0, 1].forEach(ch => {
    const sp = ch ? 23 : 0;
    const combs = ct.map(n => ({ b: new Float32Array(Math.round((n + sp) * sc)), i: 0, s: 0 }));
    const aps = at.map(n => ({ b: new Float32Array(Math.round((n + sp) * sc)), i: 0 }));
    for (let i = 0; i < N; i++) {
      const j = i - pre;
      const x = j >= 0 ? (src[0][j] + src[1][j]) * .015 : 0;
      let y = 0;
      for (const c of combs) {
        const o = c.b[c.i]; c.s = o * (1 - damp) + c.s * damp; c.b[c.i] = x + c.s * room;
        if (++c.i >= c.b.length) c.i = 0; y += o;
      }
      for (const a of aps) {
        const o = a.b[a.i]; a.b[a.i] = y + o * .5; y = o - y;
        if (++a.i >= a.b.length) a.i = 0;
      }
      out[ch][i] = y;
    }
  });
  return out;
}
function pingpong(src, time = .375, fb = .38) {
  const D = Math.round(time * SR), bl = new Float32Array(D), br = new Float32Array(D), out = bus();
  let lpL = 0, lpR = 0;
  for (let i = 0, k = 0; i < N; i++, k = (k + 1) % D) {
    const dl = bl[k], dr = br[k];
    lpL += .35 * (dl - lpL); lpR += .35 * (dr - lpR);
    bl[k] = (src[0][i] + src[1][i]) * .5 + lpR * fb;
    br[k] = lpL * fb;
    out[0][i] = dl; out[1][i] = dr;
  }
  return out;
}
const rev = freeverb(revSend);
const dly = pingpong(dlySend);

// sidechain pump from the kick pattern
const pump = new Float32Array(N).fill(1);
for (const k of kicks) {
  const i0 = Math.round(k * SR), len = Math.round(.3 * SR);
  for (let i = 0; i < len && i0 + i < N; i++) {
    const d = i / len;
    pump[i0 + i] = Math.min(pump[i0 + i], 1 - .6 * (1 - d) ** 2);
  }
}

// ---------------------------------------------------------------- master
const L = new Float32Array(N), R = new Float32Array(N);
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  // a breath of silence right before the logo hit, and a fade at the end
  const gap = t >= 3.93 && t < 4.0 ? .06 : 1;
  const fade = t > 28.4 ? Math.cos(clamp((t - 28.4) / 1.6) * Math.PI / 2) : 1;
  for (const [o, c] of [[L, 0], [R, 1]]) {
    const v = (dry[c][i] + duck[c][i] * pump[i] + rev[c][i] * .9 + dly[c][i] * .55) * gap * fade;
    o[i] = Math.tanh(v * 1.1);
    peak = Math.max(peak, Math.abs(o[i]));
  }
}
const norm = .89 / peak;
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(clamp(L[i] * norm, -1, 1) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(clamp(R[i] * norm, -1, 1) * 32767), 46 + i * 4);
}
mkdirSync(resolve(here, 'out'), { recursive: true });
writeFileSync(resolve(here, 'out', 'music.wav'), buf);
console.log('wrote out/music.wav  peak', peak.toFixed(3));
