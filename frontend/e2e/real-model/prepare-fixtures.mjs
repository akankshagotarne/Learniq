/**
 * Builds the fake-camera video files for the REAL-model proctoring test (e2e/real-model/proctoring-real-model.spec.ts).
 *
 *   node e2e/real-model/prepare-fixtures.mjs
 *
 * Source photos: the MIT-licensed demo images inside the npm package @vladmandic/face-api (downloaded with `npm pack`).
 * The scenes (640x480) are written as .y4m files to e2e/.fixtures/, which is git-ignored: photos of real people are
 * never committed to this repository. Chromium plays them as its camera with --use-file-for-fake-video-capture.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '.fixtures');
mkdirSync(out, { recursive: true });

const work = join(tmpdir(), `learniq-proctor-fixtures-${Date.now()}`);
mkdirSync(work, { recursive: true });
console.log('Downloading @vladmandic/face-api demo images (npm pack)…');
const tgz = execSync('npm pack @vladmandic/face-api@1.7.15 --silent', { cwd: work }).toString().trim().split('\n').pop();
execSync(`tar -xzf "${tgz}"`, { cwd: work });
const img = (n) => `data:image/jpeg;base64,${readFileSync(join(work, 'package', 'demo', n)).toString('base64')}`;

// crops are given in a 480x320 thumbnail coordinate system of each source photo
const SCENES = {
  'one-face': [{ src: 'sample3.jpg', box: [250, 40, 370, 230], dest: [0, 0, 640, 480] }],
  'two-faces': [{ src: 'sample3.jpg', box: [250, 40, 370, 230], dest: [0, 0, 320, 480] }, { src: 'sample6.jpg', box: [140, 30, 250, 220], dest: [320, 0, 320, 480] }],
  'no-face': [{ src: 'sample3.jpg', box: [0, 0, 110, 70], dest: [0, 0, 640, 480] }],
  'face-and-phone': [{ src: 'sample3.jpg', box: [250, 40, 370, 230], dest: [0, 0, 360, 480] }, { src: 'sample2.jpg', box: [5, 265, 85, 315], dest: [360, 0, 280, 480] }],
};

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, parts] of Object.entries(SCENES)) {
  const rgba = await page.evaluate(async (ps) => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgb(52,58,70)'; ctx.fillRect(0, 0, 640, 480);
    for (const p of ps) {
      const im = new Image(); im.src = p.src; await im.decode();
      const sx = im.naturalWidth / 480; const sy = im.naturalHeight / 320;
      const [x0, y0, x1, y1] = p.box; const [dx, dy, dw, dh] = p.dest;
      const cw = (x1 - x0) * sx; const ch = (y1 - y0) * sy;
      const scale = Math.min(dw / cw, dh / ch); const w = cw * scale; const h = ch * scale; // keep aspect ratio (letterbox)
      ctx.drawImage(im, x0 * sx, y0 * sy, cw, ch, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
    }
    const d = ctx.getImageData(0, 0, 640, 480).data;
    let s = ''; for (let i = 0; i < d.length; i += 8192) s += String.fromCharCode(...d.subarray(i, i + 8192));
    return btoa(s);
  }, parts.map((p) => ({ ...p, src: img(p.src) })));
  const px = Buffer.from(rgba, 'base64');
  const W = 640, H = 480;
  const Y = Buffer.alloc(W * H), U = Buffer.alloc(W * H / 4), V = Buffer.alloc(W * H / 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; const r = px[i], g = px[i + 1], b = px[i + 2];
    Y[y * W + x] = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
    if (y % 2 === 0 && x % 2 === 0) {
      const j = (y / 2) * (W / 2) + x / 2;
      U[j] = Math.max(0, Math.min(255, Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b)));
      V[j] = Math.max(0, Math.min(255, Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b)));
    }
  }
  const frame = Buffer.concat([Buffer.from('FRAME\n'), Y, U, V]);
  writeFileSync(join(out, `${name}.y4m`), Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F15:1 Ip A1:1 C420jpeg\n`), frame, frame]));
  console.log('wrote', join(out, `${name}.y4m`));
}
await browser.close();
if (existsSync(work)) rmSync(work, { recursive: true, force: true });
