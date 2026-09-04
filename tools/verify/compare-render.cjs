const _path = require('path');
const WORK = process.env.PORT_WORK || _path.join(__dirname, '..', '..', '.port-work');
const REPO_ROOT = process.env.PORT_REPO || _path.join(__dirname, '..', '..');
// Reference (original document) vs port (Astro build), rendered in the same browser
// with the same local assets and the same fonts. Any difference is caused by the
// restructuring, which is the thing under test.
const { chromium } = require('playwright');
const fs = require('fs');

const S = WORK;
const OUT = S + '/compare';
const PORT_BASE = 'http://127.0.0.1:4321';   // the Astro build
const REF_BASE  = 'http://127.0.0.1:4322';   // the original documents, same paths
const FONTS = JSON.parse(fs.readFileSync(S + '/fontcache/index.json', 'utf8'));
const BYFAMILY = JSON.parse(fs.readFileSync(S + '/fontcache/byfamily.json', 'utf8'));
// VERIFY_WIDTH lets the same harness re-run at mobile widths; screenshots are
// suffixed so a narrow run does not overwrite the desktop set.
const VW = parseInt(process.env.VERIFY_WIDTH || '1440', 10);
const TAG = VW === 1440 ? '' : '.' + VW;

const PAGES = [
  'home:/', 'what-we-do:/what-we-do/', 'who-we-service:/who-we-service/', 'buildings:/buildings/',
  'de-icing-service:/de-icing-service/', 'fleet-washing:/fleet-washing/', 'garbage-rooms:/garbage-rooms/',
  'graffiti-removal:/graffiti-removal/', 'heavy-equipment-washing:/heavy-equipment-washing/',
  'parking-underground:/parking-underground/', 'storefronts-3:/storefronts-3/',
  'water-tanker-service:/water-tanker-service/', 'about-us:/about-us/', 'contact-us:/contact-us/',
  'residential:/residential/', 'lookbook:/lookbook/', 'blog-post-title:/blog-post-title/',
  'author-admin:/author/admin/',
].map((s) => s.split(':'));

const PROBES = [
  ['body', 'fontFamily,fontSize,color,backgroundColor'],
  ['header.u-header, header.site-header', 'backgroundColor,minHeight,position,color'],
  ['h1', 'fontFamily,fontSize,fontWeight,color,textAlign,lineHeight,letterSpacing'],
  ['h2', 'fontFamily,fontSize,fontWeight,color,textAlign'],
  ['h3', 'fontFamily,fontSize,color'],
  ['p', 'fontFamily,fontSize,lineHeight,color'],
  ['a.u-nav-link', 'fontFamily,fontSize,color,textTransform,padding,borderBottomWidth'],
  ['.u-sheet', 'width,maxWidth,marginLeft,marginRight'],
  ['footer', 'backgroundColor,minHeight,color'],
  ['.u-btn, .u-button-style', 'backgroundColor,color,borderRadius,padding,fontSize'],
  ['.u-nav-popup', 'display,position,backgroundColor'],
  ['.sbi_header_img img', 'width,height,borderRadius'],
  ['#sb_instagram .sbi_photo img', 'width,height,objectFit'],
];

async function setup(ctx) {
  // fonts.googleapis.com / gstatic are unreachable through this session's proxy;
  // serve the pre-fetched copies so both sides get identical, real type metrics.
  await ctx.route('**://fonts.googleapis.com/**', async (route) => {
    const u = route.request().url();
    // match on the `family` parameter, not the whole URL: the live hrefs carry extra
    // query params (display, ver) and HTML-encoded separators
    const fam = new URL(u).searchParams.get('family') || '';
    const local = FONTS[u] || BYFAMILY[fam];
    if (!local) {
      console.log('  !! no cached font CSS: ' + u.slice(0, 200));
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'text/css',
      body: fs.readFileSync(S + '/fontcache/' + local.split('/').pop(), 'utf8') });
  });
  // the cached CSS points at /__fonts/*, served by our own origin, so gstatic is unused
  // third-party tags that cannot load here and are identical on both sides anyway
  for (const g of ['**://www.googletagmanager.com/**', '**://www.google.com/**',
                   '**://www.gstatic.com/**', '**://fonts.gstatic.com/**', '**://scontent*/**'])
    await ctx.route(g, (route) => route.abort());
}

async function measure(page, url) {
  const errors = [], failed = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (/googletagmanager|google\.com|gstatic|scontent/.test(u)) return;   // intentionally aborted
    failed.push(u.replace(/^https?:\/\/127\.0\.0\.1:\d+/, '').slice(0, 120));
  });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  try { await page.evaluate(() => document.fonts.ready); } catch (e) {}
  // Scroll the whole page so anything observer-driven fires, then wait for every
  // image to finish decoding. These images carry decoding="async" and some are
  // 2560px wide, so a screenshot can otherwise land before the paint.
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 150));
    await Promise.all([...document.images].map((i) => (i.decode ? i.decode().catch(() => {}) : null)));
  });
  await page.waitForTimeout(1500);

  const data = await page.evaluate((probes) => {
    const px = (n) => Math.round(parseFloat(n) || 0);
    const out = { probes: {}, sections: [], images: {}, fonts: {}, counts: {} };
    for (const [sel, props] of probes) {
      const el = document.querySelector(sel);
      if (!el) { out.probes[sel] = null; continue; }
      const cs = getComputedStyle(el), rec = {};
      for (const p of props.split(',')) rec[p] = cs[p];
      const r = el.getBoundingClientRect();
      rec._box = `${px(r.width)}x${px(r.height)}`;
      out.probes[sel] = rec;
    }
    for (const s of document.querySelectorAll('section, .page-content, .site-main')) {
      const r = s.getBoundingClientRect();
      if (r.height < 5) continue;
      const cls = (s.className || '').toString();
      out.sections.push({
        id: (cls.split(/\s+/).find((c) => /^u-section-\d+$/.test(c)) || s.id || cls.split(/\s+/)[0] || '?'),
        h: px(r.height), w: px(r.width), top: px(r.top + window.scrollY),
        bg: getComputedStyle(s).backgroundColor,
        bgImg: getComputedStyle(s).backgroundImage === 'none' ? 'none' : 'set',
      });
    }
    const imgs = [...document.images];
    out.images.total = imgs.length;
    // an <img> with no src is not broken — the Instagram tiles past the first
    // page deliberately park their URL in data-sbi-src so a hidden tile costs
    // no request until Load More reveals it
    out.images.broken = imgs.filter((i) => (i.currentSrc || i.getAttribute('src'))
      && i.complete && i.naturalWidth === 0).map((i) => (i.currentSrc || i.src).slice(0, 120));
    out.images.brokenCount = out.images.broken.length;

    // An image that loaded fine but renders at zero opacity because an ANCESTOR
    // is transparent. This is what a plugin's fade-in JS leaves behind when the
    // JS is not shipped: the whole Instagram grid loaded and was invisible, and
    // the ref-vs-port diff could not see it because the reference strips the same
    // scripts. display:none is NOT flagged — that is usually deliberate.
    const effOpacity = (el) => {
      let o = 1;
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        o *= parseFloat(getComputedStyle(n).opacity || '1');
      }
      return o;
    };
    out.images.loadedButTransparent = imgs
      .filter((i) => i.naturalWidth > 0 && getComputedStyle(i).display !== 'none')
      .filter((i) => effOpacity(i) < 0.01)
      .map((i) => (i.currentSrc || i.src).slice(0, 110));
    out.images.transparentCount = out.images.loadedButTransparent.length;
    const h = document.querySelector('h1, h2');
    out.fonts.heading = h ? getComputedStyle(h).fontFamily : null;
    out.fonts.body = getComputedStyle(document.body).fontFamily;
    try {
      out.fonts.audiowide = document.fonts.check('16px Audiowide');
      out.fonts.roboto = document.fonts.check('16px Roboto');
      out.fonts.openSans = document.fonts.check('16px "Open Sans"');
    } catch (e) {}
    out.counts = {
      navLinks: document.querySelectorAll('a.u-nav-link, .site-navigation a').length,
      submenuItems: document.querySelectorAll('.u-nav-popup a, ul.sub-menu a').length,
      carousels: document.querySelectorAll('[data-u-ride="carousel"]').length,
      parallax: document.querySelectorAll('.u-parallax, .skrollable').length,
      forms: document.querySelectorAll('form').length,
      formFields: document.querySelectorAll('input, textarea, select').length,
      igTiles: document.querySelectorAll('.sbi_item').length,
      images: imgs.length,
      links: document.querySelectorAll('a[href]').length,
    };
    out.internalLinks = [...new Set([...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href')))].sort();
    out.docHeight = px(document.documentElement.scrollHeight);
    out.bodyClass = document.body.className;
    out.title = document.title;
    out.text = document.body.innerText.replace(/\s+/g, ' ').trim();
    return out;
  }, PROBES);
  return { ...data, errors, failed };
}

function diffProbes(a, b) {
  const out = [];
  for (const k of Object.keys(a.probes)) {
    const x = a.probes[k], y = b.probes[k];
    if (!x && !y) continue;
    if (!x || !y) { out.push(`${k}: ${!x ? 'MISSING in ref' : 'MISSING in port'}`); continue; }
    for (const p of Object.keys(x)) if (x[p] !== y[p]) out.push(`${k}.${p}: ref=${x[p]} port=${y[p]}`);
  }
  return out;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-lcd-text', '--force-device-scale-factor=1'],
  });
  const report = {};
  let clean = 0;
  for (const [slug, route] of PAGES) {
    const row = {};
    for (const [side, base] of [['ref', REF_BASE], ['port', PORT_BASE]]) {
      const ctx = await browser.newContext({ viewport: { width: VW, height: 900 },
        deviceScaleFactor: 1, isMobile: VW < 768, hasTouch: VW < 768 });
      await setup(ctx);
      const page = await ctx.newPage();
      row[side] = await measure(page, base + route);
      await page.screenshot({ path: `${OUT}/${slug}${TAG}.${side}.png`, fullPage: true });
      await ctx.close();
    }
    const d = diffProbes(row.ref, row.port);
    const secDiff = [];
    const n = Math.max(row.ref.sections.length, row.port.sections.length);
    for (let i = 0; i < n; i++) {
      const a = row.ref.sections[i], b = row.port.sections[i];
      if (!a || !b) { secDiff.push(`#${i}: ${!a ? 'extra in port ' + b.id : 'missing in port ' + a.id}`); continue; }
      if (a.id !== b.id) secDiff.push(`#${i}: id ref=${a.id} port=${b.id}`);
      if (Math.abs(a.h - b.h) > 2) secDiff.push(`${a.id}: height ref=${a.h} port=${b.h}`);
      if (a.bg !== b.bg) secDiff.push(`${a.id}: bg ref=${a.bg} port=${b.bg}`);
      if (a.bgImg !== b.bgImg) secDiff.push(`${a.id}: bgImage ref=${a.bgImg} port=${b.bgImg}`);
    }
    const countDiff = Object.keys(row.ref.counts).filter((k) => row.ref.counts[k] !== row.port.counts[k])
      .map((k) => `${k}: ref=${row.ref.counts[k]} port=${row.port.counts[k]}`);
    const heightDelta = row.port.docHeight - row.ref.docHeight;
    const textSame = row.ref.text === row.port.text;

    report[slug] = { diffProbes: d, secDiff, countDiff, heightDelta, textSame,
      transparentPort: row.port.images.transparentCount,
      transparentPortList: row.port.images.loadedButTransparent,
      refHeight: row.ref.docHeight, portHeight: row.port.docHeight,
      brokenRef: row.ref.images.brokenCount, brokenPort: row.port.images.brokenCount,
      brokenPortList: row.port.images.broken, failedPort: row.port.failed,
      errorsPort: row.port.errors, fontsRef: row.ref.fonts, fontsPort: row.port.fonts,
      bodyClassSame: row.ref.bodyClass === row.port.bodyClass,
      titleSame: row.ref.title === row.port.title,
      linksSame: JSON.stringify(row.ref.internalLinks) === JSON.stringify(row.port.internalLinks) };

    const ok = !d.length && !secDiff.length && !countDiff.length && Math.abs(heightDelta) <= 2
      && row.port.images.brokenCount === 0 && row.port.images.transparentCount === 0
      && !row.port.failed.length && textSame
      && report[slug].bodyClassSame && report[slug].linksSame;
    if (ok) clean++;
    console.log(`${ok ? 'MATCH  ' : 'DIFF   '} ${slug.padEnd(24)} h ref=${row.ref.docHeight} port=${row.port.docHeight} (${heightDelta >= 0 ? '+' : ''}${heightDelta})  broken=${row.port.images.brokenCount}  invisible=${row.port.images.transparentCount}  text=${textSame ? 'same' : 'DIFFERS'}`);
    if (row.port.images.transparentCount) {
      console.log(`         ${row.port.images.transparentCount} image(s) loaded but rendered at zero opacity:`);
      for (const u of row.port.images.loadedButTransparent.slice(0, 3)) console.log(`           ${u}`);
    }
    for (const x of [...d, ...secDiff, ...countDiff].slice(0, 8)) console.log(`         ${x}`);
    if (row.port.failed.length) console.log(`         failed requests: ${row.port.failed.slice(0, 4).join(', ')}`);
  }
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  console.log(`\n${clean}/${PAGES.length} pages render identically. report -> ${OUT}/report.json`);
  await browser.close();
})();
