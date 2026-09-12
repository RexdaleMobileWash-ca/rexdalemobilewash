#!/usr/bin/env python3
"""Generate the XML sitemaps from the ported site.

Earlier this script *copied* the live site's five Yoast sitemaps and rewrote two
things in them. That was right while the port was still being assembled — it
kept Google's crawl entry point intact — and wrong to keep, because a copied
sitemap describes the WordPress site, not this one:

  * every <lastmod> was frozen at the capture. The home page claimed a last
    modification of 2026-07-22 no matter what shipped afterwards. A lastmod that
    never moves is worse than none: Google learns to ignore it.
  * the URL set could drift. It happens to match today; nothing made it match,
    and nothing would have said so if a route were added or removed.
  * `e-landing-page-sitemap.xml` had **zero** URLs. Yoast emits one per custom
    post type, and the Elementor landing-page type has no entries. An empty
    sitemap listed in the index is a Search Console error ("Sitemap is empty"),
    so it is no longer emitted or listed.

The filenames are kept exactly — `sitemap_index.xml`, `page-sitemap.xml`,
`post-sitemap.xml`, `author-sitemap.xml` — because Google has the site indexed
under those, and so is the `sitemap.xsl` stylesheet, which only makes the XML
readable to a human who opens it in a browser.

Writes public/*.xml and public/sitemap.xsl.
"""
import os as _os
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_ROOT = _os.path.dirname(_HERE)
WORK = _os.environ.get('PORT_WORK') or _os.path.join(_ROOT, '.port-work')

import os, re, sys, json, glob, shutil, subprocess
from datetime import datetime, timezone

SRC = os.path.join(_HERE, 'capture', 'sitemaps')
DEST = os.path.join(_ROOT, 'public')
PROD = 'https://www.rexdalemobilewash.ca'
IMG_HOST = 'https://' + json.load(open(os.path.join(_ROOT, 'image-hosts.json')))['canonical']

# The same file src/seo.config.ts reads to render the meta tag. Both sides have
# to agree or the site asks Google to index a page whose own markup refuses —
# which is why bin/check-sitemaps.mjs compares the two and fails the build.
NOINDEX = set(json.load(open(os.path.join(_ROOT, 'seo-noindex.json')))['slugs'])
CHROME = ''

# WordPress's own split, kept because the filenames are kept: a post goes in the
# post sitemap, an author archive in the author sitemap, everything else is a
# page. Anything not named here is a page.
SLUG_SITEMAP = {'blog-post-title': 'post', 'author-admin': 'author'}
SITEMAPS = ['page', 'post', 'author']


def lastmod(path):
    """When this page's content last actually changed.

    The commit date of the generated content file, which is the file whose bytes
    decide what the page serves. Falls back to the file's mtime outside git or
    for a file not yet committed — a dirty tree should not silently emit a
    lastmod of the last commit, which would be a lie about newer content.
    """
    try:
        out = subprocess.run(
            ['git', 'log', '-1', '--format=%cI', '--', path],
            cwd=_ROOT, capture_output=True, text=True, timeout=10)
        stamp = out.stdout.strip()
        dirty = subprocess.run(['git', 'status', '--porcelain', '--', path],
                               cwd=_ROOT, capture_output=True, text=True, timeout=10).stdout.strip()
        if stamp and not dirty:
            return stamp
    except Exception:
        pass
    return datetime.fromtimestamp(os.path.getmtime(path), timezone.utc)\
        .isoformat(timespec='seconds')


# One pattern, deliberately: any absolute URL on the image host ending in an
# image extension, wherever it appears. The three targeted patterns this replaced
# — <img src>, url(…) and the entity-quoted url(&quot;…&quot;) — each covered a
# real spelling and together still missed the Organization logo, which is a plain
# JSON value inside the Yoast JSON-LD: `"url":"https://img…/logoclear-1.png"`.
# A pattern that cannot be fooled by quoting is worth more than three that each
# know one syntax.
IMG_ANYWHERE = re.compile(
    r'https://[^\s"\'<>()]+?\.(?:jpe?g|png|webp|gif|avif|svg)(?=[\s"\'<>()&]|$)', re.I)

# WordPress emits image-1-768x1159.jpg beside image-1.jpg: one photograph at six
# sizes. Google wants the canonical one listed, not all six.
RENDITION = re.compile(r'-\d{2,4}x\d{2,4}(?=\.[a-z]+$)', re.I)


# Every page renders these three, and none of them is in a page's content file:
# the header and footer are separate partials, and the favicon is a constant in
# SiteBase.astro. They were missing from every <url> until the coverage
# assertion in bin/check-sitemaps.mjs said so.
def _chrome():
    out = ''
    for partial in ('_header.neutral.html', '_footer.html'):
        f = os.path.join(_ROOT, 'src', 'html', partial)
        if os.path.exists(f):
            out += open(f, encoding='utf-8', errors='replace').read()
    # kept in step with FAVICON in src/layouts/SiteBase.astro
    out += f'<img src="{IMG_HOST}/2023/12/Rexdale-Mobile-Wash-Logo-Updated-23.webp">'
    return out


def images(html, css=''):
    """Content images on a page, as absolute img. URLs.

    Read from two places, because a page's images are in two places: `<img>`
    tags and inline background styles in the markup, and `background-image` in
    the page's own generated stylesheet. /residential/ has both of its hero
    images only in the CSS — markup alone would list neither.

    Header and footer chrome is excluded for free rather than by a rule: the logo
    and the skyline background live in `_header.neutral.html` and `_footer.html`,
    which are separate partials this never reads. Checked, not assumed — no image
    appears on more than a handful of the 19 content files.

    Two exclusions that do need stating.

    The Instagram tiles are included. They were excluded on the reasoning that
    they are "someone else's photographs", which was simply wrong: they are the
    client's own work photos, from the client's own Instagram account, harvested
    into the client's own bucket and served from the client's own domain. There
    is no sense in which they belong to anyone else, and 158 photographs of the
    work this business does is exactly what Google Images should be able to find.
    The per-URL limit is 1,000 images, so the home page's 177 is comfortable.

    **Anything not on the image host is still dropped.** That is the Smash
    Balloon UI sprite at /css/assets/, which is chrome served by the Worker, and
    would be any third-party image if one ever appeared.
    """
    found = [u for u in IMG_ANYWHERE.findall(html + '\n' + css)
             if u.startswith(IMG_HOST + '/')]
    canonical = {u for u in found if not RENDITION.search(u)}

    out, seen = [], set()
    for url in found:
        # A rendition is dropped only when the image it is a rendition OF is also
        # on the page. If a page shows only the 768px copy, that copy IS the
        # image there and leaving it out would lose it.
        if RENDITION.search(url) and RENDITION.sub('', url) in canonical:
            continue
        if url in seen:
            continue
        seen.add(url)
        out.append(url)
    return out


def esc(s):
    return (s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
             .replace('"', '&quot;').replace("'", '&apos;'))


HEAD = ('<?xml version="1.0" encoding="UTF-8"?>'
        '<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>\n')
URLSET_OPEN = (
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
    'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" '
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
    'xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 '
    'http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd '
    'http://www.google.com/schemas/sitemap-image/1.1 '
    'http://www.google.com/schemas/sitemap-image/1.1/sitemap-image.xsd">\n')


def urlset(entries):
    out = [HEAD, URLSET_OPEN]
    for url, mod, imgs in entries:
        out.append('\t<url>\n')
        out.append(f'\t\t<loc>{esc(url)}</loc>\n')
        out.append(f'\t\t<lastmod>{mod}</lastmod>\n')
        for i in imgs:
            out.append(f'\t\t<image:image>\n\t\t\t<image:loc>{esc(i)}</image:loc>\n\t\t</image:image>\n')
        out.append('\t</url>\n')
    out.append('</urlset>\n')
    return ''.join(out)


def index(children):
    out = [HEAD, '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n']
    for name, mod in children:
        out.append('\t<sitemap>\n')
        out.append(f'\t\t<loc>{PROD}/{name}</loc>\n')
        out.append(f'\t\t<lastmod>{mod}</lastmod>\n')
        out.append('\t</sitemap>\n')
    out.append('</sitemapindex>\n')
    return ''.join(out)


def main():
    global CHROME
    CHROME = _chrome()
    meta_path = os.path.join(WORK, 'pages_meta.json')
    if not os.path.exists(meta_path):
        print(f"  no {meta_path} — run build_site.py first")
        return 1
    meta = json.load(open(meta_path))

    xsl = os.path.join(SRC, 'main-sitemap.xsl')
    if os.path.exists(xsl):
        shutil.copyfile(xsl, os.path.join(DEST, 'sitemap.xsl'))
        print(f"  public/sitemap.xsl   {os.path.getsize(xsl)} bytes")

    buckets = {name: [] for name in SITEMAPS}
    skipped = []
    for slug, d in sorted(meta.items()):
        if slug.startswith('_'):
            continue
        # A page that tells crawlers not to index it has no business being
        # submitted for indexing. Two sources, because there are two ways a page
        # can end up noindex: the live site said so and it came through the
        # capture, or seo-noindex.json says so and the port decided it.
        robots = (d.get('meta') or {}).get('robots', '')
        if slug in NOINDEX:
            skipped.append((slug, 'noindex (seo-noindex.json)'))
            continue
        if 'noindex' in robots.lower():
            skipped.append((slug, 'noindex (from the live site)'))
            continue
        content = os.path.join(_ROOT, 'src', 'html', f'{slug}.content.html')
        if not os.path.exists(content):
            skipped.append((slug, 'no content file'))
            continue
        url = PROD + d['url']
        html = open(content, encoding='utf-8', errors='replace').read()
        sheet = os.path.join(_ROOT, 'public', 'css', f'page-{slug}.css')
        css = open(sheet, encoding='utf-8', errors='replace').read() if os.path.exists(sheet) else ''
        # The page's own head metadata is a fourth source: Yoast's JSON-LD names
        # the Organization logo, which appears nowhere in the body, the chrome or
        # the stylesheet. Found by the coverage assertion in check-sitemaps.mjs
        # rather than by reading the markup and hoping.
        m = d.get('meta') or {}
        head = (m.get('jsonld') or '') + ''.join(v for _, v in (m.get('og') or []))
        buckets[SLUG_SITEMAP.get(slug, 'page')].append(
            (url, lastmod(content), images(html + CHROME + head, css)))

    children = []
    for name in SITEMAPS:
        entries = buckets[name]
        if not entries:
            # Never emit an empty sitemap, and never list one. That is what the
            # old e-landing-page-sitemap.xml was, and Search Console reports it
            # as an error rather than ignoring it.
            print(f"  {name}-sitemap.xml   skipped, no URLs")
            continue
        fname = f'{name}-sitemap.xml'
        open(os.path.join(DEST, fname), 'w', encoding='utf-8').write(urlset(entries))
        imgs = sum(len(i) for _, _, i in entries)
        children.append((fname, max(m for _, m, _ in entries)))
        print(f"  public/{fname:24} {len(entries)} url(s), {imgs} image(s)")

    open(os.path.join(DEST, 'sitemap_index.xml'), 'w', encoding='utf-8').write(index(children))
    print(f"  public/{'sitemap_index.xml':24} {len(children)} sitemap(s)")

    # Anything not written this run is stale: a sitemap from a previous shape of
    # the site, still in public/, still shipped, maintained by nothing. That
    # includes e-landing-page-sitemap.xml, which was Yoast's empty one, and any
    # child that has just been emptied by a page becoming noindex.
    kept = {name for name, _ in children}
    for path in sorted(glob.glob(os.path.join(DEST, '*-sitemap.xml'))):
        name = os.path.basename(path)
        if name not in kept:
            os.remove(path)
            print(f"  removed public/{name} (no URLs left to list)")

    for slug, why in skipped:
        print(f"  skipped {slug}: {why}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
