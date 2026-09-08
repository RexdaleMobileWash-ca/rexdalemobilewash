#!/usr/bin/env node
// Bot-protection enforcement. Exits 1 if any page ships a form without all of it.
//
// This exists for the same reason bin/check-images.mjs does: the rule was
// written down once, and the next form added to this site will be added by
// somebody who has not read it. A form that reaches production without a
// Turnstile widget does not look broken — it looks fine, and is rejected by its
// own server on every submission, which reads as "the contact form is down".
//
// It runs inside `npm run build`, joined with &&, so it runs in Workers Builds
// on every deploy and a violation fails the deploy rather than reaching anyone.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist', 'client');

const ENDPOINT = '/api/contact/';

/** Every page with a <form> must carry all of these. */
const REQUIRED = [
  ['turnstile mount', (page) => page.includes('class="cf-turnstile-mount"')],
  ['turnstile sitekey', (page) => /<meta name="turnstile-sitekey" content="[^"]+"/.test(page)],
  ['guard script', (page) => page.includes('/js/form-guard.js')],
  ['honeypot', (page) => page.includes('name="your-website"')],
  ['dwell stamp', (page) => page.includes('name="form-loaded-at"')],
];

const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : (n.endsWith('.html') ? [p] : []);
});

const pages = [];
for (const file of walk(dist)) {
  const html = readFileSync(file, 'utf8');
  const forms = html.match(/<form\b[^>]*>/g) || [];
  if (!forms.length) continue;
  const rel = '/' + file.slice(dist.length + 1).replace(/index\.html$/, '');

  const missing = REQUIRED.filter(([, has]) => !has(html)).map(([name]) => name);
  // Every form on the page must post to the endpoint — a form left pointing at
  // the page (CF7's original action) or at "#" (Nicepage's) is a form that
  // silently goes nowhere, which is how both of them shipped broken before.
  const stray = forms.filter((f) => !f.includes(`action="${ENDPOINT}"`));

  // One mount per form: two forms sharing one widget would put a single token in
  // whichever form Turnstile attached to and leave the other with none.
  const mounts = (html.match(/class="cf-turnstile-mount"/g) || []).length;
  if (mounts !== forms.length) {
    missing.push(`${mounts} turnstile mount(s) for ${forms.length} form(s)`);
  }

  pages.push({ rel, forms: forms.length, missing, stray });
}

const bad = pages.filter((p) => p.missing.length || p.stray.length);

const p = (l, n) => console.log(`  ${(l + ' ').padEnd(36, '.')} ${n}`);
console.log('\nFORM PROTECTION CHECK\n');
p('pages with a form', pages.length);
p('forms in total', pages.reduce((n, x) => n + x.forms, 0));
p('fully protected', pages.length - bad.length);
p('incomplete', bad.length);

if (bad.length) {
  console.log('\nUNPROTECTED FORMS, BY PAGE:');
  for (const x of bad) {
    console.log(`  ${x.rel}`);
    for (const m of x.missing) console.log(`    missing: ${m}`);
    for (const f of x.stray) console.log(`    not posting to ${ENDPOINT}: ${f.slice(0, 110)}`);
  }
  console.log(`\nFORM PROTECTION CHECK FAILED — ${bad.length} page(s).`);
  console.log('If the sitekey is the missing part, set PUBLIC_TURNSTILE_SITEKEY and rebuild.');
  process.exit(1);
}
if (!pages.length) {
  // Not a pass. This site has 15 forms; finding none means the selector broke,
  // and a check that silently passes on zero input is worse than no check.
  console.log('\nFORM PROTECTION CHECK FAILED — no forms found at all in dist/client.');
  process.exit(1);
}
console.log('\nFORM PROTECTION CHECK PASSED.\n');
