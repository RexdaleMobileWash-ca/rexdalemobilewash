#!/usr/bin/env python3
"""Fetch every image address in dist/ and prove the image host actually serves it.

    python3 tools/verify/image-urls-live.py [dist-dir]

bin/check-images.mjs answers a different question: is the HOST right. It is a string
check over the build output and it never opens a socket, so a typo'd path, a file gate
5 missed, or a transform rule scoping the hostname to the wrong bucket all pass it
cleanly and 404 for every visitor. This is the other half.

Exit 0 = every address returns an image. Exit 1 = the swap is not safe to ship.

Entities are decoded before the URL is used: hero backgrounds are written as
`style="…url(&quot;https://…&quot;)"`, and a naive extractor carries `&quot;` into the
request and gets a 400 that looks like a missing file.
"""
import os, re, sys, html, subprocess, collections
from concurrent.futures import ThreadPoolExecutor

HOST_RE = None          # set from image-hosts.json
SCAN = re.compile(r'\.(html|css|xml|js|mjs|json|txt|webmanifest)$', re.I)


def urls_in(root):
    out = set()
    for dp, _, names in os.walk(root):
        for n in names:
            if not SCAN.search(n):
                continue
            text = html.unescape(open(os.path.join(dp, n), encoding='utf-8',
                                      errors='replace').read())
            out |= set(HOST_RE.findall(text))
    return {u.rstrip('.,;') for u in out}


def probe(url):
    # -r 0-0 asks for one byte: the status and content-type are what matter, and the
    # whole set is ~200MB otherwise.
    r = subprocess.run(['curl', '-sS', '-o', '/dev/null', '-r', '0-0',
                        '-w', '%{http_code} %{content_type}', url],
                       capture_output=True, text=True).stdout.split(None, 1)
    return url, (r[0] if r else '000'), (r[1].strip() if len(r) > 1 else '')


def main():
    global HOST_RE
    import json
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    host = json.load(open(os.path.join(root, 'image-hosts.json')))['canonical']
    HOST_RE = re.compile(r'https://' + re.escape(host) + r'/[^"\'\s)\\<>]+')

    dist = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, 'dist')
    urls = sorted(urls_in(dist))
    print(f"\nIMAGE REACHABILITY — {host}\n")
    print(f"  {'distinct addresses in dist ':.<36} {len(urls)}")
    if not urls:
        print("\n  no addresses found — that is itself wrong")
        return 1

    with ThreadPoolExecutor(20) as ex:
        res = list(ex.map(probe, urls))

    codes = collections.Counter(c for _, c, _ in res)
    ok = [r for r in res if r[1] in ('200', '206') and r[2].startswith('image/')]
    bad = [r for r in res if r not in ok]
    print(f"  {'served as an image ':.<36} {len(ok)}")
    print(f"  {'not served, or not an image ':.<36} {len(bad)}")
    print(f"  {'status codes ':.<36} {dict(codes)}")
    if bad:
        print("\nFAILING ADDRESSES:")
        for u, c, ct in bad:
            print(f"  {c}  {ct or '-':<24} {u}")
    print('\nRESULT: ' + ('FAIL — the image swap is not safe to ship' if bad
                          else f'PASS — all {len(ok)} addresses serve an image'))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
