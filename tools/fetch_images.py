import os as _os
WORK = _os.environ.get('PORT_WORK') or _os.path.join(
    _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), '.port-work')
REPO_ROOT = _os.environ.get('PORT_REPO') or _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))

import json, os, urllib.request, sys, time
S=WORK
# The bucket's staging directory, not public/. Images are served from img. (AD-9), so a
# photo downloaded into the repo would be one the Worker ships, gate 5's reconciliation
# never sees, and the image host does not hold. Re-run tools/reconcile-images.py after
# this to put anything new into the bucket.
DEST=S+'/b2-staging'
paths=json.load(open(S+'/media_final.json'))
ok=fail=skip=0; failures=[]
for p in paths:
    rel=p[len('wp-content/uploads/'):]
    out=os.path.join(DEST,rel)
    os.makedirs(os.path.dirname(out),exist_ok=True)
    if os.path.exists(out) and os.path.getsize(out)>0:
        skip+=1; continue
    url='https://www.rexdalemobilewash.ca/'+p
    for attempt in range(4):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Accept':'image/*,*/*'})
            with urllib.request.urlopen(req,timeout=60) as r:
                data=r.read()
            if len(data)<100: raise ValueError(f'tiny response {len(data)}')
            open(out,'wb').write(data); ok+=1; break
        except Exception as e:
            if attempt==3:
                fail+=1; failures.append((p,str(e)))
            else: time.sleep(2**attempt)
print(f"downloaded={ok} skipped={skip} failed={fail}")
for p,e in failures: print("  FAIL",p,e)
