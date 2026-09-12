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


IMG_IN_TAG = re.compile(r'<img\b[^>]*?\ssrc="([^"]+)"')
# Handles the entity-quoted form too: an inline style attribute carries its own
# quotes as &quot;, so `url(&quot;https://…&quot;)` is the usual spelling for a
# hero background and a naive ["'] pattern misses every one of them.
IMG_IN_CSS = re.compile(r'url\(\s*(?:&quot;|["\'])?([^"\'()]+?)(?:&quot;|["\'])?\s*\)')


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

    **The Instagram feed.** The home page carries 158 tiles harvested from the
    client's Instagram; its own content is 19 images. Listing the feed would make
    the sitemap 89% someone else's photographs, and they are not this site's
    content in any sense Google cares about.

    **Anything not on the image host.** That drops the Smash Balloon UI sprite at
    /css/assets/, which is chrome served by the Worker, and would drop any
    third-party image if one ever appeared.
    """
    found = IMG_IN_TAG.findall(html) + IMG_IN_CSS.findall(html) + IMG_IN_CSS.findall(css)

    out, seen = [], set()
    for url in found:
        url = url.strip()
        if not url.startswith(IMG_HOST + '/'):
            continue
        if '/instagram/' in url:
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
        # submitted for indexing. Nothing on this site does today; the rule is
        # here so that the day one does, the sitemap follows without anyone
        # having to remember.
        robots = (d.get('meta') or {}).get('robots', '')
        if 'noindex' in robots.lower():
            skipped.append((slug, 'noindex'))
            continue
        content = os.path.join(_ROOT, 'src', 'html', f'{slug}.content.html')
        if not os.path.exists(content):
            skipped.append((slug, 'no content file'))
            continue
        url = PROD + d['url']
        html = open(content, encoding='utf-8', errors='replace').read()
        sheet = os.path.join(_ROOT, 'public', 'css', f'page-{slug}.css')
        css = open(sheet, encoding='utf-8', errors='replace').read() if os.path.exists(sheet) else ''
        buckets[SLUG_SITEMAP.get(slug, 'page')].append(
            (url, lastmod(content), images(html, css)))

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

    # The old copies are no longer generated; leaving one behind in public/ would
    # ship a stale sitemap that nothing maintains.
    stale = os.path.join(DEST, 'e-landing-page-sitemap.xml')
    if os.path.exists(stale):
        os.remove(stale)
        print("  removed public/e-landing-page-sitemap.xml (0 URLs — a Search Console error)")

    for slug, why in skipped:
        print(f"  skipped {slug}: {why}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
