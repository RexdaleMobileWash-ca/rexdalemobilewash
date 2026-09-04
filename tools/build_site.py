#!/usr/bin/env python3
"""Generate the Astro site from the captured live pages.

Fidelity rules this script enforces:
  * markup is copied, never retyped
  * CSS is taken from what the live site actually serves, in document order
  * no reference may survive that points at rexdalemobilewash.ca (old server)
"""
import os as _os
WORK = _os.environ.get('PORT_WORK') or _os.path.join(
    _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), '.port-work')
REPO_ROOT = _os.environ.get('PORT_REPO') or _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))

import re, os, sys, json, glob, html, hashlib, urllib.request, urllib.error, time, collections

S   = WORK
REPO= REPO_ROOT
sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from header_apply import apply_active           # noqa: E402  (proven byte-exact)

CSSMAP   = json.load(open(S+'/css_map.json'))
HDRMODEL = json.load(open(S+'/header_model.json'))
NEUTRAL  = open(S+'/header.neutral.html', encoding='utf-8').read()

P = lambda *a: os.path.join(REPO, *a)
for d in ('src/pages','src/layouts','src/components','src/html','public/css','public/js',
          'public/images/instagram'):
    os.makedirs(P(d), exist_ok=True)

# ---------------------------------------------------------------- shared inline CSS
# These four blocks are byte-identical on every page; they become vendor files so the
# cascade order is preserved without duplicating them 17 times.
SHARED_INLINE = {
    'ba282c0d': 'wp-emoji-styles.css',
    '804dab74': 'classic-theme-styles.css',
    'fe255d30': 'wp-global-styles.css',
    '5783535e': 'core-block-supports.css',
}
# Declares only the 'star' and 'WooCommerce' @font-face families. No page contains any
# element that uses them (verified: 0 occurrences of woocommerce/star markup site-wide),
# so it is dropped rather than shipping two dead icon fonts.
DROP_INLINE = {'d88326f7': 'np-woocommerce-base-fonts'}

# ---------------------------------------------------------------- pruning
# The live site loads the whole WordPress + Elementor + Nicepage stack on every
# page regardless of what the page contains: ~1.4MB of CSS and JS per view. Each
# entry below says what markup a sheet exists to style; if the page's DOM has none
# of it, the sheet is dropped from that page.
#
# This is only safe because tools/verify/run-verify.sh pixel-diffs every page
# against the captured original. Anything removed here is proven to change
# nothing — if a diff appears, the rule is wrong, not the reference.
WP_BLOCK   = r'class="[^"]*\bwp-block-'
ELEMENTOR  = r'class="[^"]*\belementor-'
HELLO      = r'class="[^"]*\bsite-(?:header|main|footer|navigation|branding)\b'
INSTAGRAM  = r'\bsb_instagram\b|\bsbi_item\b'

SHEET_NEEDS = {
    'plugins-elementor-assets-lib-swiper-v8-css-swiper.min.css':      r'\bswiper\b',
    'css-dist-block-library-style.min.css':                            WP_BLOCK,
    'wp-global-styles.css':                                            WP_BLOCK,
    'classic-theme-styles.css':                                        WP_BLOCK,
    'core-block-supports.css':                                         WP_BLOCK,
    'wp-emoji-styles.css':                        r'wp-smiley|class="[^"]*\bemoji\b',
    'plugins-instagram-feed-css-sbi-styles.min.css':                   INSTAGRAM,
    ('plugins-instagram-feed-vendor-smashballoon-framework-'
     'Packages-Blocks-css-sb-elementor.css'):                          INSTAGRAM,
    'plugins-contact-form-7-includes-css-styles.css':                  r'\bwpcf7\b',
    'plugins-elementor-assets-css-frontend-lite.min.css':              ELEMENTOR,
    'plugins-elementor-pro-assets-css-frontend-lite.min.css':          ELEMENTOR,
    'uploads-elementor-css-post-381.css':                              ELEMENTOR,
    'plugins-elementor-assets-css-modules-lazyload-frontend.min.css':  r'data-e-bg-lazyload',
    # themes-hello-elementor-style.min.css is deliberately absent from this table.
    # It looks theme-scoped but is the theme's global element reset — box-sizing and
    # font inheritance for input/button/select/textarea among others — so every page
    # depends on it even with no site-* markup. Dropping it grew the contact-form
    # section by 91px on all 15 Nicepage pages. Always kept.
    'themes-hello-elementor-theme.min.css':                            HELLO,
    'plugins-nicepage-assets-css-froala.css':                 r'class="[^"]*\bfr-',
}
# nicepage.js (446KB, plus its jQuery dependency) drives the u-* menu, carousel and
# parallax. The two theme pages and the 404 carry no u-* markup at all.
NICEPAGE_MARKUP = r'class="[^"]*\bu-(?:body|header|footer|sheet|nav|btn|section|menu|carousel|image|text|group|layout|container)'

def prune_sheets(vendor, dom):
    """Drop sheets whose markup this page does not contain. Returns (kept, dropped)."""
    kept, dropped = [], []
    for href in vendor:
        need = SHEET_NEEDS.get(os.path.basename(href))
        if need is not None and not re.search(need, dom):
            dropped.append(os.path.basename(href))
        else:
            kept.append(href)
    return kept, dropped

# ---------------------------------------------------------------- URL rewriting
INSTA = {}
def fetch(url, tries=4):
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, b''
        except Exception:
            if a == tries-1: return 0, b''
            time.sleep(2**a)

def localize_instagram(text):
    """Instagram CDN urls are signed and expire. Freeze them into public/images/instagram/."""
    out = text
    for raw in sorted(set(re.findall(r'https://scontent[^"\'\s\\)]+', text)), key=len, reverse=True):
        real = html.unescape(raw)
        key  = real.split('?')[0]
        if raw not in INSTA:
            name = hashlib.md5(key.encode()).hexdigest()[:16] + os.path.splitext(key)[1].split('?')[0]
            if not name.endswith(('.jpg','.jpeg','.png','.webp','.mp4')): name += '.jpg'
            dest = P('public/images/instagram', name)
            if os.path.exists(dest) and os.path.getsize(dest) > 0:
                INSTA[raw] = '/images/instagram/'+name
            else:
                code, data = fetch(real)
                INSTA[raw] = ('/images/instagram/'+name) if (code == 200 and len(data) > 500) else None
                if INSTA[raw]: open(dest,'wb').write(data)
        if INSTA[raw]:
            out = out.replace(raw, INSTA[raw])
    return out

def inject_full_feed(text):
    """Replace the feed's first 20 tiles with every tile the live site can serve.

    The captured page carries one page of the feed; the rest only arrive from the
    plugin's AJAX endpoint, which dies with the WordPress site. tools/harvest-
    instagram.py pulled all of them once; this splices them in so the whole feed
    is static. Runs before the image localiser so the new tiles' photos are
    downloaded too.
    """
    tiles_file = os.path.join(S, 'instagram-tiles.html')
    if 'sbi_images' not in text or not os.path.exists(tiles_file):
        return text
    tiles = open(tiles_file, encoding='utf-8').read().strip()
    m = re.search(r'<div id="sbi_images"[^>]*>', text)
    if not m:
        return text
    # Find the grid's OWN closing </div> by counting tags. A non-greedy regex
    # anchored on what follows the grid cannot do this: the markup there is
    #   </div>(photo_wrap) </div>(last tile) </div>(#sbi_images) <div id="sbi_load">
    # and the earliest match of `</div>\s*</div>\s*<div id="sbi_load"` starts one
    # tag late, so the last tile's closing </div> survives the replacement. The
    # spliced tiles are already balanced, so that leftover tag closes #sbi_images
    # at the tile boundary and #sb_instagram at the grid's — which reparents
    # #sbi_load (Load More + Follow button) out of the feed, where none of the
    # plugin's `#sb_instagram ...` rules reach it and its inline SVG icon renders
    # at ~1380px. Same trap as split_tiles() in harvest-instagram.py.
    depth, end = 0, None
    for tag in re.finditer(r'<div\b|</div>', text[m.start():]):
        depth += -1 if tag.group(0).startswith('</') else 1
        if depth == 0:
            end = m.start() + tag.start()
            break
    if end is None:
        return text
    return text[:m.end()] + '\n' + tiles + '\n\t' + text[end:]

def rewrite(text):
    """Point every old-server reference at this site's own assets."""
    text = inject_full_feed(text)
    for host in ('https://www.new.rexdalemobilewash.ca', 'http://www.new.rexdalemobilewash.ca',
                 'https://new.rexdalemobilewash.ca',      'http://new.rexdalemobilewash.ca',
                 'https://www.rexdalemobilewash.ca',      'http://www.rexdalemobilewash.ca',
                 'https://rexdalemobilewash.ca',          'http://rexdalemobilewash.ca'):
        text = text.replace(host + '/wp-content/uploads/', '/images/')
    text = localize_instagram(text)
    # The Smash Balloon plugin's responsive-size blob. It is read only by
    # sbi-scripts.js, which needs the WordPress AJAX endpoint and so is not
    # shipped; every URL inside it is a signed Instagram CDN link that expires.
    # Dead data pointing at soon-to-be-404s, so it goes.
    text = re.sub(r'\sdata-img-src-set="[^"]*"', '', text)
    # WordPress gallery metadata naming attachment pages on the dead staging host.
    # Nothing links to them (the gallery images are not wrapped in anchors), so the
    # attribute is inert — but it must not ship a reference to a host with no DNS.
    text = re.sub(r'\sdata-link="https?://(?:www\.)?new\.rexdalemobilewash\.ca[^"]*"', '', text)
    text = static_instagram(text)
    # Bootstrap config for WordPress plugins whose JS is not shipped: the CF7 REST
    # root, Smash Balloon's admin-ajax URL, and a Fast Cache loader that also carried
    # a nonce. All three name endpoints that will not exist. The Elementor background
    # lazyload observer is NOT stripped — 4 elements on the ported pages still carry
    # data-e-bg-lazyload and depend on it.
    text = re.sub(r'<script[^>]*>\s*var\s+(?:wpcf7|sbiajaxurl|bscSl)\s*=.*?</script>', '',
                  text, flags=re.S)
    # Smash Balloon's feed-locator nonce, meaningless without the plugin.
    text = re.sub(r'\sdata-locatornonce="[^"]*"', '', text)
    # internal page links -> root-relative
    for host in ('https://www.rexdalemobilewash.ca', 'http://www.rexdalemobilewash.ca',
                 'https://rexdalemobilewash.ca',      'http://rexdalemobilewash.ca'):
        text = text.replace(host + '/', '/').replace(host + '"', '/"')
    return text

def static_instagram(text):
    """Make the Instagram grid work without the plugin's JavaScript.

    Smash Balloon ships every tile as a placeholder <img> and swaps in the real
    photo at runtime, from data-full-res. That script needs the WordPress AJAX
    endpoint, so it is not shipped here. Three things it does that the CSS alone
    does not, and that the grid is invisible or misshapen without:

      1. the tiles ship as `.sbi_item.sbi_transition`, which the plugin's own CSS
         sets to `opacity: 0` — the JS fades them in. Without it the whole grid
         renders transparent: images load, nothing is visible.
      2. the 1:1 aspect ratio (data-imageaspectratio) is applied by the JS, not
         by CSS, so tiles otherwise render at each photo's natural aspect.
      3. the photo is painted as a CSS background on `.sbi_photo`, inline.

    Smash Balloon ships a no-JS mode for exactly this, keyed on a `sbi_no_js`
    class on the container, which fixes 1 and 2 and hides the placeholder <img>.
    So: add that class, and paint the background it expects. The <img> stays for
    its alt text; the plugin's no-JS CSS hides it.
    """
    if 'sb_instagram' not in text:
        return text

    # turn on the plugin's own no-JS mode
    text = re.sub(r'(<div id="sb_instagram"[^>]*\sclass=")([^"]*)"',
                  lambda m: m.group(1) + m.group(2).rstrip() + ' sbi_no_js"', text, count=1)

    def fix_tile(m):
        tile = m.group(0)
        full = re.search(r'data-full-res="([^"]+)"', tile)
        if not full:
            return tile
        url = full.group(1)
        tile = re.sub(r'(<img[^>]*\ssrc=")[^"]*placeholder\.png(")',
                      lambda i: i.group(1) + url + i.group(2), tile, count=1)
        # the background the no-JS mode renders the photo with
        style = (f"background-image:url('{url}');background-size:cover;"
                 "background-position:center center;background-repeat:no-repeat")
        if 'style="' in tile.split('>')[0]:
            tile = re.sub(r'(<a class="sbi_photo"[^>]*style=")', r'\1' + style + ';', tile, count=1)
        else:
            tile = tile.replace('<a class="sbi_photo"', f'<a class="sbi_photo" style="{style}"', 1)
        return tile

    text = re.sub(r'<a class="sbi_photo".*?</a>', fix_tile, text, flags=re.S)

    # the avatar: .sbi_header_img expects an <img> child (sbi CSS sizes and rounds it)
    def fix_avatar(m):
        block = m.group(0)
        url = re.search(r'data-avatar-url="([^"]+)"', block)
        if not url or '<img' in block:
            return block
        return block + f'<img src="{url.group(1)}" alt="" width="80" height="80">'

    text = re.sub(r'<div class="sbi_header_img"[^>]*>', fix_avatar, text)

    # The live feed shows one page at a time behind a Load More button that calls
    # the plugin's AJAX endpoint. Every tile is inlined here, so keep the same
    # behaviour without the endpoint: hide everything past the first page and let
    # the button reveal the next batch. Same UX, no network, nothing to expire.
    PAGE = 20
    def paginate(m):
        head, body = m.group(1), m.group(2)
        parts = re.split(r'(?=<div class="sbi_item)', body)
        kept, n = [], 0
        for part in parts:
            if not part.strip().startswith('<div class="sbi_item'):
                kept.append(part); continue
            n += 1
            if n > PAGE:
                part = part.replace('<div class="sbi_item',
                                    '<div data-sbi-more style="display:none" class="sbi_item', 1)
            kept.append(part)
        return head + ''.join(kept)

    text = re.sub(r'(<div id="sbi_images"[^>]*>)(.*?)(?=</div>\s*</div>\s*<div id="sbi_load")',
                  paginate, text, flags=re.S)

    if 'sbi_load_btn' in text and 'data-sbi-more' in text:
        text = text.replace('</div>\n\n\t</div>\n\n</div>', '</div>\n\n\t</div>\n\n</div>', 1)
        text += (
            '\n<script>\n'
            '/* Load More, without the WordPress AJAX endpoint: every tile is already\n'
            '   in the page, hidden past the first batch. */\n'
            '(function () {\n'
            '  var grid = document.getElementById("sbi_images");\n'
            '  var btn  = document.querySelector("#sbi_load .sbi_load_btn");\n'
            '  if (!grid || !btn) return;\n'
            '  var STEP = 20;\n'
            '  function rest() { return grid.querySelectorAll(".sbi_item[data-sbi-more]"); }\n'
            '  function sync() { if (!rest().length) btn.style.display = "none"; }\n'
            '  btn.addEventListener("click", function () {\n'
            '    var more = rest();\n'
            '    for (var i = 0; i < STEP && i < more.length; i++) {\n'
            '      more[i].removeAttribute("data-sbi-more");\n'
            '      more[i].style.display = "";\n'
            '    }\n'
            '    sync();\n'
            '  });\n'
            '  sync();\n'
            '})();\n'
            '</script>\n')
    return text

def rewrite_absolute(text):
    """For head metadata and JSON-LD: keep the canonical domain, fix asset paths.

    canonical / og:url / schema @ids must stay absolute on the production domain —
    that is what this site will be. Only the /wp-content/uploads/ asset paths inside
    them are wrong, because those files live at /images/ here.
    """
    PROD = 'https://www.rexdalemobilewash.ca'
    STAGING = ('https://www.new.rexdalemobilewash.ca', 'http://www.new.rexdalemobilewash.ca',
               'https://new.rexdalemobilewash.ca',     'http://new.rexdalemobilewash.ca')
    for host in (PROD, 'http://www.rexdalemobilewash.ca') + STAGING:
        text = text.replace(host + '/wp-content/uploads/', PROD + '/images/')
    # The staging host has no DNS record at all; anything still naming it is dead.
    for host in STAGING:
        text = text.replace(host, PROD)
    return text

# ---------------------------------------------------------------- per-page extraction
STYLE_RE = re.compile(r'<style([^>]*)>(.*?)</style>', re.S)
LINK_RE  = re.compile(r'<link[^>]*rel=[\'"]stylesheet[\'"][^>]*>')

def css_plan(doc):
    """Ordered stylesheet plan for one page: vendor hrefs + this page's own inline CSS."""
    items = []
    for m in re.finditer(r'<link[^>]*rel=[\'"]stylesheet[\'"][^>]*>|<style([^>]*)>(.*?)</style>', doc, re.S):
        if m.group(0).startswith('<link'):
            href = html.unescape(re.search(r'href=[\'"]([^\'"]+)', m.group(0)).group(1))
            if 'fonts.googleapis.com' in href:
                items.append(('font', href)); continue
            local = CSSMAP.get(href, 'MISSING')
            if local:                    # None => not served live (global.css 404)
                items.append(('vendor', local))
            else:
                items.append(('skip', href))
        else:
            body = m.group(2)
            md5  = hashlib.md5(body.encode()).hexdigest()[:8]
            if md5 in DROP_INLINE:      items.append(('dropped', md5))
            elif md5 in SHARED_INLINE:  items.append(('vendor', '/css/vendor/'+SHARED_INLINE[md5]))
            else:                       items.append(('inline', body))
    return items

def head_meta(doc):
    """Pull the head metadata out of a captured page.

    Values are html.unescape()d on the way out. SiteBase.astro renders them as
    JSX attributes, which escape on output, so a value carried across still
    entity-encoded is encoded a second time: WordPress's "we&#039;ll" ships as
    "we&amp;#039;ll" and the entity shows up verbatim in the search snippet and
    the social card.
    """
    g = lambda p, d='': (re.search(p, doc, re.S).group(1).strip() if re.search(p, doc, re.S) else d)
    U = html.unescape
    meta = {
        'title':       U(g(r'<title>(.*?)</title>')),
        'description': U(g(r'<meta name="description" content="([^"]*)"')),
        'canonical':   U(g(r'<link rel="canonical" href="([^"]*)"')),
        'robots':      U(g(r"<meta name='robots' content='([^']*)'")),
        'og':          [], 'named': [], 'jsonld': None,
        # Not constants: the two page families differ. Nicepage pages declare
        # initial-scale=1.0, the hello-elementor pages initial-scale=1, and only
        # the theme pages carry the XFN profile link. `lang` is "en" everywhere —
        # the layout used to hardcode "en-US".
        'lang':        g(r'<html[^>]*\slang="([^"]*)"', 'en'),
        'viewport':    g(r'<meta name="viewport" content="([^"]*)"',
                         'width=device-width, initial-scale=1.0'),
        'profile':     g(r'<link rel="profile" href="([^"]*)"') or None,
        # gtm4wp pushes page classification into dataLayer BEFORE the GTM
        # loader runs. Tags and triggers in the client's container can read
        # pagePostType / pagePostType2 / pagePostAuthor; without this push they
        # are simply undefined and those tags stop firing. Invisible on the
        # page, which is why a render comparison cannot see it.
        'dataLayer':   g(r'var\s+dataLayer_content\s*=\s*(\{.*?\});') or None,
    }
    # That pattern stops at the first `};`, and the value is emitted inside a
    # <script>. Both are safe for every page in the capture — one flat object of
    # string values — and neither is safe in general, so fail loudly rather than
    # ship truncated or escaped-out JavaScript if a later capture differs.
    if meta['dataLayer'] is not None:
        try:
            json.loads(meta['dataLayer'])
        except ValueError as e:
            raise SystemExit(f"dataLayer_content is not a complete JSON object "
                             f"(nested braces truncate the match): {e}")
        if '</' in meta['dataLayer']:
            raise SystemExit("dataLayer_content contains '</' and would close the "
                             "<script> it is emitted into")
    # Two plugins write this head with two different self-closing spellings —
    # Nicepage emits `"/>`, Yoast ` />` — and Yoast's article:* properties are
    # Open Graph too. Matching `property=` with an optional space therefore keeps
    # three tags per Nicepage page (og:title, og:url, og:description) and two per
    # Yoast page (article:publisher, article:modified_time) that an `og:` +
    # ` />`-only pattern silently dropped. Document order is preserved because
    # it is meaningful: where both plugins set og:title, a scraper takes the
    # first one it sees.
    for m in re.finditer(r'<meta property="([^"]+)" content="([^"]*)"\s*/?>', doc):
        meta['og'].append((m.group(1), U(m.group(2))))
    # name=-addressed metadata other than title/description/robots
    for m in re.finditer(r'<meta name="((?:twitter:|msapplication-)[^"]+)" content="([^"]*)"\s*/?>', doc):
        meta['named'].append((m.group(1), U(m.group(2))))
    m = re.search(r'<script type="application/ld\+json" class="yoast-schema-graph">(.*?)</script>', doc, re.S)
    if m: meta['jsonld'] = m.group(1).strip()
    # head metadata keeps the production domain; only asset paths inside it move
    meta['jsonld'] = rewrite_absolute(meta['jsonld']) if meta['jsonld'] else None
    meta['og'] = [(k, rewrite_absolute(v)) for k, v in meta['og']]
    meta['named'] = [(k, rewrite_absolute(v)) for k, v in meta['named']]
    return meta

# A capture file is one flat name per page; the route it serves at can be nested.
# Anything not listed here is served at /<slug>/ from src/pages/<slug>.astro.
SLUG_TO_ROUTE = {'home': 'index', 'author-admin': 'author/admin'}

def route_of(slug):
    """(astro file stem, url path) for a slug."""
    r = SLUG_TO_ROUTE.get(slug, slug)
    return r, '/' if r == 'index' else '/' + r + '/'

def main():
    pages = {}
    report = collections.OrderedDict()
    for f in sorted(glob.glob(S+'/pages/*.html')):
        slug = os.path.basename(f)[:-5]
        if slug.startswith('_'):
            continue        # _404.html is handled by gen_404.py, it is not a route
        doc  = open(f, encoding='utf-8', errors='replace').read()
        plan = css_plan(doc)
        meta = head_meta(doc)

        hs, he = doc.find('<header'), doc.find('</header>')
        fs, fe = doc.find('<footer'), doc.find('</footer>')
        kind = 'nicepage' if ('<div class="u-body' in doc and hs >= 0 and fs > hs) else 'theme'

        if kind == 'nicepage':
            content = doc[he+len('</header>'):fs]
            footer  = doc[fs:fe+len('</footer>')]
        else:
            b = doc.find('<body'); b = doc.find('>', b)+1
            content = doc[b:doc.find('</body>')]
            footer  = None

        # inline <style> blocks are hoisted into the page stylesheet; strip them from markup
        content = STYLE_RE.sub('', content)
        if footer: footer = STYLE_RE.sub('', footer)
        # WP/GTM/analytics script tags in the body are re-emitted by the layout, not the markup
        content = re.sub(r'<script[^>]*src=[\'"][^\'"]*[\'"][^>]*>\s*</script>', '', content)
        content = re.sub(r'<link[^>]*rel=[\'"]stylesheet[\'"][^>]*>', '', content)

        content = rewrite(content)
        if footer: footer = rewrite(footer)

        # page stylesheet = this page's own inline blocks, in document order
        own = [b for k, b in plan if k == 'inline']
        css = ('/* %s — inline CSS as served by the live page, in document order.\n'
               '   %d block(s): Nicepage per-section rules, theme kit, header, footer. */\n\n'
               % (slug, len(own))) + '\n\n'.join(own)

        css = rewrite(css)
        open(P('public/css', f'page-{slug}.css'), 'w', encoding='utf-8').write(css)

        vendor = [b for k, b in plan if k == 'vendor']
        fonts  = list(dict.fromkeys(b for k, b in plan if k == 'font'))
        # The body class is load-bearing: u-overlap-transparent / u-overlap-contrast
        # decide the header's colour treatment over each page's hero.
        battrs = re.search(r'<body([^>]*)>', doc, re.S).group(1)
        bcls   = re.search(r'class="([^"]*)"', battrs)

        # decide the payload from the page's own DOM (header + content + footer,
        # with the inline <style> blocks removed so CSS text never counts as markup)
        dom = re.sub(r'<style.*?</style>', '', doc[doc.find('<body'):], flags=re.S)
        vendor, dropped = prune_sheets(vendor, dom)
        needs_nicepage = bool(re.search(NICEPAGE_MARKUP, dom))

        astro_route, url = route_of(slug)
        pages[slug] = dict(kind=kind, meta=meta, vendor=vendor, fonts=fonts,
                           bodyClass=bcls.group(1) if bcls else '',
                           needsNicepage=needs_nicepage,
                           route=astro_route, url=url)

        open(P('src/html', f'{slug}.content.html'), 'w', encoding='utf-8').write(content)
        if footer: open(P('src/html', f'{slug}.footer.html'), 'w', encoding='utf-8').write(footer)

        report[slug] = dict(kind=kind, inline_blocks=len(own), css_bytes=len(css),
                            vendor_sheets=len(vendor), fonts=len(fonts),
                            dropped=[m for k, m in plan if k == 'dropped'],
                            not_served=[h for k, h in plan if k == 'skip'],
                            pruned=dropped, needs_nicepage=needs_nicepage,
                            content_bytes=len(content))
    json.dump(pages,  open(S+'/pages_meta.json','w'), indent=1)
    json.dump(report, open(S+'/build_report.json','w'), indent=1)

    # footer is byte-identical on all 15 nicepage pages -> one component
    foots = {}
    for slug, d in pages.items():
        if d['kind'] == 'nicepage':
            t = open(P('src/html', f'{slug}.footer.html'), encoding='utf-8').read()
            foots.setdefault(hashlib.md5(t.encode()).hexdigest(), []).append(slug)
    print('distinct footers after rewrite:', len(foots))
    canon = pages and [s for s in pages if pages[s]['kind']=='nicepage'][0]
    os.replace(P('src/html', f'{canon}.footer.html'), P('src/html','_footer.html'))
    for slug, d in pages.items():
        if d['kind']=='nicepage' and os.path.exists(P('src/html', f'{slug}.footer.html')):
            os.remove(P('src/html', f'{slug}.footer.html'))

    open(P('src/html','_header.neutral.html'),'w',encoding='utf-8').write(rewrite(NEUTRAL))
    json.dump(HDRMODEL, open(P('src/nav-active.json'),'w'), indent=1)

    print(f"\n{'page':<26}{'kind':<10}{'sheets':>8}{'pruned':>8}{'npjs':>6}{'cssKB':>7}{'markupKB':>10}")
    for slug_, r in report.items():
        print(f"{slug_:<26}{r['kind']:<10}{r['vendor_sheets']:>8}{len(r['pruned']):>8}"
              f"{('yes' if r['needs_nicepage'] else 'no'):>6}{r['css_bytes']//1024:>7}"
              f"{r['content_bytes']//1024:>10}")
    print(f"\ninstagram images localized: {sum(1 for v in INSTA.values() if v)}"
          f"  failed: {sum(1 for v in INSTA.values() if not v)}")

if __name__ == '__main__':
    main()
