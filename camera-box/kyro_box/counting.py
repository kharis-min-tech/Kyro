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
    faces: Optional[list] = None      # face codes (only while face matching is switched on; never saved)
    faces_at: float = 0.0
    questions: list = field(default_factory=list)   # [(question dict, jpeg bytes)] waiting to be sent


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
        self.face_matching = False                     # switched on by an administrator on the website
        self.seat_finder = None                        # finds the seats by itself (kyro_box/seatfinder.py)
        self._rota: dict[str, list] = {}               # camera key → rota entries from the website
        self._zones: dict[str, list] = {}              # camera key → stage / ignore areas from the website
        self._faces = None
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
            # What the church taught the AI before ("that's the stage") survives restarts.
            p._movement.review_queue.load_memory(_load_memory(key))
            self._apply_policies(key)
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
        """A seat layout for this camera (drawn on the website, or found by Kyro).

        Seats that are still there with the same place keep their state and grace
        timers (so reserving a seat, or Kyro finding more seats, never blanks the
        room); new seats are added and removed ones dropped — no restart needed."""
        if version is None:
            self._seats.pop(key, None)
            self._pipelines.pop(key, None)
            if key in self.stats:
                self.stats[key].seats = None
            return
        self._seats[key] = (version, seats)
        p = self._pipelines.get(key)
        if p is None:
            return                      # built with these seats on the next count
        engine = p._seat_engine
        have = {seat.seat_id: seat for seat in engine.seats}
        made = {seat.seat_id: seat for seat in self._make_seats(key)}
        merged = []
        for sid, new in made.items():
            old = have.get(sid)
            if old is not None and [round(float(v), 1) for v in old.bbox] == [round(float(v), 1) for v in new.bbox]:
                old.row, old.number, old.section = new.row, new.number, new.section
                old.set_reserved(new.reserved, new.reserved_for)
                merged.append(old)
            else:
                merged.append(new)
        engine._seats[:] = merged
        engine._tag_exclusion_seats()

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
        self._face_codes(s, frame, result.counted_boxes, small.shape)
        self._collect_questions(key, s, pipeline, small)
        if self.seat_finder is not None:
            self.seat_finder.observe(key, result.counted_boxes, small)
        if key in self._seats:
            s.seats = [[d["seat_id"], d["state"], int(d.get("vacancy_seconds") or 0), round(float(d.get("confidence") or 0), 2)]
                       for d in result.seat_states]
        if s.current > 0:
            s.last_people_at = s.counted_at

    # ── Rota holds and stage / ignore areas (from the website) ─────────────
    def set_policies(self, key: str, rota: list, zones: list) -> None:
        if self._rota.get(key) == rota and self._zones.get(key) == zones:
            return
        self._rota[key], self._zones[key] = rota, zones
        self._apply_policies(key)

    def _apply_policies(self, key: str) -> None:
        p = self._pipelines.get(key)
        if p is None:
            return
        import numpy as np
        from ai.seat_detection.rota import RotaEntry
        from ai.seat_detection.zones import ExclusionZone
        entries = []
        for e in self._rota.get(key, []):
            try:
                entries.append(RotaEntry(entry_id=e["entry_id"], label=e.get("label", ""),
                                         start_epoch=dt.datetime.fromisoformat(e["start_time"].replace("Z", "+00:00")).timestamp(),
                                         end_epoch=dt.datetime.fromisoformat(e["end_time"].replace("Z", "+00:00")).timestamp(),
                                         seat_ids=list(e.get("seat_ids") or []), rows=list(e.get("rows") or []), section=e.get("section")))
            except (KeyError, ValueError, TypeError):
                continue
        p._seat_engine.rota.load(entries)
        zones = []
        for z in self._zones.get(key, []) + _learned_zones(key):
            if not z.get("is_active", True):
                continue
            try:
                zones.append(ExclusionZone(zone_id=str(z["zone_id"]), bbox=np.array(z["bbox"], dtype=np.float32), label=z.get("label", ""),
                                           zone_type=z.get("zone_type", "hold_seats"), hold_seats_in_rows=list(z.get("hold_seats_in_rows") or [])))
            except (KeyError, ValueError, TypeError):
                continue
        p._seat_engine.set_exclusion_zones(zones)

    # ── The AI's questions, and the church's answers ───────────────────────
    def _collect_questions(self, key: str, s: "CameraStats", pipeline, small) -> None:
        for req in pipeline._movement.new_review_requests:
            q = req.to_dict()
            cx, cy = (q.get("position") or [small.shape[1] / 2, small.shape[0] / 2])[:2]
            x1, y1 = int(max(0, cx - 200)), int(max(0, cy - 150))
            crop = small[y1:int(min(small.shape[0], cy + 150)), x1:int(min(small.shape[1], cx + 200))].copy()
            if crop.size:
                cv2.circle(crop, (int(cx - x1), int(cy - y1)), 40, (241, 102, 99), 3)
                ok, jpg = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 80])
            else:
                ok, jpg = False, None
            s.questions.append((q, jpg.tobytes() if ok else None))
        del s.questions[:-10]

    def add_question(self, key: str, q: dict, jpeg: Optional[bytes]) -> None:
        """A question from elsewhere on the camera computer (e.g. "is this a seat?")."""
        s = self.stats.setdefault(key, CameraStats())
        s.questions.append((q, jpeg))
        del s.questions[:-10]

    def apply_answer(self, key: str, review_id: str, answer: str) -> bool:
        p = self._pipelines.get(key)
        if p is None:
            return False
        done = p._movement.apply_answer(review_id, answer) is not None
        learned = p._movement.review_queue.drain_persist_queue()
        if learned:
            _save_memory(key, learned)
            if any(x.get("create_zone") for x in learned):
                self._apply_policies(key)       # a newly learned stage area holds its seats from now on
        return done

    FACES_EVERY_S = 4.0
    FACES_PER_PASS = 80

    def _face_codes(self, s: "CameraStats", frame, boxes: list, small_shape) -> None:
        """Face matching across cameras (only while switched on): codes for the clearest faces
        every few seconds. Nothing is kept once it's been sent."""
        if not self.face_matching:
            s.faces = None
            return
        if time.time() - s.faces_at < self.FACES_EVERY_S:
            return
        from kyro_box import faces
        if self._faces is None:
            self._faces = faces.FaceCodes()
        sx, sy = frame.shape[1] / small_shape[1], frame.shape[0] / small_shape[0]
        full = [[b[0] * sx, b[1] * sy, b[2] * sx, b[3] * sy] for b in boxes]
        full.sort(key=lambda b: -(b[2] - b[0]))           # the biggest (nearest) people first: the clearest faces
        s.faces = faces.pack(self._faces.codes(frame, full[:self.FACES_PER_PASS]))
        s.faces_at = time.time()

    def restart_steadying(self, key: str) -> None:
        """The picture dropped out (no signal / frozen): when it's back, count fresh —
        never mix in readings from before the gap."""
        self._recent.pop(key, None)

    def people_seen_recently(self, within_s: float) -> bool:
        now = time.time()
        return any(now - s.last_people_at < within_s for s in self.stats.values())


# ── What the church taught the AI, kept on this computer ─────────────────────
def _memory_file(key: str):
    from kyro_box import settings
    d = settings.HOME / "memory"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{key}.json"


def _load_memory(key: str) -> list:
    import json
    try:
        return list(json.loads(_memory_file(key).read_text()).values())
    except (FileNotFoundError, ValueError):
        return []


def _save_memory(key: str, learned: list) -> None:
    import json
    f = _memory_file(key)
    try:
        mem = json.loads(f.read_text())
    except (FileNotFoundError, ValueError):
        mem = {}
    for x in learned:
        mem[x["region_key"]] = {k: x[k] for k in ("region_key", "cx", "cy", "classification", "confirmation_count", "auto_zone_created")}
        if x.get("create_zone") and x.get("suggested_bbox"):
            mem[x["region_key"]]["zone_bbox"] = [float(v) for v in x["suggested_bbox"]]
    f.write_text(json.dumps(mem))


def _learned_zones(key: str) -> list:
    """Stage areas the AI learned from answers ("yes, that's the stage", three times)."""
    return [{"zone_id": f"learned-{m['region_key']}", "label": "Learned stage area", "zone_type": "hold_seats", "bbox": m["zone_bbox"]}
            for m in _load_memory(key) if m.get("zone_bbox")]
