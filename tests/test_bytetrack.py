"""
Unit tests for ai.tracking.bytetrack.

Focus areas (highest bug risk):
  1. Track IDs are assigned monotonically and don't collide after
     tracker re-instantiation in the same process (the fix in this file).
  2. A person moving smoothly across frames keeps the same track_id.
  3. Two people at different positions get different track_ids.
  4. A track that vanishes for < max_age frames stays alive (LOST),
     then is deleted after max_age.
"""

from __future__ import annotations

import numpy as np
import pytest

from ai.config import TrackingConfig
from ai.detection.detector import Detection
from ai.tracking.bytetrack import ByteTracker, Track, TrackState


def det(x1: float, y1: float, x2: float, y2: float, conf: float = 0.9) -> Detection:
    """Build a Detection with pixel bbox [x1,y1,x2,y2]."""
    return Detection(bbox=np.array([x1, y1, x2, y2], dtype=np.float32), confidence=conf, class_id=0)


@pytest.fixture
def cfg() -> TrackingConfig:
    # min_hits=1 so tracks confirm on the first frame — keeps tests short.
    return TrackingConfig(max_age=5, min_hits=1, iou_threshold=0.3,
                          high_thresh=0.6, low_thresh=0.1)


def test_ids_are_monotonic_across_tracker_reinstantiation(cfg):
    """A re-init must NOT reset the id counter — else a stale id from
    the old tracker could be re-used by the new one."""
    t1 = ByteTracker(cfg)
    out = t1.update([det(0, 0, 20, 40)])
    first_id = out[0].track_id

    # Simulate a session-reset that re-creates the tracker in the same process.
    t2 = ByteTracker(cfg)
    out2 = t2.update([det(200, 0, 220, 40)])
    second_id = out2[0].track_id

    assert second_id > first_id, "New tracker must not reuse ids from the old one"


def test_smooth_movement_keeps_same_id(cfg):
    """A person walking one step per frame should stay the same track_id."""
    t = ByteTracker(cfg)
    ids = []
    for step in range(5):
        out = t.update([det(step * 5, 0, step * 5 + 20, 40)])
        assert len(out) == 1
        ids.append(out[0].track_id)
    assert len(set(ids)) == 1, f"Expected one stable id across smooth motion, got {ids}"


def test_two_people_get_two_ids(cfg):
    t = ByteTracker(cfg)
    out = t.update([det(0, 0, 20, 40), det(300, 0, 320, 40)])
    assert len(out) == 2
    assert out[0].track_id != out[1].track_id


def test_brief_occlusion_keeps_track_alive(cfg):
    """< max_age frames without a detection should NOT delete the track."""
    t = ByteTracker(cfg)
    out = t.update([det(0, 0, 20, 40)])
    original_id = out[0].track_id

    # Person vanishes for 3 frames (< max_age=5)
    for _ in range(3):
        t.update([])

    # The track's id must still be remembered by the tracker
    assert original_id in t.active_track_ids, "Track deleted too early during brief occlusion"


def test_long_absence_deletes_track(cfg):
    """> max_age frames without a detection should delete the track."""
    t = ByteTracker(cfg)
    out = t.update([det(0, 0, 20, 40)])
    original_id = out[0].track_id

    for _ in range(cfg.max_age + 3):
        t.update([])

    assert original_id not in t.active_track_ids, "Track kept alive past max_age"


# ── Recall: partly-hidden / distant people must still be counted ─────────────

@pytest.fixture
def real_cfg() -> TrackingConfig:
    # The shipped defaults (min_hits=2, new_track_thresh=0.25, …).
    return TrackingConfig()


def test_low_confidence_person_is_counted(real_cfg):
    """Someone the detector only scores 0.35 (half-hidden behind a pew) used
    to be thrown away because new tracks required 0.6. They must be counted."""
    t = ByteTracker(real_cfg)
    out = []
    for _ in range(3):
        out = t.update([det(100, 100, 130, 160, conf=0.35)])
    assert len(out) == 1, "A consistently detected low-confidence person should be confirmed"


def test_very_low_confidence_noise_is_not_counted(real_cfg):
    """Below new_track_thresh a detection may only extend an existing track,
    never create a person on its own."""
    t = ByteTracker(real_cfg)
    out = []
    for _ in range(5):
        out = t.update([det(100, 100, 130, 160, conf=0.15)])
    assert out == []


def test_new_person_survives_a_one_frame_flicker(real_cfg):
    """A newcomer missed for one frame before confirmation must not be dropped
    and restarted (which could stop them ever reaching min_hits)."""
    t = ByteTracker(real_cfg)
    t.update([det(100, 100, 130, 160, conf=0.7)])
    t.update([])                                    # flicker
    out = t.update([det(101, 100, 131, 160, conf=0.7)])
    assert len(out) == 1
    assert len(t.active_track_ids) == 1


def test_neighbours_in_a_pew_keep_their_own_tracks(real_cfg):
    """Two people seated shoulder to shoulder, shifting slightly, must stay
    two tracks with stable ids (optimal matching, not greedy)."""
    t = ByteTracker(real_cfg)
    a, b = (100, 100, 140, 180), (136, 100, 176, 180)
    for _ in range(3):
        out = t.update([det(*a, conf=0.8), det(*b, conf=0.8)])
    ids_before = sorted(p.track_id for p in out)
    for dx in (2, 4, 6):
        out = t.update([det(a[0] + dx, a[1], a[2] + dx, a[3], conf=0.8),
                        det(b[0] + dx, b[1], b[2] + dx, b[3], conf=0.8)])
    assert sorted(p.track_id for p in out) == ids_before
