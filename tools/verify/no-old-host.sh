#!/usr/bin/env bash
# Fail the build if anything in dist/ still points at the WordPress server.
#
# This is the check the migration procedure cares most about: a hotlinked build
# deploys perfectly and is broken for everyone who is not on the old origin.
# It must run against dist/, not the sources.
#
# Canonical URLs, og:url and schema.org @id values are SUPPOSED to name
# https://www.rexdalemobilewash.ca — that is the domain this site will be — so
# only asset-shaped and API-shaped references are failures.
set -uo pipefail
cd "$(dirname "$0")/../.."
[ -d dist ] || { echo "no dist/ — run npm run build first"; exit 1; }

fail=0
check() {                       # name, pattern, allowance
  local name="$1" pat="$2" allow="${3:-0}"
  local n; n=$(grep -ro "$pat" dist/ 2>/dev/null | wc -l)
  if [ "$n" -gt "$allow" ]; then
    printf '  FAIL  %-34s %s (allowed %s)\n' "$name" "$n" "$allow"
    grep -rhoE ".{0,60}$pat.{0,60}" dist/ | head -3 | sed 's/^/          /'
    fail=1
  else
    printf '  ok    %-34s %s\n' "$name" "$n"
  fi
}

echo "old-server references in dist/"
check "wp-content"                'wp-content'
check "wp-includes"               'wp-includes'
check "wp-json"                   'wp-json'
check "staging host (no DNS)"     'new\.rexdalemobilewash'
check "instagram CDN (signed/expiring)" 'cdninstagram'
check "smash balloon placeholder" 'placeholder\.png'
check "plugin locator nonce"      'locatornonce'
# robots.txt is carried over verbatim from the live site and names /wp-admin/ twice
# only path-shaped hits count: vendored WP/Elementor CSS legitimately contains
# custom-property names like --wp-admin--admin-bar--height, which are not URLs
check "wp-admin/ path (robots.txt only)" 'wp-admin/' 2

echo
if [ "$fail" -eq 0 ]; then echo "PASS — nothing in dist/ depends on the old server"; else
  echo "FAIL — fix before deploying"; fi
exit $fail
