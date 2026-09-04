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
| Images | 110 files, all local under `public/images/` |
| CSS | the live site's own sheets, vendored, in the live load order, pruned per page |
| JS | jQuery 3.7.1 + `nicepage.js` (the menu, carousel, lightbox and parallax need them) |
| Analytics | the same GTM container, `GTM-NMTLRJ63`, with gtm4wp's `dataLayer` push |
| Non-page files | the five Yoast sitemaps, `robots.txt`, `_headers`, `_redirects` |
| Payload | ~1443KB → ~1081KB linked per page (25% smaller); see [Pruning](#pruning) |

Routes: `/`, `/what-we-do/`, `/who-we-service/`, `/buildings/`, `/de-icing-service/`,
`/fleet-washing/`, `/garbage-rooms/`, `/graffiti-removal/`,
`/heavy-equipment-washing/`, `/parking-underground/`, `/storefronts-3/`,
`/water-tanker-service/`, `/about-us/`, `/contact-us/`, `/residential/`,
`/lookbook/`, `/blog-post-title/`, `/author/admin/`.

## Build

```bash
npm install          # do NOT use --omit=optional; it strips the rolldown native binding
npm run build        # 19 pages, every one prerendered
```

The Worker is configured by `wrangler.jsonc`. Host is Cloudflare Workers (AD-1);
the adapter exists so that one on-demand route (`/api/contact`, added at gate 11)
can run, while every page stays a prerendered file.

> **`wrangler.jsonc` diverges from the gate 3 template.** That template sets
> `"main": "./dist/_worker.js/index.js"`. `@astrojs/cloudflare` 14.x builds via
> `@cloudflare/vite-plugin`, which resolves `main` while *reading* the config —
> before the build has produced `dist` — so a dist path fails the build with
> *"doesn't point to an existing file"*. The adapter supplies the entrypoint and
> the assets directory itself. Worth fixing in the gate 3 skill.

## Deployment

**Live at https://rexdalemobilewash.ash-47a.workers.dev**

Cloudflare Workers, account `47a82355…` (Ash@brandingcentres.com), Worker
`rexdalemobilewash`. Workers Builds is connected: push to `main` and Cloudflare
builds and deploys, about a minute end to end.

```
worker .......................... rexdalemobilewash
repo ............................ RexdaleMobileWash-ca/rexdalemobilewash @ main
build ........................... npm run build   deploy: npx wrangler deploy
review hostname ................. rexdalemobilewash.ash-47a.workers.dev
cutover hostname ................ not attached — that is gate 13
workers.dev ..................... enabled (public, not access-gated)
preview URLs .................... disabled
```

### Deploy test, run against the deployed host

```bash
DEPLOY_HOST=https://rexdalemobilewash.ash-47a.workers.dev npm run verify:deploy
```

```
pages 200 ........................ 18 of 18
distinct assets fetched .......... 293   (292 × 200, 1 × 404)
assets on the old server ......... 0     *** the field that matters ***
unknown path ..................... HTTP 404 + ported 404 page
```

The single 404 is `/wp-login.php` on `/blog-post-title/` — the "log in to leave a
reply" link WordPress emitted. A dead link on a placeholder page, not a missing
asset. It disappears if that page is redirected.

`_headers` and `_redirects` cannot be checked from a static file server; they are
read by the Workers asset runtime. `npx wrangler dev` against `dist/client`
serves the real thing (it logs `Parsed N valid redirect rules` / `header rules`
on startup) and is the way to check them without deploying.

### The review URL is public

`rexdalemobilewash.ash-47a.workers.dev` is an unlisted but ungated copy of the
client's site. Nothing links to it and the real domain is untouched, so the
practical risk is low — but it is not private. Two ways to close it when it
matters: put a Cloudflare Access policy in front (needs Zero Trust onboarding on
this account — there is currently no team domain and no identity provider), or
attach a real hostname on an active zone and disable workers.dev.

`*.rexdalemobilewash.ca` cannot be used yet: the zone is on this account but
**pending**, nameservers still at GoDaddy (`ns41/ns42.domaincontrol.com`).
Moving them is gate 6, which also moves the client's MX/SPF records.

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

1. Gate 11 wires the contact form to Resend at `/api/contact` — it is markup only
   today, on 14 pages.
2. Gate 13 attaches the real domain, after the `.ca` zone is active, and with it
   the zone's *Always Use HTTPS* setting; `http://` is not upgraded today.
3. Gate 14 publishes the old-URL redirects. See
   [Old addresses that do not resolve yet](#old-addresses-that-do-not-resolve-yet--gate-14).

## Images

Site images currently ship from `public/images/` in this repo. The stack serves
them from Backblaze B2 through `img.[domain]` (AD-9) — gates 4 to 7.

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

### Still to do
- **Gate 7** — `img.rexdalemobilewash.ca` as a *proxied* Cloudflare CNAME onto
  `f005.backblazeb2.com`, plus the transform rule that scopes the hostname to
  this one bucket. **Blocked**: the zone is still pending, nameservers at GoDaddy.
  Without the transform rule the hostname exposes every public bucket on that
  shared origin, so the rule is not optional.
- Then `PUBLIC_IMG_BASE=https://img.rexdalemobilewash.ca` as a Workers Builds
  **build** variable (not a runtime secret — every page is prerendered, so a
  runtime secret is not read during the build and the URLs come out empty), and
  the image paths swapped over.

**The site must never reference `*.backblazeb2.com`.** That path bypasses
Cloudflare and bills the client for every image view.

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
public/_headers, public/_redirects             edge config; _redirects is generated
```

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
npm run build
npm run verify:no-old-host    # nothing in dist/ points at the WordPress server
npm run verify:header         # header transform, byte-exact
npm run verify                # full render + pixel + behaviour parity, vs the capture
npm run verify:responsive     # horizontal overflow, 320px → 3440px
npm run verify:head           # every <head>, vs the LIVE site
npm run verify:live           # every page rendered side by side, vs the LIVE site
```

The first four compare the port against the **capture**. The last two compare it
against the **live site**, and they exist because those are two different
questions — see [Against the live site](#against-the-live-site).

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
`STAGE=https://… npm run verify:head`.

```
head parity ........... 18/18   tag for tag, once the deliberate
                                /wp-content/uploads/ -> /images/ rewrite and
                                entity/quote spelling are normalised
render vs live ........ 16/18   exact document height on all 18; the two flagged
                                are / and /what-we-do/, on the deliberate
                                differences below (157 tiles inlined vs 20
                                served, and the photo painted as a CSS
                                background rather than an <img>)
pixel vs live ......... 16/18   full-page, byte-identical
outside the feed ...... 18/18   zero differing pixels anywhere on either of
                                those two pages except inside #sbi_images, whose
                                box is identical on both sides (home 150,2405
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

Eleven, all forced, all verified:

1. **The `/lookbook/` gallery is repaired.** Its 8 images were hotlinked from
   `www.new.rexdalemobilewash.ca` — a staging host with **no DNS record at all**,
   so the gallery is broken on the live site right now. The same files exist on
   production, so the port serves those. This is the one place the port looks
   *better* than the original. Its `data-link` attributes, pointing at attachment
   pages on that dead host, were dropped (nothing linked to them).

2. **The Instagram feed is a frozen local snapshot.** Smash Balloon renders
   placeholders and swaps in photos at runtime from signed `cdninstagram.com` URLs
   that expire, via a WordPress AJAX endpoint that will not exist. The 41 images
   were downloaded and the markup points at them directly, so the grid renders
   with no JS and never expires — but **it will not show new posts**. A live feed
   needs a decision (gate 12 territory).

3. **`elementor/css/global.css` is omitted** — it returns **404 on the live site**,
   so it styles nothing today. Reproducing the 404 would be the only alternative.

4. **Dead plugin bootstrap is stripped**: the WooCommerce `star`/`WooCommerce`
   `@font-face` block (0 elements site-wide use it), the CF7 REST config, Smash
   Balloon's `admin-ajax` URL and feed nonce, and a Fast Cache loader config that
   also carried a nonce. The Elementor background-lazyload observer is **kept** —
   4 elements still depend on it.

5. **The Instagram feed carries all 157 posts, not the 20 the page shipped with.**
   The captured page holds one page of the feed; the rest only arrive from the
   plugin's `sbi_load_more_clicked` AJAX endpoint, which dies with the WordPress
   site — and the image URLs inside it are signed and expire sooner than that.
   `tools/harvest-instagram.py` paged through that endpoint once and pulled every
   tile; all 157 are inlined, their photos downloaded to
   `public/images/instagram/`. The page still shows 20 with a working **Load
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

10. **The absolute URLs in head metadata and JSON-LD resolve only after
    cutover.** `canonical`, `og:url`, `og:image`, the schema.org `@id`s and the
    Organization logo keep the production domain on purpose — that is what this
    site will be — while their asset paths move from `/wp-content/uploads/` to
    `/images/`. So `https://www.rexdalemobilewash.ca/images/2020/12/logoclear-1.png`
    is a 404 *today*, because that host is still WordPress, and a 200 the moment
    gate 13 points the domain here. Every one of those files is present under
    `public/images/`, checked. The alternative — pointing them at the
    `workers.dev` hostname — would bake the preview host into the client's
    structured data.

11. **Four response headers are reproduced from `public/_headers`, not from a
    WAF.** `X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection` and
    `Content-Security-Policy: upgrade-insecure-requests` come from Sucuri on the
    live site — a layer that does not exist here — so nothing in the ported
    markup reproduced them and the port shipped with none. The same file
    restores `max-age=86400` on `/images/`, `/css/` and `/js/`, which Cloudflare
    static assets otherwise serve as `max-age=0, must-revalidate`.

## Known issues carried over from the live site

Faithfully reproduced, not introduced here:

- **`/lookbook/` overflows horizontally at every width** (+10px at 320px, +1150px
  at 3440px). The reference render overflows identically. Everything else is clean
  from 320px to 3440px.
- **`/blog-post-title/` is WordPress placeholder copy** ("What goes into a blog
  post?"). It is in the sitemap, so it is ported rather than dropped; gate 14 may
  prefer a redirect.
- **The schema.org `SearchAction` points at `/?s={search_term_string}`**, a
  WordPress search the new site does not have. Left in place — changing structured
  data is the client's call.
- `robots.txt` is carried over verbatim and still names `/wp-admin/`. Harmless.

## Not done here

- **The contact form is markup only** — the largest remaining functional gap
  against the live site, and it does not fail quietly. The markup is
  byte-identical to live, down to `action="/contact-us/#wpcf7-f372-p195-o1"
  method="post"`, but Contact Form 7's JavaScript is not shipped. On the live
  site that JS intercepts the submit and posts to CF7's `wp-json` endpoint, so
  the page never navigates. Here nothing intercepts it, the browser performs the
  native POST, and the Worker answers **405 with an empty body** — a blank error
  page, on 14 pages. Wiring it to Resend at `/api/contact` is **gate 11**
  (`wp-15-connect-contact-form`), which comes before the domain is pointed at
  this site at gate 13, so the public never sees it. Anyone testing the preview
  hostname will.
- **Images are in the repo, not Backblaze.** The stack serves images from
  `img.rexdalemobilewash.ca` (AD-9, gates 4–7). They are local here so the port has
  zero references to the old server; moving them is a path swap under
  `public/images/`.
- No Worker, no hostname, no DNS. That is gates 9–13.

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
