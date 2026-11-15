"""Read-only SEO review checks; no form submission or database access."""
import json
from pathlib import Path
from bs4 import BeautifulSoup
root=Path(__file__).resolve().parents[1];fails=[];pages=0;matches=0
for p in (root/"dist/client").rglob("*.html"):
 s=BeautifulSoup(p.read_text(encoding="utf-8"),"html.parser");pages+=1
 desc=s.select_one('meta[name="description"]')
 og=s.select_one('meta[property="og:description"]')
 if desc and og and desc.get("content")!=og.get("content"):fails.append(str(p)+": description/OG drift")
 for tag in s.select('script[type="application/ld+json"]'):
  d=json.loads(tag.get_text())
  for n in d.get("@graph",[]):
   types=n.get("@type",[]);types=[types] if isinstance(types,str) else types
   if "WebPage" in types and desc:
    matches+=1
    if n.get("description")!=desc.get("content"):fails.append(str(p)+": schema description drift")
   for a in n.get("potentialAction",[]):
    if a.get("@type")=="SearchAction" and "?s={search_term_string}" in json.dumps(a):fails.append(str(p)+": retired search advertised")
print(json.dumps({"pages":pages,"webpage_description_matches":matches,"failures":fails,"form_database_viewport_tests":"not performed"},indent=2))
raise SystemExit(bool(fails))
