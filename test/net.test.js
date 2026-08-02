/* End-to-end over the real HTTP surface: two players, a live room, one order,
   a disconnect, and a rejoin. Boots the server on a spare port. */
'use strict';
const { server } = require("../src/net/server");
const { NODE_COUNT, NODE_PER_PLAYER, NODE_MAX, COUNTDOWN_MS } = require("../src/config");
const PORT = 8177, BASE = "http://127.0.0.1:" + PORT;
/* two players take seats before the match starts, so the board scales to this */
const EXPECT = Math.min(NODE_MAX, NODE_COUNT + NODE_PER_PLAYER * 2);

const post = body => fetch(BASE + "/api/cmd", {
  method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(body)
}).then(r => r.json());

function stream(code, pid, onEvent){
  const ctrl = new AbortController();
  fetch(BASE + "/api/stream?code=" + code + "&pid=" + pid, { signal:ctrl.signal }).then(async res => {
    const rd = res.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;){
      const { done, value } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream:true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0){
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(chunk), da = /^data: (.+)$/m.exec(chunk);
        if (ev && da) onEvent(ev[1], JSON.parse(da[1]));
      }
    }
  }).catch(() => {});
  return ctrl;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (label, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + label + (detail === undefined ? "" : "  → " + detail));
  if (!ok) fails++;
};

(async () => {
  server.listen(PORT);
  await wait(300);

  const A = await post({ action:"create", name:"Vee" });
  check("host opens a room", A.ok && /^[A-Z0-9]{4}$/.test(A.code), A.code);
  const log = { A:{}, B:{} };
  const sa = stream(A.code, A.pid, (e, d) => log.A[e] = d);
  await wait(300);

  const B = await post({ action:"join", code:A.code.toLowerCase(), name:"Ayesha" });
  check("guest joins by code", B.ok);
  const sb = stream(A.code, B.pid, (e, d) => log.B[e] = d);
  await wait(400);
  check("both seated", log.A.lobby.players.length === 2, log.A.lobby.players.map(p => p.name + ":" + p.seat).join(","));

  await post({ action:"ready", code:A.code, pid:B.pid, ready:true });
  await wait(200);
  check("guest can ready up", !!(log.A.lobby.players.find(p => p.pid === B.pid) || {}).ready);

  const refused = await post({ action:"start", code:A.code, pid:B.pid });
  check("only the host may start", refused.ok === false, refused.error);

  await post({ action:"start", code:A.code, pid:A.pid });
  await wait(600);
  check("map delivered once", log.B.init && log.B.init.nodes.length === EXPECT, EXPECT + " nodes");
  check("snapshots flowing", !!log.B.state && log.B.state.n.length === EXPECT * 2);

  /* the match opens with a shared countdown — wait for it to flip to live */
  await wait(COUNTDOWN_MS);
  check("match went live after the countdown", log.B.state.phase === "live", log.B.state.phase);

  const st = log.B.state, seat = log.B.init.seat;
  const mine = [], theirs = [];
  for (let i = 0; i < EXPECT; i++) (st.n[i*2] === seat ? mine : theirs).push(i);
  const src = mine[0];
  let tgt = theirs[0], best = Infinity;
  for (const t of theirs){
    const d = Math.hypot(log.B.init.nodes[t][0] - log.B.init.nodes[src][0],
                         log.B.init.nodes[t][1] - log.B.init.nodes[src][1]);
    if (d < best){ best = d; tgt = t; }
  }
  const before = st.n[src*2+1];
  await post({ action:"send", code:A.code, pid:B.pid, from:[src], to:tgt, cid:1 });
  await wait(400);
  check("order halves the garrison", log.B.state.n[src*2+1] < before, before + " → " + log.B.state.n[src*2+1]);
  check("order acknowledged", log.B.state.ack === 1);
  check("host sees the column too", log.A.state.f.length > 0);

  /* a retried / duplicated order (same id) must not send troops a second time */
  const afterOne = log.B.state.n[src*2+1];
  await post({ action:"send", code:A.code, pid:B.pid, from:[src], to:tgt, cid:1 });
  await wait(400);
  check("a replayed order is ignored", log.B.state.n[src*2+1] >= afterOne, afterOne + " → " + log.B.state.n[src*2+1]);

  sb.abort();
  await wait(700);
  check("dropped player marked away", log.A.lobby.players.find(p => p.pid === B.pid).live === false);
  const held0 = log.A.state.n.filter((v,i) => i%2===0 && v===seat).length;
  await wait(4000);
  const held1 = log.A.state.n.filter((v,i) => i%2===0 && v===seat).length;
  check("AI keeps the empty seat playing", held1 >= held0, held0 + " → " + held1);

  const back = await post({ action:"join", code:A.code, pid:B.pid, name:"Ayesha" });
  const sb2 = stream(A.code, B.pid, (e, d) => log.B[e] = d);
  await wait(500);
  check("rejoin restores the seat", back.ok && log.B.init.seat === seat, "seat " + log.B.init.seat);

  sa.abort(); sb2.abort();
  console.log(fails ? "\n" + fails + " failing check(s)" : "\nall checks passed");
  process.exit(fails ? 1 : 0);
})();
