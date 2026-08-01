'use strict';

/* ══════════════════════════════════════════════════════════════════════════
   Holdings — authoritative multiplayer server.

   No dependencies. Plain http.
   Server → client:  Server-Sent Events (one long-lived GET per player)
   Client → server:  POST /api/cmd

   The server owns the entire simulation. Clients render it and predict their
   own sends locally so the drag feels instant; the next snapshot corrects
   them. Every faction nobody is sitting in is played by the AI, so a room is
   playable with one human or five.
   ══════════════════════════════════════════════════════════════════════════ */

const { PORT } = require('./config');
const { server } = require('./net/server');
const { sweep }  = require('./game/loop');
const { rooms }  = require('./game/rooms');

setInterval(sweep, 60000);

/* a heartbeat in the logs — enough to spot a room or memory leak */
setInterval(() => {
  let players = 0, connected = 0;
  for (const room of rooms.values()) for (const p of room.players.values()){ players++; if (p.live) connected++; }
  console.log('[stats] rooms=' + rooms.size + ' players=' + players +
              ' connected=' + connected +
              ' rss=' + Math.round(process.memoryUsage().rss / 1048576) + 'MB' +
              ' uptime=' + Math.round(process.uptime()) + 's');
}, 10 * 60 * 1000);

server.listen(PORT, () => {
  console.log('Holdings running \u2192 http://localhost:' + PORT);
});

/* Fly sends SIGTERM on every deploy. Stop taking new connections and exit
   cleanly; in-memory matches still end (that is the single-process design). */
function shutdown(sig){
  console.log('Holdings shutting down (' + sig + ')');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
