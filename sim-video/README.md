# What if the Moon came closer?

A 76-second vertical (1080×1920) simulation video set on Mumbai's Marine Drive,
rendered frame by frame from a Three.js scene in headless Chromium.

```bash
npm install
npm run stills                 # key frames → out/stills/ and a contact sheet
node render.js --stills 13,49  # any times, in seconds
node render.js --from 40 --to 50   # a slice as MP4
npm run render                 # the whole video → out/moon-closer.mp4
```

Open `index.html` through any static server to watch it play live, or add
`?t=49.5` to the URL to hold one frame.

## Layout

```
src/
  timeline.js   every beat: Moon distance, tides, light, captions, stamps
  scene.js      Marine Drive: road, tetrapods, Art Deco row, traffic, lamps, Moon
  shaders.js    sky + rings, water, the cracking Moon
  textures.js   facade atlas, Moon surface, glows (all generated, no assets)
  main.js       renderer and the on-screen text
render.js       static server + Playwright + ffmpeg
```

Everything on screen is a pure function of time, so any frame renders on its
own and the full render streams straight into ffmpeg without writing frames
to disk.
