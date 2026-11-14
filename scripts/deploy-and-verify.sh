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

# ── Nothing broken goes out ──────────────────────────────────────────────────
#
# "when you make fixes, make it permanent, dont forget and i need to repeat
# the hidden bugs im telling you."
#
# Every fix in this repo is held down by a test. That only means anything if
# the tests actually stand between a change and the church's site — and they
# did not: this script built and deployed whatever was in the working tree.
# A fix could be undone by the next change and nobody would know until she
# found it again and told me again.
#
# So the suite runs first, and a failure stops the deploy. It costs a couple
# of minutes on a thing that already takes minutes, and it is the difference
# between "we have tests" and "the tests are enforced".
#
# SKIP_TESTS=1 exists because a gate nobody can ever open gets deleted
# instead. It says so, loudly, every time.
if [ "${SKIP_TESTS:-0}" = "1" ]; then
  echo "⚠ SKIP_TESTS=1 — deploying WITHOUT running the tests. Nothing is being checked."
else
  echo "→ Checking everything still works ($(ls tests/*.mjs | wc -l | tr -d ' ') tests)"
  failed=0
  for t in tests/*.mjs; do
    if ! out=$(node "$t" 2>&1); then
      failed=1
      echo "   ✗ $t"
      echo "$out" | grep "✗" | sed 's/^/     /' | head -6
    fi
  done
  if ! ( cd dashboard && npx tsc --noEmit ) >/dev/null 2>&1; then
    failed=1
    echo "   ✗ the website does not typecheck"
    ( cd dashboard && npx tsc --noEmit 2>&1 | head -6 | sed 's/^/     /' )
  fi
  names=$(npx tsc --allowJs --checkJs --noEmit --target es2022 --module esnext \
            --moduleResolution bundler worker/*.js 2>&1 | grep -E "TS2304|TS2552" | head -6)
  if [ -n "$names" ]; then
    failed=1
    echo "   ✗ the worker uses names that do not exist"
    echo "$names" | sed 's/^/     /'
  fi
  if [ "$failed" = "1" ]; then
    echo "✗ Something that used to work is broken. Nothing has been deployed."
    echo "  The site is still serving the build before this one."
    exit 1
  fi
  echo "   all passing"
fi
# Run the checks and stop — for seeing whether anything is broken without
# putting anything live.
if [ "${CHECK_ONLY:-0}" = "1" ]; then
  echo "✓ Everything passes. Nothing deployed (CHECK_ONLY=1)."
  exit 0
fi

# A stamp for worker/venue.js that doesn't change when the stamp itself does.
# The line matches whether or not it is exported. It became `export const`
# the day the worker started importing it — and this pattern did not follow,
# so for a whole afternoon the stamp was never written into the file, every
# deploy genuinely succeeded, and this script sat waiting for the live server
# to report a stamp that had never been deployed. Six "it is still on old
# code" failures, every one of them wrong.
stamp_of() { sed 's/^\(export \)*const VENUE_CODE = .*/const VENUE_CODE = "";/' worker/venue.js | shasum | cut -c1-12; }
STAMP="venue-$(stamp_of)"
if ! grep -q "^\(export \)*const VENUE_CODE = \"$STAMP\";$" worker/venue.js; then
  sed -i '' "s/^\(export \)*const VENUE_CODE = .*/\1const VENUE_CODE = \"$STAMP\";/" worker/venue.js
  echo "→ Stamped worker/venue.js as $STAMP"
fi
# …and never take it on trust again. A stamp that did not go in means every
# check below is comparing against something that was never deployed, and the
# failure it reports is a lie about the server.
if ! grep -q "VENUE_CODE = \"$STAMP\";$" worker/venue.js; then
  echo "✗ Could not write the stamp into worker/venue.js."
  echo "  Everything below would be checking for code that was never deployed."
  exit 1
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
  # ── Why the whole output is kept ────────────────────────────────────────
  #
  # This used to pipe wrangler straight into grep, which threw away both its
  # exit code and anything it had to say. A deploy that FAILED outright then
  # looked exactly like one that had worked: three lines of progress, then
  # six files missing, then "not everything landed — deploying again", then
  # "✗ Files are still missing after 3 attempts". Everything pointed at the
  # files, and nothing anywhere said that wrangler had refused.
  #
  # One real failure read that way for its whole run. The site went on
  # serving the build before it, which is the one thing this script exists
  # to notice.
  log="$(mktemp)"
  if ! npx wrangler deploy >"$log" 2>&1; then
    echo "   ✗ wrangler could not deploy. What it said:"
    sed 's/^/   | /' "$log"
    rm -f "$log"
    echo "✗ Nothing was deployed. The site is still serving the build before this one."
    exit 1
  fi
  grep -E "assets to upload|No updated|Version ID" "$log" | sed 's/^/   /'
  rm -f "$log"
  echo "→ Verifying what the server actually serves"
  if check; then
    # The pages are right. Now the live-cameras link, which lags behind.
    # The live-cameras object keeps the code it started with until it next
    # falls IDLE — and during a service it never does, because a camera
    # reports every few seconds for hours. So asking politely and waiting
    # was asking for something that could not happen: the pages went live in
    # seconds and the counting brain stayed on old code all morning, until
    # somebody was told to stop their cameras mid-service.
    #
    # ?restart=1 tells it to let go. The worker only passes that on when the
    # object really is behind THIS deploy, and the object writes down
    # everything that only lives in memory before it goes.
    # ── Why the gaps between these checks are LONG ────────────────────────
    #
    # The live-cameras server is evicted a few seconds after its last
    # request, and that eviction is what makes it pick up new code. Checking
    # whether it has restarted is itself a request to it — so a check every
    # five seconds is a request every five seconds, and the loop that was
    # waiting for an idle moment was the thing preventing one. It would have
    # waited for ever and blamed the server.
    #
    # So: ask once, then stand well back. Thirty seconds of silence is far
    # more than the few it needs, and ten of those is five minutes.
    echo "→ Telling the live-cameras server to pick up the new code"
    curl -s -o /dev/null "$SITE/api/version?restart=1"
    for _ in $(seq 1 10); do          # up to ~5 minutes, quietly
      sleep 30
      live=$(curl -s "$SITE/api/version" | sed 's/.*"venue":"\([^"]*\)".*/\1/')
      if [ "$live" = "$STAMP" ]; then
        echo "   live cameras: $live ✓"
        echo "✓ Live and verified"
        exit 0
      fi
      # …and WHAT is holding it open, which five failed deploys could only
      # guess at. See /internal/version in worker/venue.js.
      held=$(curl -s "$SITE/api/version" | sed -n 's/.*"holding":{"sockets":\([-0-9]*\),"idle_s":\([0-9]*\)}.*/\1 connection(s) open, last spoken to \2s ago/p')
      echo "   live cameras still on: ${live:-unknown} — ${held:-leaving it alone} for another 30s"
    done
    echo "✗ The pages are live, but the live-cameras server is STILL running older code."
    echo "  Anything new it has to answer (new buttons, new figures) will say \"Not found\"."
    echo ""
    echo "  It was asked to let go and didn't — which is expected ONCE. The code that"
    echo "  takes that request lives in the live-cameras server itself, so it can only"
    echo "  obey once it is already running a version that contains it. This deploy is"
    echo "  the one that puts it there; from the next one on, it restarts by itself."
    echo ""
    echo "  Something is keeping it awake. The lines above say how many live"
    echo "  connections it is holding and how long since anything spoke to it — it"
    echo "  needs a few seconds in a row with nobody talking, and it is not only this"
    echo "  browser: the computer doing the counting holds a connection, and so does"
    echo "  any phone or laptop with Kyro open. Close them, wait a minute, run again."
    echo "  Do NOT say it is fixed yet."
    exit 1
  fi
  echo "   not everything landed — deploying again"
done

echo "✗ Files are still missing after 3 attempts. Do NOT tell anyone it is fixed."
exit 1
