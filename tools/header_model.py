import os as _os
WORK = _os.environ.get('PORT_WORK') or _os.path.join(
    _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), '.port-work')
REPO_ROOT = _os.environ.get('PORT_REPO') or _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))

import re, glob, os, json
S=WORK
ANC='current-menu-ancestor current-menu-parent current_page_parent current_page_ancestor '
def neutralize(h):
    h=re.sub(r'current-menu-item page_item page-item-\d+ current_page_item ','',h)
    h=re.sub(re.escape(ANC),'',h)
    h=h.replace(' aria-current="page"','')
    h=re.sub(r'(class="[^"]*?) active"', r'\1"', h)
    return h
def analyse(h):
    li=re.compile(r'<li[^>]*class="([^"]*)"')
    active=None; pid=None; anc=None
    for m in li.finditer(h):
        c=m.group(1)
        if 'current-menu-item' in c:
            mm=re.search(r'\bmenu-item-(\d+)\b(?!-)',c.replace('menu-item-type-post_type','').replace('menu-item-object-page','').replace('menu-item-has-children','').replace('menu-item-home',''))
            pi=re.search(r'page-item-(\d+)',c)
            ids=re.findall(r'\bmenu-item-(\d+)\b',c)
            if ids: active=ids[-1]
            if pi: pid=pi.group(1)
        if 'current-menu-ancestor' in c:
            ids=re.findall(r'\bmenu-item-(\d+)\b',c)
            if ids: anc=ids[-1]
    return active,pid,anc

neutrals={}; model={}
for f in sorted(glob.glob(S+'/parts/*.header.html')):
    slug=os.path.basename(f).split('.')[0]
    h=open(f,encoding='utf-8',errors='replace').read()
    n=neutralize(h)
    neutrals.setdefault(n,[]).append(slug)
    model[slug]=analyse(h)
print("distinct neutral headers:", len(neutrals))
for n,slugs in neutrals.items(): print(f"  {len(n)} bytes  <- {len(slugs)} pages")
print()
for s,v in sorted(model.items()): print(f"  {s:<26} active_menu_item={v[0]}  page_item={v[1]}  ancestor={v[2]}")
NEU=list(neutrals)[0]
open(S+'/header.neutral.html','w').write(NEU)
json.dump(model,open(S+'/header_model.json','w'),indent=1)
