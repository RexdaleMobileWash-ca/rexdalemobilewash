#!/usr/bin/env node
// Sitemap enforcement. Exits 1 if the sitemaps and the site disagree.
//
// A sitemap is the one file nobody looks at. It is also the file that tells
// Google what this site is, so a wrong one is expensive and silent: a URL that
// 404s wastes crawl budget and gets reported as an error; a page that is served
// but never listed may simply not be found. Neither shows up in any other check
// here — the render harness, the image check and the form check all pass over a
// completely broken sitemap without noticing.
//
// Runs inside `npm run build`, joined with &&, so it runs in Workers Builds on
// every deploy.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist', 'client');
const SITE = 'https://www.rexdalemobilewash.ca';
const IMG = 'https://' +
  JSON.parse(readFileSync(join(root, 'image-hosts.json'), 'utf8')).canonical;

/** Every route the built site actually serves. */
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const served = new Set();
const noindex = new Set();
for (const f of walk(dist)) {
  if (!f.endsWith('index.html')) continue;
  const route = '/' + f.slice(dist.length + 1).replace(/index\.html$/, '');
  served.add(route);
  const robots = readFileSync(f, 'utf8').match(/<meta name="robots" content="([^"]*)"/);
  if (robots && /noindex/i.test(robots[1])) noindex.add(route);
}

const text = (f) => readFileSync(join(dist, f), 'utf8');
const tags = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([^<]+)</${tag}>`, 'g'))]
  .map((m) => m[1]);

const problems = [];
const fail = (msg) => problems.push(msg);

// -- the index
if (!existsSync(join(dist, 'sitemap_index.xml'))) {
  fail('sitemap_index.xml is missing — it is the crawl entry point Google has indexed');
}
const index = text('sitemap_index.xml');
const children = tags(index, 'loc').map((u) => u.replace(SITE + '/', ''));

// -- every child listed must exist, be non-empty, and be reachable
const listed = new Map();
for (const child of children) {
  if (!existsSync(join(dist, child))) {
    fail(`${child} is listed in the index but not built`);
    continue;
  }
  const xml = text(child);
  const urls = tags(xml, 'loc');
  if (!urls.length) {
    // This is what e-landing-page-sitemap.xml was. Search Console reports an
    // empty sitemap as an error rather than ignoring it.
    fail(`${child} contains zero URLs — an empty sitemap is a Search Console error`);
  }
  listed.set(child, urls);
}

// -- no sitemap file may be built and then left out of the index
for (const f of readdirSync(dist)) {
  if (!/-sitemap\.xml$/.test(f)) continue;
  if (!children.includes(f)) fail(`${f} is built but not listed in sitemap_index.xml`);
}

// -- the URL set must be exactly the indexable routes
const inSitemaps = new Map();
for (const [child, urls] of listed) {
  for (const u of urls) {
    if (!u.startsWith(SITE + '/') && u !== SITE) fail(`${child}: ${u} is not on ${SITE}`);
    const path = u.replace(SITE, '') || '/';
    if (inSitemaps.has(path)) fail(`${path} appears in both ${inSitemaps.get(path)} and ${child}`);
    inSitemaps.set(path, child);
    if (!served.has(path)) fail(`${child}: ${path} is listed but the site does not serve it`);
    if (noindex.has(path)) fail(`${child}: ${path} is listed but the page says noindex`);
  }
}
for (const route of served) {
  if (noindex.has(route)) continue;
  if (!inSitemaps.has(route)) fail(`${route} is served and indexable but is in no sitemap`);
}

// -- lastmod must be present and a real date, not a placeholder
for (const [child, urls] of listed) {
  const xml = text(child);
  const mods = tags(xml, 'lastmod');
  if (mods.length !== urls.length) {
    fail(`${child}: ${urls.length} URL(s) but ${mods.length} lastmod(s)`);
  }
  for (const m of mods) {
    if (Number.isNaN(Date.parse(m))) fail(`${child}: "${m}" is not a valid date`);
  }
}

// -- images must be on the image host, and never the Instagram feed
let imageCount = 0;
for (const [child] of listed) {
  for (const loc of tags(text(child), 'image:loc')) {
    imageCount++;
    // Only that it is on the image host. The Instagram tiles are NOT excluded:
    // they are the client's own work photos in the client's own bucket, and
    // every image on this site is to be indexed.
    if (!loc.startsWith(IMG + '/')) fail(`${child}: image ${loc} is not on ${IMG}`);
  }
}

// -- coverage: every image the built site actually shows must be listed
//
// The point of an image sitemap here is that every image gets indexed, and an
// image the generator never saw is invisible — it is not wrong, it is absent,
// which is exactly the failure a check has to make loud. This caught three:
// the logo, the footer skyline and the favicon, none of which live in a page's
// content file.
//
// Responsive renditions are excluded from the requirement. WordPress emits
// `image-1-768x1159.jpg` beside `image-1.jpg`; they are one photograph at six
// sizes, and Google wants the canonical one listed, not all six.
const RENDITION = /-\d{2,4}x\d{2,4}(?=\.[a-z]+$)/i;
const shown = new Set();
for (const f of walk(dist)) {
  if (!/\.(html|css)$/.test(f)) continue;
  for (const m of readFileSync(f, 'utf8').matchAll(
    new RegExp(IMG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/[^"\'&)\\s<]+', 'g'))) {
    shown.add(m[0].replace(/[.,;]+$/, ''));
  }
}
const listedImages = new Set();
for (const [child] of listed) {
  for (const loc of tags(text(child), 'image:loc')) listedImages.add(loc);
}
const uncovered = [...shown].filter(
  (u) => !listedImages.has(u) && !RENDITION.test(u) && !listedImages.has(u.replace(RENDITION, '')));
for (const u of uncovered.slice(0, 10)) {
  fail(`${u.replace(IMG, '')} is shown by the site but is in no sitemap`);
}
if (uncovered.length > 10) fail(`…and ${uncovered.length - 10} more images shown but not listed`);

// -- robots.txt has to say where the sitemap is
const robotsTxt = existsSync(join(dist, 'robots.txt')) ? text('robots.txt') : '';
if (!robotsTxt.includes(`Sitemap: ${SITE}/sitemap_index.xml`)) {
  fail('robots.txt does not point at sitemap_index.xml');
}

// -- well-formedness, to the extent this can tell without a parser
for (const f of [...listed.keys(), 'sitemap_index.xml']) {
  const xml = text(f);
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) {
    fail(`${f} does not start with an XML declaration`);
  }
  const open = (xml.match(/<url>/g) || []).length;
  const close = (xml.match(/<\/url>/g) || []).length;
  if (open !== close) fail(`${f}: ${open} <url> vs ${close} </url>`);
}

const p = (l, n) => console.log(`  ${(l + ' ').padEnd(36, '.')} ${n}`);
console.log('\nSITEMAP CHECK\n');
p('routes served', served.size);
p('routes marked noindex', noindex.size);
p('sitemaps in the index', children.length);
p('urls listed', inSitemaps.size);
p('images listed', imageCount);
p('distinct images listed', listedImages.size);
p('shown but not listed', uncovered.length);
p('problems', problems.length);

if (problems.length) {
  console.log('\nPROBLEMS:');
  for (const m of problems) console.log('  ' + m);
  console.log(`\nSITEMAP CHECK FAILED — ${problems.length}.`);
  process.exit(1);
}
console.log('\nSITEMAP CHECK PASSED.\n');
