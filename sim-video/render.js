// Renders the video frame by frame in headless Chromium.
//
//   node render.js --stills 2,26,49,73     one PNG per time, plus a contact sheet
//   node render.js                         the whole video, with sound → out/moon-closer.mp4
//   node render.js --audio                 redo only the soundtrack on the last render
//   node render.js --from 10 --to 20       a slice, for checking a section
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'out');
fs.mkdirSync(out, { recursive: true });

const args = process.argv.slice(2);
const opt = name => {
  const i = args.indexOf(name);
  return i < 0 ? null : args[i + 1] ?? '';
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('console', m => console.log('[page]', m.text()));
page.on('pageerror', e => console.error('[page error]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.ready === true, null, { timeout: 180000 });
const { DURATION, FPS } = await page.evaluate(() => window.meta);

async function frame(t) {
  await page.evaluate(t => window.renderAt(t), t);
}

if (opt('--stills') !== null) {
  const times = (opt('--stills') || '2,26,49,73').split(',').map(Number);
  const dir = path.join(out, 'stills');
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const t of times) {
    const t0 = Date.now();
    await frame(t);
    const f = path.join(dir, `t${String(t).replace('.', '_')}.png`);
    await page.screenshot({ path: f });
    files.push(f);
    console.log(`t=${t}s → ${path.relative(root, f)} (${Date.now() - t0} ms)`);
  }
  // Side-by-side contact sheet at half size.
  const sheet = path.join(dir, 'sheet.jpg');
  const inputs = files.flatMap(f => ['-i', f]);
  const filter = files.map((_, i) => `[${i}:v]scale=540:-1[v${i}]`).join(';') + ';' + files.map((_, i) => `[v${i}]`).join('') + `hstack=inputs=${files.length}`;
  await run('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', filter, '-q:v', '3', sheet]);
  console.log(`sheet → ${path.relative(root, sheet)}`);
} else if (args.includes('--audio')) {
  await soundtrack(path.join(out, 'moon-closer.silent.mp4'), path.join(out, 'moon-closer.mp4'));
} else {
  const from = parseFloat(opt('--from') ?? 0), to = parseFloat(opt('--to') ?? DURATION);
  const whole = from === 0 && to === DURATION;
  const name = opt('--out') || (whole ? 'moon-closer.silent.mp4' : `slice-${from}-${to}.mp4`);
  const file = path.join(out, name);
  const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const n = Math.round((to - from) * FPS);
  const started = Date.now();
  for (let i = 0; i < n; i++) {
    await frame(from + i / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 30 === 0) {
      const per = (Date.now() - started) / (i + 1);
      console.log(`frame ${i}/${n}  ${(per / 1000).toFixed(2)} s/frame  ~${Math.round((per * (n - i)) / 60000)} min left`);
    }
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  console.log(`video → ${path.relative(root, file)}`);
  if (whole) await soundtrack(file, path.join(out, 'moon-closer.mp4'));
}

// Synthesise the ambience from the timeline and lay it under the picture.
async function soundtrack(silent, final) {
  const cuesFile = path.join(out, 'cues.json');
  const wav = path.join(out, 'ambience.wav');
  fs.writeFileSync(cuesFile, JSON.stringify(await page.evaluate(() => window.cues())));
  await run('python3', [path.join(root, 'audio.py'), cuesFile, wav]);
  await run('ffmpeg', ['-y', '-v', 'error', '-i', silent, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', final]);
  console.log(`video with sound → ${path.relative(root, final)}`);
}

await browser.close();
server.close();

function run(cmd, a) {
  return new Promise((res, rej) => spawn(cmd, a, { stdio: 'inherit' }).on('close', c => (c ? rej(new Error(`${cmd} exited ${c}`)) : res())));
}
