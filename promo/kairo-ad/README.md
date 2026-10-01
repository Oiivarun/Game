# Kairo — 30s Apple-style SaaS spot

A demo ad for **Kairo**, a fictional AI calendar. Everything is code: the picture is an HTML page
whose every element is a pure function of time, rendered frame-by-frame in headless Chromium; the
soundtrack is synthesized in Node and cued to the same timeline.

```
npm install
npm run music      # out/music.wav  (120 BPM, cues locked to the cuts)
npm run stills -- 3.3,10.8,21.8      # quick PNG previews at given seconds
npm run render     # out/kairo-ad.mp4  (1920x1080, 60 fps, H.264 + AAC)
```

Open `index.html?t=12.5` in a browser to scrub to any moment.

| Time | Beat | Scene |
|---|---|---|
| 0–4s | Problem | "Meetings. Messages. Deadlines. Reminders." on the beat, then notification chaos: "It's a lot." |
| 4–6s | Reveal | Everything implodes into a bloom; logo draws on; "Your calendar, on autopilot." |
| 6–12s | Hero | App window rises; cursor hits *Plan my week*; seven tasks spring into the calendar |
| 12–16s | Focus | Camera flies into the Deep work block; interruptions bounce off a shield |
| 16–20s | Summaries | Light sheet slides up; a meeting summary streams in; action items get scheduled |
| 20–23s | Proof | "6.5 hours, every single week." count-up on the drop |
| 23–26s | Devices | Laptop + phone |
| 26–30s | End card | Lockup, "Make time for what matters.", CTA |

Env knobs for `render.mjs`: `FPS` (60), `WORKERS` (4), `FROM`/`TO` seconds for partial renders.
Fonts: Inter / Inter Tight (SIL OFL) via Fontsource.
