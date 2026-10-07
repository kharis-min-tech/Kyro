"""
LatestFrameReader (ai/worker.py): when detection is slower than the camera,
the worker must get the NEWEST frame, not an ever-growing backlog.
"""
import time
import numpy as np
import pytest

pytest.importorskip("redis")
pytest.importorskip("httpx")
from ai.worker import LatestFrameReader  # noqa: E402


class FakeCamera:
    """Produces frame #n (a 1×1 image whose pixel value is n) every 5 ms."""

    def __init__(self, frames: int = 400):
        self.n = 0
        self.frames = frames

    def read(self):
        time.sleep(0.005)
        if self.n >= self.frames:
            return False, None
        self.n += 1
        return True, np.full((1, 1, 3), self.n % 256, dtype=np.uint8)

    def release(self):
        pass

    def isOpened(self):
        return True


def test_slow_consumer_gets_latest_frame_not_backlog():
    cam = FakeCamera()
    reader = LatestFrameReader(cam)
    ok, first = reader.read()
    assert ok
    time.sleep(0.2)  # "slow detection": ~40 camera frames arrive meanwhile
    ok, latest = reader.read()
    assert ok
    # A queued reader would hand back the very next frame (first + 1).
    assert int(latest[0, 0, 0]) - int(first[0, 0, 0]) >= 20
    reader.release()


def test_reports_failure_when_camera_stops():
    cam = FakeCamera(frames=3)
    reader = LatestFrameReader(cam)
    time.sleep(0.1)
    reader.read()  # drain
    ok, _ = reader.read(timeout=0.5)
    assert ok is False
