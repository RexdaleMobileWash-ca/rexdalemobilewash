const _path = require('path');
const WORK = process.env.PORT_WORK || _path.join(__dirname, '..', '..', '.port-work');
const REPO_ROOT = process.env.PORT_REPO || _path.join(__dirname, '..', '..');
// Behaviour parity: the dropdown, the off-canvas menu and the carousel.
// A screenshot cannot see any of this, and all three are places the port could
// silently lose something (the submenu is the only route to 9 pages).
const { chromium } = require('playwright');
const fs = require('fs');
const { routeImages } = require('./img-route.cjs');
const S = WORK;
const FONTS = JSON.parse(fs.readFileSync(S + '/fontcache/index.json', 'utf8'));
const BY = JSON.parse(fs.readFileSync(S + '/fontcache/byfamily.json', 'utf8'));
const SIDES = [['ref', 'http://127.0.0.1:4322'], ['port', 'http://127.0.0.1:4321']];

async function setup(ctx) {
  await ctx.route('**://fonts.googleapis.com/**', (r) => {
    const f = new URL(r.request().url()).searchParams.get('family') || '';
    const l = FONTS[r.request().url()] || BY[f];
    return r.fulfill({ status: 200, contentType: 'text/css',
      body: l ? fs.readFileSync(S + '/fontcache/' + l.split('/').pop(), 'utf8') : '' });
  });
  for (const g of ['**://www.googletagmanager.com/**', '**://www.google.com/**',
                   '**://www.gstatic.com/**', '**://fonts.gstatic.com/**', '**://scontent*/**'])
    await ctx.route(g, (r) => r.abort());
  // img.[domain] is unreachable from Chromium here; serve the same bytes
  // from the bucket's staging directory. See tools/verify/img-route.cjs.
  await routeImages(ctx);
}

const vis = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return 'absent';
  const c = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return `${c.display}/${c.visibility}/op${c.opacity}/${Math.round(r.width)}x${Math.round(r.height)}`;
}, sel);

async function run(browser, base) {
  const res = {};
  // ---------- desktop dropdown ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await setup(ctx);
    const p = await ctx.newPage();
    await p.goto(base + '/', { waitUntil: 'load' });
    await p.waitForTimeout(1800);

    const POPUP = '.u-nav-item.menu-item-249 .u-nav-popup, li.menu-item-249 .u-nav-popup';
    res.popupAtRest = await vis(p, POPUP);
    await p.hover('li.menu-item-249 > a');
    await p.waitForTimeout(700);
    res.popupOnHover = await vis(p, POPUP);
    res.submenuLinksOnHover = await p.evaluate(() =>
      [...document.querySelectorAll('li.menu-item-249 .u-nav-popup a')]
        .filter((a) => a.getBoundingClientRect().width > 0).map((a) => a.getAttribute('href')));
    // move the pointer well away: the menu must close again
    await p.mouse.move(20, 700);
    await p.waitForTimeout(700);
    res.popupAfterLeave = await vis(p, POPUP);
    // click the trigger, then leave — must not latch open (the :focus-within trap)
    await p.click('li.menu-item-249 > a', { noWaitAfter: true }).catch(() => {});
    await p.waitForTimeout(400);
    await p.mouse.move(20, 700);
    await p.waitForTimeout(700);
    res.popupAfterClickThenLeave = await vis(p, POPUP);
    await ctx.close();
  }
  // ---------- carousel ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await setup(ctx);
    const p = await ctx.newPage();
    await p.goto(base + '/', { waitUntil: 'load' });
    await p.waitForTimeout(1500);
    res.carousel = await p.evaluate(() => {
      const c = document.querySelector('[data-u-ride="carousel"]');
      if (!c) return null;
      return { id: c.id, interval: c.getAttribute('data-interval'), pause: c.getAttribute('data-pause'),
        items: c.querySelectorAll('.u-carousel-item').length,
        indicators: c.querySelectorAll('.u-carousel-indicators li').length,
        controls: c.querySelectorAll('.u-carousel-control').length,
        active: [...c.querySelectorAll('.u-carousel-item')].findIndex((i) => i.classList.contains('u-active')) };
    });
    if (res.carousel && res.carousel.controls) {
      await p.evaluate(() => {
        const n = document.querySelector('[data-u-ride="carousel"] .u-carousel-control-next, [data-u-ride="carousel"] [data-u-slide="next"]');
        if (n) n.click();
      });
      await p.waitForTimeout(1400);
      res.carouselAfterNext = await p.evaluate(() => {
        const c = document.querySelector('[data-u-ride="carousel"]');
        return [...c.querySelectorAll('.u-carousel-item')].findIndex((i) => i.classList.contains('u-active'));
      });
    }
    await ctx.close();
  }
  // ---------- lightbox ----------
  // PhotoSwipe is bundled inside nicepage.js and builds its whole .pswp DOM on
  // click. None of its classes exist statically — which is why nicepage.css
  // cannot be pruned by "does this class appear in the DOM".
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await setup(ctx);
    const p = await ctx.newPage();
    await p.goto(base + '/de-icing-service/', { waitUntil: 'load' });
    await p.waitForTimeout(1800);
    res.lightboxTriggers = await p.evaluate(() =>
      document.querySelectorAll('.u-lightbox, [class*="u-lightbox"]').length);
    res.pswpBefore = await p.evaluate(() => document.querySelectorAll('.pswp').length);
    res.galleryItems = await p.evaluate(() =>
      document.querySelectorAll('.u-lightbox .u-gallery-item, .u-lightbox img').length);
    await p.evaluate(() => {
      const t = document.querySelector('.u-lightbox .u-gallery-item, .u-lightbox img');
      if (t) t.click();
    });
    await p.waitForTimeout(1200);
    // What matters is that exactly one lightbox OPENS. The count of inert hidden
    // templates differs by one on purpose: the live site emits an empty trailing
    // <div class="u-body"> after the footer, and nicepage.js builds a PhotoSwipe
    // template per .u-body container. That div renders nothing (the pages are
    // pixel-identical), so the port drops it and initialises one fewer template.
    res.pswpOpen = await p.evaluate(() =>
      [...document.querySelectorAll('.pswp')].filter((e) => e.getBoundingClientRect().width > 0).length);
    res.pswpOpenClass = await p.evaluate(() => {
      const e = document.querySelector('.pswp');
      return e ? e.className : null;
    });
    await ctx.close();
  }
  // ---------- Instagram Load More ----------
  // Both sides run the port's own client-side pager (make_reference.py puts the
  // captured document through the same rewrite), so this is not really a
  // comparison — it is an invariant, and the numbers below are absolute. It
  // exists because the pager had no test at all, and because the tiles past the
  // first page now park their photo in data-sbi-src: `display:none` does not
  // stop a browser fetching an <img src>, so leaving it there pulled all 158
  // photos on load. If a tile is revealed without its src coming back, the grid
  // fills with blanks and nothing else here would notice.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await setup(ctx);
    const p = await ctx.newPage();
    let tileRequests = 0;
    p.on('request', (r) => { if (/\/images\/instagram\//.test(r.url())) tileRequests++; });
    await p.goto(base + '/', { waitUntil: 'load' });
    await p.evaluate(async () => {
      const s = innerHeight;
      for (let y = 0; y < document.documentElement.scrollHeight; y += s) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
      scrollTo(0, 0);
    });
    await p.waitForTimeout(2500);
    const grid = () => p.evaluate(() => {
      const items = [...document.querySelectorAll('.sbi_item')];
      const shown = items.filter((i) => i.getBoundingClientRect().height > 1);
      const btn = document.querySelector('#sbi_load .sbi_load_btn');
      return {
        shown: shown.length,
        // every revealed tile must have its photo back, loaded, and painted
        loaded: shown.filter((i) => { const m = i.querySelector('img'); return m && m.naturalWidth > 1; }).length,
        painted: shown.filter((i) => getComputedStyle(i.querySelector('.sbi_photo')).backgroundImage !== 'none').length,
        btn: btn ? getComputedStyle(btn).display !== 'none' : null,
      };
    });
    res.igOnLoad = await grid();
    res.igTilesFetchedOnLoad = tileRequests;
    await p.click('#sbi_load .sbi_load_btn');
    await p.waitForTimeout(2500);
    res.igAfterOneClick = await grid();
    for (let i = 0; i < 12; i++) {
      const more = await p.evaluate(() => { const b = document.querySelector('#sbi_load .sbi_load_btn'); return b && getComputedStyle(b).display !== 'none'; });
      if (!more) break;
      await p.click('#sbi_load .sbi_load_btn');
      await p.waitForTimeout(700);
    }
    await p.waitForTimeout(3500);
    res.igExhausted = await grid();
    await ctx.close();
  }
  // ---------- mobile off-canvas ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await setup(ctx);
    const p = await ctx.newPage();
    await p.goto(base + '/', { waitUntil: 'load' });
    await p.waitForTimeout(1800);
    res.burgerVisible = await vis(p, '.u-menu-open, .u-hamburger-link');
    res.offcanvasAtRest = await vis(p, '.u-offcanvas .u-sidenav, .u-sidenav');
    await p.click('.u-menu-open, .u-hamburger-link', { noWaitAfter: true }).catch((e) => { res.burgerClickError = e.message.slice(0, 60); });
    await p.waitForTimeout(900);
    res.offcanvasAfterOpen = await vis(p, '.u-offcanvas .u-sidenav, .u-sidenav');
    res.offcanvasLinks = await p.evaluate(() =>
      [...document.querySelectorAll('.u-sidenav a')].filter((a) => a.getBoundingClientRect().width > 0).length);
    await ctx.close();
  }
  return res;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const out = {};
  for (const [side, base] of SIDES) out[side] = await run(browser, base);
  await browser.close();

  const keys = [...new Set([...Object.keys(out.ref), ...Object.keys(out.port)])];
  let diffs = 0;
  console.log(`${'check'.padEnd(28)}${'reference'.padEnd(30)}port`);
  for (const k of keys) {
    const a = JSON.stringify(out.ref[k]), b = JSON.stringify(out.port[k]);
    const same = a === b;
    if (!same) diffs++;
    console.log(`${same ? '  ' : '!!'}${k.padEnd(26)}${String(a).slice(0, 28).padEnd(30)}${String(b).slice(0, 60)}`);
  }
  console.log(`\n${diffs === 0 ? 'behaviour identical on every check' : diffs + ' behaviour difference(s)'}`);
  fs.writeFileSync(S + '/compare/interact.json', JSON.stringify(out, null, 1));
})();
