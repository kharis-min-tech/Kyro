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
        self._day = dt.date.today()
        self._lock = threading.Lock()
        self.ready = True

    def _pipeline(self, key: str):
        if key not in self._pipelines:
            import ai.pipeline as pipeline_module
            made_here = pipeline_module.PersonDetector
            pipeline_module.PersonDetector = lambda _cfg: self._detector   # share the one loaded model
            try:
                p = pipeline_module.VisionPipeline(camera_id=key, seats=[], cfg=self._config)
            finally:
                pipeline_module.PersonDetector = made_here
            self._pipelines[key] = p
            self.stats.setdefault(key, CameraStats())
        return self._pipelines[key]

    def forget(self, keys_still_present: set[str]) -> None:
        for key in list(self._pipelines):
            if key not in keys_still_present:
                self._pipelines.pop(key, None)

    def new_day_check(self) -> None:
        """Start fresh totals (peak, entries, exits) each day."""
        today = dt.date.today()
        if today != self._day:
            self._day = today
            for p in self._pipelines.values():
                p.reset_session()
            for s in self.stats.values():
                s.peak = s.entries = s.exits = 0

    def count(self, key: str, frame) -> None:
        t0 = time.time()
        s = self.stats.setdefault(key, CameraStats())
        try:
            pipeline = self._pipeline(key)
            small = cv2.resize(frame, (PIPELINE_W, PIPELINE_H)) if frame.shape[:2] != (PIPELINE_H, PIPELINE_W) else frame
            result = pipeline.process_frame(small, detect_frame=frame)
        except Exception as e:  # noqa: BLE001 — one bad picture must not stop counting
            log.exception("Counting failed on %s", key)
            s.error = f"Counting error: {e}"[:120]
            return
        a = result.attendance
        s.current, s.peak = a.current_attendance, max(s.peak, a.peak_attendance)
        s.entries, s.exits = a.total_entries, a.total_exits
        s.counted_at, s.error = time.time(), None
        s.seconds_per_count = round(time.time() - t0, 2)
        if s.current > 0:
            s.last_people_at = s.counted_at

    def people_seen_recently(self, within_s: float) -> bool:
        now = time.time()
        return any(now - s.last_people_at < within_s for s in self.stats.values())
