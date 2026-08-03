'use strict';

/* ══════════════════════════════════════════════════════════════════════════
   Wire format
   Everything the server says to a browser goes out through here.
   ══════════════════════════════════════════════════════════════════════════ */

function pushEvent(player, event, data){
  if (!player.res) return;
  try {
    player.res.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
  } catch (e){ /* the close handler will clean up */ }
}

function roster(room){
  return {
    code: room.code,
    phase: room.phase,
    host: room.hostPid,
    winner: room.winner === undefined ? null : room.winner,
    countdownMs: room.phase === "countdown" ? Math.max(0, room.goLiveAt - Date.now()) : 0,
    players: room.order.map(pid => room.players.get(pid)).filter(Boolean).map(p => ({
      pid: p.pid, name: p.name, seat: p.seat, live: p.live, ready: !!p.ready
    }))
  };
}
function broadcastLobby(room){
  const r = roster(room);
  for (const p of room.players.values()) pushEvent(p, "lobby", r);
}
function sendInit(room, player){
  pushEvent(player, "init", {
    seed: room.seed,
    nodes: room.nodes.map(n => [Math.round(n.x), Math.round(n.y), n.r, n.tier, n.home ? 1 : 0, n.candidate ? 1 : 0]),
    links: room.links,
    seat: player.seat
  });
}
function broadcastInit(room){
  for (const p of room.players.values()) sendInit(room, p);
}
function broadcastState(room){
  if (!room.nodes.length) return;
  const n = new Array(room.nodes.length * 2);
  for (let i = 0; i < room.nodes.length; i++){
    n[i * 2]     = room.nodes[i].owner === null ? -1 : room.nodes[i].owner;
    n[i * 2 + 1] = room.nodes[i].count;
  }
  const f = room.flights.map(fl =>
    [fl.id, fl.from, fl.to, fl.owner, fl.count, fl.delivered, Math.round(fl.prog)]);
  const t = Math.round(room.elapsed * 10) / 10;
  for (const p of room.players.values()){
    if (!p.res) continue;
    pushEvent(p, "state", { t, n, f, ack: p.ack, phase: room.phase });
  }
}

module.exports = { pushEvent, roster, broadcastLobby, sendInit, broadcastInit, broadcastState };
