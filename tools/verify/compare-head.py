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

SKIP = re.compile(r'''rel=['"]?(alternate|shortlink|EditURI|https://api\.w\.org/|pingback|dns-prefetch)
    |name=['"]generator
    |data-intl-tel-input-cdn-path
    |global\.css
    |fonts\.(googleapis|gstatic)
    |rel=['"]?stylesheet
    |charset''', re.X)
ASSET = re.compile(r'https?://(?:www\.)?(?:new\.)?rexdalemobilewash\.ca/(?:wp-content/uploads|images)/')


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
        only_live = [t for t in L if t not in S]
        only_port = [t for t in S if t not in L]
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
