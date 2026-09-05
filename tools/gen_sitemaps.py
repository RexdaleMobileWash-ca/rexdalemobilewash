#!/usr/bin/env python3
"""Carry the live site's XML sitemaps over to the port.

The live WordPress site serves five Yoast-generated sitemaps. Google has them
indexed under those exact filenames, so a port that 404s on
/sitemap_index.xml loses its crawl entry point at cutover — a regression the
page-by-page render comparison cannot see, because a sitemap is not a page.

Like the page capture, these are copied from the live site rather than
regenerated: the URL set, the <lastmod> stamps and the per-page <image:image>
lists are the live site's own, and once the WordPress site is switched off at
gate 16 they cannot be re-fetched.

Two edits, both forced:

  * `/wp-content/uploads/` -> `https://img.rexdalemobilewash.ca/` in the
    <image:image> URLs, the same rewrite every ported page gets. Google has
    those exact addresses indexed for image search; leaving them on the
    WordPress host would 404 every one of them at gate 16.
  * the XSL stylesheet reference. Yoast points it at
    /wp-content/plugins/wordpress-seo/css/main-sitemap.xsl, a path the new site
    has no reason to serve. The stylesheet itself is self-contained, so it is
    vendored to /sitemap.xsl and the reference re-pointed there. It only styles
    the XML for a human opening it in a browser; crawlers ignore it.

Writes public/*.xml and public/sitemap.xsl.
"""
import os as _os
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_ROOT = _os.path.dirname(_HERE)

import os, re, json, glob, shutil

SRC = os.path.join(_HERE, 'capture', 'sitemaps')
DEST = os.path.join(_ROOT, 'public')
PROD = 'https://www.rexdalemobilewash.ca'
IMG_BASE = 'https://' + json.load(open(os.path.join(_ROOT, 'image-hosts.json')))['canonical']
XSL_LIVE = re.compile(r'href="[^"]*wordpress-seo/css/main-sitemap\.xsl"')


def main():
    if not os.path.isdir(SRC):
        print(f"  no captured sitemaps in {SRC} — nothing to do")
        return
    xsl = os.path.join(SRC, 'main-sitemap.xsl')
    if os.path.exists(xsl):
        shutil.copyfile(xsl, os.path.join(DEST, 'sitemap.xsl'))
        print(f"  public/sitemap.xsl   {os.path.getsize(xsl)} bytes")

    for f in sorted(glob.glob(os.path.join(SRC, '*.xml'))):
        name = os.path.basename(f)
        xml = open(f, encoding='utf-8').read()
        xml = XSL_LIVE.sub('href="/sitemap.xsl"', xml)
        for host in (PROD, 'http://www.rexdalemobilewash.ca',
                     'https://rexdalemobilewash.ca', 'http://rexdalemobilewash.ca'):
            xml = xml.replace(host + '/wp-content/uploads/', IMG_BASE + '/')
        assert 'wp-content' not in xml, f"{name} still names wp-content"
        open(os.path.join(DEST, name), 'w', encoding='utf-8').write(xml)
        locs = xml.count('<loc>')
        print(f"  public/{name}   {len(xml)} bytes, {locs} <loc>")


if __name__ == '__main__':
    main()
