"""
Merging whole-frame + tile detections (ai.detection.detector._merge):
the same person must be counted once, a tile's half-person fragment must be
dropped, and real people — including someone mostly hidden behind another —
must all be kept.
"""
import numpy as np
import pytest

pytest.importorskip("torchvision")
from ai.detection.detector import _merge  # noqa: E402


def arr(*boxes):
    return np.array(boxes, dtype=np.float32)


def merge(boxes, scores, edge):
    return _merge(arr(*boxes), np.array(scores, dtype=np.float32), np.array(edge, dtype=bool), 0.55, 0.6)


def test_same_person_from_frame_and_tile_counted_once():
    b, s = merge([[100, 100, 150, 220], [102, 101, 151, 219]], [0.8, 0.7], [False, False])
    assert len(b) == 1 and s[0] == pytest.approx(0.8)


def test_tile_edge_fragment_is_dropped():
    # Whole person from the full frame, plus the top half of the same person
    # cut off by a tile's lower edge.
    b, _ = merge([[100, 100, 150, 220], [100, 100, 150, 160]], [0.8, 0.6], [False, True])
    assert len(b) == 1


def test_two_neighbours_both_kept():
    b, _ = merge([[100, 100, 150, 220], [140, 100, 190, 220]], [0.8, 0.75], [False, False])
    assert len(b) == 2


def test_person_behind_another_is_kept():
    # Someone sitting behind is mostly inside the front person's box. Not a
    # tile fragment, so must never be merged away.
    b, _ = merge([[100, 100, 200, 300], [120, 110, 170, 200]], [0.9, 0.5], [False, False])
    assert len(b) == 2
