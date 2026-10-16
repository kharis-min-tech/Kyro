"""AttendanceCounter: a briefly hidden person still counts as present."""
import numpy as np

from ai.analytics.counter import AttendanceCounter
from ai.tracking.bytetrack import TrackedPerson, TrackState


def person(tid):
    return TrackedPerson(track_id=tid, bbox=np.array([0, 0, 10, 20], dtype=np.float32), confidence=0.9, state=TrackState.CONFIRMED)


def test_briefly_hidden_person_still_counted():
    c = AttendanceCounter()
    c.update([person(1), person(2), person(3)], still_tracked_ids={1, 2, 3})
    # Person 3 is hidden this frame but the tracker still remembers them.
    c.update([person(1), person(2)], still_tracked_ids={1, 2, 3})
    assert c.current_attendance == 3
    assert c.total_exits == 0


def test_person_who_left_drops_off():
    c = AttendanceCounter()
    c.update([person(1), person(2)], still_tracked_ids={1, 2})
    c.update([person(1)], still_tracked_ids={1})  # tracker forgot person 2
    assert c.current_attendance == 1
    assert c.total_exits == 1


def test_person_picked_up_again_under_new_id_counts_once():
    c = AttendanceCounter()
    c.update([person(1)], still_tracked_ids={1})
    # The tracker lost person 1 (they moved) and found them again as track 2,
    # while still remembering track 1: that's one person, not two.
    c.update([person(2)], still_tracked_ids={1, 2})
    assert c.current_attendance == 1
    assert c.peak_attendance == 1


def test_new_arrival_while_nobody_is_lost_still_counts():
    c = AttendanceCounter()
    c.update([person(1)], still_tracked_ids={1})
    c.update([person(1), person(2)], still_tracked_ids={1, 2})
    assert c.current_attendance == 2
