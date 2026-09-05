// Serve img.[domain] from the bucket's staging directory during a Chromium comparison.
//
// Every image on this site now comes from img.rexdalemobilewash.ca (AD-9), and
// Chromium cannot reach it through this session's proxy — curl can, Chromium gets
// nothing, the same limitation that already forces the Google Fonts cache next door.
// Left alone, every photo would fail to load and every measurement that depends on an
// image's intrinsic size would be taken against a 0x0 box.
//
// This is not a way of avoiding the real host. It is the split the two checks make:
//
//   tools/verify/image-urls-live.py  fetches every address in dist/ over the network
//                                    and proves the real host serves a real image
//   this file                        proves the PAGE is correct, using the same bytes
//
// The bytes are the same bytes: .port-work/b2-staging is what gate 5 uploaded, and
// tools/reconcile-images.py compares it to the bucket byte-for-byte. Serving them
// locally changes where they come from, not what they are.
const fs = require('fs');
const path = require('path');

const WORK = process.env.PORT_WORK ||
  path.join(__dirname, '..', '..', '.port-work');
const ROOT = process.env.PORT_REPO || path.join(__dirname, '..', '..');
const HOST = JSON.parse(fs.readFileSync(path.join(ROOT, 'image-hosts.json'), 'utf8')).canonical;
const STAGING = path.join(WORK, 'b2-staging');

const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.avif': 'image/avif', '.mp4': 'video/mp4' };

let missing = 0;

async function routeImages(ctx) {
  await ctx.route(`**://${HOST}/**`, (route) => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, '');
    const file = path.join(STAGING, key);
    // path.join would happily climb out of STAGING on a crafted key
    if (!file.startsWith(STAGING + path.sep) || !fs.existsSync(file)) {
      missing++;
      console.log('  !! not in b2-staging: /' + key);
      return route.abort();
    }
    return route.fulfill({ status: 200,
      contentType: TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      body: fs.readFileSync(file) });
  });
}

const missingCount = () => missing;

module.exports = { routeImages, missingCount, HOST, STAGING };
