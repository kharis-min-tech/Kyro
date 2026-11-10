#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Kyro — One-time local dev setup
# Run once: bash setup.sh
#
# This script used to end by printing "Login: admin / kyro-admin-change-me"
# and copying .env.example to .env unchanged. Anybody who followed it ran with
# a published password, a published API key and a published JWT secret — and a
# published JWT secret means anybody can forge a session token for any account.
# It generates real secrets now, and never prints a default password, because
# there is no longer a default password to print.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║         Kyro — Local Dev Setup                       ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── 0. Is everything here? ───────────────────────────────────────────────────
# Checked up front rather than failing three minutes in with a bare
# "command not found".
missing=0
need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "✗ $1 is not installed — $2"
    missing=1
  fi
}
need python3 "install Python 3.10 or newer from python.org"
need node     "install Node from nodejs.org (which brings npm with it)"
need npm      "install Node from nodejs.org (which brings npm with it)"
need openssl  "it comes with macOS and most Linux; on Windows use Git Bash"
if [ "$missing" -ne 0 ]; then
  echo ""
  echo "Install what's missing above, then run this again."
  exit 1
fi

PY_OK=$(python3 -c 'import sys; print(1 if sys.version_info >= (3, 10) else 0)')
if [ "$PY_OK" != "1" ]; then
  echo "✗ Kyro needs Python 3.10 or newer. You have $(python3 -V 2>&1)."
  exit 1
fi

# ── 1. Python virtual environment ────────────────────────────────────────────
if [ -d .venv ]; then
  echo "▶ Using the Python environment that is already here (.venv)"
else
  echo "▶ Creating Python virtual environment..."
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate

echo "▶ Installing AI engine dependencies..."
pip install --upgrade pip -q
pip install -r ai/requirements.txt -q

echo "▶ Installing backend dependencies..."
pip install -r backend/requirements.txt -q

# ── 2. Dashboard node modules ────────────────────────────────────────────────
echo "▶ Installing dashboard npm packages..."
(cd "$ROOT/dashboard" && npm install --silent)

# ── 3. Secrets ───────────────────────────────────────────────────────────────
# Generated, not copied. The API refuses to start with the default JWT secret
# (see backend/main.py), which is correct and used to leave anybody following
# these instructions stuck at a RuntimeError they had no way to read.
ADMIN_PASSWORD=""
if [ -f .env ]; then
  echo "▶ Leaving your existing .env alone"
else
  echo "▶ Writing .env with freshly generated secrets..."
  ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  DB_PASSWORD="$(openssl rand -hex 16)"
  python3 - "$ADMIN_PASSWORD" "$DB_PASSWORD" <<'PYEOF'
import re, secrets, sys
admin, dbpw = sys.argv[1], sys.argv[2]
env = open(".env.example").read()
swap = {
    "KYRO_JWT_SECRET": secrets.token_hex(32),
    "KYRO_API_KEY": secrets.token_hex(32),
    "KYRO_DASHBOARD_PASS": admin,
    "POSTGRES_PASSWORD": dbpw,
}
for key, value in swap.items():
    env = re.sub(rf"(?m)^{key}=.*$", f"{key}={value}", env)
# The connection string carries the same password, so it has to move with it.
env = re.sub(r"(?m)^DATABASE_URL=.*$",
             f"DATABASE_URL=postgresql+asyncpg://kyro:{dbpw}@postgres:5432/kyro", env)
open(".env", "w").write(env)
PYEOF
  chmod 600 .env
  echo "  ✓ .env written, readable only by you"
fi

echo ""
echo "✅ Setup complete!"
echo ""
if [ -n "$ADMIN_PASSWORD" ]; then
  echo "  ┌─────────────────────────────────────────────────────┐"
  echo "  │  Your admin login — write this down now.            │"
  echo "  │  It is in .env and it is shown here only once.      │"
  echo "  └─────────────────────────────────────────────────────┘"
  echo ""
  echo "    username: admin"
  echo "    password: $ADMIN_PASSWORD"
  echo ""
else
  echo "  Your login is in .env (KYRO_DASHBOARD_USER / KYRO_DASHBOARD_PASS)."
  echo ""
fi
echo "Next: open 4 terminals in this folder ($ROOT) and run:"
echo ""
echo "  Terminal 1 — Infrastructure (Postgres + Redis):"
echo "    docker compose -f docker/docker-compose.yml up postgres redis"
echo ""
echo "  Terminal 2 — Backend API:"
echo "    source .venv/bin/activate"
echo "    set -a && source .env && set +a        # the API needs these"
echo "    uvicorn backend.main:app --reload --port 8000"
echo ""
echo "  Terminal 3 — Demo stream (simulated people + live updates):"
echo "    source .venv/bin/activate"
echo "    set -a && source .env && set +a"
echo "    python -m ai.demo_stream --camera-id cam-01 --capacity 20"
echo ""
echo "  Terminal 4 — Dashboard:"
echo "    cd dashboard && npm run dev"
echo ""
echo "  Then open: http://localhost:3000"
echo "  API docs:  http://localhost:8000/docs"
echo ""
