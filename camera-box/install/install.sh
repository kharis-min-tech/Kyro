#!/bin/bash
# Kyro Camera Box installer for Mac and Linux.
#
# Run in Terminal:
#   curl -fsSL https://raw.githubusercontent.com/kharis-min-tech/Kyro/main/camera-box/install/install.sh | bash
#
# Installs Python if needed, downloads Kyro, asks for the pairing code from the
# website, and sets Kyro to start by itself whenever this computer is on.
set -euo pipefail
HOME2="$HOME/.kyro-box"
REPO="kharis-min-tech/Kyro"
say() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }

# 1. Python 3.10–3.12
say "Checking for Python"
PY=""
for c in python3.12 python3.11 python3.10 python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,12) else 1)' 2>/dev/null; then
    PY="$(command -v "$c")"; break
  fi
done
if [ -z "$PY" ]; then
  say "Installing Python 3.12 (one time, a few minutes)"
  if [ "$(uname)" = "Darwin" ]; then
    if command -v brew >/dev/null 2>&1; then
      brew install python@3.12
      PY="$(brew --prefix)/bin/python3.12"
    else
      curl -fsSL -o /tmp/python-3.12.pkg "https://www.python.org/ftp/python/3.12.7/python-3.12.7-macos11.pkg"
      echo "Your Mac password is needed to install Python:"
      sudo installer -pkg /tmp/python-3.12.pkg -target /
      PY="/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12"
    fi
  else
    sudo apt-get update && sudo apt-get install -y python3 python3-venv python3-pip
    PY="$(command -v python3)"
  fi
fi

# 2. Kyro's own Python environment
mkdir -p "$HOME2"
if [ ! -x "$HOME2/venv/bin/python" ]; then
  say "Setting up Kyro's Python environment"
  "$PY" -m venv "$HOME2/venv"
fi
VPY="$HOME2/venv/bin/python"
"$VPY" -m pip install --disable-pip-version-check -q --upgrade pip

# 3. Download the latest Kyro Camera Box + counting AI, install what it needs
say "Downloading Kyro (the first time takes 10-20 minutes)"
TMP="$(mktemp -d)"
curl -fsSL -o "$TMP/kyro.zip" "https://codeload.github.com/$REPO/zip/refs/heads/main"
(cd "$TMP" && unzip -q kyro.zip)
SRC="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)"
"$VPY" -m pip install --disable-pip-version-check -q -r "$SRC/camera-box/requirements.txt"
PYTHONPATH="$SRC:$SRC/camera-box" "$VPY" -m kyro_box install
rm -rf "$TMP"

# 4. Pair with the website
CODE="$HOME2/app/$(cat "$HOME2/current")"
export PYTHONPATH="$CODE:$CODE/camera-box"
if ! "$VPY" -m kyro_box status >/dev/null 2>&1; then
  say "Pair this computer with your Kyro website"
  until "$VPY" -m kyro_box pair < /dev/tty; do :; done
fi
unset PYTHONPATH

# 5. Start by itself, restart if it ever stops
say "Setting Kyro to start automatically"
if [ "$(uname)" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/org.kharis.kyro-box.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>org.kharis.kyro-box</string>
  <key>ProgramArguments</key><array><string>$VPY</string><string>$HOME2/launcher.py</string></array>
  <key>WorkingDirectory</key><string>$HOME2</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$HOME2/logs/launcher.err</string>
</dict></plist>
PL
  mkdir -p "$HOME2/logs"
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  # Keep the Mac awake while plugged in, so counting never pauses
  sudo pmset -c sleep 0 2>/dev/null || true
  echo "If your Mac asks whether Python may use the camera, click Allow."
else
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/kyro-box.service" <<SV
[Unit]
Description=Kyro Camera Box
After=network-online.target

[Service]
ExecStart=$VPY $HOME2/launcher.py
WorkingDirectory=$HOME2
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
SV
  systemctl --user daemon-reload
  systemctl --user enable --now kyro-box.service
  sudo loginctl enable-linger "$USER" 2>/dev/null || true
fi

say "All done!"
echo "Kyro is running and will start by itself whenever this computer is on."
echo "Plug in your cameras - they appear on the website's Cameras page within a few seconds."
echo "The first start downloads the counting AI, so the first counts can take a few minutes."
