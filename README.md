# rexdalemobilewash.ca — Astro port

A visual-match clone of the live WordPress site at https://www.rexdalemobilewash.ca/,
rebuilt as an Astro 7 site for Cloudflare Workers.

**Mode: clone, not redesign.** The brief was the same site on a better stack. The
markup and CSS are the live site's own, copied rather than retyped; nothing was
designed from page text. Where the port deliberately differs from the live site,
it is listed under [Deliberate differences](#deliberate-differences) below.

## What is here

| | |
|---|---|
| Pages | 18 routes + a ported 404 |
| Source design | Nicepage 8.6.2 (15 pages) and the hello-elementor theme (3 pages + 404) |
| Images | none in the repo — every one comes from `img.rexdalemobilewash.ca` (AD-9) |
| CSS | the live site's own sheets, vendored, in the live load order, pruned per page, plus `mobile-fixes.css` ([difference 14](#deliberate-differences)) |
| JS | jQuery 3.7.1 + `nicepage.js` (the menu, carousel, lightbox and parallax need them) |
| Forms | 15 forms, 2 kinds, both -> `/api/contact/` -> Resend, behind four bot-protection layers |
| Analytics | the same GTM container, `GTM-NMTLRJ63`, with gtm4wp's `dataLayer` push |
| Non-page files | four generated sitemaps + XSL, `robots.txt`, `_headers`, `_redirects` |
| Payload | ~1443KB → ~1081KB linked per page (25% smaller); see [Pruning](#pruning) |

Routes: `/`, `/what-we-do/`, `/who-we-service/`, `/buildings/`, `/de-icing-service/`,
`/fleet-washing/`, `/garbage-rooms/`, `/graffiti-removal/`,
`/heavy-equipment-washing/`, `/parking-underground/`, `/storefronts-3/`,
`/water-tanker-service/`, `/about-us/`, `/contact-us/`, `/residential/`,
`/lookbook/`, `/blog-post-title/`, `/author/admin/`.

## Build

```bash
npm install          # do NOT use --omit=optional; it strips the rolldown native binding
npm run build        # 19 prerendered pages + the one on-demand route, /api/contact/
```

The Worker is configured by `wrangler.jsonc`. Host is Cloudflare Workers (AD-1);
the adapter exists so that one on-demand route (`/api/contact/`, gate 11) can
run, while every page stays a prerendered file.

> **`wrangler.jsonc` diverges from the gate 3 template.** That template sets
> `"main": "./dist/_worker.js/index.js"`. `@astrojs/cloudflare` 14.x builds via
> `@cloudflare/vite-plugin`, which resolves `main` while *reading* the config —
> before the build has produced `dist` — so a dist path fails the build with
> *"doesn't point to an existing file"*. The adapter supplies the entrypoint and
> the assets directory itself. Worth fixing in the gate 3 skill.

## Deployment

**Live at https://rexdalemobilewash.ash-47a.workers.dev**

Cloudflare Workers, account `47a82355…` (Ash@brandingcentres.com), Worker
`rexdalemobilewash`.

> **Workers Builds is connected but is not firing.** Pushes to `main` on
> 2026-09-04 produced no build: Cloudflare's last automatic deployment is
> 2026-09-03T18:03, and GitHub shows no check run or commit status for any of
> those commits. The account token in this environment is refused on the
> Workers Builds API (`/accounts/…/builds/repos` → 10000 Authentication error),
> so the cause is not visible from here — check Workers →
> `rexdalemobilewash` → Settings → Builds in the dashboard. Until it is fixed,
> **a push to `main` does not deploy**; deploy with `npm run build && npx
> wrangler deploy` and re-run the checks against the deployed host.

> **⚠ Staging is running Turnstile's ALWAYS-PASSES TEST KEYS, and must not go
> to production that way.** The deploy on 2026-09-09 was the first to carry the
> bot-protection commit, and no Turnstile widget exists on the account yet —
> creating or reading one needs a permission this session's token does not have
> (`/accounts/…/challenges/widgets` → 10000 Authentication error). The choice
> was between shipping without a sitekey, which makes the Worker reject *every*
> submission (`TURNSTILE_SECRET missing at runtime`), and shipping Cloudflare's
> published test pair, which accepts any token from anyone:
>
> ```
> build var       PUBLIC_TURNSTILE_SITEKEY  1x00000000000000000000AA
> Worker secret   TURNSTILE_SECRET          1x0000000000000000000000000000000AA
> ```
>
> Neither value is committed. The Turnstile layer is therefore **inert** — the
> honeypot, the dwell-time stamp, the MX lookup and the 5-per-60s burst limiter
> are all live, so staging is still better protected than the build it
> replaced, which had none of them. To make it real: create the widget
> (Managed; hostnames `rexdalemobilewash.ca`, `www.`, `staging.`, and the
> `workers.dev` host), then
> `PUBLIC_TURNSTILE_SITEKEY=<real> npm run build`,
> `npx wrangler secret put TURNSTILE_SECRET`, and redeploy. **Do this before
> gate 13.**

```
worker .......................... rexdalemobilewash
repo ............................ RexdaleMobileWash-ca/rexdalemobilewash @ main
build ........................... npm run build   deploy: npx wrangler deploy
review hostname ................. staging.rexdalemobilewash.ca  (noindex)
                                  rexdalemobilewash.ash-47a.workers.dev
cutover hostname ................ not attached — that is gate 13
zone ............................ rexdalemobilewash.ca, ACTIVE on Cloudflare
workers.dev ..................... enabled (public, not access-gated)
preview URLs .................... disabled
```

### Deploy test, run against the deployed host

```bash
DEPLOY_HOST=https://staging.rexdalemobilewash.ca npm run verify:deploy
```

```
pages 200 ........................ 18 of 18
distinct assets fetched .......... 52    (51 × 200, 1 × 404)
assets on the old server ......... 0     *** the field that matters ***
unknown path ..................... HTTP 404 + ported 404 page
```

It was 293 before the images moved to `img.`. `verify:deploy` fetches
same-origin assets, and the Worker no longer serves any image — which is the
point, and also means this number no longer covers them. Measured separately
against the deployed pages rather than `dist/`:

```
image hosts referenced by the 18 deployed pages
  831 references, all on img.rexdalemobilewash.ca, 0 anywhere else
  223 distinct addresses, 223 served as an image, 0 failures
/favicon.ico ..................... 302 -> https://img.rexdalemobilewash.ca/…
```

The single 404 is `/wp-login.php` on `/blog-post-title/` — the "log in to leave a
reply" link WordPress emitted. A dead link on a placeholder page, not a missing
asset. It disappears if that page is redirected.

`_headers` and `_redirects` cannot be checked from a static file server; they are
read by the Workers asset runtime. `npx wrangler dev` against `dist/client`
serves the real thing (it logs `Parsed N valid redirect rules` / `header rules`
on startup) and is the way to check them without deploying.

### The review hostname: staging.rexdalemobilewash.ca

**The zone is `active`, not pending.** An earlier version of this file said
`*.rexdalemobilewash.ca` could not be used because the zone was pending with
nameservers at GoDaddy. It is not: `rexdalemobilewash.ca` is authoritative on
Cloudflare (`dee`/`josh.ns.cloudflare.com`), so gate 6 is done — which also
unblocks gate 7's `img.` hostname.

`staging.rexdalemobilewash.ca` is attached to the Worker as a Custom Domain,
declared in `wrangler.jsonc` under `routes` so it survives every future
`wrangler deploy` rather than being attached by hand. Cloudflare creates and
owns the proxied DNS record (an `AAAA` to `100::`, its standard placeholder for
a proxied Worker route), so there is no separate record to keep in sync.

Attaching it added **exactly one** record to a zone that carries the client's
live Microsoft 365 mail. The 32 records that were there before — `MX` to
`rexdalemobilewash-ca.mail.protection.outlook.com`, SPF, the Microsoft
verification TXT, `autodiscover`, `lyncdiscover`, `sip`, the SRV pair — are
byte-identical afterwards. A subdomain route cannot affect them, and the apex
and `www` still point at the WordPress server. **This is not the cutover**;
pointing the real domain here is gate 13.

**It is `noindex`.** It serves a complete copy of the client's site on their own
brand domain, so a Cloudflare Response Header Transform Rule scoped to
`http.host eq "staging.rexdalemobilewash.ca"` sets
`X-Robots-Tag: noindex, nofollow`. The scoping is the point: the same header in
`public/_headers` would apply to every hostname the Worker answers on and would
follow the site onto the production domain at gate 13, deindexing the client.
Remove it by deleting the rule in that zone's
`http_response_headers_transform` entrypoint ruleset — nothing in the repo
depends on it.

`rexdalemobilewash.ash-47a.workers.dev` still answers as well: an unlisted but
ungated copy, and unlike the staging hostname it carries no `noindex`. Close it
by setting `"workers_dev": false` in `wrangler.jsonc` and rebuilding, now that a
real hostname exists — or put Cloudflare Access in front of both (needs Zero
Trust onboarding on this account; there is no team domain or identity provider
yet).

### Two things that will bite

**The config is resolved at build time.** `@astrojs/cloudflare` writes
`wrangler.jsonc` into `dist/client/wrangler.json` during the build, and *that* is
what `wrangler deploy` reads. Edit the config and deploy without rebuilding and
you ship the previous build's settings. `workers_dev` and `preview_urls` default
to **enabled**, so a stale config publishes the site.

**Workers Builds has overridden those flags once**, re-enabling `workers.dev`
against `"workers_dev": false`. A later build did not repeat it, so it looks like
one-time behaviour on the first build after connecting the repo — but if the site
ever needs to be genuinely private, verify after each deploy:

```bash
curl -s -H "Authorization: Bearer $CF_API_TOKEN" \
  https://api.cloudflare.com/client/v4/accounts/$ACC/workers/scripts/rexdalemobilewash/subdomain
```

### Still to do

1. Gate 13 attaches the real domain, and with it
   the zone's *Always Use HTTPS* setting; `http://` is not upgraded today.
2. Gate 14 publishes the old-URL redirects. See
   [Old addresses that do not resolve yet](#old-addresses-that-do-not-resolve-yet--gate-14).

## Images

Gates 4 to 7 are done and the pages point at the bucket: there is no
`public/images/` in this repo, and every image address on the site is
`https://img.rexdalemobilewash.ca/…` (AD-9).

### Gate 4 — the bucket (done)

```
bucket .................... rexdalemobilewash-img
bucketId .................. 6fdfd8ab8f996b8fac030819
account ................... TBOX Studio          MATCH — holds briansmasonry-img,
                                                 boldeimaging-img, wheresmylink-img
bucket type ............... allPublic
lifecycle rule ............ keep only last version (daysFromHidingToDeleting=1)
object lock ............... off
native origin ............. f005.backblazeb2.com           <- the gate 7 CNAME target
S3 endpoint ............... s3.us-east-005.backblazeb2.com <- keys/SDKs only
direct fetch .............. 200 (probe uploaded, fetched, deleted)
unknown path .............. 404, not another bucket's content
files in bucket ........... 0
```

Those two addresses look alike and are not interchangeable. **The CNAME target is
the native origin**; using the S3 endpoint there is the usual gate 7 failure.

### Gate 5 — the images are in the bucket (done)

```
                        staging          bucket
files                       695             695
bytes                 208966295       208966295
difference                                    0
byte-for-byte spot check   5 of 5 OK   (fixed seed 20260903)
RESULT                     PASS
```

695 = 537 files from the WordPress media library at uploads-relative paths
(`2020/12/foo.jpg`) plus 158 Instagram stills under `instagram/`.

Reproduce with `python3 tools/reconcile-images.py ./.port-work/b2-staging
b2:rexdalemobilewash-img` — it exits non-zero on any difference, names every
missing file with its size, and checks that the combined size of the named files
equals the byte gap exactly. A count match alone would not prove nothing was
silently truncated.

**Source: the WordPress media library, not the pages.** The pages reference 110
image files; `wp-json/wp/v2/media` lists **115 media items whose generated sizes
come to 537 distinct files**. Copying only what the pages use would have left
gate 14's redirects 404ing for every other old image URL. Paths are preserved
uploads-relative (`2020/12/foo.jpg`), so the gate 14 rule is one prefix rewrite.

**15 files carried GPS EXIF** — one coordinate, ~130km from the business address,
i.e. somebody's property rather than the yard. `tools/strip-exif.py` removed
EXIF/XMP from 164 files before upload, at the container level (JPEG APP1
segments, PNG eXIf/iTXt chunks) so the compressed image data is untouched: all
164 verified pixel-identical afterwards, 1.8MB of metadata gone.

**That run covered the Backblaze copy only.** `public/images/`, which is what the
site actually serves until gate 7, was never passed through it, and three files
there — `2020/12/DE-ICING-1-1024x1024-{1,2,3}-1024x1024.jpg` — were still
shipping a GPS IFD. `python3 tools/strip-exif.py public/images` has now been run
against it too: 62 files rewritten, all 62 pixel-identical, 245KB of metadata
gone, 0 files left carrying a coordinate. Run it against any directory the site
serves from, not only the one it uploads from.

The upload used an application key **scoped to this one bucket**, not the master
key — the master key can delete every other client's bucket. The key value lives
in `.port-work/b2-key.env` (gitignored, chmod 600) and belongs in the password
manager.

The 158 Instagram stills were added after the initial reconciliation. They are
not the old site's images — they were harvested from the feed — so they went in
as a separate `rclone copy` under `instagram/`, and the reconciliation above
covers the whole bucket. They carried no EXIF at all: Instagram strips it
server-side.

**The eventual swap is a pure base swap.** Bucket keys mirror the repo layout
under `public/images/`, so `/images/2020/12/foo.jpg` becomes
`https://img.rexdalemobilewash.ca/2020/12/foo.jpg` and
`/images/instagram/x.jpg` becomes `https://img.rexdalemobilewash.ca/instagram/x.jpg`.
Nothing else has to change.

### Gate 7 — the image address is live (done)

`https://img.rexdalemobilewash.ca/<bucket key>` now serves the bucket, through
Cloudflare. This is the second proxied record added to the client's live zone,
after `staging.` above; the 34 records that were there before are untouched.

Two records, both mandatory:

```
CNAME  img -> f005.backblazeb2.com          PROXIED   (native origin, not the S3 endpoint)
Transform rule, http_request_transform phase:
  when  http.host eq "img.rexdalemobilewash.ca"
  path  concat("/file/rexdalemobilewash-img", http.request.uri.path)
```

Proof:

```
img.rexdalemobilewash.ca resolves to  104.21.90.186 / 172.67.203.212   (Cloudflare anycast)
f005.backblazeb2.com     resolves to  149.137.136.16                   (B2 direct — not what we hit)

GET /2023/12/Rexdale-Mobile-Wash-Logo-Updated-23.webp
  status .............. 200
  content-type ........ image/webp
  content-length ...... 7926          identical to the staged file
  cf-cache-status ..... MISS, then HIT on the second request
  x-bz-file-id ........ 4_z6fdfd8ab8f996b8fac030819_...   the gate 4 bucketId

6 random files (3 Instagram, 3 media library) fetched through img.: all 200,
all byte-identical to staging by sha256.
```

Out-of-bucket paths, which is the security half of the gate:

```
/../../file/backblaze-b2-public/x.txt          400   rejected at the Cloudflare edge
/%2e%2e/%2e%2e/file/backblaze-b2-public/x.txt  400   rejected at the Cloudflare edge
/file/backblaze-b2-public/x.txt                404   B2: "File with such name does not exist."
/b2api/v2/b2_list_buckets                      404   B2: "File with such name does not exist."
/2023/12/does-not-exist.webp                   404
```

The last two 404s are the ones that matter. B2 answered its own API path with
*file not found* — meaning the transform rule had already prefixed it to
`/file/rexdalemobilewash-img/b2api/v2/b2_list_buckets`, so nothing on that host
can address anything outside this bucket. Without the rule, `img.` would map to
the whole shared B2 origin and anyone could pull another Backblaze customer's
public bucket through the client's domain.

`cf-cache-status` being present at all is the other load-bearing line: it proves
the request went *through* Cloudflare rather than direct to Backblaze, which is
what makes egress free.

**Flagged, not changed (AD-2):** the zone's SSL/TLS mode is **Full**, not Full
(strict). B2 presents a valid certificate, so Full (strict) would work and is
stronger — but that setting is zone-wide and affects the client's other
hostnames, so it is the client's call, not this migration's.

### The pages now point at it (done)

`public/images/` is gone — 268 files, 84MB — and every image address on the site
is `https://img.rexdalemobilewash.ca/…`. The Worker serves no images at all.

**One host, in one file.** `image-hosts.json` at the repo root is the only place
the hostname is written. `tools/build_site.py`, `tools/gen_sitemaps.py`,
`tools/gen_edge.py`, `src/layouts/SiteBase.astro`, `tools/verify/compare-head.py`
and the AD-9 checker all read it, so the generator and the checker cannot
disagree about what "the image host" means.

**Not the `PUBLIC_IMG_BASE` build variable this file used to plan for.**
`public/css/page-*.css` is copied into `dist` verbatim — Astro never parses it —
so a `${PUBLIC_IMG_BASE}` placeholder inside a hero's `background-image: url()`
would ship to the browser literally. Two of this site's section backgrounds are
exactly that. One host in one JSON file does the same job with nothing to
resolve at build time and nothing to go missing in Workers Builds.

Where the addresses had to change, and what each one would have broken:

```
page markup, 1125 refs   <img src>, srcset, inline background-image
per-page CSS, 2 refs     hero backgrounds in public/css/page-residential.css
og:image                 copied into Facebook/LinkedIn/Slack unfurl caches — it
                         keeps resolving to whatever it said long after gate 16
JSON-LD image/logo/      Yoast's organisation + article schema
  contentUrl
sitemap <image:image>    41 refs — the addresses Google has indexed for image
                         search; left behind they 404 at gate 16
rel=icon, apple-touch-   the favicon is the client's logo, a media-library file
  icon, TileImage
/favicon.ico redirect    WordPress answers it with a 302 to the Site Icon; there
                         is no local path left to redirect to, so it is absolute
```

**`public/_headers` lost its `/images/*` rule.** The Worker serves no images, so
the rule could never match. `img.` sets its own (`cache-control: max-age=14400`,
plus `cf-cache-status`); the live site sent `max-age=86400`, so images
revalidate 6× more often than they did. Not a correctness problem, and a
Cloudflare Cache Rule on that hostname would close it if it ever matters.

**The one image on the site that was not the client's.** The AD-9 check caught an
`og:image` on `/author/admin/` pointing at `secure.gravatar.com`. Both easy exits
were wrong: allowlisting the host is a hotlink with permission, and mirroring the
file into the bucket copies in a grey silhouette — the admin email has no
Gravatar, so `d=mm` was serving the generic mystery-person placeholder. That page
now carries the site logo, which Yoast already names as the organisation's logo
in the JSON-LD on the same page. Listed under
[Deliberate differences](#deliberate-differences).

**The site must never reference `*.backblazeb2.com`.** That path bypasses
Cloudflare and bills the client for every image view.

## The contact forms

Gate 11. `/api/contact/` is the one route on this site that is **not**
prerendered, and the reason the Cloudflare adapter is here at all.

**There are two forms, not one, and the second is easy to miss.**

```
Contact Form 7          14 pages   Name / Email / Subject / Message
Nicepage u-inner-form    1 page    Name / Email / Address   (/residential/, and
                                   the only form on that page)
```

`/residential/` carries **only** the Nicepage one — it is the single page with
no CF7 form, which is why a grep for `wpcf7-form` finds 14 pages and misses it
entirely. (An earlier version of this file said that page carried both. It does
not; it has CF7's `wpcf7mailsent` event names in an inline script and a
`.wpcf7-response-output` div, and no CF7 form.) They were broken in different
ways:

- **CF7** posts to `action="/<page>/#wpcf7-f372-p195-o1"` — the page itself,
  because on the live site CF7's JavaScript intercepts the submit and posts to
  WordPress's REST endpoint, so the browser never follows that action. That JS
  needs the WordPress AJAX endpoint and is not shipped, so nothing intercepted,
  the browser did the native POST, and the Worker answered **405 with an empty
  body** — a blank error page on 14 pages.
- **Nicepage's form** posts to `action="#"`, and `nicepage.js` *is* shipped: it
  reads that attribute and sends a `FormData` there over jQuery with
  `dataType:'json'`. So it was posting the form to the page and parsing an HTML
  document as JSON. A silent failure rather than a blank page.

Both now point at `/api/contact/`, which recognises which form submitted from
the field names that arrive rather than from a hidden marker — a marker is one
more thing a copy-paste of the markup can drop, and the field names already
identify the form.

### Three ways in, all handled

```
contact-form.js   fetch, JSON          -> JSON  {status, message, invalid[]}
nicepage.js       FormData, wants JSON -> JSON  {success:true}   its own check
no JavaScript     native form POST     -> 303 back to the page, ?form=sent
```

The third is why the form's `action` and `method` still point at a real
endpoint: with `contact-form.js` blocked or failed the form still submits, and
the 303 carries the outcome back to the same page and the same `#wpcf7-…`
fragment the live site's own action used. The redirect target is built from the
`Referer` and CF7's `_wpcf7_unit_tag`, both visitor-supplied, so both are
constrained — a path that does not start with a single `/` could be
`//evil.example`, a protocol-relative URL that redirects off-site.

Telling the second and third apart is not the content type: `nicepage.js` sends
`multipart/form-data`, exactly like a browser with JavaScript off, and a 303
would break it. It is what the caller **accepts** — `Accept: application/json`
or `X-Requested-With: XMLHttpRequest`.

### It sets CF7's own classes

The site already carries CF7's stylesheet verbatim, so `contact-form.js` sets
the classes that stylesheet is written for — `form.sent` green, `form.invalid`
yellow, `form.failed` red, `.wpcf7-not-valid-tip` under a bad field — and the
states look like the original with no new CSS.

**No spinner element, deliberately.** CF7's own script inserts
`<span class="wpcf7-spinner">` beside the submit button and the vendored
stylesheet still has the rules for it, so adding one is two lines. It is also
`display:inline-block; width:24px; margin:0 24px`, and `visibility:hidden`
reserves space — it would park 72px beside the button on all 14 form pages,
permanently, for a one-second animation. Feedback during the request comes from
disabling the button instead, which costs no layout. This is why the port stays
18/18 pixel-identical with the forms wired.

### Addressing

```
From ....... website@rexdalemobilewash.ca      the client's own domain
To ......... customerservice@rexdalemobilewash.ca
Reply-To ... the visitor who filled the form
```

All three are in `src/contact.config.ts`, and two of them depart from gate 11's
letter on purpose.

**A visitor's address is never put in `From`.** That is forgery from the
receiving mail server's point of view and it lands the notification in spam.
It goes in `Reply-To`, which is what makes Reply answer the lead.

### Sending as the client's own domain

Gate 11 says never to use the client's domain as a sending domain, and the
reason is real: a bounce or a spam complaint then lands on the reputation of the
domain that also carries their Microsoft 365 business mail. This build was
directed to use it anyway. Two things make that a much smaller risk here than
the general rule assumes:

- **The only recipient is the client, at an address on the same domain.** This
  is not a mailing to strangers who can mark it as spam; it is the business
  emailing itself when someone fills a form.
- **The DNS already supports it and does not change.** Resend is set up on this
  domain with DKIM at `resend._domainkey` and a *separate return path* at
  `send.rexdalemobilewash.ca`, which carries its own SPF
  (`include:amazonses.com`) and its own bounce MX. So the apex SPF —
  `v=spf1 include:secureserver.net -all`, the one serving their real mail — is
  not involved and is not touched. DKIM and SPF both align with
  `rexdalemobilewash.ca`, so DMARC passes.

What it buys: the notification looks like the business rather than a third
party, and it authenticates cleanly into Microsoft 365.

> **Watch the first one for Microsoft's own spoof filter.** Mail arriving from
> outside that claims to be from your own domain is exactly what M365
> anti-spoofing looks for. Authenticated same-domain mail normally passes, and
> everything above is authenticated — but if the first test message is missing,
> look in **Junk** and then in the M365 quarantine before assuming the route
> failed. Adding Resend to the tenant's allowed senders is the fix if it comes
> to that.

### Reply-To is the lead, not the client

Gate 11's letter puts the client's own address here. That makes Reply address
the client themselves, which is useful to nobody — and the check the gate
actually states, that a reply must not go to the sending domain, passes either
way. So Reply answers the lead, and the notification says so at the top rather
than carrying a second button that does the same thing.

**The recipient was a decision, not a carry-over.** CF7's recipient lives in the
WordPress admin, which this migration never read. `customerservice@` is the
address printed in the page bodies on all 15 Nicepage pages; `dispatch@` is the
one the header and footer link with the subjects "Website Inquiry" and "From
Rexdale Website". `customerservice@` was chosen.

### Bot protection — four layers, all server-side

Built before launch rather than after the spam started. Every check is decided on
the Worker from the request itself; the page can claim whatever it likes and none
of it is believed. `src/lib/spam-guard.ts` holds all four.

```
1  Turnstile     token verified against siteverify. No valid token, no send.
2  Honeypot      a field a person never sees, plus a 3-second dwell floor.
3  Sanity        the email domain must be able to receive mail; no placeholders.
4  Rate limit     3 per form per hour per IP, plus a 5-per-minute burst brake.
```

**The order is deliberate.** The free local checks run first, so a flood spends
nothing of ours. The rate limit runs *before* Turnstile, so a flood cannot run up
siteverify calls either. The two calls that leave the Worker — siteverify and the
MX lookup — run last, and only for a submission that is otherwise plausible.

#### Invisible, and what happens when it is not

The widget renders with `appearance: 'interaction-only'`: it shows nothing, and
becomes visible only if Turnstile decides a human must actually do something.
That is a deliberate choice over the pure Invisible widget type, which *hard
fails* the same visitor instead. A real customer who trips the heuristics gets a
checkbox; they do not get a form that silently refuses them.

It is not hidden with CSS anywhere. If Turnstile ever does need a human, they
have to be able to see it.

**Consequence worth stating plainly: with JavaScript off, the forms cannot be
submitted at all.** Turnstile has no non-JS mode, so there is no token, so the
server rejects. The no-JavaScript fallback built at gate 11 still runs — the
form's `action` and `method` still point at a real endpoint and the 303 still
carries the outcome back — but it will carry a rejection. That is the cost of
"no valid token = reject, nothing sent", and it is the right trade for a form
whose alternative is being farmed by bots.

#### The honeypot is off-screen, not `display:none`

`display:none` is the first thing a scripted submitter learns to skip. Measured
in Chromium on the built page:

```
rect ................. -9324,-9179  34x44     off-screen, still rendered
display: none ........ false
aria-hidden .......... true                    on the wrapper and the input
tabindex ............. -1
autocomplete ......... off
keyboard reachable ... false
tab order ............ your-email > your-subject > your-message > submit
```

`tabindex="-1"` is what keeps `aria-hidden` from being an ARIA violation: the
rule it would otherwise break is "no focusable element inside `aria-hidden`".

A submission carrying anything in it is answered **200, "Thank you for your
message"** and nothing is sent. Every other rejection tells the visitor what went
wrong; this one lies, because telling a spammer which check caught them is how
they tune past it.

#### The dwell floor, and what it is worth

`form-loaded-at` is stamped by the page's JavaScript at load, and a submission
completed in under three seconds is rejected. Being honest about this layer: the
timestamp is client-supplied and forgeable, and it costs a scripted submitter one
line to defeat. It stops every bot that has not bothered. **Turnstile is the
load-bearing layer; this is not.**

Absent or unparseable is a rejection, not a pass — a submission that did not run
the page's JavaScript has no Turnstile token either.

#### MX is not the whole email test

RFC 5321: a domain with **no MX but an A or AAAA record still receives mail
there**. Checking MX alone rejects real, deliverable addresses, which is a worse
failure than accepting a junk one — so the check is MX, then A, then AAAA, over
DNS-over-HTTPS (a Worker has no resolver). `cloudflare.com` has no MX and is in
the test suite for exactly this reason.

A lookup that errors or times out **allows** the submission. Dropping real
enquiries because a resolver had a bad minute is not a trade worth making; the
miss is logged instead.

#### Rate limiting takes two stores

```
burst    CONTACT_RATE_LIMIT   Workers binding   5 / 60s    no provisioning
hourly   FORM_RATE_LIMIT      KV counter        3 / hour   needs a namespace
```

The Workers rate-limiting binding accepts a period of **10 or 60 seconds only**,
so "3 per hour" is not expressible with it — hence the KV counter, keyed per
form, so a visitor who used the contact form has not spent the residential
form's allowance.

Know what each is. Cloudflare documents the binding as counted **per data
centre** and "intentionally designed to not be used as an accurate accounting
system": a caller spread across colos gets a multiple of it. KV is
account-global, so the hourly number is the one that holds — at the cost of being
eventually consistent, which can let a simultaneous burst through before the
counter catches up.

**Not Turnstile-instead-of, and not a WAF rule.** A Cloudflare rate-limiting rule
would be the enforcing layer, and this session's API token is refused on that API
(`request is not authorized`, on a Free zone). Worth adding by hand later; it
does not replace any of the above.

#### Every rejection is logged

One line, one shape, greppable in `wrangler tail`:

```
[spam-guard] REJECT {"ts":"…","form":"cf7","reason":"dwell-too-fast:412ms",
                     "ip":"203.0.113.7","page":"/contact-us/","country":"CA"}
```

and one line per actual send, which is what makes "exactly once" checkable:

```
[contact] SENT {"ts":"…","form":"cf7","id":"…","page":"/contact-us/","ip":"…","country":"CA"}
```

#### Traceability in the notification itself

Every notification footer carries the submitting page, the IP and the location,
so a suspicious enquiry can be traced without going near the logs:

```
Sent from the contact form on /contact-us/ · 203.0.113.7 · Toronto, ON, CA
```

#### The build refuses to ship an unprotected form

`bin/check-forms.mjs` runs inside `npm run build`, joined with `&&`. For every
page carrying a `<form>` it requires the Turnstile mount, the sitekey meta, the
guard script, the honeypot and the dwell field — one mount per form — and that
every form posts to `/api/contact/`.

This is the part that survives everyone forgetting. A form added later without
protection does not look broken; it looks fine and is rejected by its own server
on every submission, which reads to the client as "the contact form is down".

It also fails on **zero** forms found. A check that silently passes on no input
is worse than no check.

It caught a real one immediately: `hasForm` was `'wpcf7-form' in content`, so
`/residential/` — the one page whose only form is Nicepage's — would have shipped
with no widget and no script, and rejected every submission it received.

```
FORM PROTECTION CHECK

  pages with a form .................. 15
  forms in total ..................... 15
  fully protected .................... 15
  incomplete ......................... 0

FORM PROTECTION CHECK PASSED.
```

With `PUBLIC_TURNSTILE_SITEKEY` unset it fails all 15 and names the missing
piece, which is the intended behaviour: a build with no sitekey must not produce
a deployable site.

#### Proof

`npm run test:forms` starts `wrangler dev` on the built output, runs every case
against the real Workers runtime, and reads the Worker's own log back — so
"sends exactly once" is checked against what the Worker *did*, not what it said.
Turnstile is exercised with Cloudflare's published test keys, so siteverify is
called for real:

```
PASS  GET is refused                                405, Allow: POST
PASS  no token rejected (cf7)                       403 · nothing sent
PASS  no token rejected (nicepage)                  403 · nothing sent
PASS  honeypot: looks accepted, sends nothing       200 "sent" · sends 0/0
PASS  submitted in under 3s rejected                400
PASS  missing dwell stamp rejected                  400
PASS  one-character name rejected                   400
PASS  placeholder name rejected                     400
PASS  email domain with no mail route rejected      400
PASS  domain with a mail route accepted             200   (cloudflare.com: A, no MX)
PASS  valid cf7 submission sends exactly once       200 · id … · sends: 1
PASS  valid nicepage submission sends exactly once  200 · id … · sends: 1
PASS  rate limit stops the 4th in an hour           codes: 200 200 200 429 429
PASS  every rejection reason appears in the log     7/7
PASS  rejection log carries form, reason, ip, page  10 rejection line(s)
PASS  valid token refused when siteverify says no   403 · nothing sent

RESULT: PASS — 16 of 16
```

The last one restarts the Worker against Cloudflare's **always-fails** secret and
replays a fully valid submission. It is the case that proves the verdict comes
from siteverify rather than from the presence of a string.

> **Two traps this harness hit, recorded because they both looked like bugs in
> the code under test.**
>
> The suite shared one client IP across cases, and the hourly limit counts every
> submission that reaches it — not just the ones that send. By the time the
> "valid submission" case ran, that IP was out of budget and the test reported a
> 429. Each case now gets its own IP; the rate-limit case keeps a fixed one,
> because repeat submissions from one address is the point there.
>
> `wrangler dev --var` does **not** override `.dev.vars`, so phase 2 silently ran
> against the always-*passes* secret and reported a pass that proved nothing. And
> killing `npx` leaves `workerd` holding the port: the next run's server dies
> quietly, the stale one answers every request, and every log-based assertion
> reads zero while the HTTP ones still pass. The harness now writes `.dev.vars`
> for phase 2 and kills the whole process group.

#### It changes nothing visible

The widget mount, the honeypot wrapper and the dwell field are injected by the
port pipeline, so the comparison reference carries them too; the guard script and
the sitekey meta are the port's alone.

```
render parity ......... 18/18
pixel diff ............ 18/18   full-page, byte-identical at 1440px
behaviour ............. 20/20
```

The verify harness serves an **empty stub** for `challenges.cloudflare.com`
rather than aborting the request. Aborting makes it a *failed* request, which the
render comparison counts — it reported all 15 form pages as DIFF on nothing but
that, while geometry, element counts and text were identical.

### The API key is a Worker secret

Not a build variable. A build variable is visible while the build runs and
absent when the route executes, so the form fails in production against a build
that passed — the trap this gate is mostly about.

> **And the way to read it changed under this gate.** The procedure says
> `Astro.locals.runtime.env`. **Astro 7 removed that**, and the getter throws:
> the route answered `500 Internal Server Error` on a build that passed, on a
> form that looked correctly wired. The Astro 7 spelling is
> `import { env } from 'cloudflare:workers'`, read inside the handler rather
> than at module scope. Worth fixing in the gate 11 skill.

Add it with `npx wrangler secret put RESEND_API_KEY`, or Workers → Settings →
**Variables & Secrets** → add as a *Secret*. For local testing, `.dev.vars`
(gitignored) at `dist/server/.dev.vars`, which is where `wrangler dev` reads it
from for this adapter's output.

### Abuse protection

Superseded — see [Bot protection](#bot-protection--four-layers-all-server-side)
above. Gate 11 shipped a honeypot and a 5-per-minute rate limit and deferred
Turnstile on the grounds that it "would put a visible widget into a page this
port is pixel-matched against". That reasoning was wrong: rendered with
`appearance: 'interaction-only'` the widget shows nothing and the port is still
18/18 pixel-identical.

### Proven, against the real Workers runtime

`npx wrangler dev --config dist/server/wrangler.json`, with a deliberately
invalid key so the Resend call is real and its rejection is visible:

```
GET  /api/contact/                       405 + Allow: POST
route prerendered                        no       dist/client has no api/ directory
JSON, valid                              502      resend: 401 "API key is invalid"
                                                  — the route reached Resend
JSON, invalid                            422 {"invalid":["your-name","your-subject","your-email"]}
honeypot filled                          200 {"status":"sent"}  and nothing sent
no-JS form POST                          303 -> /contact-us/?form=failed#wpcf7-f372-p195-o1
no-JS, invalid                           303 -> /fleet-washing/?form=invalid#wpcf7-f372-p125-o1
nicepage FormData + Accept: json         502 (as above), never a 303
nicepage, missing fields                 422 {"invalid":["email","message"]}
text/plain body                          403      Astro's own CSRF origin check
rate limit, 8 posts from one IP          5×502 then 429 + Retry-After: 60
rate limit, a different IP               unaffected
```

Astro's CSRF check is worth knowing about: it rejects a form-encoded POST with
no `Origin` header outright. Browsers always send one on a POST, so it costs
nothing and adds a layer — but it means a `curl` test without `-H Origin:` gets
a 403 that looks like a broken route.

And on the deployed Worker at `staging.rexdalemobilewash.ca`:

```
GET  /api/contact/            405 + Allow: POST
POST invalid                  422 {"invalid":["your-name","your-subject","your-email"]}
POST valid                    500 {"status":"failed"}   RESEND_API_KEY missing at runtime
honeypot                      200 {"status":"sent"}     and nothing sent
form action, /contact-us/     /api/contact/  (was /contact-us/#wpcf7-f372-p195-o1)
form action, /residential/    /api/contact/  (was #)
honeypot + script on the page yes
```

That 500 is the route's own diagnostic, not a crash: it is the branch that fires
when the secret is absent, and it logs *"RESEND\_API\_KEY missing at runtime — is
it a Worker secret rather than a build variable?"*.

### The live send

The key is a **sending-access** key scoped to `rexdalemobilewash.ca` alone — it
cannot read the account, manage domains, or send as any other domain — added as
a Worker secret. Three real submissions through the deployed site, read back
from Resend:

```
                              CF7 form           Nicepage form (/residential/)
resend status ............... delivered          delivered
from ........................ Rexdale Mobile Wash website <website@rexdalemobilewash.ca>
to .......................... customerservice@rexdalemobilewash.ca
reply_to .................... the visitor's address, not the client's
subject ..................... Website enquiry: <the visitor's subject>
                                                Website enquiry: Residential enquiry
field labels ................ Name/Email/Subject/Message
                                                Name/Email/Address   <- its own wording
page recorded ............... /contact-us/       /residential/
```

**The secret survives a redeploy.** `wrangler deploy` does not list secrets it
did not upload, so its binding table shows only `IMAGES`, `CONTACT_RATE_LIMIT`
and `ASSETS` and looks as though the key is gone. Reading the Worker's own
bindings afterwards shows `RESEND_API_KEY -> secret_text`, and a submission after
the redeploy still delivers. Worth knowing before someone re-adds it every time.

> **Two things that cost a round each, recorded so they do not cost another.**
>
> The Resend MCP prints the new key immediately followed by the word
> `IMPORTANT`, with nothing between them: `…K5B5gIMPORTANT: The token above…`.
> The `I` belongs to `IMPORTANT`. Taking it as part of the key gives a 37-character
> token where Resend's format is 36 (`re_` + 8 + `_` + 24), and every call comes
> back `401 "API key is invalid"` — which reads like a permissions problem and is
> not. Check the length.
>
> The first live notification carried `mailto:Paolo%40tboxstudio.com`, because the
> address went through `encodeURIComponent` on its way into the href.
> Percent-encoding is legal in a `mailto:` and most clients cope, but it reads as
> broken wherever the raw href is shown. The address is already validated to hold
> one `@` and no whitespace, so HTML-escaping is the whole of what is needed.

### One more thing the deploy turned up: `session: false`

`wrangler deploy` started failing on this gate with

```
The following bindings need to be provisioned:  env.SESSION  KV Namespace
A request to /accounts/…/storage/kv/namespaces failed. Authentication error [code: 10000]
```

`@astrojs/cloudflare` declares a `SESSION` KV binding with no namespace id
whenever Astro sessions are left at their default, and `wrangler deploy` then
tries to create the namespace. Reading the deployed Worker's own settings shows
`"bindings": []` — it never had one, and nothing on this site stores a session:
every page is a prerendered file and `/api/contact/` reads a request and sends
an email. So `astro.config.mjs` sets `session: false`, which is both what the
site actually needs and one fewer billable resource on the client's account.
Bindings after the deploy are `IMAGES`, `CONTACT_RATE_LIMIT` and `ASSETS`.

### The client's own mail, re-checked

Every gate that touches mail re-proves the client's own mail survived it. Read
back from Cloudflare after this gate's changes, against the gate 0.3 baseline:

```
MX     rexdalemobilewash.ca          rexdalemobilewash-ca.mail.protection.outlook.com  prio 0
TXT    rexdalemobilewash.ca          "v=spf1 include:secureserver.net -all"
TXT    _dmarc                        v=DMARC1; p=none;
CNAME  autodiscover                  autodiscover.outlook.com
CNAME  lyncdiscover                  webdir.online.lync.com
CNAME  sip                           sipdir.online.lync.com
SRV    _sip._tls / _sipfederationtls sipdir / sipfed.online.lync.com
```

Unchanged, and this gate added no DNS record at all.

The Resend records were already on the zone before this gate — `resend._domainkey`
carrying a DKIM key, and `send.rexdalemobilewash.ca` with its own SPF and an MX
to `feedback-smtp.us-east-1.amazonses.com` for bounces. They are left exactly as
found, and they are what makes sending as `rexdalemobilewash.ca` authenticate.
Note what they do *not* touch: the apex SPF still reads
`v=spf1 include:secureserver.net -all` and the apex MX still points at Microsoft
365, because Resend's return path is the `send.` subdomain rather than the apex.
That separation is why this form cannot affect the client's real mail flow even
though it sends as their domain.

## SEO

Two separate jobs, in this order: **keep everything the live site ranks on**, then
add what it never had. The first is not a claim, it is a measurement —
`npm run verify:head` fetches all 18 live pages and diffs the `<head>` tag for
tag against the built output:

```
head parity ........... 18/18   every title, description, canonical, robots
                                directive, Open Graph tag, twitter:* tag and
                                Yoast JSON-LD node the live site emits still
                                arrives, once the deliberate differences below
                                are accounted for
```

Nothing was retyped or rewritten to get there. The metadata is the live site's
own, carried by `tools/gen_pages.py` into the generated page files, exactly as
the markup is.

### What the port adds

All of it lives in **`src/seo.config.ts`**, is applied by `SiteBase.astro` on top
of the ported props, and is a pure function of them — so it cannot drift from
what the pages actually say, and a regeneration cannot lose it. Every value is
taken from the client's own pages or measured from the media already in the
bucket. Nothing is invented: there is no `geo`, because no verified coordinates
exist for the address, and no `openingHours`, because the site does not publish
any.

**1. The organisation is now a local business.** The live site's JSON-LD declares
a bare `Organization`: name, URL, logo, three social profiles. No address, no
phone, no service area — for a trade business that has worked out of one
Etobicoke address since 1966 and sells to one metro area. The `Organization`
node now also types as `ProfessionalService` (a `LocalBusiness` subtype) and
carries the address, phone, email, founding year and service area printed in the
site's own footer and contact block. This is the largest single gap in the live
site's structured data.

**2. Service pages say what they sell.** The ten service pages gain a `Service`
node — name, `serviceType`, the page's own description, its hero image, the
organisation as `provider`, and the GTA as `areaServed`.

**3. The share card works.** 17 of the live site's 19 pages ship **no
`og:image` at all**, so every link to them posted to Facebook, LinkedIn, Slack
or iMessage renders as a grey box. Each page now carries its own hero image with
real dimensions and alt text — dimensions read from the file in the bucket, not
from the markup, because the markup's `width`/`height` are the rendered size and
not what a crawler needs. The two pages that already had an `og:image` keep
Yoast's URL untouched and gain only the dimensions it omits. Every URL is on the
image host, so `bin/check-images.mjs` polices them under AD-9 like any other
image.

**4. The duplicate Open Graph tags are resolved.** Every live page emits **two**
competing sets of OG tags — Nicepage writes its own from the page body, then
Yoast writes the real ones — so `og:title` and `og:description` each appear
twice with different values, and consumers take the **first**, which is
Nicepage's. On the home page that first `og:description` is 1,100 characters of
carousel text scraped out of the DOM, whitespace and all:

```
"BULK WATER DELIVERY learn more FLEET WASHING learn more HEAVY
 EQUIPMENT learn more … Previous Next WELCOME TO REXDALE MOBILE WASH …"
```

and on `/author/admin/` the first `og:url` is `/author/admin?author_name=admin`,
a query-string form the page's own canonical contradicts. For the properties
that may hold only one value, the port keeps the **last** — Yoast's, the one
somebody authored. Nothing is lost: where Yoast wrote no value, the surviving
one is Nicepage's, which is what a crawler would have used anyway.

**5. Four descriptions, and only four.** Every other page keeps Yoast's wording
exactly.

| page | why |
|---|---|
| `/water-tanker-service/` | live carries `/de-icing-service/`'s description **word for word** — a Yoast copy-paste that leaves two pages competing on one snippet while saying nothing about bulk water |
| `/lookbook/` | no description live |
| `/blog-post-title/` | no description live |
| `/author/admin/` | no description live |

**6. `robots.txt` names the sitemap.** It did not, so the crawl entry point was
discoverable only from Search Console. The two WordPress lines above it are
carried over verbatim and still name `/wp-admin/`; harmless, and left alone.

**7. `preconnect` to `fonts.googleapis.com`.** The live site preconnects to
`fonts.gstatic.com`, where the font *files* live, but not to the host serving the
stylesheet that names them — which is fetched first. Every page loads between
one and four sheets from it in the critical path.

**8. `ContactPage` / `AboutPage` / `CollectionPage`** on the three pages that
obviously are one.

### `bin/check-seo.mjs`

Runs inside `npm run build`, joined with `&&`, so it runs in Workers Builds on
every deploy and a violation fails the deploy rather than reaching anyone. It
exists for the same reason the image and form checks do: a page that loses its
canonical, its description or its share image does not *look* broken — it looks
exactly right, in the browser and in the pixel diff, and the damage surfaces
weeks later in somebody else's Search Console. The whole point of moving off
Yoast is that the metadata is generated by code now, and code that generates
metadata needs something that reads it back.

Per page: exactly one non-empty `<title>`; a description (a failure on an
indexable page, a warning on a `noindex` one); exactly one canonical, on-site;
**no duplicated single-value `og:` property** — the regression guard for point 4,
which would otherwise fail silently and invisibly; an `og:image`; JSON-LD that
parses, whose `Organization` carries the address, phone and service area from
point 1. Across the site: `robots.txt` names a sitemap; every `<loc>` in every
sitemap resolves to a page this site actually builds, and no page is `noindex`
while sitting in one; and no two pages share a description.

Current state — 19 pages, 0 failures, 2 warnings:

```
/buildings/     description is 196 chars (>160, will be truncated)
/contact-us/    description is 208 chars (>160, will be truncated)
```

Both are the client's own copy. Left alone deliberately: rewriting the wording
on a ranking page is the client's call, not the migration's, and the check
surfaces it as a warning rather than deciding it.

### Three things left for the client to decide

Flagged, not acted on — each changes what the site says or what it indexes, which
is past where a migration should go on its own.

1. **`/blog-post-title/` is WordPress placeholder copy** — "What goes into a
   blog post? Helpful, industry-specific content that: 1) gives readers a useful
   takeaway…" — and it is indexed and in `post-sitemap.xml`. Thin boilerplate is
   a site-quality signal, not just a wasted page. Either write a real first post
   or `noindex` it. The port describes it honestly and leaves it indexed.
2. **`/author/admin/` is an author archive for one user called "admin"**, listing
   that one placeholder post. Yoast's own default is to disable author archives
   on single-author sites. Same options, same reason it was not decided here.
3. **The `SearchAction` in the JSON-LD points at `/?s={search_term_string}`**, a
   WordPress search this site does not have. Carried over untouched, as it was
   before — see [Known issues carried over](#known-issues-carried-over-from-the-live-site).

## Sitemaps

Four files, all generated by `tools/gen_sitemaps.py` from the ported site:

```
sitemap_index.xml      the crawl entry point, lists the three below
page-sitemap.xml       16 pages, 470 image entries
post-sitemap.xml       /blog-post-title/
author-sitemap.xml     /author/admin/
sitemap.xsl            makes the XML readable to a human who opens it

18 pages, 224 distinct images, nothing excluded.
```

**The filenames are the live site's own.** Google has this site indexed under
them, so a port that 404s on `/sitemap_index.xml` loses its crawl entry point at
cutover — a regression no page-by-page comparison can see, because a sitemap is
not a page.

### They used to be copies, and that was becoming wrong

Until now this script *copied* Yoast's five sitemaps out of the capture and
rewrote two things in them. That was right while the port was being assembled
and wrong to keep, because a copied sitemap describes the WordPress site:

- **Every `<lastmod>` was frozen at the capture.** The home page claimed a last
  modification of `2026-07-22` no matter what shipped afterwards. A lastmod that
  never moves is worse than none — Google learns to ignore the field.
- **The URL set could drift.** It happened to match all 18 routes exactly;
  nothing *made* it match, and nothing would have said so if a route were added
  or removed.
- **`e-landing-page-sitemap.xml` contained zero URLs.** Yoast emits one sitemap
  per custom post type and the Elementor landing-page type has no entries. An
  empty sitemap listed in an index is a Search Console **error** — "Sitemap is
  empty" — not something it quietly ignores. It is no longer emitted or listed.

### lastmod is now the page's own history

The commit date of `src/html/<slug>.content.html`, the file whose bytes decide
what the page serves. It falls back to the file mtime outside git or on an
uncommitted file, because a dirty tree emitting the last commit's date would be
a lie about newer content.

It tracks real per-page change rather than a build timestamp: the 15 pages
carrying a form read `2026-09-08`, the date the guard fields went in, while
`/blog-post-title/` and `/author/admin/` — which have no form and were untouched
— read `2026-09-05`.

### Which images, and which not

Read from both places a page's images live: `<img>` tags and inline background
styles in the markup, **and** `background-image` in the page's own generated
stylesheet. `/residential/` has both of its hero images only in the CSS; markup
alone would list neither.

**Every image the site shows is listed** — 224 distinct, across four sources,
because a page's images are in four places: its markup, its own stylesheet, the
shared header and footer partials, and its head metadata. Yoast's JSON-LD names
the Organization logo, which appears in none of the other three.

One pattern finds them: any absolute URL on the image host ending in an image
extension, wherever it appears. That replaced three targeted patterns —
`<img src>`, `url(…)`, and the entity-quoted `url(&quot;…&quot;)` — which each
covered a real spelling and together still missed the logo, because it is a plain
JSON value: `"url":"https://img…/logoclear-1.png"`. A pattern that cannot be
fooled by quoting beats three that each know one syntax.

**The Instagram tiles are included.** They were excluded at first on the
reasoning that they are "someone else's photographs". That was simply wrong:
they are the client's own work photos, from the client's own Instagram account,
harvested into the client's own bucket and served from the client's own domain.
158 photographs of the work this business does is exactly what Google Images
should be able to find. The per-URL limit is 1,000, so the home page's 177 is
comfortable.

**Responsive renditions are not listed twice.** WordPress emits
`image-1-768x1159.jpg` beside `image-1.jpg` — one photograph at six sizes, where
Google wants the canonical one. A rendition is dropped only when the image it is
a rendition *of* is also on the page; if a page shows only the 768px copy, that
copy is the image there.

Dropped entirely: anything not on the image host, which today is the Smash
Balloon UI sprite, chrome served by the Worker.

### The build refuses to ship a wrong one

`bin/check-sitemaps.mjs`, inside `npm run build`. A sitemap is the one file
nobody looks at and the one that tells Google what this site is, so a wrong one
is expensive and silent — and invisible to every other check here. The render
harness, the image check and the form check all pass over a completely broken
sitemap without noticing.

**It owns sitemap validation outright.** `bin/check-seo.mjs` had three sitemap
assertions of its own, written when the sitemaps were still copies; they are
covered here and have been removed from there, with a pointer left in their
place. Two checks reading the same files is two checks that drift.

```
SITEMAP CHECK

  routes served ...................... 18
  routes marked noindex .............. 0
  sitemaps in the index .............. 3
  urls listed ........................ 18
  images listed ...................... 478
  distinct images listed ............. 224
  shown but not listed ............... 0
  problems ........................... 0

SITEMAP CHECK PASSED.
```

It fails on: a listed URL the site does not serve; a served, indexable route in
no sitemap; **an image the site shows that no sitemap lists**; a page listed while
its own markup says `noindex`; a URL in two sitemaps at once; a sitemap built but
left out of the index, or listed and not built; an empty sitemap; a missing or
unparseable `lastmod`; an image off the image host; and `robots.txt` not pointing
at the index.

The image-coverage assertion earned itself immediately: it found the logo, the
footer skyline and the favicon missing from every `<url>`, then the Organization
logo still missing after the first fix. None of those is *wrong* in a sitemap —
it is absent, which is the failure a check has to make loud, because nothing
about the output looks off.

Verified by planting four faults, each of which the check named:

```
a URL the site does not serve             /does-not-exist/ is listed but the site does not serve it
a served page missing from every sitemap  /about-us/ is served and indexable but is in no sitemap
a noindex page put back in a sitemap      /blog-post-title/ is listed but the page says noindex
robots.txt not pointing at the sitemap    robots.txt does not point at sitemap_index.xml
```

All four files also parse as XML with a real parser, under the correct
`sitemaps.org/schemas/sitemap/0.9` and `sitemap-image/1.1` namespaces, and the
images they list resolve on the image host.

### Nothing is held back from the index

Every one of the 18 pages carries `index, follow` and appears in a sitemap, and
every image the site shows is listed. That includes `/blog-post-title/` and
`/author/admin/`, the two thin WordPress placeholder pages — they were briefly
`noindex` and that was reversed.

The machinery for taking a page out stays, in **`seo-noindex.json`**, with an
empty list. It is one file because three things read it in two languages:
`src/seo.config.ts` renders the meta tag, `tools/gen_sitemaps.py` leaves the page
out of the sitemaps, and `bin/check-sitemaps.mjs` fails the build if those two
ever disagree. A page that is `noindex` *and* in a sitemap asks Google for
exactly what its own markup refuses, and Search Console reports the pair as an
error — so the list being in one place is the point of it.

> **If it is ever used, do not also add a `robots.txt` Disallow.** Blocking a page
> from being crawled stops Google reading the `noindex` it is being blocked to
> enforce, so the page can sit in the index indefinitely on inbound links alone.
> `noindex` needs the page to stay crawlable. That is why `robots.txt` names only
> the sitemap.

## How the port is structured

Everything under `src/html/`, `src/nav-active.json` and `public/css/page-*.css`
is **generated**. Edit the pipeline in `tools/`, not the output.

```
tools/capture/live-capture-2026-09-03.tar.gz   the 17 captured pages + the 404
tools/capture/pages-extra/                     pages captured after that tarball was sealed
tools/capture/instagram-tiles.html             all 157 harvested feed tiles
tools/capture/sitemaps/                        the five Yoast sitemaps + their XSL
tools/run-port.sh                              regenerate the port from that capture
src/layouts/SiteBase.astro                     the document shell
src/components/Header.astro                    one header + the active-state transform
src/components/Footer.astro                    one footer, byte-identical everywhere
src/html/<slug>.content.html                   each page's markup, injected with set:html
public/css/page-<slug>.css                     each page's own inline CSS, hoisted out
public/css/vendor/                             the live site's stylesheets, verbatim
public/_headers, public/_redirects             edge config, both generated
image-hosts.json                               the image host, written once and read by
                                               the generator, the layout, the AD-9
                                               checker and two verify tools
src/seo.config.ts                              everything the port ADDS to the live
                                               site's SEO — hand-written, never generated
bin/check-images.mjs                           AD-9 enforcement, inside `npm run build`
bin/check-seo.mjs                              SEO enforcement, inside `npm run build`
```

> **`src/seo.config.ts` is hand-written on purpose, and it is the only place the
> new metadata may live.** `tools/gen_pages.py` OWNS all 19 `src/pages/*.astro`
> files and rewrites them from the capture. Anything added there is lost the next
> time somebody runs `npm run port`. `SiteBase.astro` applies the config on top of
> the ported props at render time, so a regeneration cannot silently undo it.

There is no `public/images/`. Every image is served from the bucket at
`img.rexdalemobilewash.ca` (AD-9) — see [Images](#images).

**The capture is the source of truth.** The live WordPress site is switched off at
gate 16, after which it cannot be re-fetched — so the capture is committed, not
just the scripts that consumed it. That means *every* input, not only the page
HTML: `instagram-tiles.html` was for a while the one exception, produced by
`harvest-instagram.py` into the gitignored `.port-work/` and never committed, so
a regeneration would have quietly rebuilt the feed with the 20 tiles in the
captured page instead of all 157 — from an endpoint that no longer answers.

### Where the JavaScript goes

WordPress enqueued jQuery, `jquery-migrate` and `nicepage.js` in the **head**,
and only `hello-frontend.min.js` at the end of `<body>`. The port moved all of
them to the end of `<body>`, which is faster and was wrong: `/residential/`
carries an inline block — copied verbatim from the live page, like all this
markup — that calls `jQuery()` at top level to bind the four `wpcf7` result
events. It parsed before jQuery loaded and threw
`ReferenceError: jQuery is not defined`, losing all four handlers, on a page
whose contact form is the point.

So **jQuery is in the head**, where the live site put it. `nicepage.js` stays at
the end of `<body>`: it is 446KB, it self-initialises on DOM ready, no page's
markup calls into it at parse time, and the behaviour suite passes with it there.
`jquery-migrate` is not shipped at all — the port serves the same jQuery build,
so there is nothing for it to shim.

A grep for inline `<script>` blocks touching `jQuery` or `$(` across every
generated `src/html/*.content.html` finds exactly one, on `/residential/`. If a
future capture adds another, this is the ordering it depends on.

### The header

All 15 Nicepage pages served one header that differed *only* in WordPress's
active-state classes (`current-menu-item`, `page-item-N`, `aria-current`,
`.active`, and the ancestor classes on the dropdown parent). So the repo holds one
neutral template and `Header.astro` re-applies the active state per page.

`npm run verify:header` proves that round trip byte-for-byte, twice: the Python
model against the 15 captured headers, and — the one that matters — **the built
pages** against those same headers, which tests the TypeScript that actually ships.

One subtlety is encoded there: WordPress emits the `current-*` markers *before*
`menu-item-has-children`, which only shows up on `/who-we-service/`, the page that
is itself the dropdown parent.

## Verification

```bash
npm run build                 # image, form-protection, SEO and sitemap checks
npm run test:forms            # the four bot-protection layers, vs the real runtime
npm run verify:image-urls     # every image address in dist/, fetched from img.
npm run verify:no-old-host    # nothing in dist/ points at the WordPress server
npm run verify:header         # header transform, byte-exact
npm run verify                # full render + pixel + behaviour parity, vs the capture
npm run verify:responsive     # horizontal overflow, 320px → 3440px
npm run verify:head           # every <head>, vs the LIVE site
npm run verify:live           # every page rendered side by side, vs the LIVE site
```

The middle four compare the port against the **capture**. The last two compare it
against the **live site**, and they exist because those are two different
questions — see [Against the live site](#against-the-live-site).

### Images (AD-9)

Two checks, because they answer different questions and neither implies the other.

`node bin/check-images.mjs` runs inside `npm run build`, joined with `&&` — so it
runs in Workers Builds on every deploy, and a violation fails the deploy instead
of reaching the client. It is a string check over `dist/`: is every image address
on the canonical host.

```
files scanned ...................... 66
image references ................... 642
on img.rexdalemobilewash.ca ........ 639
on an allowed third party .......... 0
off-host ........................... 0
local, not in the bucket ........... 3
files mentioning new.rexdalemobilewash.ca  0
```

The three local ones are the Smash Balloon plugin's UI sprite
(`/css/assets/plugins-instagram-feed-img-sbi-sprite.png`, 119×55, 3.9KB),
referenced three times by its own vendored stylesheet. Plugin chrome, not a
content photograph, so it stays in `public/` — the count is explained, not
ignored.

> **The shipped checker was blind to 50 of those 642 references** and this build
> passed at 592. An inline style attribute carries its own quotes as entities —
> `style="background-image: url(&quot;https://…/hero.jpg&quot;)"` — and
> undecoded, that URL starts with `&quot;` so it is not absolute, and ends with
> `&quot;` so the image-extension test fails. It was counted as neither off-host
> nor local: it vanished. 29 of this site's hero and section backgrounds are
> written that way, which is precisely the case the check exists to catch.
> `bin/check-images.mjs` now decodes entities before classifying, verified by
> planting an off-host hotlink in that exact spelling — the check exits 1 and
> names it, and exits 0 once restored. **Worth pushing back into the
> `keep-images-on-backblaze` skill.**

`npm run verify:image-urls` (`tools/verify/image-urls-live.py`) answers the other
half. The host being right does not mean the file is there: a typo'd path, a file
gate 5 missed, or a transform rule scoped to the wrong bucket all pass the string
check cleanly and 404 for every visitor. So this one opens sockets.

```
distinct addresses in dist ......... 268
served as an image ................. 268
not served, or not an image ........ 0
status codes ....................... {'206': 268}
```

268 is exactly the file count `public/images/` used to hold, so nothing was lost
in the swap.

**Chromium cannot reach `img.` through this session's proxy** (curl can; this is
the same limitation that already forces the Google Fonts cache). Left alone every
photo would fail to load in the render comparison and every measurement that
depends on an image's intrinsic size would be taken against a 0×0 box. So
`tools/verify/img-route.cjs` intercepts that hostname in Chromium and serves the
same bytes from `.port-work/b2-staging` — which is what gate 5 uploaded and what
`tools/reconcile-images.py` proves byte-identical to the bucket. That is the
split: the render harness proves the **page** is right, `verify:image-urls`
proves the **host** serves it.

### Against the capture

`npm run verify` renders each **original captured document** and the **built page**
in the same Chromium, from the same local assets and the same cached fonts, and
compares them. Both sides are served at *identical route paths* — that is not
cosmetic: `nicepage.js` marks the current nav link and its dropdown parent
`active` by matching `location.pathname` against the menu hrefs, so a reference
served at any other path silently diverges and makes a correct port look broken.

```
render parity ......... 18/18   computed styles, section geometry, element
                                counts, internal links, body class, text
                        18/18   again at 390px
pixel diff ............ 18/18   full-page screenshots, byte-identical at 1440px
                        17/18   at 390px; the odd one is /about-us/, whose
                                19-frame animated GIF lands on a different frame.
                                Its element geometry is identical (x75 y877
                                153x114) and the differing pixels lie in that box.
behaviour ............. 20/20   dropdown open/close (incl. no focus latch after
                                click), 9 submenu routes, carousel, off-canvas,
                                PhotoSwipe lightbox opens, and the Instagram
                                pager: 20 tiles shown / loaded / painted from 21
                                requests, 40 after one click, 157 with the
                                button gone once exhausted
header transform ...... 15/15   model AND built pages, byte-exact
broken images ......... 0
images loaded but
  rendered invisible .. 0        added after the Instagram grid shipped invisible
failed requests ....... 0
old-server references . 0
```

Re-run at another width with `VERIFY_WIDTH=390 node tools/verify/compare-render.cjs`
then `PIX_TAG=.390 python3 tools/verify/pixel-diff.py`.

> **The narrow-width runs are expected to differ from here on.** Difference 14
> corrects the header on all 18 pages, and the hero carousel and services row
> on top of that, so at 390px the comparison is now measuring the port against
> the live site's *broken* layout and will report DIFF there — that is the
> change, not a regression. The 1440px runs are untouched: every rule in
> `public/css/mobile-fixes.css` sits inside a `max-width` query, and the header
> and card geometry at 1200px and 1440px is unchanged to the pixel.

### Against the live site

> **What the capture comparison cannot see.** The reference is the captured
> document put through *the same rewrite pass the port uses*, with the same
> WordPress plugin scripts stripped. So a bug in that pass, or a regression
> caused by not shipping that JS, appears identically on both sides and the diff
> reports a match. That is exactly how the Instagram grid shipped invisible —
> and how it later shipped with its Load More block reparented out of the feed
> and rendering a 1380px SVG, while the pixel diff read 17/17.

`npm run verify:live` (`tools/verify/compare-live.cjs`) closes that hole. It
renders the **live WordPress site** and the **port** in the same Chromium at the
same route paths, with the same third-party tags blocked on both sides, and
diffs computed styles, section geometry, a depth-6 DOM tree with boxes, element
counts, text, internal and external links, image load state, console errors and
failed requests — plus a full-page screenshot of each side.

`npm run verify:head` (`tools/verify/compare-head.py`) does the same for the
document `<head>`, which no render or pixel comparison can reach: none of it is
painted. It compares *parsed* values, so entity spelling and attribute quoting
do not register, and it skips the tags the port drops on purpose.

Both default to `dist/client`; point them at a deployed host with
`STAGE=https://… npm run verify:head`. Do that after every deploy — several of
the differences these tools found existed only on the deployed Worker, because
it was serving an older build than the repo.

> **Cache-bust when checking a deployed host.** A 404 you provoked while probing
> is cached at the edge and will keep answering 404 after the file exists. Add
> `?cb=$RANDOM`. Two rounds of "the deploy failed" here were that.

Measured against the **deployed** Worker, not a local build:

```
head parity ........... 18/18   tag for tag, once the deliberate move of the
                                media library to img. and entity/quote spelling
                                are normalised. Was 17/18: the one difference,
                                /author/admin/'s og:image (deliberate difference
                                12), is now listed in the tool as a known drop
                                rather than reported on every run, alongside the
                                gate 11 Turnstile tags and the additions in
                                [SEO](#seo). A tag on the live side and missing
                                from the port is still always a failure.
render vs live ........ 17/19   exact document height on all 19 (the 18 routes
                                plus the 404). The two flagged are / and
                                /what-we-do/, on the deliberate differences
                                below: 157 tiles inlined against 20 served, and
                                the photo painted as a CSS background rather
                                than an <img>
pixel vs live ......... 17/19   full-page, byte-identical
outside the feed ...... 19/19   ZERO differing pixels anywhere on those two
                                pages except inside #sbi_images, whose box is
                                identical on both sides (home 150,2405
                                1140x1452; what-we-do 200,991 1060x870)
```

Inside that box the two sides show the **same posts, in the same order, cropped
the same way** — the pixels differ because the live plugin picks a *resized*
variant per tile from a signed CDN URL while the port paints the frozen full-res
original, so the same photo is resampled from a different source resolution. On
`/what-we-do/` that is the whole story and it measures as noise: mean |delta|
**4.2**, 97.3% of pixels within 32 levels. On `/` the number is larger (mean 30)
for a reason that is not the port's: 4 of the 20 live tiles never finished
painting before the screenshot, and a white tile against a photo saturates the
difference. The live side is not deterministic here, which is why the harness
waits for the swap before shooting.

Also worth knowing: the harness fulfils every browser request from Node, because
Chromium cannot open a TLS tunnel through this session's egress proxy. Run it
with `NODE_USE_ENV_PROXY=1`.

Fonts: declared Roboto / Roboto Slab / Open Sans / Audiowide; **computed**
Audiowide on headings and Open Sans on body. Roboto loads but wins on only 2 of
15 pages — the live site ships ~100KB of webfont that renders almost nowhere. Kept
as-is: the Google Fonts links are copied from the live site verbatim.

## Deliberate differences

Fourteen, all verified. Thirteen were forced; the fourteenth is the one place
the port is asked to look *different* on purpose.

1. **The `/lookbook/` gallery is repaired.** Its 8 images were hotlinked from
   `www.new.rexdalemobilewash.ca` — a staging host with **no DNS record at all**,
   so the gallery is broken on the live site right now. The same files exist on
   production, so the port serves those. This is the one place the port looks
   *better* than the original. Its `data-link` attributes, pointing at attachment
   pages on that dead host, were dropped (nothing linked to them).

2. **The Instagram feed is a frozen local snapshot.** Smash Balloon renders
   placeholders and swaps in photos at runtime from signed `cdninstagram.com` URLs
   that expire, via a WordPress AJAX endpoint that will not exist. Those photos
   are in the bucket and the markup points at `img.` directly, so the grid
   renders with no JS and never expires — but **it will not show new posts**. A live feed
   needs a decision (gate 12 territory).

3. **`elementor/css/global.css` is omitted** — it returns **404 on the live site**,
   so it styles nothing today. Reproducing the 404 would be the only alternative.

4. **Dead plugin bootstrap is stripped**: the WooCommerce `star`/`WooCommerce`
   `@font-face` block (0 elements site-wide use it), the CF7 REST config, Smash
   Balloon's `admin-ajax` URL and feed nonce, and the `fast-cache-32` loader
   config. The Elementor background-lazyload observer is **kept** — 4 elements
   still depend on it.

   > **The `fast-cache-32` one is not just dead bootstrap — read this before
   > putting the live site back in front of anyone.** Every page on the live
   > site, all 19, loads
   > `wp-content/plugins/fast-cache-32/js/bsc-loader.js`. Its entire body:
   > POST `{action: "bsc_sl_get_script", nonce}` to `admin-ajax.php`, take
   > `payload.data.script` out of the JSON response, and run it —
   > `el.text = source; document.body.appendChild(el)`. That is a remote-code
   > loader: whoever controls that response executes arbitrary JavaScript in
   > every visitor's browser, on every page view. The plugin name and the `bsc_`
   > prefix (Binance Smart Chain) match a known family of WordPress
   > crypto-drainer injections. Nothing on this site needs it and no legitimate
   > cache plugin works this way.
   >
   > The port does not carry it, so the new site is clean. But it says the
   > **WordPress install is very likely compromised**, which is worth acting on
   > independently of this migration: the same access that planted this could
   > have planted more, and the media library this port copied from came out of
   > the same install. Nothing in the bucket executes — it holds only media
   > files, all EXIF-stripped and pixel-verified at gate 5 — so the port is not
   > a carrier. But the WordPress host, its database, and its credentials should
   > be treated as untrusted rather than simply switched off at gate 16.

5. **The Instagram feed carries all 157 posts, not the 20 the page shipped with.**
   The captured page holds one page of the feed; the rest only arrive from the
   plugin's `sbi_load_more_clicked` AJAX endpoint, which dies with the WordPress
   site — and the image URLs inside it are signed and expire sooner than that.
   `tools/harvest-instagram.py` paged through that endpoint once and pulled every
   tile; all 157 are inlined, their photos staged and uploaded to the bucket
   under `instagram/`. The page still shows 20 with a working **Load
   More** that reveals 20 more per click, so the rendered page is identical to
   the original — it just no longer needs a server to page through.

   The hidden tiles park their photo URL in `data-sbi-src`, and the pager puts it
   back as it reveals each one. `display:none` does **not** stop a browser
   fetching an `<img src>`: with the URL left in place the home page pulled all
   158 photos on load, 38.4MB against the 2.5MB the visible tiles need and
   against the 20 photos the live feed requests. It is 21 requests now, and 158
   only if a visitor clicks through the whole feed. The CSS background on
   `.sbi_photo` — which is what the no-JS mode actually paints — is skipped by
   the browser while the tile is hidden, so only the `<img>` needed handling.

   **Re-running the harvester will not work once the old site is off.** Its
   output is committed for that reason, at `tools/capture/instagram-tiles.html` —
   as the tiles *after* their photos were localised, so a regeneration needs
   neither the AJAX endpoint nor the signed CDN URLs.

6. **The Instagram grid is rendered in Smash Balloon's no-JS mode.** Without
   `sbi-scripts.js` the tiles ship as `.sbi_item.sbi_transition`, which the
   plugin's own CSS sets to `opacity: 0` — the JS is what fades them in. The grid
   loaded correctly and was **completely invisible**. The plugin ships a no-JS
   mode for exactly this, keyed on a `sbi_no_js` class, so the port sets that
   class and paints each photo as the CSS background that mode expects. It also
   restores the 1:1 tile ratio, which the JS applied and the CSS does not
   (tiles were rendering at each photo's natural aspect — 278×493 instead of
   278×278). The Load More button stays and works client-side (see above), so
   `/` and `/what-we-do/` remain pixel-identical to the reference.

7. **The empty trailing `<div class="u-body">` is dropped.** The live site emits
   one after the footer, inside `.nicepage-container`. It renders nothing, but
   `nicepage.js` builds a hidden PhotoSwipe template per `.u-body`, so the live
   site initialises one more than it needs. Visible behaviour is unchanged:
   exactly one lightbox opens on both sides.

8. **WordPress's own discovery metadata is not carried.** Dropped from every
   head: `rel=alternate` (the two RSS feeds and the per-page `wp-json` JSON),
   `rel="https://api.w.org/"`, `rel=EditURI`, `rel=shortlink`, and the oembed
   endpoints. Every one names a WordPress endpoint the new site does not serve,
   so carrying them would advertise 404s. The same goes for the `Link:` response
   header that repeats three of them. What this costs: `rel=shortlink` and the
   `/?p=<id>` URLs it points at stop resolving — those, and the feeds, are old
   addresses, which is gate 14's job, not the head's.

9. **The plugin fingerprints are not carried.** Four `meta name="generator"`
   tags (Security Check Plus 1.0.0, WordPress, Elementor 3.17.3, Nicepage
   8.6.2), the `data-intl-tel-input-cdn-path` meta, and
   `<link rel="dns-prefetch" href="//www.google.com">`. The generators would
   assert a plugin stack that is not running; the prefetch warms a connection
   for a reCAPTCHA the port does not load. None is read by anything.

10. **The page URLs in head metadata resolve only after cutover; the image URLs
    resolve now.** `canonical`, `og:url` and the schema.org `@id`s keep the
    production domain on purpose — that is what this site will be — so they point
    at WordPress today and at this site the moment gate 13 lands. The alternative,
    pointing them at the `workers.dev` hostname, would bake the preview host into
    the client's structured data.

    Their **image** addresses are a different thing and were split off at gate 7:
    `og:image`, the Organization logo, `contentUrl`, the favicon and the sitemap
    `<image:image>` entries all go to `img.rexdalemobilewash.ca`, which serves
    them today and will keep serving them through cutover and past gate 16. That
    matters most for `og:image`, which Facebook, LinkedIn and Slack copy into
    their unfurl caches — an address that only works after cutover would have
    been cached broken in the meantime, with nothing on the site to explain it.
    All 268 addresses in `dist/` are fetched and checked by
    `npm run verify:image-urls`.

11. **Four response headers are reproduced from `public/_headers`, not from a
    WAF.** `X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection` and
    `Content-Security-Policy: upgrade-insecure-requests` come from Sucuri on the
    live site — a layer that does not exist here — so nothing in the ported
    markup reproduced them and the port shipped with none. The same file
    restores `max-age=86400` on `/css/` and `/js/`, which Cloudflare static
    assets otherwise serve as `max-age=0, must-revalidate`, and puts the
    `charset=UTF-8` back on HTML responses. There is no `/images/` rule: the
    Worker serves no images, so it could never match — `img.` sets its own
    (`max-age=14400`), where live sent `max-age=86400`.

    That last one needs **one rule per route**, which is why `_headers` is
    generated rather than hand-written. `_headers` matches on the *request*
    path; every page is requested as a directory (`/what-we-do/`), so a
    `/*.html` rule reaches only `/404.html`, and `/*` would retype every image
    and stylesheet as HTML. `wrangler dev` hides this — its runtime appends the
    charset by itself, production does not.

    **The 404 response is the one exception and cannot be fixed here.** It is
    served for an arbitrary unknown path, so the only rule that matches it is
    `/*` — the one that would retype every asset. Live sends
    `text/html; charset=UTF-8` on its 404 and the port sends bare `text/html`.
    The page declares `<meta charset="UTF-8">` in its first bytes, so browsers
    are unaffected. Closing it properly means a zone-level Transform Rule
    (gate 13 territory) or turning every unknown path into an on-demand Worker
    route, which is a worse trade than the header.

12. **`/author/admin/`'s social card shows the logo, not the author's Gravatar.**
    Yoast set `og:image` on that page to `secure.gravatar.com`, the one image
    address on the site that was not the client's — and the AD-9 check refuses
    it. Both easy exits were wrong: allowlisting the host converts a caught
    hotlink into a permitted one, and mirroring the file into the bucket copies
    in a grey silhouette, because the admin email has no Gravatar and `d=mm` was
    serving the generic mystery-person placeholder. The site logo is already in
    the bucket and Yoast itself names it as the organisation's logo in the
    JSON-LD on the same page. This is the single remaining difference in
    `npm run verify:head`, which is otherwise exact against the live site; the
    tool now carries it as a listed known drop, so the run reads 18/18.

13. **The contact forms post to `/api/contact/`, not to the page.** Both forms'
    `action` attributes are rewritten — CF7's from `/<page>/#wpcf7-f372-…` and
    Nicepage's from `#` — because on the live site JavaScript intercepted both
    submits and the attribute was never followed. Each also gains one hidden
    honeypot input. Nothing renders differently: the port is 18/18
    pixel-identical with the forms wired. See
    [The contact forms](#the-contact-forms) for what each form was doing before,
    and for the two places this deliberately departs from gate 11 — sending as
    the client's own domain, and putting the lead rather than the client in
    `Reply-To`.

14. **The small-screen layout is corrected**, in
    `public/css/mobile-fixes.css` — the only stylesheet here that is not the
    live site's. It loads after the per-page sheet on every page, and every
    rule in it is inside a `max-width` query, so the desktop layout
    (>= 1200px) is byte-for-byte what it was.

    The design was laid out on the desktop canvas and its breakpoints were
    generated from that: the small-screen rules carry pixel margins measured
    for a 1200px stage, so on a phone they push blocks on top of each other.
    Five things:

    - **The header, below 992px.** The generated header places the logo for the
      325x75 **wordmark** it was designed with: bottom-aligned inside the blue
      bar on `margin-top: -69px`, with the bar itself pushed 117px down the
      page to clear the black contact bar. The client later swapped in the
      round logo by hand, at the top of every page sheet
      (`.u-logo-image-1 { width: 130px !important }`), and nothing downstream
      was re-tuned — so a 130px circle hangs out of both ends of a 99px bar
      that floats a third of the way down the hero, and the contact bar it was
      clearing is hidden at that width anyway. On `/about-us/` the logo lands
      on top of the page title. The bar now sits at the top of the page as one
      flex row: logo left, hamburger right, both centred on it (96px logo to
      991px, 76px to 575px). `.u-header`'s 305-335px `min-height` goes with it
      — the box is `position: absolute` over the page, so it was covering a
      third of the hero and swallowing taps meant for it. The breakpoint is
      991px and not 767px because that is where the contact bar disappears: a
      tablet was broken in exactly the way a phone was.
    - **The hero carousel, below 768px.** The slide boxes keep desktop margins
      — 387-427px from the top of a 209px-tall slide — so slide text lands
      below the bottom of its own slide, and the 48-60px headings overflow a
      340px box. Slides get a real height and their content is centred in it;
      the prev/next arrows, pinned 231.5px off the bottom, move to the middle.
    - **The services row on the home page.** The GRAFFITI REMOVAL card's
      paragraph carries `margin-top: -38px` below 1200px, which prints the copy
      straight through the heading on every phone and tablet — fixed at every
      width below 1200px, not just on a phone. On a phone the cards are also
      centred and evenly spaced (two of the five cells carry no
      `u-align-center`, and their own `u-align-center-lg/md/xl` stops short of
      the phone breakpoints, so those two read left-aligned in a stack of
      centred ones), and the duplicate graffiti icon is dropped: the card holds
      the same SVG twice, overlapping to the pixel on desktop and side by side,
      left of centre, once the card is full width.
    - **WHO WE SERVICE in the open off-canvas menu.** It is the only item with
      a submenu, so nicepage makes its link a flex box to hold the dropdown
      arrow and pushes the arrow right with `margin-left: auto`. `text-align:
      center` does not centre a flex line and an auto margin eats the space
      `justify-content` would have used, so that one label sat hard against the
      panel's left edge — 164px of text in a 250px panel, spilling off the
      screen — while its four siblings were centred. The link is a block again
      and the arrow is positioned instead of margin-pushed, so all five labels
      centre on the same axis and the arrow keeps the right edge.
    - **Content hanging off the right edge below 340px of sheet width.**
      Nicepage pins the content sheet to a flat 340px below 576px, so an
      iPhone SE and anything narrower overflows.

    Nicepage numbers its classes per page — `.u-section-5 .u-text-8` is a
    different element on every route that has a fifth section — so everything
    below the header is addressed by the section's own id (`#sec-2847`, the
    home page's services row). The header is the one piece of markup every
    page shares.

## Known issues carried over from the live site

Faithfully reproduced, not introduced here:

- **`/lookbook/` overflows horizontally at every width** (+10px at 320px, +1150px
  at 3440px). The reference render overflows identically. Everything else is clean
  from 320px to 3440px.
- **`/blog-post-title/` is WordPress placeholder copy** ("What goes into a blog
  post?"). It is in the sitemap, so it is ported rather than dropped; gate 14 may
  prefer a redirect.
- **The schema.org `SearchAction` points at `/?s={search_term_string}`**, a
  WordPress search the new site does not have. Left in place — removing it is the
  client's call. Everything the port *adds* to the structured data is additive
  and listed under [SEO](#seo); nothing Yoast wrote was removed.
- `robots.txt` is carried over verbatim and still names `/wp-admin/`. Harmless.
  One line was appended: `Sitemap:`, which the live file omits.
- **Two meta descriptions run past 160 characters** (`/buildings/` at 196,
  `/contact-us/` at 208) and will be truncated in the results page. The client's
  own copy; `bin/check-seo.mjs` warns rather than failing on them.

## Not done here

- No production hostname. That is gate 13.

### Old addresses that do not resolve yet — gate 14

`public/_redirects` covers only what the live site itself redirects: `/favicon.ico`
and the no-trailing-slash form of every route. Everything below still 404s and is
gate 14's job (`wp-18-keep-old-links-working`), published as Cloudflare rules
rather than from this repo:

```
/wp-content/uploads/*        84 media URLs; one prefix rewrite to /images/
/?p=<id>                     the WordPress shortlinks; live 301s, here the
                             query string is ignored and / is served
/feed/, /comments/feed/      the two RSS feeds
/wp-json/*                   52 URLs, including the oembed endpoints
/index.php, date archives, blog pagination, /xmlrpc.php
mixed-case paths             /What-We-Do/ is 200 on WordPress, 404 here —
                             Cloudflare static assets are case-sensitive
```

One more that no redirect can fix from this repo: **`http://` is not upgraded**.
The live site 301s `http://` to `https://`; the `workers.dev` hostname answers
plain HTTP with 200. That is the zone's *Always Use HTTPS* setting, so it lands
with the real hostname at gate 13. The `upgrade-insecure-requests` CSP in
`public/_headers` covers sub-resources in the meantime, not the document itself.

## Pruning

The live site loads the whole WordPress + Elementor + Nicepage stack on every page
regardless of what the page contains. `SHEET_NEEDS` in `tools/build_site.py` says
what markup each sheet exists to style; a sheet is dropped from any page whose DOM
contains none of it. `nicepage.js` (446KB) is emitted only where `u-*` markup
exists, which excludes the two theme pages and the 404.

```
                       sheets   linked payload
Nicepage pages         17 → 4   ~1560KB → ~1230KB   (-21%)
home / what-we-do      17 → 6   ~1580KB → ~1300KB   (-18%)
lookbook               16 → 12   ~864KB →  ~354KB   (-59%)
blog-post-title / 404  16 → 8    ~869KB →  ~236KB   (-73%)
```

Every page still renders pixel-identically to the captured original, so nothing
removed here was doing anything.

**One rule had to be corrected, and it is the interesting one.**
`themes-hello-elementor-style.min.css` looks theme-scoped, but it is the theme's
global element reset — box-sizing and font inheritance for `input`, `button`,
`select`, `textarea`. Dropping it grew the contact-form section by **91px on all
15 Nicepage pages**. The pixel diff caught it immediately; a grep for `site-header`
would not have. It is now always kept, with a comment saying why.

### Why `nicepage.css` itself is not pruned

438KB of the remaining payload is `nicepage.css`, and roughly 172KB of it matches
no class in any page's DOM. It is tempting, and it is **not** safely prunable by
static analysis, because the framework builds class names at runtime:

```js
element.classList.add(this.animationInClass + "-played")   // animation states
t.removeClass(n + " " + a)                                 // "u-nav-popup" + "-right"
```

The decisive case is PhotoSwipe. Four pages have `u-lightbox` galleries; `pswp`
appears 117 times inside `nicepage.js`, and **zero** times in any built page — the
entire lightbox DOM is created on click. "Absent from the DOM" therefore does not
mean "unused", and the failure mode is an invisible broken hover or animation
state that a load-time pixel diff cannot see.

Doing this properly needs coverage measured while *exercising* the site (hover,
click, open the lightbox, run the carousel), not a static scan. The behaviour
suite in `tools/verify/compare-behaviour.cjs` is the start of that harness.
