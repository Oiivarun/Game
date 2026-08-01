/* Runs full matches headlessly, far faster than real time, to prove the
   simulation always resolves — no deadlock at the troop cap, no crash. */
'use strict';
const { makeRoom, rooms } = require("../src/game/rooms");
const { generate } = require("../src/game/map");
const { step } = require("../src/game/sim");
const { SEATS, NODE_COUNT } = require("../src/config");

const DT = 1 / 30, LIMIT = 60 * 25;      /* give each match 25 minutes */
let fails = 0, times = [];

for (let run = 0; run < 12; run++){
  const room = makeRoom();
  clearInterval(room.timer);
  generate(room);
  room.phase = "live";

  let t = 0;
  while (room.phase === "live" && t < LIMIT){ step(room, DT); t += DT; }

  const held = new Array(SEATS).fill(0);
  for (const n of room.nodes) if (n.owner !== null) held[n.owner]++;
  const nodes = room.nodes.length;

  if (nodes !== NODE_COUNT){ console.log("run " + run + ": only " + nodes + " nodes placed"); fails++; }
  if (room.phase !== "over"){
    console.log("run " + run + ": no winner after " + Math.round(t) + "s — " + held.join("/"));
    fails++;
  } else {
    times.push(t);
    console.log("run " + run + ": " + ["Teal","Crimson","Amber","Violet","Lime"][room.winner] +
                " won in " + Math.floor(t / 60) + "m" + String(Math.floor(t % 60)).padStart(2, "0") + "s");
  }
  rooms.delete(room.code);
}

if (times.length){
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log("\naverage match " + Math.floor(avg / 60) + "m" + String(Math.round(avg % 60)).padStart(2, "0") + "s" +
              "  ·  shortest " + Math.round(Math.min(...times)) + "s  ·  longest " + Math.round(Math.max(...times)) + "s");
}
console.log(fails ? "\n" + fails + " failing run(s)" : "\nall runs resolved");
process.exit(fails ? 1 : 0);
