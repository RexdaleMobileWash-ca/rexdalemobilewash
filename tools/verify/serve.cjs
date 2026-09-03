const _path = require('path');
const WORK = process.env.PORT_WORK || _path.join(__dirname, '..', '..', '.port-work');
const REPO_ROOT = process.env.PORT_REPO || _path.join(__dirname, '..', '..');
// Serves one side of the comparison. Run twice:
//   MODE=port PORT=4321  -> the built Astro site (dist/client)
//   MODE=ref  PORT=4322  -> the original captured documents, at the SAME route paths
//
// Serving the reference at its real path matters: nicepage.js marks the current nav
// link (and its dropdown parent) `active` by matching location.pathname against the
// menu hrefs. Serving it at /ref/<slug>.html silently suppresses that and makes the
// port look wrong when it is right.
const http = require('http'), fs = require('fs'), path = require('path');
const S = WORK;
const DIST = _path.join(REPO_ROOT,'dist','client');
const MODE = process.env.MODE || 'port';
const PORT = parseInt(process.env.PORT || '4321', 10);

const ROUTES = { '/': 'home' };
for (const f of fs.readdirSync(path.join(S, 'ref'))) {
  const slug = f.replace(/\.html$/, '');
  if (slug !== 'home') ROUTES['/' + slug + '/'] = slug;
}

const T = { '.html': 'text/html;charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain' };

function send(res, f) {
  res.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream',
                       'access-control-allow-origin': '*' });
  fs.createReadStream(f).pipe(res);
}

http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  let f = null;

  if (p.startsWith('/__fonts/')) f = path.join(S, 'fontcache', p.slice('/__fonts/'.length));
  else if (MODE === 'ref' && ROUTES[p]) f = path.join(S, 'ref', ROUTES[p] + '.html');
  else {
    // assets (css/js/images) always come from the built site, identical for both sides
    f = path.join(DIST, p);
    try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); } catch (e) {}
    if (!fs.existsSync(f) && fs.existsSync(path.join(DIST, p, 'index.html'))) f = path.join(DIST, p, 'index.html');
  }

  if (!f || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/html' });
    const nf = path.join(DIST, '404.html');
    return res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'not found');
  }
  send(res, f);
}).listen(PORT, () => console.log(`MODE=${MODE} on http://127.0.0.1:${PORT}`));
