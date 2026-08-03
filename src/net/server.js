'use strict';
const http = require('http');
const fs   = require('fs');
const path = require('path');

const { PUBDIR, SEATS, MAX_ROOMS, PICK_TIMEOUT } = require('../config');
const { rooms, newId, makeRoom, seatOf, assignSeats } = require('../game/rooms');
const { generate } = require('../game/map');
const { send, setHome, maybeFinishPicks } = require('../game/sim');
const { startLoop } = require('../game/loop');
const { pushEvent, roster, broadcastLobby, sendInit, broadcastInit, broadcastState } = require('./protocol');

/* ══════════════════════════════════════════════════════════════════════════
   HTTP
   Static files, POST /api/cmd for orders, GET /api/stream for the snapshot feed.
   ══════════════════════════════════════════════════════════════════════════ */

const MIME = { ".html":"text/html; charset=utf-8", ".js":"text/javascript", ".css":"text/css",
               ".svg":"image/svg+xml", ".png":"image/png", ".ico":"image/x-icon" };

function serveStatic(req, res, rel){
  const file = path.join(PUBDIR, rel === "/" ? "index.html" : rel);
  if (!file.startsWith(PUBDIR)) return json(res, 403, { error:"nope" });
  fs.readFile(file, (err, buf) => {
    if (err) return json(res, 404, { error:"not found" });
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream",
                         "cache-control": "no-cache" });
    res.end(buf);
  });
}
function json(res, code, obj){
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type":"application/json", "cache-control":"no-store" });
  res.end(body);
}
function readBody(req){
  return new Promise(resolve => {
    let s = "";
    req.on("data", c => { s += c; if (s.length > 1e5) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(s || "{}")); } catch (e){ resolve({}); } });
  });
}

const clean = s => String(s || "").replace(/[^\p{L}\p{N} '._-]/gu, "").trim().slice(0, 18);

/* ── crude per-IP rate limiting: blunts command floods and create-spam ── */
const RL_WINDOW = 10000, RL_MAX = 40, RL_CREATE_MAX = 6;
const hits = new Map();                         /* ip -> { t, n, c } */
function ipOf(req){
  return (req.headers["fly-client-ip"] ||
          String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
          (req.socket && req.socket.remoteAddress) || "?");
}
function rateLimited(ip, action){
  const now = Date.now();
  let h = hits.get(ip);
  if (!h || now - h.t > RL_WINDOW){ h = { t: now, n: 0, c: 0 }; hits.set(ip, h); }
  h.n++;
  if (action === "create") h.c++;
  return h.n > RL_MAX || (action === "create" && h.c > RL_CREATE_MAX);
}
setInterval(() => {
  const cutoff = Date.now() - RL_WINDOW;
  for (const [ip, h] of hits) if (h.t < cutoff) hits.delete(ip);
}, 30000).unref();

/* ── multi-machine room affinity via Fly-Replay ──────────────────────────────
   Rooms live in one process's memory. If the app ever runs on more than one
   machine, a request can land on an instance that doesn't hold the room. When
   that happens we ask Fly's proxy to replay the request on another instance,
   walking the peer list (via Fly internal DNS) until the owner is found. This
   is entirely inert off Fly (FLY_MACHINE_ID unset), so local runs and the test
   suite behave exactly as before. */
const dns = require('dns').promises;
const MACHINE = process.env.FLY_MACHINE_ID || "";
const NEEDS_ROOM = new Set(["join", "name", "ready", "start", "restart", "pick", "send", "leave"]);
let peers = [], peersAt = 0;
async function getPeers(){
  if (!MACHINE) return [];
  if (Date.now() - peersAt < 10000) return peers;
  try {
    const txt = await dns.resolveTxt("_instances.internal");
    const ids = new Set();
    for (const rec of txt){
      const m = /instance=([0-9a-zA-Z]+)/.exec(rec.join(""));
      if (m) ids.add(m[1]);
    }
    ids.delete(MACHINE);
    peers = [...ids]; peersAt = Date.now();
  } catch (e){ /* not on Fly / DNS unavailable → no peers, no replay */ }
  return peers;
}
function triedSet(req){
  const m = /state=([^;]*)/.exec(String(req.headers["fly-replay-src"] || ""));
  const s = new Set((m ? decodeURIComponent(m[1]) : "").split(",").filter(Boolean));
  s.add(MACHINE);
  return s;
}
async function replayElsewhere(req, res){
  if (!MACHINE) return false;
  const tried = triedSet(req);
  for (const p of await getPeers()){
    if (tried.has(p)) continue;
    res.writeHead(200, { "fly-replay": "instance=" + p + ";state=" + encodeURIComponent([...tried].join(",")) });
    res.end();
    return true;
  }
  return false;
}

function handleCmd(body){
  const action = body.action;

  if (action === "create"){
    if (rooms.size >= MAX_ROOMS) return { ok:false, error:"Server is busy — try again in a moment." };
    const room = makeRoom();
    const pid = newId();
    room.players.set(pid, { pid, name: clean(body.name) || "Player", seat:null, live:false, res:null, ack:0, execCid:0, ready:false });
    room.order.push(pid);
    room.hostPid = pid;
    assignSeats(room);
    startLoop(room);
    return { ok:true, code: room.code, pid };
  }

  if (action === "join"){
    const room = rooms.get(String(body.code || "").toUpperCase().trim());
    if (!room) return { ok:false, error:"No room with that code." };
    room.touched = Date.now();
    let pid = String(body.pid || "");
    if (room.players.has(pid)){                       /* returning player */
      const p = room.players.get(pid);
      if (body.name) p.name = clean(body.name) || p.name;
      return { ok:true, code: room.code, pid };
    }
    pid = newId();
    room.players.set(pid, { pid, name: clean(body.name) || "Player", seat:null, live:false, res:null, ack:0, execCid:0, ready:false });
    room.order.push(pid);
    if (room.phase === "lobby") assignSeats(room);
    if (!room.hostPid) room.hostPid = pid;
    broadcastLobby(room);
    return { ok:true, code: room.code, pid, spectator: room.phase !== "lobby" };
  }

  const room = rooms.get(String(body.code || "").toUpperCase().trim());
  if (!room) return { ok:false, error:"That room has closed." };
  const me = room.players.get(String(body.pid || ""));
  if (!me) return { ok:false, error:"You are not in this room." };
  room.touched = Date.now();

  if (action === "name"){
    me.name = clean(body.name) || me.name;
    broadcastLobby(room);
    return { ok:true };
  }

  if (action === "ready"){
    me.ready = body.ready === undefined ? !me.ready : !!body.ready;
    broadcastLobby(room);
    return { ok:true, ready: me.ready };
  }

  if (action === "start"){
    if (me.pid !== room.hostPid) return { ok:false, error:"Only the host can start." };
    room.seed = (Math.random() * 1e9) | 0;
    assignSeats(room);
    generate(room);
    /* players choose where to start; finalizePicks then opens the countdown */
    room.phase = "pick";
    room.pickEnd = Date.now() + PICK_TIMEOUT;
    for (const p of room.players.values()){ p.ack = 0; p.execCid = 0; }
    broadcastLobby(room);
    broadcastInit(room);
    broadcastState(room);
    return { ok:true };
  }

  if (action === "restart"){
    /* back to the party: everyone regroups in the lobby and re-readies, then
       the host starts a fresh match — so both sides always get the same game */
    if (me.pid !== room.hostPid) return { ok:false, error:"Only the host can start." };
    room.phase = "lobby";
    room.nodes = []; room.links = []; room.flights = [];
    room.candidates = []; room.picks = {};
    room.winner = undefined; room.elapsed = 0; room.goLiveAt = 0;
    assignSeats(room);
    for (const p of room.players.values()){ p.ready = false; p.ack = 0; p.execCid = 0; }
    broadcastLobby(room);
    return { ok:true };
  }

  if (action === "pick"){
    if (room.phase !== "pick") return { ok:false, error:"Not choosing a start now." };
    const seat = seatOf(room, me.pid);
    if (seat === null) return { ok:false, error:"Spectators can't pick." };
    if (room.picks[seat] !== undefined) return { ok:false, error:"You already chose." };
    const idx = body.node | 0;
    if (room.candidates.indexOf(idx) < 0) return { ok:false, error:"Tap a highlighted circle." };
    if (room.nodes[idx].owner !== null) return { ok:false, error:"That one's taken." };
    room.picks[seat] = idx;
    setHome(room, idx, seat);
    broadcastLobby(room);
    broadcastState(room);
    maybeFinishPicks(room);
    return { ok:true, node: idx };
  }

  if (action === "send"){
    /* acknowledge even the orders we drop — an unacknowledged command
       leaves a predicted column stranded on that client's screen */
    const cid = body.cid | 0;
    me.ack = Math.max(me.ack, cid);
    const seat = seatOf(room, me.pid);
    if (room.phase !== "live" || seat === null) return { ok:true };
    /* idempotent: a retried or duplicated order (same or older id) is ignored,
       so troops are never sent twice */
    if (cid <= me.execCid) return { ok:true };
    me.execCid = cid;
    const to = body.to | 0;
    const from = Array.isArray(body.from) ? body.from : [];
    if (room.nodes[to]){
      for (const s of from.slice(0, 40)) send(room, s | 0, to, seat);
    }
    return { ok:true };
  }

  if (action === "leave"){
    room.players.delete(me.pid);
    room.order = room.order.filter(x => x !== me.pid);
    if (room.hostPid === me.pid) room.hostPid = room.order[0] || null;
    broadcastLobby(room);
    return { ok:true };
  }

  return { ok:false, error:"Unknown action." };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");

  if (u.pathname === "/api/cmd" && req.method === "POST"){
    const body = await readBody(req);
    if (rateLimited(ipOf(req), body.action))
      return json(res, 429, { ok:false, error:"Slow down a moment." });
    if (NEEDS_ROOM.has(body.action) &&
        !rooms.has(String(body.code || "").toUpperCase().trim()) &&
        await replayElsewhere(req, res)) return;
    let out;
    try { out = handleCmd(body); }
    catch (e){ console.error(e); out = { ok:false, error:"Server error." }; }
    return json(res, 200, out);
  }

  if (u.pathname === "/api/stream"){
    const room = rooms.get(String(u.searchParams.get("code") || "").toUpperCase());
    const pid  = String(u.searchParams.get("pid") || "");
    if (!room || !room.players.has(pid)){
      if (await replayElsewhere(req, res)) return;
      return json(res, 404, { error:"gone" });
    }
    const p = room.players.get(pid);

    res.writeHead(200, {
      "content-type":"text/event-stream",
      "cache-control":"no-cache, no-transform",
      "connection":"keep-alive",
      "x-accel-buffering":"no"
    });
    res.write("retry: 1500\n\n");
    if (p.res) try { p.res.end(); } catch (e) {}
    p.res = res; p.live = true;
    room.touched = Date.now();

    pushEvent(p, "hello", { pid, code: room.code });
    broadcastLobby(room);
    if (room.nodes.length){ sendInit(room, p); broadcastState(room); }

    const ka = setInterval(() => { try { res.write(": ping\n\n"); } catch (e) {} }, 20000);
    req.on("close", () => {
      clearInterval(ka);
      if (p.res === res){ p.res = null; p.live = false; }
      room.touched = Date.now();
      broadcastLobby(room);
    });
    return;
  }

  if (u.pathname === "/api/rooms"){
    return json(res, 200, { rooms: rooms.size });
  }

  if (u.pathname === "/api/stats"){
    let liveRooms = 0, players = 0, connected = 0, matches = 0;
    for (const room of rooms.values()){
      let any = false;
      for (const p of room.players.values()){ players++; if (p.live){ connected++; any = true; } }
      if (any) liveRooms++;
      if (room.phase === "live") matches++;
    }
    return json(res, 200, {
      rooms: rooms.size, liveRooms, matches, players, connected,
      uptime: Math.round(process.uptime()),
      rssMB: Math.round(process.memoryUsage().rss / 1048576)
    });
  }

  if (req.method !== "GET") return json(res, 405, { error:"method" });
  serveStatic(req, res, u.pathname === "/" ? "/" : u.pathname);
});

module.exports = { server, handleCmd };
