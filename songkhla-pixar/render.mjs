// Serves this folder, renders index.html frame-by-frame with headless Chromium (WebGL), writes JPEG frames.
// Usage: node render.mjs <outDir> [fps] [--only=t1,t2,...] [--from=sec] [--to=sec]
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] || path.join(here, 'frames');
const fps = +(process.argv[3] || 30);
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
const only = arg('only');
await mkdir(outDir, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const p = path.join(here, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(here)) throw new Error('bad path');
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(await readFile(p));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('console', m => m.type() === 'error' && console.log('console:', m.text()));
page.on('pageerror', e => console.log('pageerror:', e.message));
await page.goto(`http://localhost:${port}/index.html?render`);
await page.waitForFunction(() => window.READY, null, { timeout: 120000 });
const total = await page.evaluate(() => window.TOTAL);

const from = +(arg('from') || 0), to = +(arg('to') || total);
const times = only ? only.split(',').map(Number)
  : Array.from({ length: Math.round((to - from) * fps) }, (_, i) => from + i / fps);
const t0 = Date.now();
for (const [i, t] of times.entries()) {
  await page.evaluate(t => window.seek(t), t);
  const name = only ? `t${t}.jpg` : `f${String(Math.round(t * fps)).padStart(5, '0')}.jpg`;
  await page.screenshot({ path: path.join(outDir, name), type: 'jpeg', quality: 92 });
  if (!only && i % 60 === 0) console.log(`frame ${i}/${times.length} (${((Date.now() - t0) / 1000 / (i + 1)).toFixed(2)}s/frame)`);
}
await browser.close(); server.close();
console.log('done', times.length, 'frames');
