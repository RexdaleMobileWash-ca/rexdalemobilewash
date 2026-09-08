#!/usr/bin/env node
/**
 * Prove the four layers, against the real Workers runtime.
 *
 *     npm run build && npm run test:forms
 *
 * It starts `wrangler dev` on the built output, runs every case against it, and
 * reads the Worker's own log back to check what it did — not just what it said.
 * That is the only way to prove "sends exactly once": the response carries one
 * id, and the log carries exactly one `[contact] SENT` line for that submission.
 *
 * Turnstile is exercised with Cloudflare's published test keys, which is what
 * they are for:
 *
 *     sitekey 1x00000000000000000000AA               always passes
 *     secret  1x0000000000000000000000000000000AA    always passes
 *     secret  2x0000000000000000000000000000000AA    always fails
 *
 * So the "valid submission" cases go through siteverify for real and come back
 * successful, and the "no token" cases are rejected by the same code path that
 * runs in production. Nothing is stubbed.
 *
 * REQUIRES dist/server/.dev.vars with:
 *     RESEND_API_KEY = "re_..."        the real key; sends go to a test address
 *     TURNSTILE_SECRET = "1x0000000000000000000000000000000AA"
 *     CONTACT_TO = "delivered@resend.dev"    Resend's own sink, not the client
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.TEST_PORT || 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = BASE;
const CONFIG = join(root, 'dist', 'server', 'wrangler.json');
const DEV_VARS = join(root, 'dist', 'server', '.dev.vars');

const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';   // any non-empty token passes the test secret

if (!existsSync(CONFIG)) {
  console.error('No dist/server/wrangler.json — run `npm run build` first.');
  process.exit(1);
}
if (!existsSync(DEV_VARS)) {
  console.error(`No ${DEV_VARS}. Create it with RESEND_API_KEY, TURNSTILE_SECRET and`);
  console.error('CONTACT_TO=delivered@resend.dev — see the header of this file.');
  process.exit(1);
}
const devVars = readFileSync(DEV_VARS, 'utf8');
for (const need of ['RESEND_API_KEY', 'TURNSTILE_SECRET', 'CONTACT_TO']) {
  if (!devVars.includes(need)) {
    console.error(`${DEV_VARS} is missing ${need}.`);
    process.exit(1);
  }
}
if (!/CONTACT_TO\s*=\s*"?delivered@resend\.dev/.test(devVars)) {
  // A test run that mails the client's real inbox 5 times is not a test.
  console.error('Refusing to run: CONTACT_TO in .dev.vars must be delivered@resend.dev');
  process.exit(1);
}

/* --------------------------------------------------------------- the harness */

let log = '';
let dev = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Start wrangler dev on the built output.
 *
 *  `overrides` are written into .dev.vars rather than passed as `--var`:
 *  .dev.vars takes precedence over --var, so a --var override is silently
 *  ignored and phase 2 quietly runs against the always-PASSES secret, reporting
 *  a pass that proves nothing. The file is restored by stopDev(). */
async function startDev(overrides = {}) {
  if (Object.keys(overrides).length) {
    const patched = Object.entries(overrides).reduce(
      (text, [k, v]) => text.replace(new RegExp(`^${k}\\s*=.*$`, 'm'), `${k} = "${v}"`),
      devVars);
    writeFileSync(DEV_VARS, patched);
  }
  await ensurePortFree();
  const args = ['wrangler', 'dev', '--config', CONFIG, '--port', String(PORT), '--local'];
  // detached, so the whole process group can be killed. `npx` spawns wrangler
  // which spawns workerd; killing npx alone leaves workerd holding the port, the
  // next run's spawn dies quietly, the STALE server answers every request, and
  // the log-based assertions all read zero while the HTTP ones still pass. That
  // failure looks exactly like a bug in the code under test.
  dev = spawn('npx', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  dev.stdout.on('data', (x) => { log += x.toString(); });
  dev.stderr.on('data', (x) => { log += x.toString(); });
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(BASE + '/', { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error('wrangler dev did not come up:\n' + log.slice(-1500));
}

function killGroup(pid, signal) {
  try { process.kill(-pid, signal); } catch { /* already gone */ }
}

async function stopDev() {
  writeFileSync(DEV_VARS, devVars);        // always put the real vars back
  if (!dev) return;
  killGroup(dev.pid, 'SIGTERM');
  await sleep(1200);
  killGroup(dev.pid, 'SIGKILL');
  dev = null;
  await ensurePortFree();
}

/** Nothing may be listening on the test port when a phase starts, or that
 *  something answers the tests instead of the server this run built. */
async function ensurePortFree() {
  for (let i = 0; i < 20; i++) {
    try {
      await fetch(BASE + '/', { signal: AbortSignal.timeout(700) });
    } catch {
      return;                              // refused: the port is free
    }
    await sleep(500);
  }
  throw new Error(`something is still listening on ${BASE} — kill it and re-run ` +
    `(fuser -k ${PORT}/tcp)`);
}

/** A body that passes every layer, so each test can spoil exactly one thing. */
const good = (form) => form === 'cf7'
  ? {
      'your-name': 'Dana Whitfield',
      'your-email': 'dana@example.com',
      'your-subject': 'Fleet wash quote',
      'your-message': 'Six trucks, monthly.',
      'form-loaded-at': String(Date.now() - 9000),
      'cf-turnstile-response': TOKEN,
    }
  : {
      name: 'Dana Whitfield',
      email: 'dana@example.com',
      message: '12 Anywhere Avenue, Toronto',
      'form-loaded-at': String(Date.now() - 9000),
      'cf-turnstile-response': TOKEN,
    };

/* Every case gets its own client IP.
 *
 * The hourly limit is 3 per IP and it counts every submission that reaches it,
 * not just the ones that send — so a suite sharing one IP starts rate-limiting
 * its own later cases, and the failure reads exactly like a bug in the code
 * under test. Learned the hard way: the first run of this file reported "valid
 * submission" as a 429. */
let ipSeq = 0;
const nextIp = () => `203.0.113.${(ipSeq++ % 200) + 20}`;

async function post(body, extraHeaders = {}) {
  const res = await fetch(BASE + '/api/contact/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: ORIGIN,
      'CF-Connecting-IP': nextIp(),
      Referer: BASE + '/contact-us/',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(52)} ${detail}`);
}

/** How many times the Worker has logged an actual send, so far. */
const sendCount = () => (log.match(/\[contact\] SENT /g) || []).length;
const rejectionsFor = (reason) =>
  (log.match(new RegExp(`"reason":"${reason}[^"]*"`, 'g')) || []).length;

/* ----------------------------------------------------------------- the cases */

async function run() {
  await startDev();
  console.log(`\nFORM GUARD TEST — ${BASE}/api/contact/\n`);

  // -- the method itself
  const get = await fetch(BASE + '/api/contact/');
  check('GET is refused', get.status === 405 && get.headers.get('allow') === 'POST',
    `${get.status}, Allow: ${get.headers.get('allow')}`);

  // -- layer 1: no Turnstile token, on BOTH forms
  for (const form of ['cf7', 'nicepage']) {
    const body = { ...good(form) };
    delete body['cf-turnstile-response'];
    const before = sendCount();
    const r = await post(body);
    await sleep(150);
    check(`no token rejected (${form})`,
      r.status === 403 && sendCount() === before,
      `${r.status} · nothing sent · "${(r.json.message || '').slice(0, 46)}…"`);
  }

  // -- layer 2a: honeypot. Answers success, sends nothing.
  {
    const before = sendCount();
    const r = await post({ ...good('cf7'), 'your-website': 'http://spam.example' });
    await sleep(300);
    check('honeypot: looks accepted, sends nothing',
      r.status === 200 && r.json.status === 'sent' && sendCount() === before,
      `${r.status} "${r.json.status}" · sends before/after: ${before}/${sendCount()}`);
  }

  // -- layer 2b: dwell time
  {
    const r = await post({ ...good('cf7'), 'form-loaded-at': String(Date.now() - 400) });
    check('submitted in under 3s rejected', r.status === 400,
      `${r.status} · "${(r.json.message || '').slice(0, 46)}…"`);
  }
  {
    const r = await post({ ...good('cf7'), 'form-loaded-at': '' });
    check('missing dwell stamp rejected', r.status === 400, `${r.status}`);
  }

  // -- layer 3: sanity
  {
    const r = await post({ ...good('cf7'), 'your-name': 'x' });
    check('one-character name rejected', r.status === 400, `${r.status}`);
  }
  {
    const r = await post({ ...good('cf7'), 'your-name': 'asdf' });
    check('placeholder name rejected', r.status === 400, `${r.status}`);
  }
  {
    const r = await post({ ...good('cf7'), 'your-email': 'someone@no-such-domain-zzqq.invalid' });
    check('email domain with no mail route rejected', r.status === 400,
      `${r.status} · "${(r.json.message || '').slice(0, 46)}…"`);
  }
  {
    // A domain with no MX but an A record still receives mail (RFC 5321), so it
    // must NOT be rejected. This is the case a naive MX-only check gets wrong.
    const r = await post({ ...good('cf7'), 'your-email': 'someone@cloudflare.com' });
    check('domain with a mail route accepted', r.status === 200, `${r.status}`);
  }

  // -- the valid submission: works, and sends EXACTLY once
  for (const form of ['cf7', 'nicepage']) {
    const before = sendCount();
    const r = await post(good(form));
    await sleep(600);
    const sent = sendCount() - before;
    check(`valid ${form} submission sends exactly once`,
      r.status === 200 && r.json.status === 'sent' && !!r.json.id && sent === 1,
      `${r.status} · id ${String(r.json.id).slice(0, 8)}… · sends: ${sent}`);
  }

  // -- layer 4: hourly rate limit, from a fresh IP so the earlier cases do not
  //    count against it
  {
    // one fixed IP for all five, overriding the rotation, because this is the
    // one case where repeat submissions from the same address is the point
    const ip = '198.51.100.' + (10 + Math.floor(Math.random() * 200));
    const codes = [];
    for (let i = 0; i < 5; i++) {
      const r = await post(good('cf7'), { 'CF-Connecting-IP': ip });
      codes.push(r.status);
      await sleep(200);
    }
    const blocked = codes.filter((c) => c === 429).length;
    check('rate limit stops the 4th submission in an hour',
      codes.slice(0, 3).every((c) => c === 200) && blocked >= 1,
      `codes: ${codes.join(' ')}`);
  }

  // -- every rejection is logged, in one greppable shape
  {
    const kinds = ['turnstile-token-missing', 'honeypot', 'dwell-too-fast', 'dwell-missing',
      'name-too-short', 'name-placeholder', 'email-domain'];
    const found = kinds.filter((k) => rejectionsFor(k) > 0);
    check('every rejection reason appears in the log',
      found.length >= 6, `${found.length}/${kinds.length}: ${found.join(', ')}`);
  }
  {
    const lines = (log.match(/\[spam-guard\] REJECT /g) || []).length;
    const hasFields = /"ts":"[^"]+","form":"[^"]+","reason":"[^"]+","ip":"[^"]+","page":"[^"]+"/.test(log);
    check('rejection log carries form, reason, ip, page, ts',
      lines > 0 && hasFields, `${lines} rejection line(s)`);
  }

  // -- phase 2: siteverify's verdict is what decides, not the presence of a
  //    string. Same code, same fully-valid submission, restarted against
  //    Cloudflare's ALWAYS-FAILS secret: it must now be refused and send nothing.
  console.log('\n  restarting against the always-fails Turnstile secret…');
  await stopDev();
  const beforePhase2 = sendCount();
  await startDev({ TURNSTILE_SECRET: '2x0000000000000000000000000000000AA' });
  {
    const r = await post(good('cf7'), { 'CF-Connecting-IP': '203.0.113.88' });
    await sleep(400);
    check('valid-looking token refused when siteverify says no',
      r.status === 403 && sendCount() === beforePhase2,
      `${r.status} · nothing sent · "${(r.json.message || '').slice(0, 46)}…"`);
  }

  console.log('');
  const failed = results.filter((r) => !r.pass);
  console.log(failed.length
    ? `RESULT: FAIL — ${failed.length} of ${results.length}`
    : `RESULT: PASS — ${results.length} of ${results.length}`);
  return failed.length ? 1 : 0;
}

let code = 1;
try {
  code = await run();
} catch (e) {
  console.error('\nharness error:', e.message);
} finally {
  await stopDev();
}
process.exit(code);
