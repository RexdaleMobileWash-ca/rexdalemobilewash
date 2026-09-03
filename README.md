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
| Pages | 17 routes + a ported 404 |
| Source design | Nicepage 8.6.2 (15 pages) and the hello-elementor theme (2 pages + 404) |
| Images | 110 files, all local under `public/images/` |
| CSS | the live site's own sheets, vendored, in the live load order, pruned per page |
| JS | jQuery 3.7.1 + `nicepage.js` (the menu, carousel, lightbox and parallax need them) |
| Analytics | the same GTM container, `GTM-NMTLRJ63` |
| Payload | ~1443KB → ~1081KB linked per page (25% smaller); see [Pruning](#pruning) |

Routes: `/`, `/what-we-do/`, `/who-we-service/`, `/buildings/`, `/de-icing-service/`,
`/fleet-washing/`, `/garbage-rooms/`, `/graffiti-removal/`,
`/heavy-equipment-washing/`, `/parking-underground/`, `/storefronts-3/`,
`/water-tanker-service/`, `/about-us/`, `/contact-us/`, `/residential/`,
`/lookbook/`, `/blog-post-title/`.

## Build

```bash
npm install          # do NOT use --omit=optional; it strips the rolldown native binding
npm run build        # 18 pages, every one prerendered
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

Deployed to Cloudflare Workers on the account `47a82355…` (Ash@brandingcentres.com)
as the Worker **`rexdalemobilewash`**.

```
worker .......................... rexdalemobilewash
repo ............................ RexdaleMobileWash-ca/rexdalemobilewash @ main
version ......................... 24a2078c-646a-4744-981d-daa932228c88
preview hostname attached ....... NONE — see below
cutover hostname ................ not attached (that is gate 13)
workers.dev ..................... disabled
preview URLs .................... disabled
```

**It currently has no reachable hostname, on purpose.** The two candidates both
need a decision that has not been made:

- `*.rexdalemobilewash.ca` — the zone is on this account but **pending**: its
  nameservers are still GoDaddy (`ns41/ns42.domaincontrol.com`), so Cloudflare is
  not authoritative and cannot create the record or issue the certificate. Moving
  them is gate 6, which also moves the client's MX/SPF records.
- `workers.dev` behind Cloudflare Access — the account has **no Zero Trust
  organisation and no identity providers**, so there is nothing to authenticate
  against. Onboarding it means choosing an account-wide team domain.

Until one is settled, a hostname on an already-active zone on this account
(`brandingcentres.com`, `briansmasonry.net`, …) is the shortest path to a
reviewable URL — the same shape as `staging.briansmasonry.net`.

### The trap in this config

`@astrojs/cloudflare` resolves `wrangler.jsonc` at **build** time into
`dist/client/wrangler.json`, and that generated file is what `wrangler deploy`
reads. Editing `wrangler.jsonc` without rebuilding deploys the *previous* build's
settings. That is not cosmetic: `workers_dev` and `preview_urls` default to
**enabled**, so a stale config publishes the client's unapproved site. It happened
once during this deploy and was closed within about two minutes.

Always `npm run build` before `npx wrangler deploy`, and verify after:

```bash
curl -s -H "Authorization: Bearer $CF_API_TOKEN" \
  https://api.cloudflare.com/client/v4/accounts/$ACC/workers/scripts/rexdalemobilewash/subdomain
# expect {"enabled": false, "previews_enabled": false}
```

### Still to do

1. **Connect Workers Builds** — dashboard only, cannot be done from here. Install
   the *Cloudflare Workers and Pages* GitHub App on the **RexdaleMobileWash-ca**
   org, scoped to this repo, then Workers & Pages → `rexdalemobilewash` →
   Settings → Builds → Connect: branch `main`, build `npm run build`, deploy
   `npx wrangler deploy`, root directory blank.
2. Attach a preview hostname once chosen.
3. Gate 11 wires the contact form; only then does gate 13 attach the real domain.

### Deploy test, run against the deployed host

```
pages 200 ....................... 17 of 17
distinct assets fetched ......... 154   (153 × 200, 1 × 404)
assets served by the old domain .. 0     *** the field that matters ***
unknown path .................... 404 + the ported 404 page
```

The single 404 is `/wp-login.php` on `/blog-post-title/` — the "log in to leave a
reply" link WordPress emitted. It is a dead link on a placeholder page, not a
missing asset.

## How the port is structured

Everything under `src/html/`, `src/nav-active.json` and `public/css/page-*.css`
is **generated**. Edit the pipeline in `tools/`, not the output.

```
tools/capture/live-capture-2026-09-03.tar.gz   the 17 captured pages + the 404
tools/run-port.sh                              regenerate the port from that capture
src/layouts/SiteBase.astro                     the document shell
src/components/Header.astro                    one header + the active-state transform
src/components/Footer.astro                    one footer, byte-identical everywhere
src/html/<slug>.content.html                   each page's markup, injected with set:html
public/css/page-<slug>.css                     each page's own inline CSS, hoisted out
public/css/vendor/                             the live site's stylesheets, verbatim
```

**The capture is the source of truth.** The live WordPress site is switched off at
gate 16, after which it cannot be re-fetched — so the capture is committed, not
just the scripts that consumed it.

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
npm run verify                # full render + pixel + behaviour parity
npm run verify:responsive     # horizontal overflow, 320px → 3440px
```

`npm run verify` renders each **original captured document** and the **built page**
in the same Chromium, from the same local assets and the same cached fonts, and
compares them. Both sides are served at *identical route paths* — that is not
cosmetic: `nicepage.js` marks the current nav link and its dropdown parent
`active` by matching `location.pathname` against the menu hrefs, so a reference
served at any other path silently diverges and makes a correct port look broken.

Results at the time of writing:

```
render parity ......... 17/17   computed styles, section geometry, element
                                counts, internal links, body class, text
                        17/17   again at 390px
pixel diff ............ 17/17   full-page screenshots, byte-identical at 1440px
                        16/17   at 390px; the 17th is /about-us/, whose 19-frame
                                animated GIF lands on a different frame. Its
                                element geometry is identical (x75 y877 153x114)
                                and the differing pixels lie inside that box.
behaviour ............. 16/16   dropdown open/close (incl. no focus latch after
                                click), 9 submenu routes, carousel, off-canvas,
                                PhotoSwipe lightbox opens
header transform ...... 15/15   model AND built pages, byte-exact
broken images ......... 0
failed requests ....... 0
old-server references . 0
```

Re-run at another width with `VERIFY_WIDTH=390 node tools/verify/compare-render.cjs`
then `PIX_TAG=.390 python3 tools/verify/pixel-diff.py`.

Fonts: declared Roboto / Roboto Slab / Open Sans / Audiowide; **computed**
Audiowide on headings and Open Sans on body. Roboto loads but wins on only 2 of
15 pages — the live site ships ~100KB of webfont that renders almost nowhere. Kept
as-is: the Google Fonts links are copied from the live site verbatim.

## Deliberate differences

Five, all forced, all verified:

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

5. **The empty trailing `<div class="u-body">` is dropped.** The live site emits
   one after the footer, inside `.nicepage-container`. It renders nothing, but
   `nicepage.js` builds a hidden PhotoSwipe template per `.u-body`, so the live
   site initialises one more than it needs. Visible behaviour is unchanged:
   exactly one lightbox opens on both sides.

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

- **The contact form is markup only.** It appears on 14 pages and currently posts
  nowhere. Wiring it to Resend at `/api/contact` is **gate 11**
  (`wp-15-connect-contact-form`) — deliberately not done, and it comes before the
  domain is pointed at this site at gate 13.
- **Images are in the repo, not Backblaze.** The stack serves images from
  `img.rexdalemobilewash.ca` (AD-9, gates 4–7). They are local here so the port has
  zero references to the old server; moving them is a path swap under
  `public/images/`.
- No Worker, no hostname, no DNS. That is gates 9–13.

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
