#!/usr/bin/env python3
"""The deploy test: fetch every page from the DEPLOYED host and check asset origins.

    DEPLOY_HOST=https://staging.example.com python3 tools/verify/deploy-check.py

Run it against the deployed hostname, never localhost, and never from a network
that can still reach the old WordPress server. A build whose images still point
at the old host returns 200 for the HTML and looks perfect in a browser that can
reach that host — right up until the old site is switched off.

`assets on the old server` is the field that matters. Any number other than zero
means the old host cannot be retired, whatever else passes.
"""
import os, re, sys, html, collections, urllib.request, urllib.error

BASE = (os.environ.get('DEPLOY_HOST') or '').rstrip('/')
if not BASE:
    sys.exit('set DEPLOY_HOST, e.g. DEPLOY_HOST=https://staging.example.com')

ROUTES = ['/', '/what-we-do/', '/who-we-service/', '/buildings/', '/de-icing-service/',
          '/fleet-washing/', '/garbage-rooms/', '/graffiti-removal/',
          '/heavy-equipment-washing/', '/parking-underground/', '/storefronts-3/',
          '/water-tanker-service/', '/about-us/', '/contact-us/', '/residential/',
          '/lookbook/', '/blog-post-title/']

# asset- and API-shaped references to the site being migrated away from
OLD = re.compile(r'(?:www\.)?(?:new\.)?rexdalemobilewash\.ca/'
                 r'(?:wp-content|wp-includes|wp-json|wp-admin)|cdninstagram')

def get(url, method='GET'):
    req = urllib.request.Request(url, method=method, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b''
    except Exception as e:
        return 0, str(e).encode()

def main():
    pages_ok, seen, bad, foreign = 0, set(), [], []
    status = collections.Counter()

    for route in ROUTES:
        code, body = get(BASE + route)
        if code != 200:
            bad.append((route, 'PAGE ITSELF', code))
            continue
        pages_ok += 1
        text = body.decode('utf-8', 'replace')
        if OLD.search(text):
            foreign.append(route)

        urls = set()
        for m in re.finditer(r'(?:src|href)="([^"]+)"', text):
            u = html.unescape(m.group(1))
            if u.startswith('/') and not u.startswith('//'):
                urls.add(BASE + u)
        for m in re.finditer(r'srcset="([^"]+)"', text):
            for part in html.unescape(m.group(1)).split(','):
                p = part.strip().split(' ')[0]
                if p.startswith('/'):
                    urls.add(BASE + p)

        for u in urls - seen:
            seen.add(u)
            code, _ = get(u, 'HEAD')
            if code in (0, 405):
                code, _ = get(u)
            status[code] += 1
            if code != 200:
                bad.append((route, u[len(BASE):], code))

    code, body = get(BASE + '/definitely-no-such-page/')
    served_404 = 'nothing was found at this location' in body.decode('utf-8', 'replace')

    print(f"pages 200 ........................ {pages_ok} of {len(ROUTES)}")
    print(f"distinct assets fetched .......... {sum(status.values())}")
    print(f"  by status ...................... {dict(status)}")
    print(f"assets on the old server ......... {len(foreign)}"
          f"{'   *** FAIL ***' if foreign else ''}")
    print(f"unknown path ..................... HTTP {code}"
          f"{' + ported 404 page' if served_404 else '  *** no 404 page ***'}")
    if bad:
        print(f"\nnon-200 ({len(bad)}):")
        for r, u, c in bad[:30]:
            print(f"   {c}  {r}  {u}")
    if foreign:
        print("\nPAGES STILL REFERENCING THE OLD SERVER:")
        for r in foreign:
            print("  ", r)
    return 1 if (foreign or pages_ok != len(ROUTES) or code != 404 or not served_404) else 0

if __name__ == '__main__':
    sys.exit(main())
