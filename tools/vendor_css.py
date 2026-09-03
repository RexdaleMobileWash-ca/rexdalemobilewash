import os as _os
WORK = _os.environ.get('PORT_WORK') or _os.path.join(
    _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), '.port-work')
REPO_ROOT = _os.environ.get('PORT_REPO') or _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))

import re, glob, os, json, html, urllib.request, time, hashlib
S=WORK
REPO=REPO_ROOT
VDIR=os.path.join(REPO,'public/css/vendor')
os.makedirs(VDIR,exist_ok=True)

def get(url, tries=4):
    for a in range(tries):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Accept-Encoding':'identity'})
            with urllib.request.urlopen(req,timeout=60) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, b''
        except Exception:
            if a==tries-1: return 0, b''
            time.sleep(2**a)

# 1. every distinct same-host stylesheet URL, in first-seen order
seen=[]
for f in sorted(glob.glob(S+'/pages/*.html')):
    t=open(f,encoding='utf-8',errors='replace').read()
    for m in re.finditer(r'<link[^>]*rel=[\'"]stylesheet[\'"][^>]*>', t):
        hr=re.search(r'href=[\'"]([^\'"]+)', m.group(0))
        if not hr: continue
        u=html.unescape(hr.group(1))
        if 'rexdalemobilewash.ca' in u and u not in seen: seen.append(u)

def flat(u):
    p=u.split('?')[0]
    parts=p.split('/wp-content/')[-1].split('/wp-includes/')[-1]
    name=re.sub(r'[^A-Za-z0-9._-]','-',parts)
    return name

mapping={}
print("=== vendoring stylesheets ===")
for u in seen:
    name=flat(u); out=os.path.join(VDIR,name)
    code,data=get(u)
    if code!=200 or data[:20].lstrip().startswith(b'<!doctype') or data[:6].lower()==b'<html':
        print(f"  SKIP  HTTP {code}  {u.split('?')[0].split('/')[-1]}   <-- not served")
        mapping[u]=None; continue
    open(out,'wb').write(data)
    mapping[u]='/css/vendor/'+name
    print(f"  ok    HTTP {code} {len(data):>8}b  {name}")
json.dump(mapping, open(S+'/css_map.json','w'), indent=1)
