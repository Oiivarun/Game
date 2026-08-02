'use strict';
const { SEATS } = require('../config');

/* ══════════════════════════════════════════════════════════════════════════
   Rooms and seating
   Room records, codes, and who is sitting where. No simulation in here.
   ══════════════════════════════════════════════════════════════════════════ */

const rooms = new Map();

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   /* no I/O/0/1 */
function newCode(){
  let c;
  do {
    c = "";
    for (let i = 0; i < 4; i++) c += CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0];
  } while (rooms.has(c));
  return c;
}
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function makeRoom(){
  const code = newCode();
  const room = {
    code,
    seed: (Math.random() * 1e9) | 0,
    rng: null,
    phase: "lobby",          /* lobby | live | over */
    players: new Map(),      /* pid -> player                              */
    order: [],               /* join order, decides seating                */
    hostPid: null,
    nodes: [], links: [], flights: [],
    nextFlight: 1,
    elapsed: 0,
    goLiveAt: 0,             /* when a countdown flips the room to live      */
    winner: undefined,
    aiClock: new Array(SEATS).fill(0),
    tickN: 0,
    timer: null,
    touched: Date.now()
  };
  rooms.set(code, room);
  return room;
}

function seatOf(room, pid){
  const p = room.players.get(pid);
  return p && p.seat !== null ? p.seat : null;
}
function seatHolder(room, seat){
  for (const p of room.players.values()) if (p.seat === seat) return p;
  return null;
}
/* a seat plays itself whenever the person holding it is away */
function isBot(room, seat){
  const p = seatHolder(room, seat);
  return !p || !p.live;
}

function assignSeats(room){
  const taken = new Set();
  for (const p of room.players.values()) if (p.seat !== null) taken.add(p.seat);
  for (const pid of room.order){
    const p = room.players.get(pid);
    if (!p || p.seat !== null) continue;
    for (let s = 0; s < SEATS; s++){
      if (!taken.has(s)){ p.seat = s; taken.add(s); break; }
    }
    /* no free seat → stays a spectator (p.seat === null) */
  }
}

module.exports = { rooms, newCode, newId, makeRoom, seatOf, seatHolder, isBot, assignSeats };
