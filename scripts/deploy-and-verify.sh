#!/usr/bin/env bash
# Build the website, put it live, and CHECK it really went live.
#
# "Deployed ✓" is not proof. Twice now wrangler has reported success, said
# "No updated asset files to upload", and left the new page files missing —
# so the site carried on serving old code and fixes looked like they had
# done nothing. This builds, deploys, then fetches every page file and
# compares its size with the one just built. If anything is missing it
# deploys again and re-checks, and shouts if it still isn't there.
#
# It then waits for the LIVE CAMERAS part of the server. That part is a
# Durable Object: one long-running thing that holds the link to the camera
# computer, and it carries on running the code it started with until it next
# falls idle. A deploy does not reach it for a minute or two. So a brand-new
# button can call a server that has never heard of it and get "Not found" —
# which is exactly what happened to "Start fresh", in front of someone trying
# to use it during a service. The stamp below is a hash of worker/venue.js, and
# this waits until the live object says it is running that same code.
#
#   ./scripts/deploy-and-verify.sh
set -uo pipefail
cd "$(dirname "$0")/.."
SITE="https://kyro.kharischurch.com"
OUT="dashboard/out"

# A stamp for worker/venue.js that doesn't change when the stamp itself does.
stamp_of() { sed 's/^const VENUE_CODE = .*/const VENUE_CODE = "";/' worker/venue.js | shasum | cut -c1-12; }
STAMP="venue-$(stamp_of)"
if ! grep -q "^const VENUE_CODE = \"$STAMP\";$" worker/venue.js; then
  sed -i '' "s/^const VENUE_CODE = .*/const VENUE_CODE = \"$STAMP\";/" worker/venue.js
  echo "→ Stamped worker/venue.js as $STAMP"
fi

echo "→ Building"
( cd dashboard && CF_PAGES=1 npm run build 2>&1 | grep -E "Failed|error|Compiled successfully" | head -5 )
[ -f "$OUT/index.html" ] || { echo "✗ No build output — stopping"; exit 1; }

# Every page's own file, plus the shared ones the pages load.
files() { find "$OUT/_next/static/chunks" -name '*.js' -type f | sed "s#^$OUT/##"; }

check() {
  local missing=0 n=0
  while read -r f; do
    n=$((n + 1))
    local want have
    want=$(wc -c < "$OUT/$f" | tr -d ' ')
    have=$(curl -s -o /dev/null -w '%{size_download}' "$SITE/$f")
    if [ "$want" != "$have" ]; then
      echo "   missing or stale: $f (built $want bytes, served $have)"
      missing=$((missing + 1))
    fi
  done < <(files)
  echo "   checked $n files, $missing wrong"
  return $missing
}

for attempt in 1 2 3; do
  echo "→ Deploying (attempt $attempt)"
  npx wrangler deploy 2>&1 | grep -E "assets to upload|No updated|Version ID" | sed 's/^/   /'
  echo "→ Verifying what the server actually serves"
  if check; then
    # The pages are right. Now the live-cameras link, which lags behind.
    echo "→ Waiting for the live-cameras server to pick up the new code"
    for _ in $(seq 1 30); do          # up to ~5 minutes
      live=$(curl -s "$SITE/api/version" | sed 's/.*"venue":"\([^"]*\)".*/\1/')
      if [ "$live" = "$STAMP" ]; then
        echo "   live cameras: $live ✓"
        echo "✓ Live and verified"
        exit 0
      fi
      echo "   live cameras still on: ${live:-unknown} — waiting"
      sleep 10
    done
    echo "✗ The pages are live, but the live-cameras server is STILL running older code."
    echo "  Anything new it has to answer (new buttons, new figures) will say \"Not found\"."
    echo "  It picks the new code up when it next falls idle. Do NOT say it is fixed yet."
    exit 1
  fi
  echo "   not everything landed — deploying again"
done

echo "✗ Files are still missing after 3 attempts. Do NOT tell anyone it is fixed."
exit 1
