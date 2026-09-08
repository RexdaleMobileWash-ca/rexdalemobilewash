import type { APIRoute } from 'astro';
// The Worker's bindings and secrets. NOT `Astro.locals.runtime.env`, which is what
// the gate 11 procedure and every pre-Astro-7 example still say: Astro 7 removed it
// and the getter throws, so the route answers 500 on a build that passed and a form
// that looked wired. NOT `import.meta.env` either — that inlines what the BUILD saw,
// which for a Worker secret is nothing.
import { env } from 'cloudflare:workers';
import { FROM, TO, REPLY_TO, MESSAGES } from '../../contact.config';

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
 * arrive, not by a hidden marker: a marker is one more thing that can be
 * dropped by a copy-paste of the markup, and the field names already identify
 * the form unambiguously.
 */
interface FormSpec {
  id: string;
  /** email-body label -> field name, in the order the notification shows them */
  fields: [label: string, field: string][];
  required: string[];
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
  emailField: 'your-email',
  subjectField: 'your-subject',
};

const NICEPAGE: FormSpec = {
  id: 'nicepage',
  fields: [['Name', 'name'], ['Email', 'email'], ['Address', 'message']],
  // all three carry `required` in the markup
  required: ['name', 'email', 'message'],
  emailField: 'email',
  subject: 'Residential enquiry',
};

const LIMITS: Record<string, number> = {
  'your-name': 200, 'your-email': 320, 'your-subject': 300, 'your-message': 10000,
  name: 200, email: 320, message: 10000,
};
const DEFAULT_LIMIT = 2000;

// Deliberately permissive. Address syntax is far wider than any regex people
// write for it, and a form that rejects a real customer's address to feel
// strict costs more than a bounced notification. Resend rejects what is
// genuinely unsendable.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Parsed {
  spec: FormSpec;
  values: Record<string, string>;
  /** the honeypot field, which a person never sees and never fills */
  honeypot: string;
  /** CF7's per-page form id, e.g. wpcf7-f372-p195-o1 — the fragment the live
   *  site's own form action pointed at, so the no-JS redirect lands on the form
   *  rather than the top of the page, exactly as WordPress did it */
  unitTag: string;
  /** true only for a real browser form submission — JavaScript off. Both
   *  enhancement scripts post the same bodies but ask for JSON, so this is
   *  decided by what the caller accepts, not by the content type. */
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
    // Two callers post a form body. nicepage.js sends a FormData over
    // jQuery.ajax with dataType:'json' — so multipart, but it wants JSON back
    // and a 303 would break it. A browser with JavaScript off sends the same
    // content type and wants a page. `wantsJson` is what tells them apart.
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
    honeypot: get('your-website').trim(),
    unitTag: get('_wpcf7_unit_tag').trim(),
    formPost,
  };
}

function validate(spec: FormSpec, values: Record<string, string>): string[] {
  const bad = spec.required.filter((f) => !values[f]);
  const email = values[spec.emailField];
  if (email && !EMAIL.test(email)) bad.push(spec.emailField);
  return [...new Set(bad)];
}

/** Header injection: a newline in a header value starts a new header. Resend
 *  takes JSON over HTTPS rather than pasting these into an SMTP envelope, so it
 *  is not exploitable here — but subject and name are visitor-controlled and
 *  one refactor away from somewhere it would be. */
const header = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;');

function body(spec: FormSpec, v: Record<string, string>, meta: { ip: string; page: string }) {
  const rows = spec.fields.map(([label, field]) =>
    [label, v[field] || '(none)'] as [string, string]);
  const from = v[spec.emailField];
  const name = v[spec.fields[0][1]] || from;

  const text = rows.map(([k, val]) => `${k}: ${val}`).join('\n\n') +
    `\n\n---\nSent from the contact form on ${meta.page}\n` +
    `Reply to the sender: ${from}\n`;

  // Reply-To on this message is the client's own address (gate 11), so a plain
  // Reply goes to them rather than to the TBOX sending domain nobody reads. The
  // sender's address is therefore given here as a one-click mailto with the
  // subject prefilled, so answering the enquiry is still a single action.
  const subject = spec.subjectField ? v[spec.subjectField] : spec.subject || 'your enquiry';
  const mailto = `mailto:${encodeURIComponent(from)}` +
    `?subject=${encodeURIComponent('Re: ' + subject)}`;

  const html =
    `<div style="font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#222">` +
    `<p style="margin:0 0 18px"><a href="${esc(mailto)}" ` +
    `style="display:inline-block;padding:10px 18px;background:#0d6efd;color:#fff;` +
    `border-radius:4px;text-decoration:none;font-weight:600">Reply to ${esc(name)}</a></p>` +
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse">` +
    rows.map(([k, val]) =>
      `<tr><td style="padding:4px 16px 4px 0;vertical-align:top;color:#666;` +
      `white-space:nowrap">${esc(k)}</td>` +
      `<td style="padding:4px 0;white-space:pre-wrap">${esc(val)}</td></tr>`).join('') +
    `</table>` +
    `<p style="margin:18px 0 0;color:#888;font-size:13px">Sent from the contact form ` +
    `on ${esc(meta.page)}${meta.ip ? ` · ${esc(meta.ip)}` : ''}</p></div>`;

  return { text, html, subject };
}

/** No-JS submissions get a redirect back to the page they came from, carrying
 *  the outcome. 303 and not 302: it makes the follow-up a GET explicitly, so a
 *  refresh cannot re-post the form. */
function back(page: string, status: string, unitTag: string) {
  // Both are visitor-supplied — the referer header and a form field — so both
  // are constrained before they reach a Location header. A path not starting
  // with a single / could be `//evil.example`, a protocol-relative URL that
  // redirects off-site; the unit tag is held to CF7's own shape.
  const url = /^\/[^/]/.test(page) ? page : '/contact-us/';
  const frag = /^wpcf7-[a-z0-9-]{1,60}$/i.test(unitTag) ? `#${unitTag}` : '';
  return new Response(null, {
    status: 303,
    headers: { Location: `${url}?form=${status}${frag}`, 'Cache-Control': 'no-store' },
  });
}

/** The Workers rate-limiting binding, declared in wrangler.jsonc: 5 submissions
 *  per 60 seconds per IP. Keyed on the Cloudflare-supplied client IP, which the
 *  edge sets and a caller cannot forge — an X-Forwarded-For key would be one
 *  header away from useless. A request with no IP at all (only reachable off
 *  Cloudflare) is not limited rather than being limited as one shared bucket,
 *  which would let one caller lock out everybody. */
async function rateLimited(ip: string): Promise<boolean> {
  const limiter = (env as { CONTACT_RATE_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> } })
    .CONTACT_RATE_LIMIT;
  if (!limiter || !ip) return false;
  try {
    const { success } = await limiter.limit({ key: ip });
    return !success;
  } catch (e) {
    // Never let the limiter's own failure become the form's failure.
    console.error('rate limiter unavailable', e);
    return false;
  }
}

/** `success`/`ok` are for nicepage.js, which treats `data.success || data.ok`
 *  as the whole verdict; `status`/`message`/`invalid` are for
 *  public/js/contact-form.js. One shape both readers understand. */
const json = (status: string, http: number, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({
    status,
    success: status === 'sent',
    ok: status === 'sent',
    message: MESSAGES[status as keyof typeof MESSAGES] ?? MESSAGES.failed,
    ...(status === 'sent' ? {} : { error: MESSAGES[status as keyof typeof MESSAGES] }),
    ...extra,
  }), {
    status: http,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const POST: APIRoute = async ({ request }) => {
  const parsed = await parse(request);
  if (!parsed) return json('failed', 415);
  const { spec, values, honeypot, unitTag, formPost } = parsed;

  const referer = request.headers.get('referer') || '';
  let page = '/contact-us/';
  try { if (referer) page = new URL(referer).pathname; } catch { /* keep the default */ }

  // The honeypot is a text input inside a hidden container. A person never sees
  // it and never fills it; a bot that fills every field it finds does.
  // Answered as success rather than rejected — telling a spammer which check
  // caught them is how they tune past it.
  if (honeypot) return formPost ? back(page, 'sent', unitTag) : json('sent', 200);

  const invalid = validate(spec, values);
  if (invalid.length) {
    return formPost ? back(page, 'invalid', unitTag) : json('invalid', 422, { invalid });
  }

  const ip = request.headers.get('cf-connecting-ip') || '';
  // Checked after validation and the honeypot, so a bot hammering the endpoint
  // spends its budget without ever reaching Resend, and before the send, so a
  // burst cannot run up the client's email bill. 429 with Retry-After tells an
  // honest caller what happened; the visitor sees CF7's own "try again later".
  if (await rateLimited(ip)) {
    return formPost
      ? back(page, 'failed', unitTag)
      : new Response(JSON.stringify({
          status: 'spam', success: false, ok: false,
          message: MESSAGES.spam, error: MESSAGES.spam,
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '60',
            'Cache-Control': 'no-store',
          },
        });
  }

  // Read at call time, not at module scope: a Worker secret is not available while
  // the module is being evaluated, and hoisting this would freeze it as undefined.
  const key = (env as Record<string, string | undefined>).RESEND_API_KEY;
  if (!key) {
    console.error('RESEND_API_KEY missing at runtime — is it a Worker secret rather than a build variable?');
    return formPost ? back(page, 'failed', unitTag) : json('failed', 500);
  }

  const { text, html, subject } = body(spec, values, { ip, page });

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: TO,
        reply_to: REPLY_TO,
        subject: header(`Website enquiry: ${subject}`),
        text,
        html,
      }),
    });
  } catch (e) {
    console.error('resend request failed', e);
    return formPost ? back(page, 'failed', unitTag) : json('failed', 502);
  }

  if (!res.ok) {
    // The body, not just the status: Resend names the reason — an unverified
    // sending domain, a malformed address — and the status alone does not.
    console.error('resend rejected the message', res.status, await res.text().catch(() => ''));
    return formPost ? back(page, 'failed', unitTag) : json('failed', 502);
  }

  const { id } = (await res.json().catch(() => ({}))) as { id?: string };
  return formPost ? back(page, 'sent', unitTag) : json('sent', 200, { id });
};

/** A GET here is someone opening the URL, not a submission. 405 with an Allow
 *  header says so, where the asset runtime gave an empty 405. */
export const GET: APIRoute = () =>
  new Response('This endpoint accepts POST from the contact form.', {
    status: 405,
    headers: { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' },
  });
