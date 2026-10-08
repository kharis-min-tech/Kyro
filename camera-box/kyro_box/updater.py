"""Automatic updates.

Every hour the box asks GitHub whether the counting AI (ai/) or this program
(camera-box/) has changed. If so — and nobody is in front of the cameras, so a
service is never interrupted — it downloads the new version next to the
current one, installs anything new it needs, checks it starts, then switches
over. The launcher (launcher.py) goes back to the previous version by itself
if the new one keeps failing.

Folder layout (~/.kyro-box):
    app/<version>/ai, app/<version>/camera-box    the code
    current, previous                           which version runs / ran before
    venv/                                       Python and its packages
"""
from __future__ import annotations

import io
import json
import logging
import os
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path
from typing import Optional

from kyro_box import settings

log = logging.getLogger("kyro.box.updater")

REPO = "kharis-min-tech/Kyro"
BRANCH = "main"
PARTS = ("ai", "camera-box")
UPDATE_EXIT_CODE = 42       # tells the launcher "restart me on the new version"


def app_dir() -> Path:
    return settings.HOME / "app"


def running_version() -> str:
    try:
        return (settings.HOME / "current").read_text().strip()
    except FileNotFoundError:
        return ""


def _get(url: str, accept: str = "application/vnd.github+json", timeout: float = 30) -> bytes:
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": "KyroCameraBox"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read()


def latest_version() -> tuple[str, str]:
    """(version id, commit) — the version id only changes when ai/ or camera-box/ change."""
    commit = _get(f"https://api.github.com/repos/{REPO}/commits/{BRANCH}", "application/vnd.github.sha").decode().strip()
    listing = json.loads(_get(f"https://api.github.com/repos/{REPO}/contents/?ref={commit}"))
    trees = {e["name"]: e["sha"] for e in listing if e.get("type") == "dir"}
    version = "-".join(trees.get(p, "none")[:8] for p in PARTS)
    return version, commit


def download(commit: str, dest: Path) -> None:
    """Fetch just ai/ and camera-box/ from that commit into `dest`."""
    data = b""
    for attempt in range(4):            # church internet can drop mid-download
        try:
            data = _get(f"https://codeload.github.com/{REPO}/zip/{commit}", "application/zip", timeout=300)
            break
        except Exception:  # noqa: BLE001
            if attempt == 3:
                raise
            time.sleep(10 * (attempt + 1))
    tmp = dest.with_name(dest.name + ".partial")
    shutil.rmtree(tmp, ignore_errors=True)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for name in z.namelist():
            parts = name.split("/", 1)
            if len(parts) < 2 or not parts[1].startswith(tuple(p + "/" for p in PARTS)):
                continue
            rel = Path(parts[1])
            if ".." in rel.parts or rel.is_absolute():
                continue
            target = tmp / rel
            if name.endswith("/"):
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(z.read(name))
    shutil.rmtree(dest, ignore_errors=True)
    tmp.rename(dest)


def child_env(code: Path) -> dict:
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join([str(code), str(code / "camera-box")])
    env["KYRO_MODELS_DIR"] = str(settings.HOME / "models")
    return env


def prepare(code: Path) -> None:
    """Install what the new version needs, then make sure it starts."""
    req = code / "camera-box" / "requirements.txt"
    log.info("Installing what the new version needs…")
    subprocess.run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "-q", "-r", str(req)],
                   check=True, timeout=3600)
    subprocess.run([sys.executable, "-m", "kyro_box", "check"], cwd=code, env=child_env(code),
                   check=True, timeout=600)


def cleanup(keep: set[str]) -> None:
    for d in app_dir().iterdir():
        if d.is_dir() and d.name not in keep:
            shutil.rmtree(d, ignore_errors=True)


def install(version: str, commit: str) -> None:
    """Download + prepare a version and make it the one the launcher runs."""
    dest = app_dir() / version
    app_dir().mkdir(parents=True, exist_ok=True)
    download(commit, dest)
    prepare(dest)
    current = running_version()
    if current and current != version:
        (settings.HOME / "previous").write_text(current)
    (settings.HOME / "current").write_text(version)
    (settings.HOME / "trial").write_text(str(time.time()))   # launcher: watch this one
    cleanup({version, current})


class AutoUpdater:
    CHECK_EVERY_S = 3600
    QUIET_FOR_S = 15 * 60       # no people seen for this long = safe to restart

    def __init__(self) -> None:
        self._next_check = time.time() + 120
        self._pending: Optional[tuple[str, str]] = None

    def due(self, people_recently: bool) -> bool:
        """Call regularly. True → a new version is installed; exit with UPDATE_EXIT_CODE."""
        if os.environ.get("KYRO_BOX_NO_UPDATE"):
            return False
        now = time.time()
        if self._pending is None and now >= self._next_check:
            self._next_check = now + self.CHECK_EVERY_S
            try:
                version, commit = latest_version()
                bad = (settings.HOME / "bad_version").read_text().strip() if (settings.HOME / "bad_version").exists() else ""
                if version != running_version() and version != bad:
                    log.info("A new version is available (%s)", version)
                    self._pending = (version, commit)
            except Exception as e:  # noqa: BLE001 — offline etc.; try again next hour
                log.info("Couldn't check for updates: %s", e)
        night = 3 <= time.localtime().tm_hour < 4   # always fine in the middle of the night
        if self._pending is None or (people_recently and not night):
            return False
        version, commit = self._pending
        self._pending = None
        try:
            install(version, commit)
            log.info("Updated to %s — restarting", version)
            return True
        except Exception as e:  # noqa: BLE001
            log.warning("Update failed, staying on the current version: %s", e)
            shutil.rmtree(app_dir() / version, ignore_errors=True)
            return False
