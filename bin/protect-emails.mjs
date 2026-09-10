#!/usr/bin/env node
// Email-address obfuscation, restored.
//
// The live WordPress site never published a readable email address. It sits
// behind Cloudflare's Scrape Shield, whose Email Address Obfuscation rewrites
// every address in the HTML on its way out — the source shows
// `[email protected]` and a `/cdn-cgi/l/email-protection#<hex>` href, and a
// Cloudflare script swaps the real address back in for the reader. Fetch any
// live page and grep it: three obfuscated addresses per page, zero plaintext.
//
// That rewriter runs over a response coming FROM an origin. This site has no
// origin — the Worker is the origin, and its response is returned to the reader
// without passing through Scrape Shield. So the port shipped, on every page,
// the two addresses the client has had protected for years:
//
//     dist/client   45x mailto: hrefs, 15x visible link text   (78 total incl. JSON-LD)
//     live site     0
//
// That is the only real regression the old-vs-new page comparison turned up,
// and it is the kind that does not look broken: the pages render identically
// and the damage arrives later, as spam, in somebody else's inbox.
//
// This restores the protection at the same layer Cloudflare did it — over the
// built HTML, after Astro has written it — because the markup it has to reach
// is not hand-maintained. src/html/*.content.html and src/html/_footer.html are
// regenerated wholesale by tools/build_site.py, so an edit there is lost the
// next time the port is re-run (the same reason src/seo.config.ts exists).
//
// The technique is HTML numeric character references: `dispatch@…` is written
// out as `&#100;&#105;&#115;…`. The HTML parser decodes those before anything
// else sees them, so unlike Cloudflare's version this needs no JavaScript —
// the mailto: link works, the text is selectable and copyable, screen readers
// read the address, and a crawler parsing HTML reads it too. What does NOT read
// it is an address harvester running a regex over the raw bytes, which is what
// nearly all of them are.
//
// Deliberately NOT touched: the contents of <script> and <style>. Character
// references are not decoded there, so encoding the Organization node's `email`
// would turn the JSON-LD graph into a syntax error. That address is
// machine-readable structured data by intent — see src/seo.config.ts — and is
// left exactly as written.
//
// Runs inside `npm run build`, before the three check-* scripts, so the output
// they read is the output that ships.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist', 'client');

/** Blocks whose text the HTML parser does not decode entities in. */
const RAW_TEXT = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

// `2020@2x.png` and friends satisfy the pattern above and are not addresses.
const ASSET = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|css|js|mjs|json|xml|txt|html?)$/i;

const encode = (s) => Array.from(s, (c) => `&#${c.codePointAt(0)};`).join('');

const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : (n.endsWith('.html') ? [p] : []);
});

/** Replace addresses in `s`, leaving anything that is really a filename alone. */
function protect(s, tally) {
  return s.replace(EMAIL, (addr) => {
    if (ASSET.test(addr)) return addr;
    tally.set(addr, (tally.get(addr) || 0) + 1);
    return encode(addr);
  });
}

/** Walk `html`, protecting everything outside a raw-text block. */
function rewrite(html, tally) {
  let out = '', last = 0;
  for (const m of html.matchAll(RAW_TEXT)) {
    out += protect(html.slice(last, m.index), tally);
    out += m[0];
    last = m.index + m[0].length;
  }
  return out + protect(html.slice(last), tally);
}

/** Plaintext addresses still readable outside a raw-text block. */
function leaks(html) {
  const found = [];
  let last = 0;
  const scan = (s) => {
    for (const m of s.matchAll(EMAIL)) if (!ASSET.test(m[0])) found.push(m[0]);
  };
  for (const m of html.matchAll(RAW_TEXT)) { scan(html.slice(last, m.index)); last = m.index + m[0].length; }
  scan(html.slice(last));
  return found;
}

const tally = new Map();
const fails = [];
let files = 0, changed = 0;

for (const file of walk(dist)) {
  files++;
  const before = readFileSync(file, 'utf8');
  const after = rewrite(before, tally);
  if (after !== before) { writeFileSync(file, after); changed++; }
  const left = leaks(after);
  if (left.length) fails.push([file.slice(dist.length + 1), [...new Set(left)]]);
}

const total = [...tally.values()].reduce((a, b) => a + b, 0);

console.log('\nEMAIL OBFUSCATION\n');
console.log(`  pages scanned ...................... ${files}`);
console.log(`  pages rewritten .................... ${changed}`);
console.log(`  addresses obfuscated ............... ${total}`);
if (tally.size) {
  console.log('\n  by address');
  for (const [addr, n] of [...tally].sort((a, b) => b[1] - a[1]))
    console.log(`    ${addr.padEnd(38)} ${n}`);
}

if (fails.length) {
  console.log('\nSTILL READABLE IN THE SHIPPED HTML:');
  for (const [f, addrs] of fails) console.log(`  ${f}\n    ${addrs.join(', ')}`);
  console.log(`\nEMAIL OBFUSCATION FAILED — ${fails.length} page(s).`);
  process.exit(1);
}
console.log('\nEMAIL OBFUSCATION PASSED.\n');
