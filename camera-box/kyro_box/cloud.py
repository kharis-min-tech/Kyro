"""Talking to the Kyro website (worker/venue.js). Standard library only."""
from __future__ import annotations

import json
import platform
import socket
import urllib.error
import urllib.request

from kyro_box import __version__


class CloudError(Exception):
    def __init__(self, message: str, status: int = 0) -> None:
        super().__init__(message)
        self.status = status


def _request(method: str, url: str, body: bytes | None = None, token: str | None = None,
             content_type: str = "application/json", timeout: float = 20) -> dict:
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("User-Agent", f"KyroCameraBox/{__version__}")
    if body is not None:
        req.add_header("Content-Type", content_type)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read()
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get("error") or e.reason
        except Exception:  # noqa: BLE001
            msg = e.reason
        raise CloudError(str(msg), e.code) from None
    except (urllib.error.URLError, socket.timeout, OSError) as e:
        raise CloudError(f"Can't reach the Kyro website: {getattr(e, 'reason', e)}") from None
    try:
        return json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        raise CloudError("The Kyro website sent an unexpected reply") from None


def machine_name() -> str:
    return (socket.gethostname() or "Camera computer").split(".")[0][:60]


def pair(server: str, code: str) -> dict:
    """Swap a one-time code from the website for this computer's own key."""
    body = json.dumps({
        "code": code, "name": machine_name(), "version": __version__,
        "platform": f"{platform.system()} {platform.machine()}"[:40],
    }).encode()
    return _request("POST", f"{server}/api/devices/pair", body)


def report(server: str, token: str, cameras: list[dict]) -> dict:
    body = json.dumps({"version": __version__, "cameras": cameras}).encode()
    return _request("POST", f"{server}/api/devices/report", body, token)


def snapshot(server: str, token: str, key: str, jpeg: bytes) -> None:
    from urllib.parse import quote
    _request("PUT", f"{server}/api/devices/snapshot?camera={quote(key)}", jpeg, token, "image/jpeg")
