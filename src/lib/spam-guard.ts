/**
 * The four layers every form submission passes before an email is sent.
 *
 * All of it runs on the Worker. Nothing here trusts a client-side result: the
 * page can say whatever it likes, and each check is re-decided from the request.
 *
 *   1. Turnstile   a token, verified against siteverify. No valid token, no send.
 *   2. Honeypot    a field a person never sees, plus a dwell-time floor.
 *   3. Sanity      the email domain must be able to receive mail; no placeholders.
 *   4. Rate limit  per IP, per form.
 *
 * Order matters and is deliberate. The cheap local checks (honeypot, dwell,
 * shape) run before anything that costs a network round trip, so a bot flood
 * spends nothing of ours; the rate limit runs before Turnstile so a flood cannot
 * run up siteverify calls either; Turnstile and the MX lookup — the two calls
 * that leave the Worker — run last, and only for a submission that is otherwise
 * plausible.
 *
 * Every rejection returns a `reason` that gets logged. Only the honeypot is
 * answered as success, and only to the bot that tripped it.
 */

export type Verdict =
  | { ok: true }
  /** reject, and show the visitor `message` */
  | { ok: false; reason: string; message: string; status: number }
  /** the honeypot: answer as though it sent, and send nothing */
  | { ok: false; reason: string; silent: true };

export const OK: Verdict = { ok: true };

const bad = (reason: string, message: string, status = 400): Verdict =>
  ({ ok: false, reason, message, status });

/* ------------------------------------------------------------------ 1. Turnstile */

export interface TurnstileResult {
  verdict: Verdict;
  /** siteverify's own timestamp for when the challenge was solved */
  challengeTs?: string;
}

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verify a Turnstile token server-side.
 *
 * Three failure modes, told apart because they mean different things to the
 * person at the keyboard:
 *
 *   no token / bad token   a bot, or a widget that never ran. Reject.
 *   secret missing         our misconfiguration. Reject — fail CLOSED, because
 *                          failing open would silently disable the whole layer
 *                          and nothing would look wrong — and log loudly.
 *   siteverify unreachable Cloudflare's problem, or the network's. Reject, but
 *                          say "try again" rather than "you look like a bot",
 *                          and log loudly. A real enquiry is the business; it
 *                          must be obvious when we are dropping them.
 */
export async function checkTurnstile(
  token: string,
  secret: string | undefined,
  ip: string,
): Promise<TurnstileResult> {
  if (!secret) {
    console.error('[spam-guard] TURNSTILE_SECRET missing at runtime — every ' +
      'submission is being rejected. Is it a Worker secret rather than a build variable?');
    return {
      verdict: bad('turnstile-secret-missing',
        'The form is not set up correctly. Please call us on (416) 244-6497.', 500),
    };
  }
  if (!token) {
    return { verdict: bad('turnstile-token-missing',
      'Your browser did not complete the security check. Please reload the page and try again.', 403) };
  }

  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);

  let data: { success?: boolean; challenge_ts?: string; 'error-codes'?: string[] };
  try {
    const res = await fetch(SITEVERIFY, {
      method: 'POST',
      body: form,
      // Bounded: siteverify sitting open would hold the request until the
      // Worker's own limit and the visitor would watch a spinner until it died.
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`siteverify responded ${res.status}`);
    data = await res.json();
  } catch (e) {
    console.error('[spam-guard] siteverify unreachable —', (e as Error).message,
      '— rejecting this submission. If this repeats, real enquiries are being lost.');
    return { verdict: bad('turnstile-unreachable',
      'We could not complete the security check just now. Please try again in a moment, ' +
      'or call us on (416) 244-6497.', 503) };
  }

  if (!data.success) {
    return { verdict: bad('turnstile-rejected:' + (data['error-codes'] || []).join(','),
      'The security check did not pass. Please reload the page and try again.', 403) };
  }
  return { verdict: OK, challengeTs: data.challenge_ts };
}

/* --------------------------------------------------- 2. honeypot and dwell time */

/** Anything at all in the hidden field is a bot. */
export function checkHoneypot(value: string): Verdict {
  if (value.trim()) return { ok: false, reason: 'honeypot', silent: true };
  return OK;
}

export const MIN_DWELL_MS = 3000;

/**
 * How long the form was on screen before it was submitted.
 *
 * The timestamp is set by the page's own JavaScript at load, so it is
 * client-supplied and a determined bot can forge it. That is the honest
 * description of this layer: it costs a scripted submitter one extra line to
 * defeat and stops every one that has not bothered. It is not load-bearing —
 * Turnstile is.
 *
 * Absent or unparseable is a rejection, not a pass. A submission with no
 * timestamp did not run the page's JavaScript, and a submission that did not run
 * the page's JavaScript has no Turnstile token either.
 */
export function checkDwell(raw: string, now = Date.now()): Verdict {
  const started = Number(raw);
  if (!raw || !Number.isFinite(started)) {
    return bad('dwell-missing',
      'Your browser did not finish loading the form. Please reload the page and try again.', 400);
  }
  const elapsed = now - started;
  // A clock skewed into the future would otherwise read as a huge dwell and pass.
  if (elapsed < 0) return bad('dwell-future', 'Please reload the page and try again.', 400);
  if (elapsed < MIN_DWELL_MS) {
    return bad(`dwell-too-fast:${elapsed}ms`,
      'That was submitted faster than a form can be filled in. Please try again.', 400);
  }
  return OK;
}

/* -------------------------------------------------------- 3. sanity validation */

/** Values that are technically a name and are never anyone's name. */
const PLACEHOLDERS = new Set([
  'x', 'xx', 'xxx', 'xxxx', 'test', 'testing', 'test test', 'asdf', 'asdfasdf',
  'qwerty', 'aaa', 'aaaa', 'abc', 'abcd', 'none', 'na', 'n/a', 'null', 'undefined',
  'name', 'your name', 'firstname', 'lastname', 'john doe', 'jane doe', 'sdf', 'fff',
]);

export function isPlaceholder(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (PLACEHOLDERS.has(v)) return true;
  // one character repeated: "aaaaaa", "......"
  return v.length >= 3 && /^(.)\1+$/.test(v);
}

/** A name has to be at least two characters and not a placeholder. */
export function checkName(value: string): Verdict {
  const v = value.trim();
  if (v.length < 2) return bad('name-too-short', 'Please enter your name.', 400);
  if (isPlaceholder(v)) return bad('name-placeholder', 'Please enter your name.', 400);
  return OK;
}

/** Digits only, so "(416) 244-6497" counts as 10 and "+1 416" as 4. */
export function digitCount(value: string): number {
  return (value.match(/[0-9]/g) || []).length;
}

/**
 * Neither form on this site has a phone field, so nothing calls this today. It
 * is here because the next form will have one, and because the rule — under
 * seven digits is not a phone number — is the sort of thing that gets
 * reinvented differently every time.
 */
export function checkPhone(value: string): Verdict {
  if (digitCount(value) < 7) {
    return bad('phone-too-short', 'Please enter a phone number we can reach you on.', 400);
  }
  return OK;
}

/**
 * Can the email domain actually receive mail?
 *
 * DNS over HTTPS, because a Worker has no resolver. **MX is not the whole
 * test**: RFC 5321 says a domain with no MX but an A or AAAA record still
 * receives mail there, so checking MX alone rejects real, deliverable addresses
 * — which is a worse failure than accepting a junk one.
 *
 * A lookup that errors or times out returns `ok`. Rejecting real enquiries
 * because Cloudflare's resolver had a bad minute is not a trade worth making;
 * the miss is logged instead.
 */
export async function checkEmailDomain(email: string): Promise<Verdict> {
  const domain = email.split('@')[1];
  if (!domain || !domain.includes('.')) {
    return bad('email-domain-malformed', 'That email address looks wrong. Please check it.', 400);
  }
  const ask = async (type: 'MX' | 'A' | 'AAAA') => {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`,
      { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) throw new Error(`dns-query responded ${res.status}`);
    const data = (await res.json()) as { Status?: number; Answer?: { type: number }[] };
    return { status: data.Status, answers: data.Answer || [] };
  };

  try {
    const mx = await ask('MX');
    // NXDOMAIN (3): the domain does not exist at all. Nothing can be delivered.
    if (mx.status === 3) {
      return bad('email-domain-nxdomain', 'That email address looks wrong. Please check it.', 400);
    }
    if (mx.answers.length) return OK;
    const a = await ask('A');
    if (a.answers.length) return OK;
    const aaaa = await ask('AAAA');
    if (aaaa.answers.length) return OK;
    return bad('email-domain-no-mail-route',
      'We could not find a mail server for that email address. Please check it.', 400);
  } catch (e) {
    console.error('[spam-guard] MX lookup failed for', domain, '—', (e as Error).message,
      '— allowing the submission through rather than dropping a real enquiry.');
    return OK;
  }
}

/* ------------------------------------------------------------- 4. rate limiting */

export interface RateLimitStores {
  /** the Workers rate-limiting binding: the short burst brake */
  burst?: { limit(o: { key: string }): Promise<{ success: boolean }> };
  /** a KV namespace: the hourly budget the binding cannot express */
  hourly?: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  };
}

export const HOURLY_LIMIT = 3;
const HOUR_SECONDS = 3600;

/**
 * Two windows, because one binding cannot do both.
 *
 * The Workers rate-limiting binding only accepts a period of 10 or 60 seconds,
 * so "3 per hour" is not expressible with it. It stays as the burst brake and KV
 * carries the hourly budget, keyed per form so a visitor who uses the contact
 * form has not spent the residential form's allowance.
 *
 * Know what the binding is: Cloudflare documents it as counted PER DATA CENTRE
 * and "intentionally designed to not be used as an accurate accounting system".
 * A caller spread across colos gets a multiple of it. KV is account-global, so
 * the hourly number is the one that actually holds — at the cost of being
 * eventually consistent, which can let a burst of simultaneous requests through
 * before the counter catches up.
 *
 * If KV is not bound, the hourly limit cannot be enforced. That degrades to the
 * burst limit alone and says so in the log every time, rather than quietly
 * behaving as though the limit were there.
 */
export async function checkRateLimit(
  stores: RateLimitStores,
  formId: string,
  ip: string,
): Promise<Verdict> {
  if (!ip) return OK;          // no client IP: only reachable off Cloudflare

  if (stores.burst) {
    try {
      const { success } = await stores.burst.limit({ key: `${formId}:${ip}` });
      if (!success) {
        return bad('rate-limit-burst',
          'Too many submissions from this connection. Please wait a minute and try again.', 429);
      }
    } catch (e) {
      console.error('[spam-guard] burst limiter unavailable —', (e as Error).message);
    }
  }

  if (!stores.hourly) {
    console.error('[spam-guard] no KV binding for the hourly rate limit — running on the ' +
      'burst limiter alone. Create the namespace and bind it as FORM_RATE_LIMIT.');
    return OK;
  }

  // A fixed hour bucket rather than a sliding window: one read and at most one
  // write per submission, where a sliding window needs a stored list per IP.
  const bucket = Math.floor(Date.now() / (HOUR_SECONDS * 1000));
  const key = `rl:${formId}:${ip}:${bucket}`;
  try {
    const count = Number((await stores.hourly.get(key)) || '0');
    if (count >= HOURLY_LIMIT) {
      return bad('rate-limit-hourly',
        'You have sent several messages recently. Please give us a little time to reply, ' +
        'or call us on (416) 244-6497.', 429);
    }
    // TTL is two buckets' worth so a key written at :59 still expires cleanly.
    await stores.hourly.put(key, String(count + 1), { expirationTtl: HOUR_SECONDS * 2 });
  } catch (e) {
    console.error('[spam-guard] hourly rate-limit store failed —', (e as Error).message,
      '— allowing the submission through.');
  }
  return OK;
}

/* --------------------------------------------------------------------- logging */

export interface RejectionLog {
  form: string;
  reason: string;
  ip: string;
  page: string;
  country?: string;
}

/** One line per rejection, one shape, so `wrangler tail` can be grepped. */
export function logRejection(r: RejectionLog): void {
  console.warn('[spam-guard] REJECT ' + JSON.stringify({
    ts: new Date().toISOString(),
    form: r.form,
    reason: r.reason,
    ip: r.ip || '(none)',
    page: r.page,
    country: r.country || '(unknown)',
  }));
}
