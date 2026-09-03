import os as _os
_HERE = _os.path.dirname(_os.path.abspath(__file__))          # tools/verify
_ROOT = _os.path.dirname(_os.path.dirname(_HERE))              # repo root
WORK = _os.environ.get('PORT_WORK') or _os.path.join(_ROOT, '.port-work')
REPO_ROOT = _os.environ.get('PORT_REPO') or _ROOT

from PIL import Image, ImageChops
import glob, os, sys
S=WORK+'/compare'
rows=[]
for ref in sorted(glob.glob(S+'/*.ref.png')):
    slug=os.path.basename(ref)[:-8]
    port=f'{S}/{slug}.port.png'
    if not os.path.exists(port): rows.append((slug,'NO PORT SHOT',0,0)); continue
    a=Image.open(ref).convert('RGB'); b=Image.open(port).convert('RGB')
    if a.size!=b.size:
        rows.append((slug,f'SIZE {a.size} vs {b.size}',0,0)); continue
    d=ImageChops.difference(a,b)
    bbox=d.getbbox()
    if bbox is None:
        rows.append((slug,'IDENTICAL',0,0)); continue
    # count differing pixels and max channel delta
    hist=d.convert('L').histogram()
    diffpx=sum(hist[1:])
    total=a.size[0]*a.size[1]
    mx=max(i for i,c in enumerate(hist) if c)
    rows.append((slug,f'{diffpx} px ({100*diffpx/total:.4f}%) maxdelta={mx} bbox={bbox}',diffpx,total))
    d.convert('L').point(lambda v: 255 if v>8 else 0).save(f'{S}/{slug}.diff.png')
if not rows:
    print('  no screenshots found in '+S); raise SystemExit(1)
w=max(len(r[0]) for r in rows)
ident=0
for slug,msg,dp,tp in rows:
    print(f"  {slug:<{w}}  {msg}")
    if msg=='IDENTICAL': ident+=1
print(f"\npixel-identical: {ident}/{len(rows)}")
