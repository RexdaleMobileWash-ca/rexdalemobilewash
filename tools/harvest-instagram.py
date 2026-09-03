#!/usr/bin/env python3
"""Harvest the FULL Instagram feed from the live WordPress site, while it is up.

The captured page carries only the first 20 tiles; the rest arrive when a visitor
presses Load More, which calls Smash Balloon's `sbi_load_more_clicked` AJAX
action. That endpoint dies with the WordPress site at gate 16, and the image URLs
inside it are signed and expire sooner than that — so this runs once, now, and
its output is committed.

    python3 tools/harvest-instagram.py

Writes $PORT_WORK/instagram-tiles.html — every tile in feed order, ready for
build_site.py to splice into the captured markup and localise.
"""
import os as _os
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_ROOT = _os.path.dirname(_HERE)
WORK = _os.environ.get('PORT_WORK') or _os.path.join(_ROOT, '.port-work')

import re, json, html, time, urllib.parse, urllib.request

AJAX = 'https://www.rexdalemobilewash.ca/wp-admin/admin-ajax.php'
# straight off the live page's #sb_instagram container
FEED = {'feed_id': '*1', 'atts': '{"feed":"1"}', 'post_id': '37',
        'location': 'content', 'current_resolution': 'full',
        'locator_nonce': '02c43e7a88'}
UA = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/120.0 Safari/537.36')

def load_more(offset, page):
    data = dict(FEED, action='sbi_load_more_clicked', offset=str(offset), page=str(page))
    req = urllib.request.Request(
        AJAX, data=urllib.parse.urlencode(data).encode(),
        headers={'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': UA,
                 'Referer': 'https://www.rexdalemobilewash.ca/'})
    with urllib.request.urlopen(req, timeout=90) as r:
        body = r.read().decode('utf-8', 'replace')
    if body.strip() in ('0', '-1', ''):
        return None
    try:
        return json.loads(body)['data'].get('html', '')
    except Exception:
        return None

def split_tiles(chunk):
    """Return each .sbi_item as a DIV-BALANCED fragment, with its id.

    Splitting on 'up to the next tile' looks right and is not: the last tile of a
    chunk then swallows the grid's own closing </div>, which closes #sbi_images
    early and reparents every later tile onto #sb_instagram. The Load More script
    then finds nothing inside the grid. Count the tags instead.
    """
    out = []
    for m in re.finditer(r'<div class="sbi_item', chunk):
        start, depth = m.start(), 0
        for tag in re.finditer(r'<div\b|</div>', chunk[start:]):
            depth += -1 if tag.group(0).startswith('</') else 1
            if depth == 0:
                frag = chunk[start:start + tag.end()]
                ident = re.search(r'id="(sbi_[0-9]+)"', frag)
                out.append((ident.group(1) if ident else frag[:40], frag))
                break
    return out

def main():
    # tile 1..20 come from the captured page itself
    cap = open(_os.path.join(WORK, 'pages', 'home.html'), encoding='utf-8', errors='replace').read()
    start = cap.find('<div id="sbi_images"')
    end = cap.find('</div>\n\n\t\t<div id="sbi_load"', start)
    if end < 0:
        end = cap.find('<div id="sbi_load"', start)
    first = cap[start:end]

    seen, tiles = set(), []
    for ident, frag in split_tiles(first):
        if ident not in seen:
            seen.add(ident); tiles.append(frag.rstrip())
    print(f"  page 1 (captured) : {len(tiles)} tiles")

    page, offset, empty = 1, len(tiles), 0
    while True:
        page += 1
        chunk = load_more(offset, page)
        if chunk is None:
            print(f"  page {page}: endpoint returned nothing usable — stopping")
            break
        new = 0
        for ident, frag in split_tiles(chunk):
            if ident in seen:
                continue
            seen.add(ident); tiles.append(frag.rstrip()); new += 1
        print(f"  page {page:<2}          : +{new} new (total {len(tiles)})")
        if new == 0:
            empty += 1
            if empty >= 2:
                break
        else:
            empty = 0
        offset = len(tiles)
        time.sleep(1.0)          # be gentle with the client's server
        if page > 60:
            print("  stopping at 60 pages as a safety limit")
            break

    out = _os.path.join(WORK, 'instagram-tiles.html')
    open(out, 'w', encoding='utf-8').write('\n'.join(tiles) + '\n')
    imgs = len(set(re.findall(r'https://scontent[^"\'\s\\]+', html.unescape('\n'.join(tiles)))))
    print(f"\n  {len(tiles)} tiles, {imgs} distinct image urls -> {out}")

if __name__ == '__main__':
    main()
