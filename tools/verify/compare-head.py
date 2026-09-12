#!/usr/bin/env python3
"""Compare every page's <head> against the LIVE site, tag for tag.

The render harness cannot see this. `run-verify.sh` compares the port against
the captured document *after the same rewrite pass*, so a bug in that pass shows
up identically on both sides and reports a match — and none of the head metadata
is painted on screen anyway, so a pixel diff is blind to all of it. This fetches
the live pages and diffs the head against the built output.

    npm run build
    python3 tools/verify/compare-head.py                      # vs dist/client
    STAGE=https://rexdalemobilewash.ash-47a.workers.dev \\
        python3 tools/verify/compare-head.py                  # vs a deployed host

Three things are normalised, because they are spelling and not meaning:

  * entity encoding — WordPress writes `we&#039;ll`, an HTML serialiser writes
    `we'll`; both parse to the same string. (The bug this tool was written for
    was the *opposite*: `we&amp;#039;ll`, which parses differently. Comparing
    parsed values catches that and ignores the harmless case.)
  * attribute quoting — Yoast emits `name='robots'`, Astro `name="robots"`.
  * the `/wp-content/uploads/` -> `/images/` asset rewrite, which is the one
    deliberate difference in these URLs.

Tags the port drops on purpose are skipped: the WordPress discovery links
(rel=alternate feeds, api.w.org, EditURI, shortlink, pingback), the plugin
`generator` fingerprints, the reCAPTCHA dns-prefetch, the intl-tel-input meta,
elementor global.css (404 on the live site), and the stylesheet links, whose
per-page set the port prunes. See "Deliberate differences" in README.md.

The port also ADDS metadata the live site does not have (see "SEO: what the port
adds" in README.md), so the diff is asymmetric on purpose:

  * a tag on the LIVE side and not on the port side is always a failure — that
    is a regression, and catching it is the whole reason this tool exists;
  * a tag on the PORT side and not on the live side is a failure UNLESS it is
    one of the listed additions in ADDED, a description on one of the four pages
    listed in DESC_OVERRIDDEN, or the robots directive on one of the pages in
    seo-noindex.json, which the port deliberately takes out of the index.

One more asymmetry: every live page emits two competing sets of Open Graph
tags, Nicepage's then Yoast's, so `og:title` and `og:description` each appear
twice with different values. src/seo.config.ts keeps the last. Both sides are
collapsed by the same rule before the diff, so what is compared is the value a
crawler would actually use — which is exactly the value that changed, and the
reason it was worth changing.
"""
import os as _os
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_ROOT = _os.path.dirname(_os.path.dirname(_HERE))

import re, os, sys, html, json, subprocess

LIVE = os.environ.get('LIVE', 'https://www.rexdalemobilewash.ca').rstrip('/')
STAGE = os.environ.get('STAGE', '').rstrip('/')
DIST = os.path.join(_ROOT, 'dist', 'client')
UA = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/120.0 Safari/537.36')

ROUTES = ['/', '/what-we-do/', '/who-we-service/', '/buildings/', '/de-icing-service/',
          '/fleet-washing/', '/garbage-rooms/', '/graffiti-removal/',
          '/heavy-equipment-washing/', '/parking-underground/', '/storefronts-3/',
          '/water-tanker-service/', '/about-us/', '/contact-us/', '/residential/',
          '/lookbook/', '/blog-post-title/', '/author/admin/']

# Metadata the port adds that the live site has no equivalent for. Allowed on
# the port side only; anything else port-only is still reported.
#
#   og:image*                the share card — 17 of the live site's 19 pages
#                            have none (README, "SEO: what the port adds")
#   fonts.googleapis.com     the preconnect the live site omits, same section
#   turnstile-sitekey,       gate 11's bot protection, which has no live
#   challenges.cloudflare…   equivalent because the live forms have none
#                            (README, "Bot protection — four layers")
#
# NB re.X strips literal spaces from the pattern, so every gap between
# attributes has to be written \s+.
ADDED = re.compile(r'''property=["']og:image(:width|:height|:alt)?["']
    |rel=["']preconnect["']\s+href=["']https://fonts\.googleapis\.com["']
    |name=["']turnstile-sitekey["']
    |rel=["']preconnect["']\s+href=["']https://challenges\.cloudflare\.com["']''', re.X)

# The one tag the port drops that is not in SKIP: deliberate difference 12.
# Yoast points /author/admin/'s og:image at secure.gravatar.com — the single
# image address on the site that is not the client's, which the AD-9 check
# refuses. The port serves the logo Yoast itself names as the organisation's
# logo in the JSON-LD on that same page.
DROPPED = re.compile(
    r'''property=["']og:image["']\s+content=["']https://secure\.gravatar\.com''', re.X)

# The four pages whose meta description the port rewrites, and why. Every other
# page keeps Yoast's description exactly. See DESCRIPTIONS in src/seo.config.ts.
DESC_OVERRIDDEN = {
    '/water-tanker-service/',   # live carries /de-icing-service/'s, word for word
    '/lookbook/',               # live has none
    '/blog-post-title/',        # live has none
    '/author/admin/',           # live has none
}

# Pages the port takes OUT of the index that the live site leaves in. Read from
# seo-noindex.json rather than listed again here, so this tool and the two things
# that act on the list cannot drift apart. The routes are derived from the slugs
# the same way gen_pages.py derives them: 'author-admin' serves at /author/admin/.
_SLUG_ROUTE = {'home': '/', 'author-admin': '/author/admin/'}
ROBOTS_OVERRIDDEN = {
    _SLUG_ROUTE.get(s, f'/{s}/')
    for s in json.load(open(os.path.join(_ROOT, 'seo-noindex.json')))['slugs']
}

# Open Graph properties that may hold only one value, so a second is a bug.
SINGLE_OG = ('og:title', 'og:description', 'og:url', 'og:type', 'og:site_name',
             'og:locale')

SKIP = re.compile(r'''rel=['"]?(alternate|shortlink|EditURI|https://api\.w\.org/|pingback|dns-prefetch)
    |name=['"]generator
    |data-intl-tel-input-cdn-path
    |global\.css
    |fonts\.(googleapis|gstatic)
    |rel=['"]?stylesheet
    |charset''', re.X)
# Fold every spelling of "this site's own media library" to one form, so the diff is
# about the tags rather than about the AD-9 move. Live writes
# www.rexdalemobilewash.ca/wp-content/uploads/, the port writes the image host.
IMG_HOST = json.load(open(os.path.join(_ROOT, 'image-hosts.json')))['canonical']
ASSET = re.compile(r'https?://(?:' + re.escape(IMG_HOST) + r'|(?:www\.)?(?:new\.)?'
                   r'rexdalemobilewash\.ca/(?:wp-content/uploads|images))/')


def get(url):
    # curl, not urllib: only curl reads this session's proxy configuration
    r = subprocess.run(['curl', '-s', '--compressed', '-m', '90', '-A', UA, url],
                       capture_output=True)
    return r.stdout.decode('utf-8', 'replace')


def stage_doc(route):
    if STAGE:
        return get(STAGE + route)
    p = os.path.join(DIST, 'index.html') if route == '/' else \
        os.path.join(DIST, route.strip('/'), 'index.html')
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


def norm(t):
    t = html.unescape(t).replace(' ', ' ')
    t = ASSET.sub('/images/', t)
    t = re.sub(r'\s+', ' ', t)
    t = re.sub(r"(\w+)='([^']*)'", lambda m: f'{m.group(1)}="{m.group(2)}"', t)
    return t.strip()


def tags(doc):
    end = doc.find('</head>')
    if end < 0:
        return None
    head, out = doc[:end], []
    for m in re.finditer(r'<(?:meta|link)\b[^>]*>', head):
        t = m.group(0)
        if SKIP.search(t):
            continue
        out.append(norm(t.replace(' />', '>').replace('/>', '>')))
    ti = re.search(r'<title>(.*?)</title>', head, re.S)
    if ti:
        out.append('<title>' + norm(ti.group(1)) + '</title>')
    return collapse_og(out)


def collapse_og(tags):
    """Keep the last value of each single-value og: property, in first position.

    The same rule src/seo.config.ts applies to the port, applied to both sides
    so the comparison is about the value a crawler ends up with rather than
    about how many times WordPress wrote one.
    """
    last, out, seen = {}, [], set()
    for t in tags:
        p = re.search(r'property="(og:[a-z_]+)"', t)
        if p and p.group(1) in SINGLE_OG:
            last[p.group(1)] = t
    for t in tags:
        p = re.search(r'property="(og:[a-z_]+)"', t)
        if not p or p.group(1) not in SINGLE_OG:
            out.append(t)
            continue
        if p.group(1) in seen:
            continue
        seen.add(p.group(1))
        out.append(last[p.group(1)])
    return out


def main():
    where = STAGE or 'dist/client'
    print(f'live {LIVE}\nport {where}\n')
    bad = 0
    for r in ROUTES:
        L, S = tags(get(LIVE + r)), tags(stage_doc(r))
        if L is None or S is None:
            bad += 1
            print(f'  FAIL  {r:<28} {"live" if L is None else "port"} returned no <head>')
            continue
        is_desc = lambda t: t.startswith('<meta name="description"')
        is_robots = lambda t: t.startswith('<meta name="robots"')
        drops = []
        if r in DESC_OVERRIDDEN:
            drops.append(is_desc)
        if r in ROBOTS_OVERRIDDEN:
            # Both sides are dropped, not just the port's: the live value is
            # `index, follow` and the port's is `noindex, follow`, so leaving
            # either in place reports the deliberate difference as a regression.
            drops.append(is_robots)
        drop = lambda t: any(f(t) for f in drops)

        only_live = [t for t in L if t not in S and not drop(t) and not DROPPED.search(t)]
        only_port = [t for t in S if t not in L and not ADDED.search(t) and not drop(t)]
        if only_live or only_port:
            bad += 1
            print(f'  DIFF  {r}')
            for t in only_live:
                print(f'          only live : {t[:170]}')
            for t in only_port:
                print(f'          only port : {t[:170]}')
        else:
            print(f'  match {r:<28} {len(L)} tags')
    print(f'\n{len(ROUTES)-bad}/{len(ROUTES)} heads match')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
