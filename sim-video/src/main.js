import * as THREE from 'three';
import { buildWorld } from './scene.js';
import { stateAt, DURATION, FPS, STAMPS, WRECK_T } from './timeline.js';

const W = 1080, H = 1920;
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const world = buildWorld(renderer);

const $ = s => document.querySelector(s);
const hud = {
  title: $('#title'), counter: $('#counter'), cLabel: $('#counter .label'), cValue: $('#counter .value'),
  cUnit: $('#counter .unit'), cSub: $('#counter .sub'), stamp: $('#stamp'), sValue: $('#stamp .value'),
  sLabel: $('#stamp .label'), caption: $('#caption'), flash: $('#flash'), fade: $('#fade'),
};

function drawHud(s) {
  const h = s.hud;
  hud.title.textContent = h.title ? h.title.text : '';
  hud.title.style.opacity = h.title ? h.title.o : 0;
  hud.counter.style.opacity = h.show;
  hud.cLabel.textContent = h.counter.label;
  hud.cValue.textContent = h.counter.value;
  hud.cUnit.textContent = h.counter.unit;
  hud.cSub.textContent = h.sub || '';
  hud.caption.textContent = h.caption ? h.caption.text : '';
  hud.caption.style.opacity = h.caption ? h.caption.o : 0;
  hud.stamp.style.opacity = h.stamp ? h.stamp.o : 0;
  if (h.stamp) {
    hud.sValue.textContent = h.stamp.value;
    hud.sLabel.textContent = h.stamp.label;
    hud.stamp.style.transform = `scale(${h.stamp.s})`;
  }
  hud.flash.style.opacity = s.flash * 0.9;
  hud.fade.style.opacity = s.fade;
}

window.renderAt = t => {
  const s = stateAt(t);
  world.update(s);
  renderer.render(world.scene, world.camera);
  drawHud(s);
  return true;
};
window.meta = { DURATION, FPS };

// Everything the soundtrack needs to stay in sync with the picture.
window.cues = () => {
  const keys = ['seaLevel', 'waves', 'quake', 'crack', 'breakup', 'ring', 'traffic', 'people', 'wild', 'dist'];
  const out = { duration: DURATION, rate: 100, stamps: STAMPS.map(s => s[0]), wreck: WRECK_T, t: [] };
  for (const k of keys) out[k] = [];
  for (let i = 0; i <= DURATION * 100; i++) {
    const s = stateAt(i / 100);
    out.t.push(i / 100);
    for (const k of keys) out[k].push(+s[k].toFixed(4));
  }
  out.meteors = world.meteors.map(m => ({ t0: m.t0, dur: m.dur, w: m.w, az: m.az }));
  return out;
};

await document.fonts.load('500 60px Cormorant');
await document.fonts.load('italic 500 44px Cormorant');
await document.fonts.load('500 19px Jost');

// Opened in a normal browser: ?t=12.5 shows one frame, otherwise it plays.
const q = new URLSearchParams(location.search);
if (q.has('t')) window.renderAt(parseFloat(q.get('t')));
else if (!navigator.webdriver) {
  const t0 = performance.now();
  const loop = () => { window.renderAt(((performance.now() - t0) / 1000) % DURATION); requestAnimationFrame(loop); };
  loop();
}
window.ready = true;
