#!/usr/bin/env python3
"""Read-only crawl driven by AgriciDaniel/claude-seo scripts.

Agrici pieces used: sitemap_discovery.py (subprocess), url_safety.safe_requests_get
and parse_html.parse_html (imported). The crawl continues until the frontier is
empty; the real counts are recorded. No credentials are read or sent.
"""
import hashlib, json, subprocess, sys, time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from urllib import robotparser
from urllib.parse import urldefrag, urlparse

agrici, site_id, starts_arg, out = sys.argv[1:5]
starts = [u for u in starts_arg.split(",") if u]
sys.path.insert(0, f"{agrici}/scripts")
import url_safety as us            # noqa: E402
from parse_html import parse_html  # noqa: E402

SAFETY_CEILING = 20000
hosts = {urlparse(u).netloc for u in starts}
out_dir = Path(out)
out_dir.mkdir(parents=True, exist_ok=True)
scripts_run = {"sitemap_discovery.py": False, "url_safety.safe_requests_get": False, "parse_html.parse_html": False}


def norm(u):
    u = urldefrag(u)[0]
    p = urlparse(u)
    if p.scheme not in ("http", "https") or p.netloc not in hosts:
        return None
    return u.rstrip("/") if p.path not in ("", "/") else f"{p.scheme}://{p.netloc}/"


def get(u):
    scripts_run["url_safety.safe_requests_get"] = True
    return us.safe_requests_get(u, timeout=30)


# robots.txt, per host
robots, robots_status = {}, {}
for st in starts:
    h = urlparse(st).netloc
    rp = robotparser.RobotFileParser()
    try:
        r = get(f"{urlparse(st).scheme}://{h}/robots.txt")
        robots_status[h] = r.status_code
        rp.parse(r.text.splitlines() if r.status_code == 200 else [])
    except Exception as e:  # noqa: BLE001
        robots_status[h] = f"error: {type(e).__name__}"
    robots[h] = rp

# sitemap discovery via the Agrici script, per start URL
sitemap = {"found": []}
for st in starts:
    try:
        p = subprocess.run([sys.executable, f"{agrici}/scripts/sitemap_discovery.py", "--json", st],
                           capture_output=True, text=True, timeout=180)
        sitemap["found"] += json.loads(p.stdout or "{}").get("found", [])
        scripts_run["sitemap_discovery.py"] = True
    except Exception as e:  # noqa: BLE001
        sitemap.setdefault("errors", []).append(f"{type(e).__name__}: {e}")

frontier, seen = deque(), set()
sitemap_urls = set()


def read_sitemap(u, depth=0):
    import re
    if depth > 3:
        return
    try:
        x = get(u).text
    except Exception:  # noqa: BLE001
        return
    for loc in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", x):
        if loc.endswith(".xml") and depth < 3:
            read_sitemap(loc, depth + 1)
        elif norm(loc):
            sitemap_urls.add(norm(loc))


for s_ in sitemap.get("found", []):
    su = s_.get("url") if isinstance(s_, dict) else s_
    if su:
        read_sitemap(su)
for u in [norm(x) for x in starts] + sorted(sitemap_urls):
    if u and u not in seen:
        seen.add(u); frontier.append(u)

pages, errors, blocked = [], [], []
while frontier and len(pages) < SAFETY_CEILING:
    u = frontier.popleft()
    if robots_status.get(urlparse(u).netloc) == 200 and not robots[urlparse(u).netloc].can_fetch("*", u):
        blocked.append(u); continue
    try:
        r = get(u)
    except Exception as e:  # noqa: BLE001
        errors.append({"url": u, "error": f"{type(e).__name__}: {e}"}); continue
    rec = {"url": u, "status": r.status_code, "final_url": r.url, "content_type": r.headers.get("content-type", "")}
    if r.status_code == 200 and "html" in rec["content_type"].lower():
        d = parse_html(us.decode_response_text(r) if hasattr(us, "decode_response_text") else r.text, r.url)
        scripts_run["parse_html.parse_html"] = True
        imgs = d.get("images", [])
        rec.update(title=d.get("title"), meta_description=d.get("meta_description"), meta_robots=d.get("meta_robots"),
                   canonical=d.get("canonical"), h1_count=len(d.get("h1", [])), word_count=d.get("word_count"),
                   images=len(imgs), images_missing_alt=sum(1 for i in imgs if not i.get("alt")),
                   schema_blocks=len(d.get("schema", [])), internal_links=len(d["links"]["internal"]))
        for l in d["links"]["internal"]:
            n = norm(l["href"])
            if n and n not in seen:
                seen.add(n); frontier.append(n)
    pages.append(rec)
    time.sleep(0.05)

ok = [p for p in pages if p["status"] == 200 and "title" in p]
summary = {
    "site_id": site_id, "start_urls": starts, "run_at": datetime.now(timezone.utc).isoformat(),
    "agrici_commit": subprocess.run(["git", "-C", agrici, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip(),
    "agrici_scripts_run": [k for k, v in scripts_run.items() if v],
    "frontier_empty": not frontier, "safety_ceiling": SAFETY_CEILING,
    "robots_status": robots_status, "sitemap_urls": len(sitemap_urls),
    "urls_discovered": len(seen), "pages_fetched": len(pages), "html_pages": len(ok),
    "non_200": sum(1 for p in pages if p["status"] != 200), "fetch_errors": len(errors),
    "blocked_by_robots": len(blocked),
    "findings": {
        "missing_title": sum(1 for p in ok if not p.get("title")),
        "missing_meta_description": sum(1 for p in ok if not p.get("meta_description")),
        "missing_canonical": sum(1 for p in ok if not p.get("canonical")),
        "h1_not_exactly_one": sum(1 for p in ok if p.get("h1_count") != 1),
        "noindex_pages": sum(1 for p in ok if "noindex" in (p.get("meta_robots") or "").lower()),
        "images_missing_alt": sum(p.get("images_missing_alt", 0) for p in ok),
        "pages_without_schema": sum(1 for p in ok if not p.get("schema_blocks")),
    },
}
pages_path = out_dir / "agrici-pages.json"
pages_path.write_text(json.dumps({"pages": pages, "errors": errors, "blocked": blocked}, indent=1, sort_keys=True))
summary["pages_sha256"] = hashlib.sha256(pages_path.read_bytes()).hexdigest()
(out_dir / "agrici-summary.json").write_text(json.dumps(summary, indent=1, sort_keys=True))
print(json.dumps(summary, indent=1))
sys.exit(0 if pages else 3)
