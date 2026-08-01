# Holdings

A territory game for up to five players. Drag from your circles onto any other
circle to send half its troops; drag across several of your own first to send
from all of them. Every seat nobody is sitting in is played by the AI, so a
room works with one human or five.

One authoritative Node process, no dependencies, no build step.

```bash
npm start          # → http://localhost:8080
npm test           # twelve full AI matches, then an end-to-end HTTP run
```

## Layout

```
src/
  config.js        tuning — the client mirrors a few of these to draw
  index.js         entry point
  game/
    map.js         seeded board generation
    rooms.js       room records, codes, seating
    sim.js         columns, landings, the AI, one authoritative step
    loop.js        the clock, and the sweeper for abandoned rooms
  net/
    protocol.js    everything the server says to a browser
    server.js      static files, POST /api/cmd, GET /api/stream
public/
  index.html       the whole client — canvas, lobby, prediction
test/
  sim.test.js      plays matches headlessly to prove none deadlock
  net.test.js      two players over real HTTP: join, order, drop, rejoin
```

## Push it to GitHub

```bash
git init -b main
git add -A && git commit -m "Holdings"
gh repo create holdings --private --source=. --push
```

`.github/workflows/deploy.yml` runs the tests on every push and pull request,
and deploys to Fly when `main` passes. For that it needs one repository secret:

```bash
fly tokens create deploy -x 999999h     # prints a token
```

Add it as `FLY_API_TOKEN` under Settings → Secrets and variables → Actions.
Set the secret yourself in the GitHub UI; never paste a token into a file in
the repo.

## Sharing the link

**For a game right now**, put a tunnel in front of it and send the URL:

```bash
npx localtunnel --port 8080
# or
cloudflared tunnel --url http://localhost:8080
```

**For a URL that stays up**, deploy to Fly:

```bash
fly auth login
fly launch --no-deploy --copy-config --ha=false --name holdings-yourname
fly deploy --ha=false
fly scale count 1
fly open
```

`--copy-config` makes it use the `fly.toml` in this folder rather than
generating one. The app name has to be globally unique, so change it in
`fly.toml` or pass `--name`. Roughly $2/month for an always-on
`shared-cpu-1x` with 256MB.

### One machine, not two

Fly's default is two machines for high availability. Do not take it here.
Rooms live in the server process's memory, so two machines behind one hostname
means two separate room stores — you and your friend type the same code and
land in different games, with the board flipping between them. That is why
`--ha=false` appears twice above and why `fly scale count 1` is a step rather
than a suggestion. Check it any time with `fly status`.

If you would rather not pay while nobody is playing, set
`auto_stop_machines = "suspend"` and `min_machines_running = 0` in `fly.toml`.
The first visitor then waits a few seconds for a wake-up, and a suspend that
lands mid-match ends that match.

Render also works from the included `render.yaml`, and the folder deploys
unchanged to Koyeb or any host that runs `npm start`.

## How a match runs

- The host creates a room and presses **Start the match**. Only the host can
  start or restart.
- Seats are handed out in join order and the five home bases are shuffled before
  colours are assigned, so no seat index gets a positional advantage.
- Empty seats are AI. If someone closes their tab mid-match, the AI takes their
  seat immediately and the match keeps moving; if they come back on the same
  link the seat is theirs again, with everything they built.
- Losing every holding doesn't kick you out — you stay and watch.
- Rooms with nobody connected are swept after ten minutes.

## What changed under the hood

**The server owns the game.** `server.js` runs the whole simulation at 30 Hz —
growth, troop movement, captures, AI — and broadcasts a snapshot ten times a
second over Server-Sent Events. Clients send orders by `POST /api/cmd`. Nothing
about the outcome is decided in a browser, so nobody can edit their troop count
in the console.

**Troops travel as columns, not particles.** A send of 40 troops used to be 40
objects; it is now one object with a count and a distance travelled. The dots on
screen are derived from that at draw time, identical to before. This is what
makes the snapshot small enough to send ten times a second — a full game state
is about a kilobyte.

**Your own orders are drawn before the server confirms them.** Release a drag and
the column leaves immediately; the client keeps that guess in a pending list and
throws it away as soon as the server acknowledges the order and sends back the
real one. Round-trip latency stays invisible unless the connection is bad.

**Map data is sent once.** Node positions and the link mesh go out at match
start; snapshots after that carry only owner, count, and columns in flight.

## Tuning

Game feel lives at the top of `server.js` — `TIER`, `HOME`, `SEND_FRACTION`,
`TROOP_SPEED`, `NODE_COUNT`. The client mirrors `SEND_FRACTION`, `TROOP_SPEED`
and the palette near the top of `public/index.html` because it needs them to
draw; change those in both places or the prediction will disagree with the
server for a fraction of a second.

`NET_EVERY` sets the broadcast rate (3 = ten snapshots a second). Raising it cuts
bandwidth and makes columns rely more on client-side interpolation.

## Checks

```bash
npm test    # plays twelve full AI matches at max speed
```

It asserts every match resolves rather than deadlocking at the troop cap, and
prints who won and how long each took. Matches land around 2m30s–3m30s.

## Known limits

- SSE needs an unbuffered proxy. The server sets `X-Accel-Buffering: no` for
  nginx and pings every 20s to keep idle connections open; if you put Cloudflare
  in front of it, leave the response uncompressed.
- Rooms live in memory. Restarting the server ends every match in progress.
- Five seats is the map, not the netcode — more players means editing `SEATS` in
  `server.js`, the `FACTIONS` palette in the client, and the home-placement
  spacing, which starts to crowd past six.
