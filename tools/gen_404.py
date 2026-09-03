import os as _os
WORK = _os.environ.get('PORT_WORK') or _os.path.join(
    _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), '.port-work')
REPO_ROOT = _os.environ.get('PORT_REPO') or _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))

import sys, os, re, json, html
S=WORK
REPO=REPO_ROOT
sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import build_site as B

doc=open(S+'/pages/_404.html',encoding='utf-8',errors='replace').read()
plan=B.css_plan(doc); meta=B.head_meta(doc)
b=doc.find('<body'); b=doc.find('>',b)+1
content=doc[b:doc.find('</body>')]
content=B.STYLE_RE.sub('',content)
content=re.sub(r'<script[^>]*src=[\'"][^\'"]*[\'"][^>]*>\s*</script>','',content)
content=re.sub(r'<link[^>]*rel=[\'"]stylesheet[\'"][^>]*>','',content)
content=B.rewrite(content)
own=[x for k,x in plan if k=='inline']
css=('/* 404 — inline CSS as served by the live 404 page, in document order. */\n\n'+'\n\n'.join(own))
open(REPO+'/public/css/page-404.css','w',encoding='utf-8').write(B.rewrite(css))
open(REPO+'/src/html/404.content.html','w',encoding='utf-8').write(content)
vendor=[x for k,x in plan if k=='vendor']; fonts=list(dict.fromkeys(x for k,x in plan if k=='font'))
bodyClass=re.search(r'class="([^"]*)"',re.search(r'<body([^>]*)>',doc,re.S).group(1)).group(1)
j=lambda v: json.dumps(v,ensure_ascii=False)
out=f'''---
// Ported from the live site's own 404 page, which uses the theme layout rather
// than the Nicepage chrome. Prerendered so `dist/404.html` exists — that file is
// what wrangler.jsonc's `not_found_handling: "404-page"` serves for unknown URLs.
import SiteBase from '../layouts/SiteBase.astro';
import content from '../html/404.content.html?raw';

export const prerender = true;
---

<SiteBase
  slug="404"
  chrome="none"
  bodyClass={{{j(bodyClass)}}}
  title={{{j(meta['title'])}}}
  robots="noindex, follow"
  vendor={{{j(vendor)}}}
  fonts={{{j(fonts)}}}
>
  <Fragment set:html={{content}} />
</SiteBase>
'''
open(REPO+'/src/pages/404.astro','w',encoding='utf-8').write(out)
print("404 ported: vendor sheets",len(vendor),"| inline blocks",len(own),"| markup",len(content),"bytes")
