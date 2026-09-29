#!/usr/bin/env node
// One-off, manually-run generator for a local, size-reduced derivative of a
// single belowfold image: /2020/12/DSC07630-1.jpg on the home page.
//
// That file is the client's own original on the canonical image host (AD-9,
// image-hosts.json) — 6000x4000, 6,866,705 bytes — served at a display size of
// well under 600px wide. Nothing here uploads to, deletes from, or otherwise
// mutates that host: this script only performs a read-only GET of the existing
// public URL and writes a *new, separate* file under public/img/, checked into
// this repo like any other local static asset. The original is left as the
// <img> fallback in src/html/home.content.html so nothing about AD-9 changes:
// every "real" image reference on the site is still the client's file on
// img.rexdalemobilewash.ca; this is an additional, local, opt-in <source> for
// browsers that support it.
//
// Not wired into `npm run build` on purpose — the derivative is small enough
// to commit once and does not need to be regenerated on every deploy, and a
// build step that depends on an outside host being reachable is exactly the
// kind of fragility this repo's checks (bin/check-*) are designed to catch
// elsewhere. Re-run manually with `node tools/gen-image-derivative.mjs` only
// if the source photo itself changes.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'https://img.rexdalemobilewash.ca/2020/12/DSC07630-1.jpg';
const OUT = join(root, 'public', 'img', 'dsc07630-1-1200.webp');
const WIDTH = 1200; // >2x the widest measured display width (~585px cell) for retina

// Node's own fetch() timed out in the sandbox this was written in even though
// the host is reachable (curl to the same URL worked immediately) — some
// environments restrict outbound fetch() specifically. Try fetch() first,
// since it needs nothing else installed, and fall back to shelling out to
// curl, which is what actually succeeded here. Either way this is a plain
// read-only GET of the existing public file; nothing is written back to it.
async function fetchOriginal(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.warn(`fetch() failed (${err.message}); falling back to curl`);
    return execFileSync('curl', ['-sL', '--fail', url], { maxBuffer: 1024 * 1024 * 64 });
  }
}

const buf = await fetchOriginal(SRC);
console.log(`fetched ${SRC}: ${buf.length} bytes`);

const out = await sharp(buf)
  .resize({ width: WIDTH, withoutEnlargement: true })
  .webp({ quality: 78 })
  .toBuffer();

writeFileSync(OUT, out);
const meta = await sharp(out).metadata();
console.log(`wrote ${OUT}: ${out.length} bytes (${meta.width}x${meta.height}), ` +
  `${Math.round((1 - out.length / buf.length) * 100)}% smaller than the original`);
