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
#   ./scripts/deploy-and-verify.sh
set -uo pipefail
cd "$(dirname "$0")/.."
SITE="https://kyro.kharischurch.com"
OUT="dashboard/out"

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
    echo "✓ Live and verified"
    exit 0
  fi
  echo "   not everything landed — deploying again"
done

echo "✗ Files are still missing after 3 attempts. Do NOT tell anyone it is fixed."
exit 1
