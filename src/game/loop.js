'use strict';
const { SIM_DT, NET_EVERY, ROOM_IDLE_MS, LOBBY_TIMEOUT } = require('../config');
const { rooms } = require('./rooms');
const { step, finalizePicks } = require('./sim');
const { broadcastState, broadcastLobby } = require('../net/protocol');

/* ══════════════════════════════════════════════════════════════════════════
   The clock
   One interval per live room, plus the sweeper that retires abandoned ones.
   ══════════════════════════════════════════════════════════════════════════ */

function tick(room){
  /* nobody left choosing a start in time → finish the picks for them */
  if (room.phase === "pick" && Date.now() >= room.pickEnd) finalizePicks(room);

  /* the countdown is driven here so every client goes live on the same tick */
  if (room.phase === "countdown" && Date.now() >= room.goLiveAt){
    room.phase = "live";
    room.elapsed = 0;
    broadcastLobby(room);
    broadcastState(room);
  }

  step(room, SIM_DT);
  if (++room.tickN % NET_EVERY === 0) broadcastState(room);

  const idle = ![...room.players.values()].some(p => p.live);
  if (idle && Date.now() - room.touched > ROOM_IDLE_MS) closeRoom(room);
}

function startLoop(room){
  if (room.timer) return;
  room.timer = setInterval(() => tick(room), SIM_DT * 1000);
}
function closeRoom(room){
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
  for (const p of room.players.values()) if (p.res) try { p.res.end(); } catch (e) {}
  rooms.delete(room.code);
}

/* rooms nobody is connected to, and lobbies that never started */
function sweep(){
  const now = Date.now();
  for (const room of [...rooms.values()]){
    const live = [...room.players.values()].some(p => p.live);
    if (!live && now - room.touched > ROOM_IDLE_MS) closeRoom(room);
    else if (room.phase === "lobby" && now - room.touched > LOBBY_TIMEOUT) closeRoom(room);
  }
}

module.exports = { tick, startLoop, closeRoom, sweep };
