#!/usr/bin/env python3
"""Post-launch check (gate 15): every old WordPress address, the live image check and the
live SEO check, all against https://www.rexdalemobilewash.ca rather than dist/.
Run from the repo root:  python3 tools/verify/post-launch-check.py . <outdir>
Writes <outdir>/rexdalemobilewash.ca-sweep.tsv and prints the three blocks."""
import json, re, subprocess, sys, tarfile, html as htmlmod
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urljoin, urlparse

REPO, OUT = Path(sys.argv[1]), Path(sys.argv[2])
W = "https://www.rexdalemobilewash.ca"
IMG = "img.rexdalemobilewash.ca"
CAP = REPO / "tools/capture"

def curl(url, follow=False):
    """One request. Returns (status, location, headers_text, body)."""
    args = ["curl", "-sS", "--max-time", "30", "-D", "-", "-o", "-", url]
    r = subprocess.run(args, capture_output=True)
    raw = r.stdout
    # strip the proxy's CONNECT preamble, keep the last header block
    blocks = raw.split(b"\r\n\r\n")
    i = 0
    while i < len(blocks) - 1 and blocks[i].startswith(b"HTTP/1.1 200 Connection Established"):
        i += 1
    head = blocks[i].decode("latin-1") if i < len(blocks) else ""
    body = b"\r\n\r\n".join(blocks[i + 1:])
    m = re.match(r"HTTP/\S+ (\d+)", head)
    loc = re.search(r"(?im)^location:\s*(\S+)", head)
    return (int(m.group(1)) if m else 0, loc.group(1) if loc else "", head, body)

# ---------------------------------------------------------------- the address list
addrs = []
def add(u, kind):
    u = u.strip()
    if u.startswith("data:"):          # inline images Yoast wrote into <image:loc>; not addresses
        return
    if u.startswith("/"):
        u = W + u
    u = re.sub(r"^https?://(www\.)?rexdalemobilewash\.ca", W, u)
    addrs.append((u, kind))

for f in sorted((CAP / "sitemaps").glob("*.xml")):
    t = f.read_text()
    for u in re.findall(r"<loc>([^<]+)</loc>", t):
        add(u, "page" if "sitemap" not in u else "sitemap")
    for u in re.findall(r"<image:loc>([^<]+)</image:loc>", t):
        add(u, "image")
add("/sitemap_index.xml", "sitemap")
for p in json.loads((CAP / "media_final.json").read_text()):
    add("/" + p.lstrip("/"), "image")
for line in (CAP / "rclone-rexdalemobilewash.ca-20260903T190644Z.log").read_text().splitlines():
    m = re.search(r"INFO\s+:\s+(.+?): Copied", line)
    if m:
        add("/wp-content/uploads/" + m.group(1), "image")
for p in ["/feed/", "/comments/feed/", "/index.php", "/favicon.ico", "/robots.txt",
          "/What-We-Do/", "/Contact-Us/", "/2020/12/", "/page/2/", "/category/uncategorized/"]:
    add(p, "wp-only")
for p in ["/", "/fleet-washing/", "/contact-us/"]:
    addrs.append(("https://rexdalemobilewash.ca" + p, "apex"))
    addrs.append(("http://www.rexdalemobilewash.ca" + p, "http"))

seen, uniq = set(), []
for u, k in addrs:
    if u not in seen:
        seen.add(u); uniq.append((u, k))

def sweep(item):
    url, kind = item
    hops, cur = [], url
    for _ in range(6):
        st, loc, _, _ = curl(cur)
        hops.append(st)
        if st in (301, 302, 303, 307, 308) and loc:
            cur = urljoin(cur, loc)
            continue
        break
    first, final = hops[0], hops[-1]
    if first == 200:
        v = "OK"
    elif first in (301, 302, 303, 307, 308):
        if any(h in (302, 303, 307, 308) for h in hops[:-1]):
            v = "TEMP-REDIRECT"
        elif final == 200:
            v = "OK"
        else:
            v = "REDIRECT-BROKEN"
    else:
        v = "FAIL"
    return (v, kind, url, " -> ".join(map(str, hops)), cur)

with ThreadPoolExecutor(16) as ex:
    results = list(ex.map(sweep, uniq))

with open(OUT / "rexdalemobilewash.ca-sweep.tsv", "w") as fh:
    fh.write("verdict\tkind\taddress\thops\tlanded\n")
    for r in sorted(results):
        fh.write("\t".join(r) + "\n")

n200 = sum(1 for r in results if r[0] == "OK" and r[3] == "200")
n301 = sum(1 for r in results if r[0] == "OK" and r[3] != "200")
bad = [r for r in results if r[0] != "OK"]
kinds = {}
for r in results:
    kinds[r[1]] = kinds.get(r[1], 0) + 1
P = lambda l, n: print(f"  {(l + ' ').ljust(36, '.')} {n}")
print("\nADDRESS SWEEP —", W)
P("addresses in the list", len(results))
for k, n in sorted(kinds.items()):
    P(f"  of which {k}", n)
P("200 direct", n200)
P("301 -> 200", n301)
P("FAILED", len(bad))
if bad:
    print("\nFAILURES, BY ADDRESS:")
    for v, k, u, h, landed in bad:
        print(f"  {u.replace(W, '')}   {h}   {v}")

# ---------------------------------------------------------------- live image check
pages = sorted({urlparse(u).path for u, k in uniq if k == "page"}) + ["/this-page-does-not-exist/"]
PATTERNS = [
    (r'<img\b[^>]*?\ssrc\s*=\s*["\']([^"\']+)', "img src"),
    (r'\ssrcset\s*=\s*["\']([^"\']+)["\']', "srcset"),
    (r'<source\b[^>]*?\ssrc\s*=\s*["\']([^"\']+)', "source"),
    (r'<link\b[^>]*?as=["\']image["\'][^>]*?href\s*=\s*["\']([^"\']+)', "preload"),
    (r'(?:og:image|twitter:image)["\'][^>]*?content\s*=\s*["\']([^"\']+)', "social"),
    (r'rel=["\'][^"\']*(?:icon|apple-touch-icon)[^"\']*["\'][^>]*?href\s*=\s*["\']([^"\']+)', "icon"),
    (r'url\(\s*["\']?([^"\')]+?)["\']?\s*\)', "css url()"),
    (r'"(?:image|logo|thumbnailUrl|contentUrl)"\s*:\s*"([^"]+)"', "json-ld"),
]
IMG_EXT = re.compile(r"\.(avif|webp|png|jpe?g|gif|svg|ico|bmp|tiff?)(?:[?#]|$)", re.I)
served = {}
def fetch_page(p):
    st, _, head, body = curl(W + p)
    return p, st, head, body.decode("utf-8", "replace")
with ThreadPoolExecutor(8) as ex:
    for p, st, head, body in ex.map(fetch_page, pages):
        served[p] = (st, head, body)
css_urls = set()
for p, (st, head, body) in served.items():
    for h in re.findall(r'<link\b[^>]*rel=["\']stylesheet["\'][^>]*href=["\']([^"\']+)', body):
        css_urls.add(urljoin(W + p, htmlmod.unescape(h)))
docs = {p: b for p, (s, h, b) in served.items()}
for cu in sorted(css_urls):
    if urlparse(cu).netloc == "www.rexdalemobilewash.ca":
        docs[cu] = curl(cu)[3].decode("utf-8", "replace")

total = on_img = 0; off = []; local = []; wp_refs = []
for name, text in docs.items():
    base = W + name if name.startswith("/") else name
    if re.search(r"/wp-(content|includes|json|admin)/|wp-login\.php", text):
        wp_refs += sorted(set(re.findall(r"[^\s\"'<>()]*(?:/wp-(?:content|includes|json|admin)/|wp-login\.php)[^\s\"'<>()]*", text)))[:3]
    for rx, kind in PATTERNS:
        for m in re.finditer(rx, text, re.I):
            for raw in m.group(1).split(","):
                u = htmlmod.unescape(raw.strip().split(" ")[0]) if raw.strip() else ""
                if not u or re.match(r"(data:|blob:|mailto:|tel:|#)", u, re.I):
                    continue
                absu = urljoin(base, u)
                host = urlparse(absu).netloc.lower()
                if kind == "css url()" and not IMG_EXT.search(absu):
                    continue
                if host == IMG:
                    total += 1; on_img += 1
                elif host == "www.rexdalemobilewash.ca":
                    if IMG_EXT.search(absu):
                        total += 1; local.append((name, kind, absu))
                else:
                    if IMG_EXT.search(absu) or kind in ("img src", "srcset", "social", "json-ld"):
                        total += 1; off.append((name, kind, absu))

st, _, ih, _ = curl(f"https://{IMG}/2023/12/Rexdale-Mobile-Wash-Logo-Updated-23.webp")
st2, _, ih2, _ = curl(f"https://{IMG}/2023/12/Rexdale-Mobile-Wash-Logo-Updated-23.webp")
cache = re.search(r"(?im)^cf-cache-status:\s*(\S+)", ih2)
oob, _, _, _ = curl(f"https://{IMG}/b2api/v2/b2_list_buckets")
print("\nLIVE IMAGE CHECK")
P("pages fetched", len(served))
P("stylesheets fetched", len(docs) - len(served))
P("image references", total)
P(f"  on {IMG}", on_img)
P("  local on www (not in the bucket)", len(local))
P("  off-host", len(off))
P("references to WordPress paths", len(set(wp_refs)))
P("img sample fetch", st)
P("  cf-cache-status (2nd fetch)", cache.group(1) if cache else "ABSENT")
P("  out-of-bucket path", oob)
for x in off[:20]:
    print("   OFF-HOST", *x)
for x in sorted(set((k, u) for _, k, u in local))[:10]:
    print("   LOCAL", *x)
for x in sorted(set(wp_refs))[:10]:
    print("   WP-PATH", x)

# ---------------------------------------------------------------- live SEO check
canon_ok = 0; canon_bad = []; ld_blocks = 0; ld_bad = []; robots_bad = []
for p, (st, head, body) in served.items():
    if p == "/this-page-does-not-exist/":
        continue
    c = re.search(r'<link[^>]+rel=["\']canonical["\'][^>]+href=["\']([^"\']+)', body)
    want = W + p
    if c and c.group(1) == want:
        canon_ok += 1
    else:
        canon_bad.append((p, c.group(1) if c else None))
    for b in re.findall(r'<script[^>]+application/ld\+json[^>]*>([\s\S]*?)</script>', body, re.I):
        ld_blocks += 1
        try:
            json.loads(b)
        except Exception as e:
            ld_bad.append((p, str(e)[:80]))
    rb = re.search(r'<meta name="robots" content="([^"]+)"', body)
    xr = re.search(r"(?im)^x-robots-tag:\s*(.+)$", head)
    if (rb and "noindex" in rb.group(1)) or (xr and "noindex" in xr.group(1)):
        robots_bad.append(p)

# sitemaps as served
sm_status, _, _, sm_body = curl(W + "/sitemap_index.xml")
children = re.findall(r"<loc>([^<]+)</loc>", sm_body.decode())
sm_urls, sm_fail = [], []
for ch in children:
    cst, _, _, cb = curl(ch)
    if cst != 200:
        sm_fail.append((ch, cst))
    sm_urls += re.findall(r"<url>\s*<loc>([^<]+)</loc>", cb.decode())
with ThreadPoolExecutor(8) as ex:
    sm_res = list(ex.map(lambda u: (u, curl(u)[0]), sm_urls))
sm_off = [u for u in sm_urls if not u.startswith(W + "/")]
sm_non200 = [(u, s) for u, s in sm_res if s != 200]
xsl_st, _, xsl_head, _ = curl(W + "/sitemap.xsl")
xsl_ct = re.search(r"(?im)^content-type:\s*(.+?)\s*$", xsl_head)
rt = curl(W + "/robots.txt")[3].decode()

# verification tokens: old <head> (captured) vs live
VER = re.compile(r'<meta[^>]+name=["\']([^"\']*(?:verification|verify|msvalidate|ahrefs|validate)[^"\']*)["\'][^>]*content=["\']([^"\']+)', re.I)
old_tokens = set()
with tarfile.open(CAP / "live-capture-2026-09-03.tar.gz") as tf:
    for m in tf.getmembers():
        if m.isfile() and m.name.endswith(".html"):
            old_tokens |= set(VER.findall(tf.extractfile(m).read().decode("utf-8", "replace")))
new_tokens = set()
for p, (st, head, body) in served.items():
    new_tokens |= set(VER.findall(body))
gtm_old = "GTM-NMTLRJ63"
gtm_live = sum(1 for p, (s, h, b) in served.items() if gtm_old in b)

print("\nLIVE SEO CHECK")
P("canonical on the real domain", f"{canon_ok} of {len(served) - 1}")
P("JSON-LD blocks", ld_blocks)
P("  parse", ld_blocks - len(ld_bad))
P("pages noindexed (meta or header)", len(robots_bad))
P("sitemap index", f"{sm_status}, {len(children)} child sitemaps")
P("sitemap addresses returning 200", f"{len(sm_res) - len(sm_non200)} of {len(sm_res)}")
P("sitemap addresses off the domain", len(sm_off))
P("sitemap.xsl", f"{xsl_st} {xsl_ct.group(1) if xsl_ct else ''}")
P("robots.txt Sitemap line", "yes" if re.search(r"(?im)^sitemap:\s*https://www\.rexdalemobilewash\.ca/", rt) else "NO")
P("verification tokens, old site", len(old_tokens))
P("verification tokens, live", f"{len(old_tokens & new_tokens)} of {len(old_tokens)}")
P(f"GTM {gtm_old} on live pages", f"{gtm_live} of {len(served)}")
for x in canon_bad: print("   CANONICAL", *x)
for x in ld_bad: print("   JSON-LD", *x)
for x in robots_bad: print("   NOINDEX", x)
for x in sm_fail + sm_non200: print("   SITEMAP", *x)
for x in sorted(old_tokens - new_tokens): print("   TOKEN MISSING", *x)
print("   old tokens:", sorted(old_tokens))
