// Renders index.html frame-by-frame to PNG/JPEG, then encodes MP4 with ffmpeg.
// Usage: node render.mjs [outDir] [fps] [--only=t1,t2,...]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] || path.join(here, 'frames');
const fps = +(process.argv[3] || 30);
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await page.goto('file://' + path.join(here, 'index.html') + '?render');
await page.evaluate(() => document.fonts.ready);
const total = await page.evaluate(() => window.TOTAL);

const times = only ? only.split(',').map(Number) : Array.from({ length: Math.round(total * fps) }, (_, i) => i / fps);
for (const [i, t] of times.entries()) {
  await page.evaluate(t => window.seek(t), t);
  const name = only ? `t${t}.jpg` : `f${String(i).padStart(5, '0')}.jpg`;
  await page.screenshot({ path: path.join(outDir, name), type: 'jpeg', quality: 92 });
  if (!only && i % 150 === 0) console.log(`frame ${i}/${times.length}`);
}
await browser.close();
console.log('done', times.length, 'frames');
