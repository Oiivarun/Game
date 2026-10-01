// Renders index.html frame-by-frame with headless Chromium and encodes with ffmpeg.
//   node render.mjs                 -> out/kairo-ad.mp4 (video + music.wav if present)
//   node render.mjs --stills 1,3.5  -> out/stills/t_1.00.png, ...
// Env: FPS (default 60), WORKERS (default 4), FROM/TO (seconds, for partial renders)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, 'out');
const W = 1920, H = 1080, DUR = 30;
const FPS = +(process.env.FPS || 60);
const WORKERS = +(process.env.WORKERS || 4);
const url = 'file://' + resolve(here, 'index.html');
mkdirSync(OUT, { recursive: true });

const run = (cmd, args) => new Promise((ok, fail) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  p.on('exit', c => c === 0 ? ok() : fail(new Error(`${cmd} exited ${c}`)));
});

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(url);
  await page.evaluate(() => window.ready);
  return page;
}

const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text'] });
const stillsIdx = process.argv.indexOf('--stills');

if (stillsIdx > -1) {
  const times = (process.argv[stillsIdx + 1] || '0').split(',').map(Number);
  const SD = resolve(OUT, process.env.STILLS || 'stills');
  mkdirSync(SD, { recursive: true });
  const page = await openPage(browser);
  for (const t of times) {
    await page.evaluate(t => window.render(t), t);
    const file = resolve(SD, `t_${t.toFixed(2).padStart(5, '0')}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
  await browser.close();
  process.exit(0);
}

const from = Math.round(+(process.env.FROM || 0) * FPS);
const to = Math.round(+(process.env.TO || DUR) * FPS);
const total = to - from;
const per = Math.ceil(total / WORKERS);
let done = 0;
const t0 = Date.now();

const segs = await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
  const a = from + w * per, b = Math.min(to, a + per);
  if (a >= b) return null;
  const page = await openPage(browser);
  const cdp = await page.context().newCDPSession(page);
  const seg = resolve(OUT, `seg${w}.mp4`);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-r', String(FPS), seg], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = a; f < b; f++) {
    await page.evaluate(t => window.render(t), f / FPS);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
    const buf = Buffer.from(data, 'base64');
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (++done % 60 === 0) process.stdout.write(`\r${done}/${total} frames  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('exit', r));
  return seg;
}));
await browser.close();
console.log(`\nrendered ${total} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

const list = resolve(OUT, 'segs.txt');
writeFileSync(list, segs.filter(Boolean).map(s => `file '${s}'`).join('\n'));
const silent = resolve(OUT, 'video.mp4');
await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);
const wav = resolve(here, 'out', 'music.wav');
const final = resolve(OUT, 'kairo-ad.mp4');
if (existsSync(wav) && from === 0) {
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', final]);
  console.log('wrote', final);
} else {
  console.log('wrote', silent);
}
