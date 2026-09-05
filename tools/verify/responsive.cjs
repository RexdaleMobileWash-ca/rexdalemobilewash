const _path = require('path');
const WORK = process.env.PORT_WORK || _path.join(__dirname, '..', '..', '.port-work');
const REPO_ROOT = process.env.PORT_REPO || _path.join(__dirname, '..', '..');
const { chromium } = require('playwright');
const fs=require('fs');
const { routeImages } = require('./img-route.cjs');
const S=WORK;
const FONTS=JSON.parse(fs.readFileSync(S+'/fontcache/index.json','utf8'));
const BY=JSON.parse(fs.readFileSync(S+'/fontcache/byfamily.json','utf8'));
const WIDTHS=[320,375,768,1024,1440,2560,3440];
const ROUTES=['/','/who-we-service/','/contact-us/','/lookbook/'];
async function setup(ctx){
  await ctx.route('**://fonts.googleapis.com/**',r=>{const f=new URL(r.request().url()).searchParams.get('family')||'';
    const l=FONTS[r.request().url()]||BY[f];
    return r.fulfill({status:200,contentType:'text/css',body:l?fs.readFileSync(S+'/fontcache/'+l.split('/').pop(),'utf8'):''});});
  for(const g of ['**://www.googletagmanager.com/**','**://www.google.com/**','**://www.gstatic.com/**','**://fonts.gstatic.com/**','**://scontent*/**'])
    await ctx.route(g,r=>r.abort());
  // img.[domain] is unreachable from Chromium here; serve the same bytes
  // from the bucket's staging directory. See tools/verify/img-route.cjs.
  await routeImages(ctx);
}
(async()=>{
  const b=await chromium.launch({executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  const rows=[];
  for(const base of [['port','http://127.0.0.1:4321'],['ref','http://127.0.0.1:4322']]){
    for(const w of WIDTHS){
      for(const route of ROUTES){
        const ctx=await b.newContext({viewport:{width:w,height:900},isMobile:w<768,hasTouch:w<768}); await setup(ctx);
        const p=await ctx.newPage();
        await p.goto(base[1]+route,{waitUntil:'load',timeout:60000});
        await p.waitForTimeout(350);
        const m=await p.evaluate(()=>{
          const de=document.documentElement;
          const over=[];
          document.querySelectorAll('*').forEach(el=>{const r=el.getBoundingClientRect();
            if(r.width>0 && (r.right>de.clientWidth+1 || r.left<-1)){
              const c=(el.className||'').toString().split(/\s+/)[0]||el.tagName;
              over.push(c+':'+Math.round(r.right-de.clientWidth));}});
          return {scrollW:de.scrollWidth, clientW:de.clientWidth,
                  hOverflow: de.scrollWidth>de.clientWidth+1,
                  offenders:[...new Set(over)].slice(0,4)};
        });
        rows.push({side:base[0],w,route,...m});
        await ctx.close();
      }
    }
  }
  fs.writeFileSync(S+'/compare/responsive.json',JSON.stringify(rows,null,1));
  // report
  const byW={};
  for(const r of rows){ const k=r.side+'@'+r.w; byW[k]=byW[k]||[]; if(r.hOverflow) byW[k].push(r.route+' (+'+(r.scrollW-r.clientW)+'px)'); }
  console.log('horizontal overflow by width (empty = none):');
  for(const w of WIDTHS){
    const pp=byW['port@'+w]||[], rr=byW['ref@'+w]||[];
    const same = JSON.stringify(pp)===JSON.stringify(rr);
    console.log(`  ${String(w).padStart(5)}px  port:${pp.length?pp.join(', '):'none'}`);
    if(!same) console.log(`          ref :${rr.length?rr.join(', '):'none'}   <-- DIFFERS FROM REFERENCE`);
  }
  await b.close();
})();
