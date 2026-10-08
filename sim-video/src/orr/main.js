import * as THREE from 'three';
import { buildWorld } from './scene.js';
import { simulate } from './traffic.js';
import { stateAt, simTime, DURATION, FPS, STAMPS, BRAKE_AT, BRAKE_S } from './timeline.js';

const W = 1080, H = 1920;
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// One snapshot of the road per video frame, all computed up front.
const NF = Math.round(DURATION * FPS);
const times = [];
for (let k = 0; k <= NF; k++) times.push(simTime(k / FPS));
const sim = simulate({
  density: 0.065,
  times,
  brakes: [
    { lane: 1, at: BRAKE_S, t0: BRAKE_AT, dur: 1.8, decel: 5 },
    // the drivers alongside flinch too
    { lane: 0, at: BRAKE_S - 6, t0: BRAKE_AT + 0.5, dur: 1.4, decel: 4 },
    { lane: 2, at: BRAKE_S - 4, t0: BRAKE_AT + 0.7, dur: 1.4, decel: 4 },
  ],
});
const world = buildWorld(renderer, sim);
const frameOf = t => Math.max(0, Math.min(NF, Math.round(t * FPS)));

const $ = s => document.querySelector(s);
const hud = {
  title: $('#title'), counter: $('#counter'), cLabel: $('#counter .label'), cValue: $('#counter .value'),
  cUnit: $('#counter .unit'), cSub: $('#counter .sub'), stamp: $('#stamp'), sValue: $('#stamp .value'),
  sLabel: $('#stamp .label'), caption: $('#caption'), fade: $('#fade'), marker: $('#marker'),
};

function drawHud(s, info) {
  const h = s.hud;
  hud.title.textContent = h.title ? h.title.text : '';
  hud.title.style.opacity = h.title ? h.title.o : 0;
  hud.counter.style.opacity = h.show;
  hud.cLabel.textContent = h.counter.label;
  hud.cValue.textContent = h.counter.value;
  hud.cUnit.textContent = h.counter.unit;
  hud.cSub.textContent = `Average speed ${Math.round(info.avgSpeed * 3.6)} km/h`;
  hud.caption.textContent = h.caption ? h.caption.text : '';
  hud.caption.style.opacity = h.caption ? h.caption.o : 0;
  hud.stamp.style.opacity = h.stamp ? h.stamp.o : 0;
  if (h.stamp) {
    hud.sValue.textContent = h.stamp.value;
    hud.sLabel.textContent = h.stamp.label;
    hud.stamp.style.transform = `scale(${h.stamp.s})`;
  }
  hud.fade.style.opacity = s.fade;
  if (info.culprit && s.marker > 0) {
    const p = info.culprit.clone().project(world.camera);
    hud.marker.style.left = `${((p.x + 1) / 2) * W}px`;
    hud.marker.style.top = `${((1 - p.y) / 2) * H}px`;
    hud.marker.style.opacity = s.marker;
  } else hud.marker.style.opacity = 0;
}

window.renderAt = t => {
  const s = stateAt(t);
  const info = world.update(s, sim.snaps[frameOf(t)]);
  renderer.render(world.scene, world.camera);
  drawHud(s, info);
  return true;
};
window.meta = { DURATION, FPS, name: 'orr-phantom-jam', audio: 'audio_orr.py' };

// What the soundtrack follows, one sample per video frame.
window.cues = () => {
  const out = { duration: DURATION, rate: FPS, stamps: STAMPS.map(s => s[0]), brake: BRAKE_AT, t: [], speed: [], stopped: [], nearBrake: [], clock: [] };
  for (let k = 0; k <= NF; k++) {
    const st = world.stats(sim.snaps[k]);
    out.t.push(k / FPS);
    out.speed.push(+st.speed.toFixed(3));
    out.stopped.push(+st.stopped.toFixed(3));
    out.nearBrake.push(+st.nearBrake.toFixed(3));
    out.clock.push(+stateAt(k / FPS).rate.toFixed(2));
  }
  return out;
};

await document.fonts.load('500 60px Cormorant');
await document.fonts.load('italic 500 44px Cormorant');
await document.fonts.load('500 19px Jost');

const q = new URLSearchParams(location.search);
if (q.has('t')) window.renderAt(parseFloat(q.get('t')));
else if (!navigator.webdriver) {
  const t0 = performance.now();
  const loop = () => { window.renderAt(((performance.now() - t0) / 1000) % DURATION); requestAnimationFrame(loop); };
  loop();
}
window.ready = true;
