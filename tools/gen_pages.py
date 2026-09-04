import os as _os
WORK = _os.environ.get('PORT_WORK') or _os.path.join(
    _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), '.port-work')
REPO_ROOT = _os.environ.get('PORT_REPO') or _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))

import json, os, re
S=WORK
REPO=REPO_ROOT
meta=json.load(open(S+'/pages_meta.json'))
def js(v): return json.dumps(v, ensure_ascii=False)

for slug,d in sorted(meta.items()):
    if slug.startswith('_'): continue   # not a route
    route=d['route']                    # build_site.py owns the slug -> route map
    up='../'*(route.count('/')+1)       # src/pages/a/b.astro -> ../../layouts
    m=d['meta']
    chrome='nicepage' if d['kind']=='nicepage' else 'none'
    jsonld=m.get('jsonld')
    lines=['---',
      "// Ported from the live page. The markup in ../html/%s.content.html is the" % slug,
      "// live site's own HTML, with asset URLs pointed at this repo; it is injected" ,
      "// with set:html so nothing is re-typed or reformatted.",
      "import SiteBase from '%slayouts/SiteBase.astro';" % up,
      "import content from '%shtml/%s.content.html?raw';" % (up, slug),
      '',
      'export const prerender = true;',
      '']
    if jsonld:
        lines.append('const jsonld = %s;' % js(jsonld))
    lines.append('---')
    lines.append('')
    props=[f'  slug="{slug}"', f'  chrome="{chrome}"',
           f'  bodyClass={{{js(d["bodyClass"])}}}',
           f'  title={{{js(m["title"])}}}']
    if m.get('description'): props.append(f'  description={{{js(m["description"])}}}')
    if m.get('canonical'):   props.append(f'  canonical={{{js(m["canonical"])}}}')
    if m.get('robots'):      props.append(f'  robots={{{js(m["robots"])}}}')
    if m.get('og'):          props.append(f'  og={{{js([list(x) for x in m["og"]])}}}')
    if m.get('named'):       props.append(f'  named={{{js([list(x) for x in m["named"]])}}}')
    if m.get('lang'):        props.append(f'  lang={{{js(m["lang"])}}}')
    if m.get('viewport'):    props.append(f'  viewport={{{js(m["viewport"])}}}')
    if m.get('profile'):     props.append(f'  profile={{{js(m["profile"])}}}')
    if m.get('dataLayer'):   props.append(f'  dataLayer={{{js(m["dataLayer"])}}}')
    if jsonld:               props.append('  jsonld={jsonld}')
    if not d.get('needsNicepage', True): props.append('  needsNicepage={false}')
    props.append(f'  vendor={{{js(d["vendor"])}}}')
    props.append(f'  fonts={{{js(d["fonts"])}}}')
    lines.append('<SiteBase')
    lines += props
    lines.append('>')
    lines.append('  <Fragment set:html={content} />')
    lines.append('</SiteBase>')
    dest=os.path.join(REPO,'src/pages',route+'.astro')
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    open(dest,'w',encoding='utf-8').write('\n'.join(lines)+'\n')
    print(f"  src/pages/{route}.astro   ({d['kind']}, {len(d['vendor'])} sheets)")
