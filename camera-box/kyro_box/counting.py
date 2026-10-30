"""Runs Kyro's people-counting AI (ai/pipeline.py) on every camera.

One copy of the AI model is shared by all cameras (it's the big memory user)
and the cameras take turns, newest picture each time — so with three cameras
on a slow computer each is still counted every few seconds instead of
falling further and further behind.
"""
from __future__ import annotations

import datetime as dt
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

import cv2

log = logging.getLogger("kyro.box.counting")

PIPELINE_W, PIPELINE_H = 1280, 720
STEADY_OVER = 3            # pictures the headcount is steadied over


def pick_device() -> str:
    """Fastest hardware this computer has: NVIDIA graphics → Apple chip → processor."""
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except Exception:  # noqa: BLE001
        pass
    return "cpu"


@dataclass
class CameraStats:
    current: int = 0
    peak: int = 0
    entries: int = 0
    exits: int = 0
    counted_at: float = 0.0
    error: Optional[str] = None
    last_people_at: float = 0.0
    seconds_per_count: float = 0.0
    seats: Optional[list] = None      # [seat_id, state, seconds vacant, confidence] per seat, if it has a layout


@dataclass
class Counter:
    stats: dict[str, CameraStats] = field(default_factory=dict)

    def __post_init__(self) -> None:
        os.environ.setdefault("DETECTION_DEVICE", pick_device())
        from ai.config import config            # imported late: reads DETECTION_DEVICE
        from ai.detection.detector import PersonDetector
        self._config = config
        log.info("Loading the counting AI on %s (first run downloads the model — a few minutes)…",
                 config.detection.device)
        self._detector = PersonDetector(config.detection)
        self._pipelines: dict[str, object] = {}
        self._recent: dict[str, list[int]] = {}
        self.ignore_zones: dict[str, list] = {}   # camera key → "don't count this area" rectangles
        self._seats: dict[str, tuple[str, list]] = {}   # camera key → (layout version, seats drawn on the website)
        self._day = dt.date.today()
        self._lock = threading.Lock()
        self.ready = True

    def _pipeline(self, key: str):
        if key not in self._pipelines:
            import ai.pipeline as pipeline_module
            made_here = pipeline_module.PersonDetector
            pipeline_module.PersonDetector = lambda _cfg: self._detector   # share the one loaded model
            try:
                p = pipeline_module.VisionPipeline(camera_id=key, seats=self._make_seats(key), cfg=self._config)
            finally:
                pipeline_module.PersonDetector = made_here
            self._pipelines[key] = p
            self.stats.setdefault(key, CameraStats())
        return self._pipelines[key]

    def _make_seats(self, key: str) -> list:
        import numpy as np
        from ai.seat_detection.seat import Seat
        out = []
        for s in self._seats.get(key, ("", []))[1]:
            try:
                out.append(Seat(seat_id=str(s["seat_id"]), bbox=np.array(s["bbox"], dtype=np.float32), row=str(s.get("row", "")),
                                number=int(s.get("number", 0)), section=str(s.get("section") or "Main"),
                                reserved=bool(s.get("reserved")), reserved_for=s.get("reserved_for")))
            except (KeyError, TypeError, ValueError):
                continue
        return out

    def seat_version(self, key: str) -> Optional[str]:
        return self._seats.get(key, (None,))[0]

    def set_seats(self, key: str, version: Optional[str], seats: list) -> None:
        """A new seat layout from the website: start this camera's seat tracking afresh with it."""
        if version is None:
            self._seats.pop(key, None)
        else:
            old = self._seats.get(key, (None, []))[1]
            self._seats[key] = (version, seats)
            geometry = lambda lst: [(s.get("seat_id"), tuple(s.get("bbox") or ())) for s in lst]
            p = self._pipelines.get(key)
            if p is not None and geometry(old) == geometry(seats):
                # Only reservations changed (e.g. a seat reserved mid-service): update those
                # seats and keep every other seat's state and timers.
                by_id = {s["seat_id"]: s for s in seats}
                for seat in p._seat_engine.seats:
                    s = by_id.get(seat.seat_id)
                    if s is not None:
                        seat.set_reserved(bool(s.get("reserved")), s.get("reserved_for"))
                return
        self._pipelines.pop(key, None)
        if key in self.stats:
            self.stats[key].seats = None

    def forget(self, keys_still_present: set[str]) -> None:
        for key in list(self._pipelines):
            if key not in keys_still_present:
                self._pipelines.pop(key, None)
                self._recent.pop(key, None)

    def new_day_check(self) -> None:
        """Start fresh totals (peak, entries, exits) each day."""
        today = dt.date.today()
        if today != self._day:
            self._day = today
            for p in self._pipelines.values():
                p.reset_session()
            self._recent.clear()
            for s in self.stats.values():
                s.peak = s.entries = s.exits = 0

    def count(self, key: str, frame) -> None:
        t0 = time.time()
        s = self.stats.setdefault(key, CameraStats())
        try:
            pipeline = self._pipeline(key)
            pipeline.ignore_zones = self.ignore_zones.get(key, [])
            small = cv2.resize(frame, (PIPELINE_W, PIPELINE_H)) if frame.shape[:2] != (PIPELINE_H, PIPELINE_W) else frame
            result = pipeline.process_frame(small, detect_frame=frame)
        except Exception as e:  # noqa: BLE001 — one bad picture must not stop counting
            log.exception("Counting failed on %s", key)
            s.error = f"Counting error: {e}"[:120]
            return
        a = result.attendance
        # Headcount: the people seen in each picture, steadied over the last
        # few pictures (the middle reading), so one odd picture doesn't make it
        # jump — the same way Camera Mode counts. Entries/exits come from tracking.
        recent = self._recent.setdefault(key, [])
        recent.append(result.people_in_frame)
        del recent[:-STEADY_OVER]
        s.current = sorted(recent)[len(recent) // 2]
        s.peak = max(s.peak, s.current)
        s.entries, s.exits = a.total_entries, a.total_exits
        s.counted_at, s.error = time.time(), None
        s.seconds_per_count = round(time.time() - t0, 2)
        if key in self._seats:
            s.seats = [[d["seat_id"], d["state"], int(d.get("vacancy_seconds") or 0), round(float(d.get("confidence") or 0), 2)]
                       for d in result.seat_states]
        if s.current > 0:
            s.last_people_at = s.counted_at

    def restart_steadying(self, key: str) -> None:
        """The picture dropped out (no signal / frozen): when it's back, count fresh —
        never mix in readings from before the gap."""
        self._recent.pop(key, None)

    def people_seen_recently(self, within_s: float) -> bool:
        now = time.time()
        return any(now - s.last_people_at < within_s for s in self.stats.values())
