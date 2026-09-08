import type { APIRoute } from 'astro';
// The Worker's bindings and secrets. NOT `Astro.locals.runtime.env`, which is what
// the gate 11 procedure and every pre-Astro-7 example still say: Astro 7 removed it
// and the getter throws, so the route answers 500 on a build that passed and a form
// that looked wired. NOT `import.meta.env` either — that inlines what the BUILD saw,
// which for a Worker secret is nothing.
import { env } from 'cloudflare:workers';
import { setting, REPLY_TO_SENDER, MESSAGES } from '../../contact.config';
import {
  checkTurnstile, checkHoneypot, checkDwell, checkName, checkEmailDomain,
  checkRateLimit, logRejection, type Verdict, type RateLimitStores,
} from '../../lib/spam-guard';

// The one route on this site that is NOT prerendered, and the reason the
// Cloudflare adapter is here at all. A prerendered API route is written to a
// static file: it answers GET with that file's bytes and silently accepts
// nothing. `false`, not "omitted" — the project sets no global default.
export const prerender = false;

/* ------------------------------------------------------------------ the forms
 *
 * There are two, with different field names, and both were dead in the port.
 *
 *   cf7       Contact Form 7, on 14 pages. Name / Email / Subject / Message.
 *   nicepage  Nicepage's own `u-inner-form`, on /residential/ only. Name /
 *             Email / Address — its `message` field is labelled Address, and
 *             the notification says Address so the client reads what the
 *             visitor was actually asked.
 *
 * One endpoint serves both. Which one submitted is decided by the fields that
 * arrive, not by a hidden marker: a marker is one more thing a copy-paste of the
 * markup can drop, and the field names already identify the form.
 */
interface FormSpec {
  id: string;
  /** email-body label -> field name, in the order the notification shows them */
  fields: [label: string, field: string][];
  required: string[];
  nameField: string;
  emailField: string;
  /** field whose value becomes the subject line, or a fixed subject */
  subjectField?: string;
  subject?: string;
}

const CF7: FormSpec = {
  id: 'cf7',
  fields: [['Name', 'your-name'], ['Email', 'your-email'],
           ['Subject', 'your-subject'], ['Message', 'your-message']],
  // CF7's markup carries aria-required="true" on exactly these three and marks
  // the message "(optional)", so this is the live form's own rule.
  required: ['your-name', 'your-email', 'your-subject'],
  nameField: 'your-name',
  emailField: 'your-email',
  subjectField: 'your-subject',
};

const NICEPAGE: FormSpec = {
  id: 'nicepage',
  fields: [['Name', 'name'], ['Email', 'email'], ['Address', 'message']],
  required: ['name', 'email', 'message'],   // all three carry `required` in the markup
  nameField: 'name',
  emailField: 'email',
  subject: 'Residential enquiry',
};

const LIMITS: Record<string, number> = {
  'your-name': 200, 'your-email': 320, 'your-subject': 300, 'your-message': 10000,
  name: 200, email: 320, message: 10000,
};
const DEFAULT_LIMIT = 2000;

// Deliberately permissive on shape — address syntax is far wider than any regex
// people write for it. Whether the domain can actually receive mail is a
// separate, stronger check in spam-guard.ts.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Parsed {
  spec: FormSpec;
  values: Record<string, string>;
  honeypot: string;
  /** ms since epoch, written by the page's JS at load — the dwell-time floor */
  loadedAt: string;
  /** the Turnstile token, from the widget's own hidden input */
  token: string;
  /** CF7's per-page form id, e.g. wpcf7-f372-p195-o1 — the fragment the live
   *  site's own form action pointed at, so the no-JS redirect lands on the form */
  unitTag: string;
  /** true only for a real browser form submission. Both enhancement scripts post
   *  the same bodies but ask for JSON, so this is decided by what the caller
   *  accepts, not by the content type. */
  formPost: boolean;
}

async function parse(request: Request): Promise<Parsed | null> {
  const type = (request.headers.get('content-type') || '').split(';')[0].trim();
  const accept = request.headers.get('accept') || '';
  const wantsJson = accept.includes('application/json') ||
    request.headers.get('x-requested-with') === 'XMLHttpRequest';

  let get: (k: string) => string;
  let formPost = false;

  if (type === 'application/json') {
    const parsedBody = await request.json().catch(() => null);
    if (!parsedBody || typeof parsedBody !== 'object') return null;
    get = (k) => String((parsedBody as Record<string, unknown>)[k] ?? '');
  } else if (type === 'application/x-www-form-urlencoded' || type === 'multipart/form-data') {
    // nicepage.js sends a FormData over jQuery with dataType:'json' — multipart,
    // exactly like a browser with JavaScript off, but it wants JSON back and a
    // 303 would break it. `wantsJson` is what tells them apart.
    const form = await request.formData().catch(() => null);
    if (!form) return null;
    formPost = !wantsJson;
    get = (k) => String(form.get(k) ?? '');
  } else {
    return null;
  }

  const spec = get('your-email') || get('your-name') ? CF7
    : get('email') || get('name') ? NICEPAGE
    : null;
  if (!spec) return null;

  const values: Record<string, string> = {};
  for (const [, field] of spec.fields) {
    values[field] = get(field).trim().slice(0, LIMITS[field] ?? DEFAULT_LIMIT);
  }
  return {
    spec,
    values,
    honeypot: get('your-website'),
    loadedAt: get('form-loaded-at').trim(),
    token: get('cf-turnstile-response').trim(),
    unitTag: get('_wpcf7_unit_tag').trim(),
    formPost,
  };
}

/** Shape checks that need no network. Returns the offending fields so the page
 *  can mark them, the way CF7 does. */
function validateShape(spec: FormSpec, v: Record<string, string>): string[] {
  const bad = spec.required.filter((f) => !v[f]);
  const email = v[spec.emailField];
  if (email && !EMAIL.test(email)) bad.push(spec.emailField);
  return [...new Set(bad)];
}

/** Header injection: a newline in a header value starts a new header. Resend
 *  takes JSON over HTTPS rather than pasting these into an SMTP envelope, so it
 *  is not exploitable here — but subject and name are visitor-controlled and one
 *  refactor away from somewhere it would be. */
const header = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;');

interface Meta {
  ip: string;
  page: string;
  country?: string;
  city?: string;
  region?: string;
}

/** Where the submission came from, in one line, for the notification footer.
 *  Without this a suspicious enquiry cannot be traced without digging through
 *  Worker logs that have already rolled off. */
function origin(meta: Meta): string {
  const place = [meta.city, meta.region, meta.country].filter(Boolean).join(', ');
  return `${meta.page} · ${meta.ip || 'IP unknown'}${place ? ` · ${place}` : ''}`;
}

function body(spec: FormSpec, v: Record<string, string>, meta: Meta) {
  const rows = spec.fields.map(([label, field]) =>
    [label, v[field] || '(none)'] as [string, string]);
  const from = v[spec.emailField];
  const name = v[spec.nameField] || from;

  const text = rows.map(([k, val]) => `${k}: ${val}`).join('\n\n') +
    `\n\n---\nReply to this email to answer ${name} at ${from}\n` +
    `Sent from the contact form on ${origin(meta)}\n`;

  const subject = spec.subjectField ? v[spec.subjectField] : spec.subject || 'your enquiry';

  // No "reply to the sender" button: Reply-To is the sender, so the mail
  // client's own Reply already does it, and a second way to do the same thing is
  // one the client has to think about.
  //
  // The address is HTML-escaped into the mailto, not encodeURIComponent'd. That
  // looks like the safer call and is the wrong one: it percent-encodes the `@`,
  // so the first live notification carried `mailto:name%40example.com`. Legal per
  // RFC 6068 and handled by most clients, but it reads as broken wherever a
  // client shows the raw href. validateShape() has already required one `@` and
  // no whitespace, so escaping is the whole of what is needed.
  const html =
    `<div style="font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#222">` +
    `<p style="margin:0 0 18px;padding:10px 14px;background:#eef4ff;border-radius:4px">` +
    `<strong>Reply to this email</strong> to answer ${esc(name)} at ` +
    `<a href="mailto:${esc(from)}">${esc(from)}</a>.</p>` +
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse">` +
    rows.map(([k, val]) =>
      `<tr><td style="padding:4px 16px 4px 0;vertical-align:top;color:#666;` +
      `white-space:nowrap">${esc(k)}</td>` +
      `<td style="padding:4px 0;white-space:pre-wrap">${esc(val)}</td></tr>`).join('') +
    `</table>` +
    `<p style="margin:18px 0 0;color:#888;font-size:13px">Sent from the contact form on ` +
    `${esc(origin(meta))}</p></div>`;

  return { text, html, subject };
}

/** No-JS submissions get a redirect back to the page they came from, carrying
 *  the outcome. 303 and not 302: it makes the follow-up a GET explicitly, so a
 *  refresh cannot re-post the form. */
function back(page: string, status: string, unitTag: string) {
  // Both are visitor-supplied — the referer header and a form field — so both are
  // constrained before they reach a Location header. A path not starting with a
  // single / could be `//evil.example`, a protocol-relative URL that redirects
  // off-site; the unit tag is held to CF7's own shape.
  const url = /^\/[^/]/.test(page) ? page : '/contact-us/';
  const frag = /^wpcf7-[a-z0-9-]{1,60}$/i.test(unitTag) ? `#${unitTag}` : '';
  return new Response(null, {
    status: 303,
    headers: { Location: `${url}?form=${status}${frag}`, 'Cache-Control': 'no-store' },
  });
}

/** `success`/`ok` are for nicepage.js, which treats `data.success || data.ok` as
 *  the whole verdict; `status`/`message`/`invalid` are for
 *  public/js/form-guard.js. One shape both readers understand. */
function json(
  status: 'sent' | 'invalid' | 'failed',
  http: number,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return new Response(JSON.stringify({
    status,
    success: status === 'sent',
    ok: status === 'sent',
    message,
    ...(status === 'sent' ? {} : { error: message }),
    ...extra,
  }), {
    status: http,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const parsed = await parse(request);
  if (!parsed) return json('failed', 415, MESSAGES.failed);
  const { spec, values, honeypot, loadedAt, token, unitTag, formPost } = parsed;

  const cf = (request as Request & { cf?: Record<string, string> }).cf;
  const ip = request.headers.get('cf-connecting-ip') || '';
  const meta: Meta = {
    ip,
    page: '/contact-us/',
    country: cf?.country || request.headers.get('cf-ipcountry') || undefined,
    city: cf?.city,
    region: cf?.region,
  };
  const referer = request.headers.get('referer') || '';
  try { if (referer) meta.page = new URL(referer).pathname; } catch { /* keep the default */ }

  /** Every rejection goes through here, so every one is logged in the same shape
   *  and no branch can quietly forget to. */
  const reject = (v: Extract<Verdict, { ok: false }>) => {
    logRejection({ form: spec.id, reason: v.reason, ip, page: meta.page, country: meta.country });
    if ('silent' in v) {
      // The honeypot, and only the honeypot: answer exactly as a real send would,
      // so the bot has no signal to tune against. Nothing is sent.
      return formPost ? back(meta.page, 'sent', unitTag) : json('sent', 200, MESSAGES.sent);
    }
    return formPost
      ? back(meta.page, 'failed', unitTag)
      : json('failed', v.status, v.message);
  };

  // --- layer 2a: honeypot. First, because it is free and the commonest hit.
  const hp = checkHoneypot(honeypot);
  if (!hp.ok) return reject(hp);

  // --- shape. Before the network calls, and the only rejection that names
  //     fields, so the page can mark them the way CF7 does.
  const invalid = validateShape(spec, values);
  if (invalid.length) {
    logRejection({ form: spec.id, reason: `invalid-fields:${invalid.join(',')}`,
      ip, page: meta.page, country: meta.country });
    return formPost
      ? back(meta.page, 'invalid', unitTag)
      : json('invalid', 422, MESSAGES.invalid, { invalid });
  }

  // --- layer 2b: dwell time.
  const dwell = checkDwell(loadedAt);
  if (!dwell.ok) return reject(dwell);

  // --- layer 3a: names. Local, so before anything that leaves the Worker.
  const name = checkName(values[spec.nameField]);
  if (!name.ok) return reject(name);

  // --- layer 4: rate limit. Before Turnstile, so a flood cannot run up
  //     siteverify calls either.
  const bag = env as unknown as Record<string, unknown>;
  const stores: RateLimitStores = {
    burst: bag.CONTACT_RATE_LIMIT as RateLimitStores['burst'],
    hourly: bag.FORM_RATE_LIMIT as RateLimitStores['hourly'],
  };
  const rate = await checkRateLimit(stores, spec.id, ip);
  if (!rate.ok) return reject(rate);

  // --- layer 1: Turnstile. The load-bearing one.
  const turnstile = await checkTurnstile(token, bag.TURNSTILE_SECRET as string | undefined, ip);
  if (!turnstile.verdict.ok) return reject(turnstile.verdict);

  // --- layer 3b: can the email domain receive mail? Last, because it is the
  //     second network round trip and only worth making for a real submission.
  const domain = await checkEmailDomain(values[spec.emailField]);
  if (!domain.ok) return reject(domain);

  // ---------------------------------------------------------------- send, once
  const key = bag.RESEND_API_KEY as string | undefined;
  if (!key) {
    console.error('[contact] RESEND_API_KEY missing at runtime — is it a Worker secret ' +
      'rather than a build variable?');
    return formPost ? back(meta.page, 'failed', unitTag) : json('failed', 500, MESSAGES.failed);
  }

  const { text, html, subject } = body(spec, values, meta);

  // Exactly one call to Resend, on the one path that reaches here. There is no
  // confirmation email and no second recipient: "send the visitor a copy too" is
  // the usual way a form quietly starts sending twice.
  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: setting(bag, 'CONTACT_FROM'),
        to: [setting(bag, 'CONTACT_TO')],
        // The visitor's address, so the client's Reply answers the lead. Never
        // `from` — that is forgery to the receiving mail server.
        ...(REPLY_TO_SENDER ? { reply_to: header(values[spec.emailField]) } : {}),
        subject: header(`Website enquiry: ${subject}`),
        text,
        html,
      }),
    });
  } catch (e) {
    console.error('[contact] resend request failed', e);
    return formPost ? back(meta.page, 'failed', unitTag) : json('failed', 502, MESSAGES.failed);
  }

  if (!res.ok) {
    // The body, not just the status: Resend names the reason — an unverified
    // sending domain, a malformed address — and the status alone does not.
    console.error('[contact] resend rejected the message', res.status,
      await res.text().catch(() => ''));
    return formPost ? back(meta.page, 'failed', unitTag) : json('failed', 502, MESSAGES.failed);
  }

  const { id } = (await res.json().catch(() => ({}))) as { id?: string };
  console.log('[contact] SENT ' + JSON.stringify({
    ts: new Date().toISOString(), form: spec.id, id, page: meta.page,
    ip: ip || '(none)', country: meta.country || '(unknown)',
  }));
  return formPost ? back(meta.page, 'sent', unitTag) : json('sent', 200, MESSAGES.sent, { id });
};

/** A GET here is someone opening the URL, not a submission. 405 with an Allow
 *  header says so, where the asset runtime gave an empty 405. */
export const GET: APIRoute = () =>
  new Response('This endpoint accepts POST from the contact form.', {
    status: 405,
    headers: { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' },
  });
