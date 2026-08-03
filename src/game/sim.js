'use strict';
const { SEATS, SEND_FRACTION, TROOP_SPEED, TROOP_GAP, MATCH_CAP, COUNTDOWN_MS, TIER, HOME } = require('../config');
const { dist } = require('./map');
const { isBot } = require('./rooms');
const { broadcastLobby, broadcastInit, broadcastState } = require('../net/protocol');

/* ══════════════════════════════════════════════════════════════════════════
   Start picks
   Players choose a start node during the "pick" phase; unchosen candidates
   fall to the AI, then anything still spare becomes a neutral stronghold.
   ══════════════════════════════════════════════════════════════════════════ */
function setHome(room, idx, seat){
  const n = room.nodes[idx];
  n.owner = seat; n.home = true; n.candidate = true;   /* candidate flag clears at finalize */
  n.r = HOME.r; n.growth = HOME.growth; n.cap = HOME.cap; n.count = 22; n.acc = 0;
}
function maybeFinishPicks(room){
  const humans = [...room.players.values()].filter(p => p.live && p.seat !== null);
  if (humans.length && humans.every(p => room.picks[p.seat] !== undefined)) finalizePicks(room);
}
function finalizePicks(room){
  if (room.phase !== "pick") return;
  const rnd = room.rng || (() => Math.random());
  const taken = new Set(Object.values(room.picks));
  const avail = room.candidates.filter(i => !taken.has(i));
  /* every seat needs a home — the AI takes a random spare candidate */
  for (let s = 0; s < SEATS; s++){
    if (room.picks[s] !== undefined || !avail.length) continue;
    const idx = avail.splice((rnd() * avail.length) | 0, 1)[0];
    room.picks[s] = idx; setHome(room, idx, s);
  }
  /* leftover candidates become neutral strongholds */
  for (const i of room.candidates){
    const n = room.nodes[i];
    n.candidate = false;
    if (n.owner === null){
      const t = TIER[2];
      n.tier = 2; n.home = false; n.r = t.r; n.growth = t.growth; n.cap = t.cap;
      n.count = t.start[0] + ((rnd() * (t.start[1] - t.start[0] + 1)) | 0); n.acc = 0;
    }
  }
  room.phase = "countdown";
  room.goLiveAt = Date.now() + COUNTDOWN_MS;
  for (const p of room.players.values()){ p.ack = 0; p.execCid = 0; }
  broadcastLobby(room); broadcastInit(room); broadcastState(room);
}

/* ══════════════════════════════════════════════════════════════════════════
   Simulation
   Columns, landings, the AI, and one authoritative step of the world.
   ══════════════════════════════════════════════════════════════════════════ */

function send(room, fromIdx, toIdx, owner){
  if (fromIdx === toIdx) return 0;
  const f = room.nodes[fromIdx], t = room.nodes[toIdx];
  if (!f || !t || f.owner !== owner) return 0;
  const n = Math.floor(f.count * SEND_FRACTION);
  if (n < 1) return 0;
  f.count -= n;
  const d = Math.hypot(t.x - f.x, t.y - f.y);
  room.flights.push({
    id: room.nextFlight++,
    from: fromIdx, to: toIdx, owner,
    count: n, delivered: 0, prog: 0,
    len: Math.max(8, d - f.r - t.r * 0.82)
  });
  return n;
}

function land(room, fl){
  const n = room.nodes[fl.to];
  if (n.owner === fl.owner){
    n.count = Math.min(n.cap, n.count + 1);
  } else if (n.count > 0){
    n.count--;
  } else {
    n.owner = fl.owner;
    n.count = 1;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   AI — picks the best affordable target, staging from several holdings at
   once the way a player does by dragging across them
   ══════════════════════════════════════════════════════════════════════════ */
function think(room, p){
  const rnd = room.rng;
  const N = room.nodes;
  const mine = [], enemies = [];
  for (let i = 0; i < N.length; i++) (N[i].owner === p ? mine : enemies).push(i);
  if (!mine.length || !enemies.length) return;

  let best = null, bestScore = 0.0001;
  for (const ti of enemies){
    const t = N[ti];
    const cost = t.count + 1;
    const near = mine.map(i => ({ i, d: dist(N[i], t) }))
                     .filter(o => o.d < 470)
                     .sort((a, b) => a.d - b.d);
    if (!near.length) continue;

    let budget = 0, group = [], sumD = 0;
    for (const o of near){
      const b = Math.floor(N[o.i].count * SEND_FRACTION);
      if (b < 3) continue;
      budget += b; group.push(o.i); sumD += o.d;
      if (budget > cost) break;
    }
    if (budget <= cost || !group.length) continue;

    const worth  = t.home ? 46 : t.tier === 2 ? 34 : t.tier === 1 ? 20 : 11;
    const margin = (budget - cost) / budget;
    const score  = worth * (0.55 + margin * 0.7)
                 - (sumD / group.length) * 0.045
                 - cost * 0.4
                 - (group.length - 1) * 4;
    if (score > bestScore){ bestScore = score; best = { ti, group }; }
  }
  if (best){
    for (const s of best.group) send(room, s, best.ti, p);
    return;
  }

  /* nothing capturable — throw a softening wave so the board never freezes */
  const loaded = mine.filter(i => N[i].count > N[i].cap * 0.58);
  if (loaded.length){
    const src = loaded[(rnd() * loaded.length) | 0];
    let cheap = -1, cheapScore = Infinity;
    for (const ti of enemies){
      const d = dist(N[src], N[ti]);
      if (d > 470) continue;
      const sc = N[ti].count * 1.2 + d * 0.05;
      if (sc < cheapScore){ cheapScore = sc; cheap = ti; }
    }
    if (cheap >= 0){ send(room, src, cheap, p); return; }
  }

  /* otherwise walk troops from the quiet rear toward the front line */
  if (rnd() < 0.55) return;
  let rear = -1, rearD = -1, front = -1, frontD = Infinity;
  for (const i of mine){
    let d = Infinity;
    for (const e of enemies) d = Math.min(d, dist(N[i], N[e]));
    if (d > rearD && N[i].count > 16){ rearD = d; rear = i; }
    if (d < frontD){ frontD = d; front = i; }
  }
  if (rear >= 0 && front >= 0 && rear !== front) send(room, rear, front, p);
}

/* ══════════════════════════════════════════════════════════════════════════
   Simulation
   ══════════════════════════════════════════════════════════════════════════ */
function step(room, dt){
  if (room.phase !== "live") return;
  room.elapsed += dt;

  for (const n of room.nodes){
    if (n.owner === null || n.count >= n.cap) continue;
    n.acc += n.growth * dt;
    while (n.acc >= 1){ n.acc -= 1; n.count = Math.min(n.cap, n.count + 1); }
  }

  for (let i = room.flights.length - 1; i >= 0; i--){
    const fl = room.flights[i];
    fl.prog += TROOP_SPEED * dt;
    while (fl.delivered < fl.count && fl.prog - fl.delivered * TROOP_GAP >= fl.len){
      land(room, fl);
      fl.delivered++;
    }
    if (fl.delivered >= fl.count) room.flights.splice(i, 1);
  }

  for (let s = 0; s < SEATS; s++){
    if (!isBot(room, s)) continue;
    room.aiClock[s] -= dt;
    if (room.aiClock[s] <= 0){
      room.aiClock[s] = 1.15 + room.rng() * 0.95;
      think(room, s);
    }
  }

  const owners = new Set(room.nodes.map(n => n.owner));
  if (owners.size === 1 && !owners.has(null) && room.flights.length === 0){
    room.phase = "over";
    room.winner = [...owners][0];
    broadcastLobby(room);
  } else if (room.elapsed >= MATCH_CAP){
    /* a stalemate can't drag on forever — the largest holding takes the map,
       with the most troops breaking a tie */
    const held = new Array(SEATS).fill(0), troops = new Array(SEATS).fill(0);
    for (const n of room.nodes) if (n.owner !== null){ held[n.owner]++; troops[n.owner] += n.count; }
    let win = 0;
    for (let s = 1; s < SEATS; s++){
      if (held[s] > held[win] || (held[s] === held[win] && troops[s] > troops[win])) win = s;
    }
    room.phase = "over";
    room.winner = win;
    broadcastLobby(room);
  }
}

module.exports = { send, land, think, step, setHome, maybeFinishPicks, finalizePicks };
