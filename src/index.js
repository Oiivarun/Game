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

setInterval(sweep, 60000);

server.listen(PORT, () => {
  console.log('Holdings running \u2192 http://localhost:' + PORT);
});
