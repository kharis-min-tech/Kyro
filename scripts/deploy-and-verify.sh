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

# Keep the previous builds' page files alongside the new ones.
#
# Next names every chunk after its contents, so each deploy publishes a new set
# and the old set stops existing. A tab that was already open still asks for
# the old names the moment someone opens another section of Kyro — and gets
# nothing, so the app reloads itself in front of whoever is using it. Deploy
# three times during a service and it happens three times.
#
# Nothing here is stale code: the page decides which files to ask for, and a
# page that has been reloaded asks for the new ones. This only means the files
# an already-open page needs are still there to be had. Kept for three days,
# which is longer than any tab stays open.
ARCHIVE="dashboard/.chunk-archive"
keep_old_chunks() {
  mkdir -p "$ARCHIVE"
  find "$ARCHIVE" -type f -mtime +3 -delete 2>/dev/null
  # This build's files join the archive, then the archive fills in what the
  # new build doesn't have. --ignore-existing so nothing current is overwritten.
  rsync -a "$OUT/_next/static/" "$ARCHIVE/" 2>/dev/null
  rsync -a --ignore-existing "$ARCHIVE/" "$OUT/_next/static/" 2>/dev/null
  echo "   keeping $(find "$ARCHIVE" -type f | wc -l | tr -d ' ') files from earlier builds, so open tabs don't break"
}

# A name for THIS build, baked into the pages and published beside them.
#
# The archive above means an already-open page never breaks — it goes on
# finding the files it was built with, for days. That is the right trade, and
# it has one cost: a page left open goes on running old code for ever, in
# silence. Four deploys were made during one service while the page doing the
# counting ran the code from before any of them, and every fix looked like it
# had failed: "still not 114", "this is not working", "i dont understand".
#
# So each build is named, the name is compiled into the pages, and the same
# name is published at /build.json. An open page compares the two and says
# when it is out of date. See NewVersion in the dashboard.
BUILD="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)-$(date +%H%M%S)"

echo "→ Building"
( cd dashboard && CF_PAGES=1 NEXT_PUBLIC_KYRO_BUILD="$BUILD" npm run build 2>&1 | grep -E "Failed|error|Compiled successfully" | head -5 )
[ -f "$OUT/index.html" ] || { echo "✗ No build output — stopping"; exit 1; }
printf '{"build":"%s"}' "$BUILD" > "$OUT/build.json"
echo "   this build is $BUILD"
keep_old_chunks

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
