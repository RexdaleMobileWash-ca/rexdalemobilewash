#!/usr/bin/env bash
# Prove the port still renders and behaves exactly like the captured original.
#
# It builds a "reference" render of each ORIGINAL captured document, serves it at
# the SAME route paths as the built site, then compares the two in Chromium:
# computed styles, section geometry, element counts, full-page pixels, and the
# dropdown / carousel / off-canvas behaviour.
#
# Serving both sides at identical paths is not cosmetic: nicepage.js marks the
# current nav link and its dropdown parent `active` by matching location.pathname
# against the menu hrefs, so a reference served at some other path silently
# diverges and the port looks broken when it is correct.
#
#   ./tools/verify/run-verify.sh
#
# Requires: npm run build to have been run, and playwright installed
# (npm install --no-save playwright).
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO="$PWD"
WORK="${PORT_WORK:-$REPO/.port-work}"
export PORT_WORK="$WORK" PORT_REPO="$REPO"
export NODE_PATH="$REPO/node_modules"
CHROME="${CHROME_PATH:-/opt/pw-browsers/chromium-1194/chrome-linux/chrome}"
export CHROME_PATH="$CHROME"

[ -d "$WORK/pages" ] || { echo "no capture in $WORK — run ./tools/run-port.sh first"; exit 1; }
[ -d dist/client ]   || { echo "no build — run npm run build first"; exit 1; }
node -e "require('playwright')" 2>/dev/null || {
  echo "playwright not installed — run: npm install --no-save playwright"; exit 1; }
[ -x "$CHROME" ] || { echo "chromium not found at $CHROME (set CHROME_PATH)"; exit 1; }

if [ ! -f "$WORK/fontcache/byfamily.json" ]; then
  echo "==> caching Google Fonts for offline comparison"
  python3 tools/verify/fetch-fonts.py | tail -2
fi

echo "==> building reference renders from the captured originals"
python3 tools/make_reference.py | tail -2

stop() {
  [ -f "$WORK/.serve.pids" ] && xargs -r kill < "$WORK/.serve.pids" 2>/dev/null || true
  rm -f "$WORK/.serve.pids"
}
trap stop EXIT
stop
echo "==> serving both sides"
MODE=port PORT=4321 node tools/verify/serve.cjs > "$WORK/serve-port.log" 2>&1 &
echo $! >> "$WORK/.serve.pids"
MODE=ref  PORT=4322 node tools/verify/serve.cjs > "$WORK/serve-ref.log"  2>&1 &
echo $! >> "$WORK/.serve.pids"
sleep 2

echo
echo "==> render parity (computed styles, geometry, counts, links, text)"
node tools/verify/compare-render.cjs 2>&1 | grep -vE '^\s+!!'
echo
echo "==> full-page pixel diff"
python3 tools/verify/pixel-diff.py
echo
echo "==> behaviour parity (dropdown, carousel, off-canvas)"
node tools/verify/compare-behaviour.cjs
