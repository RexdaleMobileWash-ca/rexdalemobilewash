#!/usr/bin/env python3
"""Prove the Header component reproduces every captured header byte-for-byte.

Every page on the live site served one header that differed ONLY in WordPress's
active-state classes. src/html/_header.neutral.html is that markup with the
active state stripped; Header.astro puts it back for the current page.

This checks the round trip two ways:
  1. the Python transform against each captured header (the model), and
  2. the BUILT pages against each captured header (the shipped TypeScript port),
     which is what actually runs.

The second is the one that matters — a divergence there means the component's
regexes drifted from the model.
"""
import os as _os
_HERE = _os.path.dirname(_os.path.abspath(__file__))          # tools/verify
_ROOT = _os.path.dirname(_os.path.dirname(_HERE))              # repo root
WORK = _os.environ.get('PORT_WORK') or _os.path.join(_ROOT, '.port-work')
REPO_ROOT = _os.environ.get('PORT_REPO') or _ROOT

import re, sys, json, glob, os, difflib
sys.path.insert(0, os.path.join(REPO_ROOT, 'tools'))
from header_apply import apply_active                       # noqa: E402
import build_site as B                                      # noqa: E402

NEUTRAL = open(os.path.join(WORK, 'header.neutral.html'), encoding='utf-8').read()
MODEL = json.load(open(os.path.join(WORK, 'header_model.json')))

def header_of(path):
    t = open(path, encoding='utf-8', errors='replace').read()
    i, j = t.find('<header'), t.find('</header>')
    return t[i:j + len('</header>')] if i >= 0 and j > i else None

def show(orig, gen, label):
    a = re.sub(r'>\s*<', '>\n<', orig).splitlines()
    b = re.sub(r'>\s*<', '>\n<', gen).splitlines()
    for l in list(difflib.unified_diff(a, b, 'captured', label, n=0))[:12]:
        print('        ' + l[:190])

def main():
    ok = fail = 0
    print('model transform vs captured headers')
    for slug, (mi, pi, anc) in sorted(MODEL.items()):
        orig = header_of(os.path.join(WORK, 'pages', slug + '.html'))
        gen = apply_active(NEUTRAL, mi, pi, anc)
        if gen == orig:
            ok += 1
        else:
            fail += 1
            print(f'  DIFFER {slug}')
            show(orig, gen, 'model')

    print(f'  {ok}/{ok + fail} byte-exact')

    dist = os.path.join(REPO_ROOT, 'dist', 'client')
    if not os.path.isdir(dist):
        print('\nbuilt pages: dist/ missing — run npm run build to check the shipped component')
        return 0 if fail == 0 else 1

    print('\nbuilt pages vs captured headers')
    ok2 = fail2 = 0
    for slug in sorted(MODEL):
        route = '' if slug == 'home' else slug + '/'
        built_path = os.path.join(dist, route, 'index.html')
        if not os.path.exists(built_path):
            print(f'  MISSING {slug}')
            fail2 += 1
            continue
        captured = B.rewrite(header_of(os.path.join(WORK, 'pages', slug + '.html')))
        built = header_of(built_path)
        if captured == built:
            ok2 += 1
        else:
            fail2 += 1
            print(f'  DIFFER {slug}')
            show(captured, built, 'built')
    print(f'  {ok2}/{ok2 + fail2} byte-exact')
    return 0 if (fail == 0 and fail2 == 0) else 1

if __name__ == '__main__':
    sys.exit(main())
