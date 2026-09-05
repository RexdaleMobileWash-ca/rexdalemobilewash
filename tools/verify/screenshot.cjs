// Drive the running dev server and capture what a visitor actually sees.
//
//   npm run dev            (in another shell)
//   node tools/verify/screenshot.cjs [outDir]
//
// Google Fonts are unreachable through this container's proxy, so the cached
// copies under $PORT_WORK/fontcache are served instead — otherwise every heading
// falls back and the screenshots misrepresent the site. Build the cache first
// with tools/verify/fetch-fonts.py.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { routeImages } = require('./img-route.cjs');

const WORK = process.env.PORT_WORK || path.join(__dirname, '..', '..', '.port-work');
const OUT = process.argv[2] || path.join(WORK, 'shots');
const BASE = process.env.SITE_BASE || 'http://127.0.0.1:4321';
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const fc = path.join(WORK, 'fontcache');
const FONTS = fs.existsSync(fc + '/index.json') ? JSON.parse(fs.readFileSync(fc + '/index.json', 'utf8')) : {};
const BY = fs.existsSync(fc + '/byfamily.json') ? JSON.parse(fs.readFileSync(fc + '/byfamily.json', 'utf8')) : {};

async function setup(ctx) {
  await ctx.route('**://fonts.googleapis.com/**', (r) => {
    const fam = new URL(r.request().url()).searchParams.get('family') || '';
    const local = FONTS[r.request().url()] || BY[fam];
    return r.fulfill({ status: 200, contentType: 'text/css',
      body: local ? fs.readFileSync(path.join(fc, local.split('/').pop()), 'utf8') : '' });
  });
  // unreachable from here and irrelevant to how the page looks
  for (const g of ['**://www.googletagmanager.com/**', '**://www.google.com/**',
                   '**://www.gstatic.com/**', '**://fonts.gstatic.com/**'])
    await ctx.route(g, (r) => r.abort());
  // img.[domain] is unreachable from Chromium here; serve the same bytes
  // from the bucket's staging directory. See tools/verify/img-route.cjs.
  await routeImages(ctx);
}

async function settle(page) {
  // the Astro dev toolbar floats over the page in dev mode and is not part of the site
  await page.addStyleTag({ content: 'astro-dev-toolbar{display:none!important}' }).catch(() => {});
  try { await page.evaluate(() => document.fonts.ready); } catch (e) {}
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 70));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 200));
    await Promise.all([...document.images].map((i) => (i.decode ? i.decode().catch(() => {}) : null)));
  });
  await page.waitForTimeout(900);
}

const SHOTS = [
  { name: '01-home-hero',        route: '/',                    w: 1440, full: false },
  { name: '02-home-full',        route: '/',                    w: 1440, full: true  },
  { name: '03-nav-dropdown',     route: '/who-we-service/',     w: 1440, full: false,
    act: async (p) => { await p.hover('li.menu-item-249 > a'); await p.waitForTimeout(600); } },
  { name: '04-water-tanker',     route: '/water-tanker-service/', w: 1440, full: true },
  { name: '05-contact',          route: '/contact-us/',         w: 1440, full: true  },
  { name: '06-lookbook',         route: '/lookbook/',           w: 1440, full: true  },
  { name: '07-lightbox',         route: '/de-icing-service/',   w: 1440, full: false,
    act: async (p) => {
      await p.evaluate(() => {
        const t = document.querySelector('.u-lightbox .u-gallery-item, .u-lightbox img');
        if (t) t.click();
      });
      await p.waitForTimeout(1400);
    } },
  { name: '08-404',              route: '/no-such-page/',       w: 1440, full: false },
  { name: '09-mobile-home',      route: '/',                    w: 390,  full: false },
  { name: '10-mobile-menu',      route: '/',                    w: 390,  full: false,
    act: async (p) => {
      await p.click('.u-menu-open, .u-hamburger-link').catch(() => {});
      await p.waitForTimeout(900);
    } },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-lcd-text'] });
  for (const s of SHOTS) {
    const ctx = await browser.newContext({
      viewport: { width: s.w, height: s.w < 768 ? 844 : 900 },
      deviceScaleFactor: 1, isMobile: s.w < 768, hasTouch: s.w < 768,
    });
    await setup(ctx);
    const page = await ctx.newPage();
    const resp = await page.goto(BASE + s.route, { waitUntil: 'load', timeout: 60000 });
    await settle(page);
    if (s.act) await s.act(page);
    // tall full-page shots go to jpeg so they stay a sane size to send
    const file = path.join(OUT, s.name + (s.full ? '.jpg' : '.png'));
    await page.screenshot(s.full
      ? { path: file, fullPage: true, type: 'jpeg', quality: 88 }
      : { path: file });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    console.log(`  ${s.name.padEnd(18)} ${String(resp.status()).padEnd(4)} ${s.w}px  page ${h}px  -> ${path.basename(file)}`);
    await ctx.close();
  }
  await browser.close();
  console.log(`\nshots in ${OUT}`);
})();
