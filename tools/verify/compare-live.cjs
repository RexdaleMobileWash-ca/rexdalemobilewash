// Live WordPress site vs the deployed Astro port, rendered side by side in the
// same Chromium, at the same route paths, with the same fonts and the same
// third-party tags blocked on both sides.
//
// This is the check `run-verify.sh` cannot make. That harness compares the port
// against the *captured* document with the same plugin scripts stripped, so any
// regression caused by not shipping that JS appears on both sides and reports a
// match. Here the reference is the real site, running its real JavaScript.
//
//   LIVE=https://www.rexdalemobilewash.ca \
//   STAGE=https://rexdalemobilewash.ash-47a.workers.dev \
//   VERIFY_WIDTH=1440 node tools/verify/compare-live.cjs
//
// Writes .port-work/live/<slug><tag>.<side>.png and .port-work/live/report<tag>.json
const _path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const WORK = process.env.PORT_WORK || _path.join(__dirname, '..', '..', '.port-work');
const OUT = _path.join(WORK, 'live');
const LIVE = (process.env.LIVE || 'https://www.rexdalemobilewash.ca').replace(/\/$/, '');
const STAGE = (process.env.STAGE || 'https://rexdalemobilewash.ash-47a.workers.dev').replace(/\/$/, '');
const VW = parseInt(process.env.VERIFY_WIDTH || '1440', 10);
const TAG = VW === 1440 ? '' : '.' + VW;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;

const PAGES = [
  'home:/', 'what-we-do:/what-we-do/', 'who-we-service:/who-we-service/', 'buildings:/buildings/',
  'de-icing-service:/de-icing-service/', 'fleet-washing:/fleet-washing/', 'garbage-rooms:/garbage-rooms/',
  'graffiti-removal:/graffiti-removal/', 'heavy-equipment-washing:/heavy-equipment-washing/',
  'parking-underground:/parking-underground/', 'storefronts-3:/storefronts-3/',
  'water-tanker-service:/water-tanker-service/', 'about-us:/about-us/', 'contact-us:/contact-us/',
  'residential:/residential/', 'lookbook:/lookbook/', 'blog-post-title:/blog-post-title/',
  'author-admin:/author/admin/',
].map((s) => s.split(':')).filter(([slug]) => !ONLY || ONLY.includes(slug));

const PROBES = [
  ['body', 'fontFamily,fontSize,color,backgroundColor,margin'],
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
  ['#sb_instagram .sbi_photo', 'width,height,backgroundSize'],
  ['form', 'display,width'],
  ['input[type=text], input[type=email]', 'width,height,fontSize,borderWidth,padding'],
];

// Third-party that either cannot be compared (signed, expiring URLs), is identical
// on both sides by construction, or would make the run non-deterministic.
const BLOCK = [
  '**://www.googletagmanager.com/**', '**://www.google-analytics.com/**',
  '**://www.google.com/**', '**://www.gstatic.com/**', '**://stats.g.doubleclick.net/**',
  '**://connect.facebook.net/**', '**://www.facebook.com/**',
];

// Chromium cannot open a TLS tunnel through this session's egress proxy, so it
// makes no network connections at all: every request is intercepted and fulfilled
// from Node, whose fetch does go through the proxy (NODE_USE_ENV_PROXY=1). A
// process-wide cache keeps a shared asset byte-identical across both sides.
const CACHE = new Map();
const BLOCK_RE = BLOCK.map((b) => new RegExp('^' + b.replace(/[.]/g, '\\.').replace(/\*\*/g, '.*').replace(/\\\.\*/g, '.*')));
const isBlocked = (u) => BLOCK.some((b) => {
  const host = b.replace('**://', '').replace('/**', '');
  return u.includes(host);
});

async function fetchThrough(url, method, headers, postData) {
  const key = method + ' ' + url;
  if (method === 'GET' && CACHE.has(key)) return CACHE.get(key);
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        method, headers, body: postData || undefined, redirect: 'follow',
        signal: AbortSignal.timeout(60000),
      });
      const body = Buffer.from(await r.arrayBuffer());
      const h = {};
      for (const [k, v] of r.headers) {
        const lk = k.toLowerCase();
        if (['content-encoding', 'content-length', 'transfer-encoding', 'connection',
             'content-security-policy', 'content-security-policy-report-only'].includes(lk)) continue;
        h[k] = v;
      }
      const out = { status: r.status, headers: h, body };
      if (method === 'GET') CACHE.set(key, out);
      return out;
    } catch (e) { last = e; }
  }
  throw last;
}

async function setup(ctx) {
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (isBlocked(url)) return route.abort();
    if (!/^https?:/.test(url)) return route.continue();
    const headers = { ...req.headers() };
    delete headers['accept-encoding'];
    delete headers['host'];
    try {
      const r = await fetchThrough(url, req.method(), headers, req.postData());
      return route.fulfill({ status: r.status, headers: r.headers, body: r.body });
    } catch (e) {
      return route.abort();
    }
  });
}

async function measure(page, url) {
  const errors = [], failed = [], requests = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (BLOCK.some((b) => new RegExp(b.replace(/\*\*/g, '.*').replace(/:\/\//, '://')).test(u))) return;
    failed.push({ url: u.slice(0, 160), err: (r.failure() || {}).errorText });
  });
  page.on('response', (r) => {
    if (r.status() >= 400) requests.push({ url: r.url().slice(0, 160), status: r.status() });
  });

  const resp = await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  const status = resp ? resp.status() : 0;
  try { await page.evaluate(() => document.fonts.ready); } catch (e) {}
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 200));
    await Promise.all([...document.images].map((i) => (i.decode ? i.decode().catch(() => {}) : null)));
  });
  // On the live side Smash Balloon ships every tile as a placeholder and swaps in
  // the real photo from a signed CDN url at runtime. Screenshot before that
  // settles and the live feed photographs as blank tiles, which reads as a
  // difference the port did not cause. Wait for the swap (the port has nothing
  // to wait for — its tiles are painted by CSS — so this is a no-op there).
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('#sbi_images .sbi_item .sbi_photo img')]
      .filter((i) => i.getBoundingClientRect().height > 1 || getComputedStyle(i).display === 'none');
    if (!imgs.length) return true;
    return imgs.every((i) => !/placeholder\.png/.test(i.currentSrc || i.src) && i.naturalWidth > 1);
  }, null, { timeout: 45000 }).catch(() => {});
  await page.evaluate(async () => {
    await Promise.all([...document.images].map((i) => (i.decode ? i.decode().catch(() => {}) : null)));
  });
  await page.waitForTimeout(2500);

  const data = await page.evaluate((probes) => {
    const px = (n) => Math.round(parseFloat(n) || 0);
    const out = { probes: {}, sections: [], images: {}, fonts: {}, counts: {}, tree: [] };
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
        bgImg: getComputedStyle(s).backgroundImage === 'none' ? 'none'
          : (getComputedStyle(s).backgroundImage.match(/\/([^/"')]+)["')]/) || [, 'set'])[1],
      });
    }
    // A structural signature of every laid-out element: tag, the classes that
    // matter for layout, and the box. Enough to localise a difference to a node.
    const walk = (el, depth) => {
      if (depth > 6) return;
      for (const c of el.children) {
        const r = c.getBoundingClientRect();
        if (r.width < 1 && r.height < 1) continue;
        out.tree.push({
          d: depth, t: c.tagName.toLowerCase(),
          c: (c.className || '').toString().split(/\s+/).filter(Boolean).slice(0, 4).join('.'),
          b: `${px(r.width)}x${px(r.height)}@${px(r.left)},${px(r.top + window.scrollY)}`,
        });
        walk(c, depth + 1);
      }
    };
    walk(document.body, 0);

    const imgs = [...document.images];
    out.images.total = imgs.length;
    out.images.broken = imgs.filter((i) => i.complete && i.naturalWidth === 0)
      .map((i) => (i.currentSrc || i.src).slice(0, 140));
    out.images.brokenCount = out.images.broken.length;
    const effOpacity = (el) => {
      let o = 1;
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity || '1');
      return o;
    };
    out.images.loadedButTransparent = imgs
      .filter((i) => i.naturalWidth > 0 && getComputedStyle(i).display !== 'none')
      .filter((i) => effOpacity(i) < 0.01).map((i) => (i.currentSrc || i.src).slice(0, 130));
    out.images.transparentCount = out.images.loadedButTransparent.length;
    // filenames only: the two sides serve from different hosts by design
    out.images.names = imgs.map((i) => ((i.currentSrc || i.src).split('?')[0].split('/').pop() || '')).sort();

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
      igVisibleTiles: [...document.querySelectorAll('.sbi_item')]
        .filter((e) => e.getBoundingClientRect().height > 1).length,
      galleryItems: document.querySelectorAll('.u-gallery-item, .gallery-item').length,
      images: imgs.length,
      links: document.querySelectorAll('a[href]').length,
      buttons: document.querySelectorAll('a.u-btn, button').length,
      videos: document.querySelectorAll('video, iframe').length,
    };
    out.internalLinks = [...new Set([...document.querySelectorAll('a[href]')]
      .map((a) => a.getAttribute('href'))
      .filter((h) => h && !/^(#|mailto:|tel:|javascript:)/.test(h))
      .map((h) => h.replace(/^https?:\/\/(www\.)?[^/]+/, '')))].sort();
    out.extLinks = [...new Set([...document.querySelectorAll('a[href^="http"]')]
      .map((a) => a.getAttribute('href'))
      .filter((h) => !/rexdalemobilewash|workers\.dev/.test(h)))].sort();
    out.docHeight = px(document.documentElement.scrollHeight);
    out.docWidth = px(document.documentElement.scrollWidth);
    out.bodyClass = document.body.className;
    out.title = document.title;
    out.metaDesc = (document.querySelector('meta[name=description]') || {}).content || null;
    out.canonical = (document.querySelector('link[rel=canonical]') || {}).href || null;
    out.text = document.body.innerText.replace(/\s+/g, ' ').trim();
    return out;
  }, PROBES);
  return { ...data, errors, failed, http: status, badResponses: requests };
}

function diffProbes(a, b) {
  const out = [];
  for (const k of Object.keys(a.probes)) {
    const x = a.probes[k], y = b.probes[k];
    if (!x && !y) continue;
    if (!x || !y) { out.push(`${k}: ${!x ? 'MISSING on live' : 'MISSING on stage'}`); continue; }
    for (const p of Object.keys(x)) if (x[p] !== y[p]) out.push(`${k}.${p}: live=${x[p]} stage=${y[p]}`);
  }
  return out;
}

function diffTree(a, b) {
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0, shown = 0; i < n && shown < 40; i++) {
    const x = a[i], y = b[i];
    if (!x || !y) { out.push(`#${i}: ${!x ? 'extra on stage: ' + y.t + '.' + y.c : 'missing on stage: ' + x.t + '.' + x.c}`); shown++; continue; }
    if (x.t !== y.t || x.c !== y.c) { out.push(`#${i}: live=${x.t}.${x.c} stage=${y.t}.${y.c}`); shown++; continue; }
    if (x.b !== y.b) { out.push(`#${i} ${x.t}.${x.c}: box live=${x.b} stage=${y.b}`); shown++; }
  }
  return out;
}

function textDiff(a, b) {
  if (a === b) return null;
  const A = a.split(' '), B = b.split(' ');
  let i = 0; while (i < A.length && i < B.length && A[i] === B[i]) i++;
  let j = 0; while (j < A.length - i && j < B.length - i && A[A.length - 1 - j] === B[B.length - 1 - j]) j++;
  return { onlyLive: A.slice(i, A.length - j).join(' ').slice(0, 400),
           onlyStage: B.slice(i, B.length - j).join(' ').slice(0, 400) };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // Both hosts are on the public internet, so unlike the local ref-vs-port
  // harness this one has to go through the session's egress proxy.
  // no browser-level proxy: every request is fulfilled from Node (see setup()).
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-lcd-text', '--force-device-scale-factor=1',
      '--ignore-certificate-errors'],

  });
  const report = {};
  let clean = 0;
  for (const [slug, route] of PAGES) {
    const row = {};
    for (const [side, base] of [['live', LIVE], ['stage', STAGE]]) {
      const ctx = await browser.newContext({ viewport: { width: VW, height: 900 },
        deviceScaleFactor: 1, isMobile: VW < 768, hasTouch: VW < 768 });
      await setup(ctx);
      const page = await ctx.newPage();
      try {
        row[side] = await measure(page, base + route);
        await page.screenshot({ path: `${OUT}/${slug}${TAG}.${side}.png`, fullPage: true });
      } catch (e) {
        row[side] = { error: String(e).slice(0, 300), probes: {}, sections: [], tree: [],
          counts: {}, images: { brokenCount: -1, transparentCount: -1, names: [] },
          text: '', internalLinks: [], extLinks: [], docHeight: -1, errors: [], failed: [], badResponses: [] };
      }
      await ctx.close();
    }
    const d = diffProbes(row.live, row.stage);
    const secDiff = [];
    const n = Math.max(row.live.sections.length, row.stage.sections.length);
    for (let i = 0; i < n; i++) {
      const a = row.live.sections[i], b = row.stage.sections[i];
      if (!a || !b) { secDiff.push(`#${i}: ${!a ? 'extra on stage ' + b.id : 'missing on stage ' + a.id}`); continue; }
      if (a.id !== b.id) secDiff.push(`#${i}: id live=${a.id} stage=${b.id}`);
      if (Math.abs(a.h - b.h) > 2) secDiff.push(`${a.id}: height live=${a.h} stage=${b.h}`);
      if (a.bg !== b.bg) secDiff.push(`${a.id}: bg live=${a.bg} stage=${b.bg}`);
      if (a.bgImg !== b.bgImg) secDiff.push(`${a.id}: bgImage live=${a.bgImg} stage=${b.bgImg}`);
    }
    const countDiff = Object.keys(row.live.counts).filter((k) => row.live.counts[k] !== row.stage.counts[k])
      .map((k) => `${k}: live=${row.live.counts[k]} stage=${row.stage.counts[k]}`);
    const heightDelta = row.stage.docHeight - row.live.docHeight;
    const td = textDiff(row.live.text, row.stage.text);
    const imgOnlyLive = row.live.images.names.filter((x) => !row.stage.images.names.includes(x));
    const imgOnlyStage = row.stage.images.names.filter((x) => !row.live.images.names.includes(x));
    const linkDiff = {
      onlyLive: row.live.internalLinks.filter((x) => !row.stage.internalLinks.includes(x)),
      onlyStage: row.stage.internalLinks.filter((x) => !row.live.internalLinks.includes(x)),
      extOnlyLive: row.live.extLinks.filter((x) => !row.stage.extLinks.includes(x)),
      extOnlyStage: row.stage.extLinks.filter((x) => !row.live.extLinks.includes(x)),
    };

    report[slug] = {
      route, diffProbes: d, secDiff, countDiff, heightDelta, textDiff: td,
      treeDiff: diffTree(row.live.tree, row.stage.tree),
      treeLenLive: row.live.tree.length, treeLenStage: row.stage.tree.length,
      liveHeight: row.live.docHeight, stageHeight: row.stage.docHeight,
      liveWidth: row.live.docWidth, stageWidth: row.stage.docWidth,
      brokenLive: row.live.images.brokenCount, brokenStage: row.stage.images.brokenCount,
      brokenLiveList: row.live.images.broken, brokenStageList: row.stage.images.broken,
      transparentStage: row.stage.images.transparentCount,
      transparentStageList: row.stage.images.loadedButTransparent,
      imgOnlyLive, imgOnlyStage, linkDiff,
      titleLive: row.live.title, titleStage: row.stage.title,
      metaLive: row.live.metaDesc, metaStage: row.stage.metaDesc,
      canonicalLive: row.live.canonical, canonicalStage: row.stage.canonical,
      bodyClassLive: row.live.bodyClass, bodyClassStage: row.stage.bodyClass,
      fontsLive: row.live.fonts, fontsStage: row.stage.fonts,
      errorsStage: row.stage.errors, errorsLive: row.live.errors,
      failedStage: row.stage.failed, badResponsesStage: row.stage.badResponses,
      httpLive: row.live.http, httpStage: row.stage.http,
      loadError: row.live.error || row.stage.error || null,
    };

    const ok = !d.length && !secDiff.length && !countDiff.length && Math.abs(heightDelta) <= 2
      && !td && row.stage.images.brokenCount === 0 && row.stage.images.transparentCount === 0
      && !linkDiff.onlyLive.length && !linkDiff.onlyStage.length
      && row.live.title === row.stage.title;
    if (ok) clean++;
    console.log(`${ok ? 'MATCH  ' : 'DIFF   '} ${slug.padEnd(24)} h live=${row.live.docHeight} stage=${row.stage.docHeight} (${heightDelta >= 0 ? '+' : ''}${heightDelta})  broken live=${row.live.images.brokenCount} stage=${row.stage.images.brokenCount}  invisible=${row.stage.images.transparentCount}  text=${td ? 'DIFFERS' : 'same'}`);
    for (const x of [...d, ...secDiff, ...countDiff].slice(0, 10)) console.log(`         ${x}`);
    if (td) {
      if (td.onlyLive) console.log(`         text only on live : ${td.onlyLive.slice(0, 160)}`);
      if (td.onlyStage) console.log(`         text only on stage: ${td.onlyStage.slice(0, 160)}`);
    }
    if (linkDiff.onlyLive.length) console.log(`         links only on live : ${linkDiff.onlyLive.slice(0, 6).join(' ')}`);
    if (linkDiff.onlyStage.length) console.log(`         links only on stage: ${linkDiff.onlyStage.slice(0, 6).join(' ')}`);
  }
  fs.writeFileSync(`${OUT}/report${TAG}.json`, JSON.stringify(report, null, 1));
  console.log(`\n${clean}/${PAGES.length} pages match. report -> ${OUT}/report${TAG}.json`);
  await browser.close();
})();
