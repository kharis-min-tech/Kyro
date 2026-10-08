"""Where the box keeps its settings: ~/.kyro-box/config.json (readable only by
this user — it holds the box's key and any network-camera login)."""
from __future__ import annotations

import json
import os
from pathlib import Path

HOME = Path(os.environ.get("KYRO_BOX_HOME", Path.home() / ".kyro-box"))
CONFIG = HOME / "config.json"
DEFAULT_SERVER = "https://kyro.kharischurch.com"


def load() -> dict:
    try:
        return json.loads(CONFIG.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save(cfg: dict) -> None:
    HOME.mkdir(parents=True, exist_ok=True)
    tmp = CONFIG.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, indent=2))
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass  # Windows: the file lives in the user's own profile folder
    tmp.replace(CONFIG)
