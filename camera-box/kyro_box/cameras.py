"""Finding and reading cameras.

USB cameras: every few seconds the box checks the computer's camera slots
(0, 1, 2 …) for anything newly plugged in, and drops a camera that has been
unplugged. Network cameras: only the addresses an admin typed in on the
website's Cameras page.
"""
from __future__ import annotations

import logging
import os
import platform
import threading
import time
from typing import Optional

import hashlib

import cv2
import numpy as np

log = logging.getLogger("kyro.box.cameras")

MAX_USB_SLOTS = int(os.environ.get("KYRO_BOX_USB_SLOTS", "8"))
UNPLUGGED_AFTER_S = 6       # no picture for this long → camera treated as gone
RETRY_NETWORK_S = 15        # wait between reconnect attempts to a network camera


def _usb_backend() -> int:
    system = platform.system()
    if system == "Windows":
        return cv2.CAP_DSHOW        # opens in ~1 s; the default (MSMF) can take 10+
    if system == "Darwin":
        return cv2.CAP_AVFOUNDATION
    return cv2.CAP_V4L2


def _mac_cameras() -> Optional[list[tuple[str, str, bool]]]:
    """On a Mac: (key, name, skip) for each camera slot, in the same order OpenCV
    numbers them. The key stays the same when other cameras come and go (an
    iPhone's Continuity Camera appearing shifts the slot numbers), so the
    website keeps each camera's name and room. iPhone/iPad cameras and Desk
    View are skipped — they come and go and are never the room camera.
    None = not a Mac (or names unavailable): fall back to slot numbers."""
    if platform.system() != "Darwin":
        return None
    try:
        import AVFoundation as av  # pyobjc
        devices = list(av.AVCaptureDevice.devicesWithMediaType_(av.AVMediaTypeVideo)) + \
            list(av.AVCaptureDevice.devicesWithMediaType_(av.AVMediaTypeMuxed))
    except Exception:  # noqa: BLE001
        return None
    out, seen = [], {}
    for d in devices:
        name = str(d.localizedName() or "").strip() or "USB camera"
        model = str(d.modelID() or name)
        # Same model + nth of that model: survives moving the camera to another USB port.
        n = seen[model] = seen.get(model, 0) + 1
        key = "usb-" + hashlib.sha1(f"{model}#{n}".encode()).hexdigest()[:8]
        skip = model.startswith(("iPhone", "iPad")) or "desk view" in name.lower() \
            or "Continuity" in str(d.deviceType() or "")
        out.append((key, name, skip))
    return out


def _open_usb(index: int) -> Optional[cv2.VideoCapture]:
    cap = cv2.VideoCapture(index, _usb_backend())
    if not cap.isOpened():
        cap.release()
        return None
    # Ask for the most detail the camera offers (it picks the nearest it supports):
    # more pixels per person = far-away people are found.
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
    ok, frame = cap.read()
    if not ok or frame is None:
        cap.release()
        return None
    return cap


class Camera:
    """One camera: reads continuously on its own thread, keeps only the newest picture."""

    def __init__(self, key: str, kind: str, label: str, cap: Optional[cv2.VideoCapture], url: str = "") -> None:
        self.key, self.kind, self.label, self.url = key, kind, label, url
        self._cap = cap
        self._lock = threading.Lock()
        self._frame: Optional[np.ndarray] = None
        self._frame_at = time.time()
        self._seen_frame_at = 0.0
        self._frames = 0
        self._fps_since = time.time()
        self.fps = 0.0
        self.error: Optional[str] = None
        self.stopped = False
        self.started_at = time.time()
        self._thread = threading.Thread(target=self._run, name=f"cam-{key}", daemon=True)
        self._thread.start()

    # Reading ---------------------------------------------------------------
    def _connect(self) -> bool:
        if self._cap is not None and self._cap.isOpened():
            return True
        if self.kind != "network":
            return False
        cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)
        if cap.isOpened():
            self._cap, self.error = cap, None
            log.info("Connected to network camera %s", self.key)
            return True
        cap.release()
        self.error = "Can't connect — check the address and that the camera is on"
        return False

    def _run(self) -> None:
        while not self.stopped:
            if not self._connect():
                if self.kind != "network":
                    return
                time.sleep(RETRY_NETWORK_S)
                continue
            ok, frame = self._cap.read()
            if not ok or frame is None:
                if self.kind == "network":
                    self.error = "Lost the picture — reconnecting"
                    self._cap.release()
                    self._cap = None
                    time.sleep(2)
                    continue
                time.sleep(0.2)
                if time.time() - self._frame_at > UNPLUGGED_AFTER_S:
                    return  # unplugged
                continue
            now = time.time()
            with self._lock:
                self._frame, self._frame_at = frame, now
            self.error = None
            self._frames += 1
            if now - self._fps_since >= 5:
                self.fps = round(self._frames / (now - self._fps_since), 1)
                self._frames, self._fps_since = 0, now

    def latest(self, only_new: bool = True) -> Optional[np.ndarray]:
        with self._lock:
            if self._frame is None or (only_new and self._frame_at == self._seen_frame_at):
                return None
            self._seen_frame_at = self._frame_at
            return self._frame

    def peek(self) -> Optional[np.ndarray]:
        with self._lock:
            return self._frame

    @property
    def alive(self) -> bool:
        if self.stopped:
            return False
        if self.kind == "network":
            return True  # keeps retrying; shown with an error while down
        return self._thread.is_alive()

    @property
    def size(self) -> tuple[int, int]:
        f = self.peek()
        return (f.shape[1], f.shape[0]) if f is not None else (0, 0)

    def stop(self) -> None:
        self.stopped = True
        self._thread.join(timeout=3)
        if self._cap is not None:
            self._cap.release()


class CameraManager:
    def __init__(self) -> None:
        self.cameras: dict[str, Camera] = {}
        self.disabled: set[str] = set()
        self._lock = threading.Lock()

    def active(self) -> list[Camera]:
        with self._lock:
            return list(self.cameras.values())

    def scan_usb(self) -> None:
        """Pick up newly plugged-in USB cameras and forget unplugged ones."""
        with self._lock:
            for key, cam in list(self.cameras.items()):
                if not cam.alive:
                    log.info("Camera %s was unplugged", key)
                    cam.stop()
                    del self.cameras[key]
            in_use = {c.key for c in self.cameras.values()}
        named = _mac_cameras()
        misses = 0
        for i in range(MAX_USB_SLOTS if named is None else len(named)):
            if named is None:
                key, label = f"usb-{i}", f"USB camera {i + 1}"
            else:
                key, label, skip = named[i]
                if skip:
                    continue
            if key in in_use:
                misses = 0
                continue
            if key in self.disabled:
                continue
            cap = _open_usb(i)
            if cap is None:
                misses += 1
                if named is None and misses >= 2:
                    break  # slots are numbered without gaps; two empty ones in a row = done
                continue
            misses = 0
            log.info("Found %s in slot %d", label, i)
            with self._lock:
                self.cameras[key] = Camera(key, "usb", label, cap)

    def sync_network(self, streams: list[dict]) -> None:
        """Match the network cameras to the list the website sent."""
        wanted = {s["key"]: s["url"] for s in streams if s.get("key") and s.get("url")}
        with self._lock:
            for key, cam in list(self.cameras.items()):
                if cam.kind == "network" and (key not in wanted or wanted[key] != cam.url):
                    cam.stop()
                    del self.cameras[key]
            for key, url in wanted.items():
                if key not in self.cameras:
                    log.info("Adding network camera %s", key)
                    self.cameras[key] = Camera(key, "network", "Network camera", None, url)

    def set_disabled(self, keys: list[str]) -> None:
        self.disabled = set(keys)
        with self._lock:
            for key in list(self.cameras):
                if key in self.disabled:
                    log.info("Camera %s switched off on the website", key)
                    self.cameras.pop(key).stop()

    def stop_all(self) -> None:
        with self._lock:
            for cam in self.cameras.values():
                cam.stop()
            self.cameras.clear()
