#!/usr/bin/env python3
"""Cache the Google Fonts the site links to, for offline render comparison.

The comparison must not depend on fonts.googleapis.com being reachable, and both
sides must get byte-identical faces or every text metric drifts and the diff is
meaningless. Writes $PORT_WORK/fontcache/ plus two indexes the browser harness
uses to answer a request for a font stylesheet.

The published site still links Google Fonts exactly as the live site does — this
cache exists only for verification.
"""
import os as _os
_HERE = _os.path.dirname(_os.path.abspath(__file__))          # tools/verify
_ROOT = _os.path.dirname(_os.path.dirname(_HERE))              # repo root
WORK = _os.environ.get('PORT_WORK') or _os.path.join(_ROOT, '.port-work')

import re, os, json, urllib.request, urllib.parse, hashlib, time

FD = os.path.join(WORK, 'fontcache')
os.makedirs(FD, exist_ok=True)
UA = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/120.0 Safari/537.36')          # ask as a browser, so we are served woff2
BASE = os.environ.get('VERIFY_BASE', 'http://127.0.0.1:4321')

def get(u, tries=4):
    for a in range(tries):
        try:
            r = urllib.request.Request(u, headers={'User-Agent': UA})
            with urllib.request.urlopen(r, timeout=60) as x:
                return x.status, x.read()
        except Exception:
            if a == tries - 1:
                return 0, b''
            time.sleep(2 ** a)

def main():
    meta = json.load(open(os.path.join(WORK, 'pages_meta.json')))
    urls = set()
    for d in meta.values():
        urls.update(d['fonts'])

    index, byfam, files = {}, {}, 0
    for u in sorted(urls):
        code, data = get(u)
        if code != 200:
            print(f"  FAIL {code} {u[:90]}")
            continue
        css = data.decode('utf-8', 'replace')
        for fu in sorted(set(re.findall(r'url\((https://fonts\.gstatic\.com/[^)]+)\)', css))):
            name = hashlib.md5(fu.encode()).hexdigest()[:14] + os.path.splitext(fu.split('?')[0])[1]
            dest = os.path.join(FD, name)
            if not os.path.exists(dest):
                c2, d2 = get(fu)
                if c2 != 200:
                    print(f"    font FAIL {c2} {fu[:80]}")
                    continue
                open(dest, 'wb').write(d2)
                files += 1
            # absolute, because the harness fulfils this CSS as if it came from
            # fonts.googleapis.com — a root-relative path would resolve against that host
            css = css.replace(fu, f'{BASE}/__fonts/{name}')
        key = hashlib.md5(u.encode()).hexdigest()[:14] + '.css'
        open(os.path.join(FD, key), 'w', encoding='utf-8').write(css)
        index[u] = '/__fonts/' + key
        fam = urllib.parse.parse_qs(urllib.parse.urlparse(u).query).get('family', [''])[0]
        byfam[fam] = '/__fonts/' + key
        print(f"  ok {len(css):>7}b  {u[:92]}")

    json.dump(index, open(os.path.join(FD, 'index.json'), 'w'), indent=1)
    json.dump(byfam, open(os.path.join(FD, 'byfamily.json'), 'w'), indent=1)
    print(f"\nstylesheets: {len(index)}  font files: {files}")

if __name__ == '__main__':
    main()
