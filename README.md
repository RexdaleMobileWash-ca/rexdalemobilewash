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
| CSS | the live site's own sheets, vendored, in the live load order |
| JS | jQuery 3.7.1 + `nicepage.js` (the menu, carousel and parallax need them) |
| Analytics | the same GTM container, `GTM-NMTLRJ63` |

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
pixel diff ............ 17/17   full-page screenshots, byte-identical at 1440px
behaviour ............. 11/11   dropdown open/close (incl. no focus latch after
                                click), 9 submenu routes, carousel, off-canvas
broken images ......... 0
failed requests ....... 0
old-server references . 0
```

Fonts: declared Roboto / Roboto Slab / Open Sans / Audiowide; **computed**
Audiowide on headings and Open Sans on body. Roboto loads but wins on only 2 of
15 pages — the live site ships ~100KB of webfont that renders almost nowhere. Kept
as-is, because this is a clone; see [Worth doing next](#worth-doing-next).

## Deliberate differences

Four, all forced, all verified:

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

## Worth doing next

The clone ships the live site's full payload — ~830KB of CSS and ~535KB of JS
(jQuery + `nicepage.js`) — because trimming during a visual match is how silent
regressions get in. Now that `npm run verify` exists as a pixel-level safety net,
pruning is cheap and safe to attempt: `swiper.min.css` (no swiper markup anywhere),
`block-library` on the Nicepage pages (no `wp-block-` markup), and the Roboto
webfonts that lose the cascade are the obvious candidates. Prune, re-run verify,
keep what stays 17/17.
