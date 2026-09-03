#!/usr/bin/env python3
"""Build a reference render of each ORIGINAL captured page, with its assets pointed
at the local copies.

Why: Chromium cannot reach the live site through this session's proxy, so a true
live-vs-port render comparison is not possible here. This is the next best thing and
isolates the right variable: the reference keeps the live document exactly as
WordPress emitted it — inline <style> blocks inline, in their original head/body
positions, the real per-page header, the original body attributes — while serving
byte-identical CSS/JS/images from the same local files the port uses.

Any rendering difference between reference and port is therefore caused by MY
restructuring (hoisting inline CSS into a linked file, regenerating the header from
a template, rewriting URLs), which is exactly what needs checking.
"""
import os as _os
WORK = _os.environ.get('PORT_WORK') or _os.path.join(
    _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), '.port-work')
REPO_ROOT = _os.environ.get('PORT_REPO') or _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))

import os, re, sys, json, glob, shutil

S = WORK
sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import build_site as B                                     # noqa: E402

REF = os.path.join(S, 'ref')
shutil.rmtree(REF, ignore_errors=True)
os.makedirs(REF, exist_ok=True)
CSSMAP = json.load(open(S + '/css_map.json'))

JS_LOCAL = {
    'jquery/jquery.min.js':      '/js/jquery.min.js',
    'nicepage/assets/js/nicepage.js': '/js/nicepage.js',
    'assets/js/hello-frontend.min.js': '/js/hello-frontend.min.js',
}

def localize_links(doc):
    def fix_link(m):
        tag = m.group(0)
        href = re.search(r'href=[\'"]([^\'"]+)[\'"]', tag)
        if not href:
            return tag
        u = href.group(1).replace('&#038;', '&').replace('&amp;', '&')
        if 'fonts.googleapis.com' in u:
            return tag                                     # intercepted in the browser
        if 'rexdalemobilewash.ca' not in u:
            return tag
        local = CSSMAP.get(u, 'MISSING')
        if local is None:
            return ''                                      # global.css: 404 live too
        if local == 'MISSING':
            # same href with a different query string; match on path
            path = u.split('?')[0]
            for k, v in CSSMAP.items():
                if k.split('?')[0] == path:
                    local = v
                    break
        if not local or local == 'MISSING':
            return ''
        return tag[:href.start(1)] + local + tag[href.end(1):]

    doc = re.sub(r'<link[^>]*rel=[\'"]stylesheet[\'"][^>]*>', fix_link, doc)

    def fix_script(m):
        tag = m.group(0)
        src = re.search(r'src=[\'"]([^\'"]+)[\'"]', tag)
        if not src:
            return tag
        u = src.group(1)
        if 'rexdalemobilewash.ca' not in u:
            return tag                                     # google/recaptcha: blocked in browser
        for frag, local in JS_LOCAL.items():
            if frag in u:
                return tag[:src.start(1)] + local + tag[src.end(1):]
        return ''                                          # WP plugin JS the port also omits
    return re.sub(r'<script[^>]*\ssrc=[\'"][^\'"]*[\'"][^>]*>\s*</script>', fix_script, doc)

def main():
    made = []
    for f in sorted(glob.glob(S + '/pages/*.html')):
        slug = os.path.basename(f)[:-5]
        if slug.startswith('_'):
            continue
        doc = open(f, encoding='utf-8', errors='replace').read()
        doc = localize_links(doc)
        # exactly the same asset rewriting the port gets, so the pixels compare
        doc = B.rewrite(doc)
        open(os.path.join(REF, slug + '.html'), 'w', encoding='utf-8').write(doc)
        made.append((slug, len(doc)))
    for slug, n in made:
        print(f"  ref/{slug}.html   {n} bytes")
    print(f"\n{len(made)} reference pages")

if __name__ == '__main__':
    main()
