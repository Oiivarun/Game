'use strict';
const path = require('path');

/* ══════════════════════════════════════════════════════════════════════════
   Tuning
   The client mirrors the handful of these it needs in order to draw. Change
   a shared value here and in public/index.html together, or prediction will
   disagree with the server for a fraction of a second.
   ══════════════════════════════════════════════════════════════════════════ */

module.exports = {
  PORT:   process.env.PORT || 8080,
  PUBDIR: path.join(__dirname, '..', 'public'),

  W: 1000,
  H: 640,
  NODE_COUNT: 30,                  /* base board — scales up with seated players */
  NODE_PER_PLAYER: 3,              /* extra capturable nodes per seated human     */
  NODE_MAX: 45,                    /* ceiling that still fits the 1000x640 board  */
  SEATS: 5,                        /* five factions on the map              */

  TIER: {
    2: { r:29, growth:1.05, cap:99, start:[28, 40] },   /* major house      */
    1: { r:23, growth:0.62, cap:70, start:[14, 24] },   /* holding          */
    0: { r:17, growth:0.36, cap:44, start:[5, 13] }     /* outpost          */
  },
  HOME: { r:31, growth:1.35, cap:99 },

  SEND_FRACTION: 0.5,
  TROOP_SPEED:   132,              /* px per second                         */
  TROOP_GAP:     132 * 0.028,      /* spacing inside a column               */

  SIM_DT:    1 / 30,
  NET_EVERY: 3,                    /* broadcast every 3rd tick → 10 Hz      */

  ROOM_IDLE_MS:  10 * 60 * 1000,   /* empty rooms are swept after this      */
  LOBBY_TIMEOUT: 60 * 60 * 1000,
  MATCH_CAP:     15 * 60,          /* seconds — the leader takes a stalemate */
  MAX_ROOMS:     500               /* hard ceiling on live rooms (DoS guard) */
};
