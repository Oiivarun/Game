'use strict';
const { W, H, NODE_COUNT, NODE_PER_PLAYER, NODE_MAX, SEATS, TIER, HOME } = require('../config');

/* ══════════════════════════════════════════════════════════════════════════
   Map generation
   Blue-noise scatter, homes pushed as far apart as possible, then shuffled.
   ══════════════════════════════════════════════════════════════════════════ */

function rngFor(seed){
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function generate(room){
  const rnd = room.rng = rngFor(room.seed);
  const rr = (a, b) => a + rnd() * (b - a);
  const ri = (a, b) => a + ((rnd() * (b - a + 1)) | 0);

  /* more seated players → more nodes to fight over, so nobody runs out of
     things to capture. Empty/AI-only boards keep the tuned base count. */
  const seated = [...room.players.values()].filter(p => p.seat !== null).length;
  const count = Math.min(NODE_MAX, NODE_COUNT + NODE_PER_PLAYER * seated);

  const nodes = [];
  const PAD = 70;
  /* hold node density roughly constant as the count grows, so a bigger board
     never gets impossible to place or too cramped to read */
  const MIN_D = Math.max(66, Math.min(92, Math.round(0.78 * Math.sqrt((W - 2 * PAD) * (H - 2 * PAD) / count))));
  let guard = 0;
  while (nodes.length < count && guard++ < 40000){
    const x = rr(PAD, W - PAD), y = rr(PAD, H - PAD);
    let ok = true;
    for (const n of nodes) if (Math.hypot(n.x - x, n.y - y) < MIN_D){ ok = false; break; }
    if (ok) nodes.push({ x, y, owner:null, count:0, acc:0, tier:0, home:false, candidate:false, r:0, growth:0, cap:0 });
  }

  /* start candidates: a few more than there are seats, chosen far apart, so
     players get a real choice of where to begin. They lock these in during the
     pick phase; whatever is left over becomes a neutral stronghold. */
  const K = Math.min(nodes.length - 2, SEATS + 3);
  const cand = [ nodes[(rnd() * nodes.length) | 0] ];
  while (cand.length < K){
    let best = null, bestD = -1;
    for (const n of nodes){
      if (cand.indexOf(n) >= 0) continue;
      let d = Infinity;
      for (const h of cand) d = Math.min(d, dist(n, h));
      if (d > bestD){ bestD = d; best = n; }
    }
    cand.push(best);
  }
  cand.forEach(n => {
    n.candidate = true; n.tier = 2; n.home = false; n.owner = null;
    n.r = HOME.r; n.growth = HOME.growth; n.cap = HOME.cap; n.count = 0;
  });

  /* the remaining nodes most equidistant from every candidate are the prizes */
  const free = nodes.filter(n => !n.candidate);
  for (const n of free){
    let sum = 0, min = Infinity;
    for (const h of cand){ const d = dist(n, h); sum += d; min = Math.min(min, d); }
    n._score = min * 2 + sum * 0.1;
  }
  free.sort((a, b) => b._score - a._score);
  const nMajor = Math.round(free.length * 0.24);   /* ≈ 6 of 25 at the base count */
  const nHold  = Math.round(free.length * 0.36);   /* ≈ 9 of 25 at the base count */
  free.forEach((n, i) => {
    n.tier = i < nMajor ? 2 : i < nMajor + nHold ? 1 : 0;
    const t = TIER[n.tier];
    n.r = t.r; n.growth = t.growth; n.cap = t.cap;
    n.count = ri(t.start[0], t.start[1]);
    delete n._score;
  });

  /* decorative mesh — nearest three each */
  const links = [];
  for (let i = 0; i < nodes.length; i++){
    const d = nodes.map((n, j) => ({ j, d: dist(nodes[i], n) }))
                   .filter(o => o.j !== i).sort((a, b) => a.d - b.d);
    for (let k = 0; k < 3; k++){
      if (!d[k] || d[k].d > 250) continue;
      const a = Math.min(i, d[k].j), b = Math.max(i, d[k].j);
      if (!links.some(l => l[0] === a && l[1] === b)) links.push([a, b]);
    }
  }

  room.nodes = nodes;
  room.links = links;
  room.flights = [];
  room.nextFlight = 1;
  room.elapsed = 0;
  room.winner = undefined;
  room.candidates = [];
  for (let i = 0; i < nodes.length; i++) if (nodes[i].candidate) room.candidates.push(i);
  room.picks = {};
  for (let i = 0; i < SEATS; i++) room.aiClock[i] = 1.4 + rnd() * 1.6;
}

module.exports = { rngFor, dist, generate };
