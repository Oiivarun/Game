# Mnema 30s spot — handoff brief

Next job: a 30s Apple-style ad for **Mnema**, built with the same pipeline as `../kairo-ad`
(an HTML page driven by a pure `render(t)`, captured frame-by-frame with Playwright, encoded with
ffmpeg, plus a soundtrack synthesized in Node). Start by copying `../kairo-ad` and re-skinning it.

**Sources:**
- The live homepage, saved as HTML on 2026-10-01.
- The Mnema workspace. It has **no** docs on Mnema's own brand, UI or go-to-market (only the default
  "Welcome to Mnema" doc), so everything below comes from the site.

## Still needed (grab these locally from mnema.theboringpeople.in)

- [ ] `logo.svg` (header and footer) and `/favicon.svg`. Not inlined in the HTML, so not captured yet.
- [ ] `/og-card.svg`
- [ ] Fonts: `/fonts/cabinet-grotesk/CabinetGrotesk-Bold.woff2`, `/fonts/inter/Inter-{Regular,Medium}.woff2`,
      `/fonts/jetbrains-mono/JetBrainsMono-Regular.woff2`, `/fonts/instrument-serif/InstrumentSerif-Regular.woff2`
- [ ] Global CSS tokens: `--canvas`, `--accent`, `--surface-2/3`, `--surface-rim`, `--border-subtle`,
      `--line-strong`, `--radius-md/lg`, `--ease-out`, `--duration-fast`
- [ ] Screenshots: the 3D knowledge-graph hero, the kanban board ("Built with Mnema"), the flow walker

## Brand tokens (confirmed from the HTML)

| Token | Value | Where it's used |
|---|---|---|
| Canvas | `#0A0B0D` | `theme-color`, page background, button text |
| Text primary | `#F4F5F7` / `rgb(238,240,243)` | headings, tooltips |
| Text secondary | `#B8BCC4` | nav, rotating-headline lead-in |
| Ink alphas (dark) | white at `.94 / .61 / .40 / .24` | `--ink`, `--ink-soft`, `--ink-muted`, `--ink-faint` |
| **Accent** | **`#FFB370`** (hover `#FFC590`) | primary button, rotating hero word, graph tooltip borders |
| Accent glow | `text-shadow: 0 0 20px rgba(255,179,112,.14)`; borders `rgba(255,179,112,.4)` | hero word, graph labels |
| Done | `#34D399` | kanban "Done" column |
| Audit / bug | `#F87171` | kanban "Audit / Fix" column |
| Review | `#8B8FA3` | kanban "Review" column |

- **Type:** Cabinet Grotesk Bold for h1/h2, Inter for body (nav 15px/450), JetBrains Mono for uppercase
  eyebrows and labels (`WHY MNEMA`, `HOW IT WORKS`, `FREE CORE · SELF-HOST OR CLOUD · NO CREDIT CARD`),
  Instrument Serif as an accent face.
- **Primary button:** amber fill, `#0A0B0D` text, 14px/600, radius 8, lifts 1px on hover. The ghost
  button is the secondary.
- **Motion cues on the site:** the rotating hero word ("It knows your **whole project. / meetings.**")
  enters at 320ms ease-out, rising 12px. Lenis smooth scroll, sticky scroll scenes, and a "flood" of
  file names that resolves into the graph.
- **Icons:** Lucide, stroke 1.4–1.75.
- **Graph node types:** `CONCEPT · DOC · WHY NOTE · MEETING · PROJECT · TASK · PERSON`

## Messaging (verbatim from the site)

- **Title:** Mnema — one brain for you and your agents
- **Hero:** "One brain for you and your agents." / "It knows your whole project." / "One brain. Yours and theirs. Both ways."
- **Sub:** "Mnema is the shared brain between you and your AI. Everything — docs, meetings, decisions, tasks, the
  work your agents do — connects in one place they read and write to live. You stop re-explaining. They stop forgetting."
- **Problem:** "Your AI forgets everything the moment you close the tab."
- **How it works:**
  - **CAPTURE** "Everything flows in."
  - **CONNECT** "It all connects." (not folders, but a graph your agent can traverse)
  - **RECALL** "Every agent reads it live." (Claude, ChatGPT, Cursor, Windsurf; same brain, always current)
- **Proof:** "We didn't build a demo. We built our company on it." 549 tasks, 280 shipped, each one traceable to the
  meeting or decision that started it.
- **Flows:** "Give your agent a plan, not a prompt." Steps: 01 Read specs → 02 Claim next task → 03 Work on task →
  04 Task complete without blockers? → 05 Complete task / 06 Log blocker. "A prompt hands it everything at once.
  A flow hands it one thing at a time — in the order you set."
- **Connect:** "Everything you do feeds it. Every agent reads it."
- **Open core:** "A second brain you can't inspect isn't yours." Fair-code; self-hostable; "Everything in the core
  today stays in the core, free, forever."
- **Product areas:** Meetings (the bot joins, transcribes, files decisions, creates tasks) · Tasks & Projects ·
  Flows · Sessions & Cost (what coding agents did and what it cost) · Community flows · DockMaster
- **Integrations shown:** Claude, ChatGPT, Cursor, Windsurf, Antigravity, Google Drive
- **Chaos strings** (the site's own "flood"; reuse them for the problem beat): `meeting_notes_q3.md`, `reconcile the
  vendor ledger`, `spec-draft-v2.md`, `who owns the migration?`, `audit findings — 41 open`,
  `slack: "can someone look at this"`, `invoice_841.pdf`, `TODO: chase the SOC2 gap`, `roadmap_2026.md`,
  `standup: blocked on infra`, `contract_redline_final.docx`, `retro action items`, `customer_call_transcript.txt`,
  `pricing model v4`, `incident postmortem`, `design_review_notes.md`, `vendor SLA breach?`, `launch checklist`
- **CTAs:** "Get started free" · "Self-host in ~4 min" · "FREE CORE · SELF-HOST OR CLOUD · NO CREDIT CARD"
- **Pricing:** Free $0 · Individual $15/mo · Team $20/seat/mo (5-seat minimum) · self-host the core free, forever
- **Company:** Mnema, by BOPPL. Footer line: "The shared brain between you and your AI — read and written live over MCP."

## Go-to-market (my inference from the site; nothing on GTM is recorded in the Mnema workspace)

- **Who it's for:** builders and small teams running several AI agents (Claude, Cursor and others) who are
  tired of re-explaining context; developers who want to self-host.
- **Wedge:** memory that's native to MCP, so every agent reads and writes the same live brain. Trust comes from
  the open core, and proof from the team building their own company on it.
- **Motion:** product-led. Free core, self-host or cloud free tier, upgrading to Individual or Team. The paid
  part is the hosted graph and meeting service.

## Proposed 30s structure (draft, to confirm with Varun)

| Time | Beat | Picture |
|---|---|---|
| 0–4s | Problem | The flood strings pile up; "Your AI forgets everything the moment you close the tab." |
| 4–6s | Reveal | The flood collapses into the graph; logo; "One brain for you and your agents." |
| 6–12s | Capture | A meeting card turns into notes, a decision and tasks that drop onto the board |
| 12–17s | Connect | The graph lights up node by node: meeting → why note → person → task |
| 17–22s | Recall | Claude, Cursor and ChatGPT each pull from the same brain: "Same brain. Always current." |
| 22–26s | Flows | Steps 01–06 walk themselves; "Give your agent a plan, not a prompt." |
| 26–30s | End card | "You stop re-explaining. They stop forgetting." · Get started free · Self-host in ~4 min |

Use agent and tool names as text. Third-party logos have their own usage rules, so get permission before
showing them.

## Running it locally

```
git fetch origin && git checkout claude/saas-ad-video-motion-3f74v7
cd promo/kairo-ad
npm install
npx playwright install chromium   # one-time, locally
npm run music && npm run render   # needs ffmpeg on PATH -> out/kairo-ad.mp4
```
