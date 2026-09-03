import os as _os
WORK = _os.environ.get('PORT_WORK') or _os.path.join(
    _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), '.port-work')
REPO_ROOT = _os.environ.get('PORT_REPO') or _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))

import re, os, glob, json, urllib.request, urllib.parse, time, collections
S=WORK
REPO=REPO_ROOT
VDIR=os.path.join(REPO,'public/css/vendor')
ADIR=os.path.join(REPO,'public/css/assets')
os.makedirs(ADIR,exist_ok=True)
cssmap=json.load(open(S+'/css_map.json'))
# original URL for each vendored file, to resolve relative url()
origin={}
for u,local in cssmap.items():
    if local: origin[os.path.basename(local)]=u.split('?')[0]

def get(url,tries=4):
    for a in range(tries):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Accept-Encoding':'identity'})
            with urllib.request.urlopen(req,timeout=60) as r: return r.status,r.read()
        except urllib.error.HTTPError as e: return e.code,b''
        except Exception:
            if a==tries-1: return 0,b''
            time.sleep(2**a)

refs=collections.Counter(); fetched={}; failed=[]
for path in sorted(glob.glob(VDIR+'/*.css')):
    base=os.path.basename(path)
    text=open(path,encoding='utf-8',errors='replace').read()
    baseurl=origin.get(base)
    out=text; changed=0
    for m in set(re.findall(r'url\(\s*([\'"]?)([^\'")]+)\1\s*\)', text)):
        q,ref=m
        if ref.startswith('data:') or ref.startswith('#'): continue
        absu=urllib.parse.urljoin(baseurl, ref) if baseurl else ref
        if 'rexdalemobilewash.ca' not in absu: continue
        clean=absu.split('?')[0].split('#')[0]
        frag=absu.split('#')[1] if '#' in absu else None
        name=re.sub(r'[^A-Za-z0-9._-]','-', clean.split('/wp-content/')[-1].split('/wp-includes/')[-1])
        dest=os.path.join(ADIR,name)
        if clean not in fetched:
            code,data=get(clean)
            if code==200 and data:
                open(dest,'wb').write(data); fetched[clean]='/css/assets/'+name
            else:
                fetched[clean]=None; failed.append((code,clean))
        local=fetched[clean]
        if local:
            newref=local+('#'+frag if frag else '')
            out=out.replace(f'url({q}{ref}{q})', f'url({q}{newref}{q})')
            changed+=1
        refs[base]+=1
    if changed:
        open(path,'w',encoding='utf-8').write(out)
        print(f"  {base}: rewrote {changed} url() refs")
print(f"\nassets fetched: {sum(1 for v in fetched.values() if v)}  failed: {len(failed)}")
for c,u in failed: print(f"  FAIL HTTP {c} {u}")
