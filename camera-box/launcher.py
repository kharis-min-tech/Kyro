"""Kyro Camera Box launcher — what starts with the computer.

Keeps the Camera Box running whatever happens:
  • starts the version named in ~/.kyro-box/current
  • after an automatic update (exit code 42) starts the new version
  • if a just-updated version keeps crashing, goes back to the previous one
  • if it crashes for any other reason, starts it again after a short pause

The installer copies this file to ~/.kyro-box/launcher.py. It deliberately
uses only the standard library and never changes, so updates can't break it.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

HOME = Path(os.environ.get("KYRO_BOX_HOME", Path.home() / ".kyro-box"))
UPDATE_EXIT_CODE = 42
TRIAL_CRASHES_BEFORE_ROLLBACK = 3
QUICK_CRASH_S = 300


def log(msg: str) -> None:
    (HOME / "logs").mkdir(parents=True, exist_ok=True)
    with open(HOME / "logs" / "launcher.log", "a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")


def read(name: str) -> str:
    try:
        return (HOME / name).read_text().strip()
    except FileNotFoundError:
        return ""


def main() -> int:
    trial_crashes = 0
    while True:
        version = read("current")
        code = HOME / "app" / version
        if not version or not code.is_dir():
            log(f"No installed version found ({version!r}) — run the installer again")
            time.sleep(300)
            continue
        env = dict(os.environ)
        env["PYTHONPATH"] = os.pathsep.join([str(code), str(code / "camera-box")])
        env["KYRO_MODELS_DIR"] = str(HOME / "models")
        log(f"Starting version {version}")
        started = time.time()
        rc = subprocess.call([sys.executable, "-m", "kyro_box", "run"], cwd=code, env=env)
        ran_for = time.time() - started

        if rc == UPDATE_EXIT_CODE:
            log("Updated — starting the new version")
            trial_crashes = 0
            continue
        if rc == 0:
            log("Stopped")
            return 0

        on_trial = (HOME / "trial").exists()
        if on_trial and ran_for > QUICK_CRASH_S:
            (HOME / "trial").unlink(missing_ok=True)   # it ran fine for a while — keep it
            on_trial = False
        if on_trial and ran_for < QUICK_CRASH_S:
            trial_crashes += 1
            if trial_crashes >= TRIAL_CRASHES_BEFORE_ROLLBACK and read("previous"):
                prev = read("previous")
                log(f"Version {version} keeps failing — going back to {prev}")
                (HOME / "current").write_text(prev)
                (HOME / "bad_version").write_text(version)   # the updater won't try it again
                (HOME / "trial").unlink(missing_ok=True)
                trial_crashes = 0
                continue
        log(f"Stopped unexpectedly (code {rc}) — restarting in 10 seconds")
        time.sleep(10)


if __name__ == "__main__":
    sys.exit(main())
