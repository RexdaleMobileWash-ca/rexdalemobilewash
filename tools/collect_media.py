import os as _os
WORK = _os.environ.get('PORT_WORK') or _os.path.join(
    _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), '.port-work')
REPO_ROOT = _os.environ.get('PORT_REPO') or _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))

import re, glob, os, json, collections, html
S=WORK
MEDIA={'.jpg','.jpeg','.png','.gif','.webp','.svg','.avif','.ico','.mp4','.webm'}
# both the production host and the dead staging host used by /lookbook/
host_re=re.compile(r'(?:https?:)?//(?:www\.)?(?:new\.)?rexdalemobilewash\.ca/([^\s"\'()<>\\]+)')
paths=collections.Counter(); where=collections.defaultdict(set)
for f in sorted(glob.glob(S+'/pages/*.html')):
    t=html.unescape(html.unescape(open(f,encoding='utf-8',errors='replace').read()))
    for m in host_re.finditer(t):
        p=m.group(1).split('?')[0].split('#')[0]
        if os.path.splitext(p)[1].lower() in MEDIA and p.startswith('wp-content/uploads/'):
            paths[p]+=1; where[p].add(os.path.basename(f)[:-5])
json.dump(sorted(paths), open(S+'/media_final.json','w'), indent=0)
print("distinct upload media:", len(paths))
for p in sorted(paths):
    print(f"  {p}   ({len(where[p])} pages)")
