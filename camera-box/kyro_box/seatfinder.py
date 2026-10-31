"""Kyro finds the seats by itself — nobody draws them.

Two kinds of evidence, per camera, in the seat engine's 1280×720 picture:
  1. Where people SIT: a person who stays in the same place for a while (seen
     there on several separate checks over 90 s or more) is sitting, so that
     place is a seat. People walking about never stay long enough.
  2. Empty chairs, benches and sofas the AI recognises (checked every few
     minutes, mostly useful before people arrive).

When it isn't sure — a "seat" where someone stood very upright (maybe a pastor
on the stage, or someone at the back wall), or one far away from every other
seat — it asks an administrator with a picture: "Is this a seat?". It also asks
once which end of the picture the stage is at, so row A is the front row.

Seats keep the same id for good (K1, K2 …), so the seat map doesn't jump about
as more seats are found. Everything learned is kept on this computer and
survives restarts; the website gets the seat list to draw the seat map.
"""
from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from typing import Optional

import cv2
import numpy as np

from kyro_box import settings

log = logging.getLogger("kyro.box.seats")

STAY_CHECKS = 4          # seen in the same place on this many separate checks …
STAY_SPAN_S = 90         # … spread over at least this long = someone sitting there
CHECK_GAP_S = 15         # checks closer together than this count as one
SAME_PLACE_IOU = 0.45    # this much overlap = the same place
CHAIR_EVERY_S = 300      # look for empty chairs this often
CHAIR_CHECKS = 2         # a chair seen on this many looks = a seat
CHAIR_FIRST_AFTER_S = 60 # first look for chairs this long after a camera starts
STANDING_RATIO = 2.6     # taller than this × wider = standing, not sitting → ask
PUBLISH_EVERY_S = 30     # send the seat list to the website at most this often
# The website keeps a camera's seats in one stored value capped at 128 KB, which
# is about 900 seats. Kyro sends its surest seats up to this many.
MAX_SEATS = 800
ASK_PER_HOUR = 12        # never flood anyone with questions
ROWS = "ABCDEFGHJKLMNPQRSTUVWXYZ"


def _iou(a, b) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0])); iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    i = ix * iy
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i
    return i / u if u > 0 else 0.0


def chair_to_seat(b) -> list[float]:
    """A chair's box → where a person sitting on it appears (chair plus their upper body above it)."""
    h = b[3] - b[1]
    return [float(b[0]), float(max(0.0, b[1] - 1.1 * h)), float(b[2]), float(b[3])]


class _Camera:
    def __init__(self, key: str) -> None:
        self.key = key
        self.places: list[dict] = []     # every place someone sat / a chair was seen
        self.next_id = 1
        self.stage = "top"
        self.stage_known = False
        # First empty-chair search a minute after the camera starts: counting comes first.
        self.chairs_at = time.time() - CHAIR_EVERY_S + CHAIR_FIRST_AFTER_S
        self.dirty = False
        self.published_at = 0.0
        self.asked: list[float] = []
        self.open_question: Optional[str] = None


class SeatFinder:
    def __init__(self, counter, detector) -> None:
        self.counter, self.detector = counter, detector
        self.cams: dict[str, _Camera] = {}
        self._lock = threading.Lock()
        self._questions: dict[str, tuple[str, str, Optional[int]]] = {}   # question id → (camera, kind, place id)

    # ── Saved on this computer ───────────────────────────────────────────
    def _file(self, key: str):
        d = settings.HOME / "seats"
        d.mkdir(parents=True, exist_ok=True)
        return d / f"{key}.json"

    def _cam(self, key: str) -> _Camera:
        c = self.cams.get(key)
        if c is None:
            c = self.cams[key] = _Camera(key)
            try:
                d = json.loads(self._file(key).read_text())
                c.places, c.next_id = d.get("places", []), d.get("next_id", 1)
                c.stage, c.stage_known = d.get("stage", "top"), d.get("stage_known", False)
                c.dirty = True
            except (FileNotFoundError, ValueError):
                pass
        return c

    def _save(self, c: _Camera) -> None:
        self._file(c.key).write_text(json.dumps({"places": c.places, "next_id": c.next_id, "stage": c.stage, "stage_known": c.stage_known}))

    # ── Watching ─────────────────────────────────────────────────────────
    def observe(self, key: str, person_boxes: list, picture: np.ndarray) -> None:
        """After each count: where people are now (seat engine coordinates), and the picture."""
        now = time.time()
        with self._lock:
            c = self._cam(key)
            for b in person_boxes:
                self._seen(c, [float(v) for v in b[:4]], now, "person")
            if now - c.chairs_at > CHAIR_EVERY_S and self.detector is not None:
                c.chairs_at = now
                try:
                    for box, _score in self.detector.detect_seating(picture):
                        self._seen(c, chair_to_seat(box.tolist()), now, "chair")
                except Exception:  # noqa: BLE001 — finding chairs is a bonus; never stop counting
                    log.exception("Looking for chairs failed")
            self._decide(c, picture, now)

    def _seen(self, c: _Camera, box: list, now: float, how: str) -> None:
        best, best_iou = None, SAME_PLACE_IOU
        for p in c.places:
            i = _iou(p["box"], box)
            if i > best_iou:
                best, best_iou = p, i
        if best is None:
            if len(c.places) >= MAX_SEATS * 2:
                return
            best = {"id": c.next_id, "box": box, "checks": [], "chairs": 0, "status": "maybe", "tall": 0, "seen": 0}
            c.next_id += 1
            c.places.append(best)
        if how == "chair":
            best["chairs"] += 1
            return
        best["seen"] += 1
        w, h = box[2] - box[0], box[3] - box[1]
        if w > 0 and h / w > STANDING_RATIO:
            best["tall"] += 1
        if best["status"] != "seat":
            # The place settles where people actually sit (until it's confirmed as a seat).
            best["box"] = [0.8 * a + 0.2 * b for a, b in zip(best["box"], box)]
        if not best["checks"] or now - best["checks"][-1] >= CHECK_GAP_S:
            best["checks"] = (best["checks"] + [now])[-20:]

    def _decide(self, c: _Camera, picture: np.ndarray, now: float) -> None:
        # Which end the stage is decides which row is A: ask that first.
        if not c.stage_known and sum(p["status"] == "seat" for p in c.places) >= 6 and c.open_question is None:
            self._ask_stage(c, picture, now)
        for p in c.places:
            if p["status"] != "maybe":
                continue
            sat = len(p["checks"]) >= STAY_CHECKS and p["checks"][-1] - p["checks"][0] >= STAY_SPAN_S
            chair = p["chairs"] >= CHAIR_CHECKS
            if not (sat or chair):
                continue
            standing = p["seen"] and p["tall"] / p["seen"] > 0.6
            if (standing or self._alone(c, p)) and not chair:
                if self._ask_seat(c, p, picture, now):
                    p["status"] = "asked"
                continue
            p["status"] = "seat"
            c.dirty = True
        # Forget places nobody's been in for days that never became seats.
        c.places = [p for p in c.places if p["status"] != "maybe" or not p["checks"] or now - p["checks"][-1] < 3 * 86400]

    def _alone(self, c: _Camera, p: dict) -> bool:
        """No other seat anywhere near: unusual for a hall full of chairs or pews."""
        w = p["box"][2] - p["box"][0]
        cx, cy = (p["box"][0] + p["box"][2]) / 2, (p["box"][1] + p["box"][3]) / 2
        seats = [q for q in c.places if q is not p and q["status"] == "seat"]
        if len(seats) < 6:
            return False
        return all(abs((q["box"][0] + q["box"][2]) / 2 - cx) > 4 * w or abs((q["box"][1] + q["box"][3]) / 2 - cy) > 3 * w for q in seats)

    # ── Asking ───────────────────────────────────────────────────────────
    def _can_ask(self, c: _Camera, now: float) -> bool:
        c.asked = [t for t in c.asked if now - t < 3600]
        return len(c.asked) < ASK_PER_HOUR and c.open_question is None

    def _ask_seat(self, c: _Camera, p: dict, picture: np.ndarray, now: float) -> bool:
        if not self._can_ask(c, now):
            return False
        x1, y1, x2, y2 = (int(v) for v in p["box"])
        H, W = picture.shape[:2]
        crop_box = (max(0, x1 - 220), max(0, y1 - 160), min(W, x2 + 220), min(H, y2 + 160))
        crop = picture[crop_box[1]:crop_box[3], crop_box[0]:crop_box[2]].copy()
        cv2.rectangle(crop, (x1 - crop_box[0], y1 - crop_box[1]), (x2 - crop_box[0], y2 - crop_box[1]), (241, 102, 99), 3)
        why = "someone stood very upright there" if p["seen"] and p["tall"] / p["seen"] > 0.6 else "it's away from the other seats"
        self._send(c, "seat", p["id"], f"Is this a seat? Kyro thinks so, but {why}.",
                   ["Yes, it's a seat", "No, not a seat", "Ignore"], crop, p["box"], now)
        return True

    def _ask_stage(self, c: _Camera, picture: np.ndarray, now: float) -> None:
        if not self._can_ask(c, now):
            return
        small = cv2.resize(picture, (640, 360))
        self._send(c, "stage", None, "Where is the stage in this camera's picture? (So row A is the front row.)",
                   ["Stage at the top", "Stage at the bottom", "Ignore"], small, None, now)

    def _send(self, c: _Camera, kind: str, place: Optional[int], text: str, options: list, crop, box, now: float) -> None:
        if crop is None or not crop.size:
            return
        qid = f"seat-{uuid.uuid4().hex[:12]}"
        ok, jpg = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 78])
        q = {"type": "review_request", "review_id": qid, "camera_id": c.key, "review_type": "seat_question", "target_role": "admin",
             "question": text, "track_id": -1, "seat_id": None, "position": [((box[0] + box[2]) / 2) if box else 640, ((box[1] + box[3]) / 2) if box else 360],
             "bbox_hint": box, "confidence": 0.5, "best_guess": options[0], "options": options, "created_at": now}
        self.counter.add_question(c.key, q, jpg.tobytes() if ok else None)
        self._questions[qid] = (c.key, kind, place)
        c.open_question = qid
        c.asked.append(now)

    def answer(self, key: str, review_id: str, answer: str) -> None:
        """An administrator answered on the website."""
        with self._lock:
            info = self._questions.pop(review_id, None)
            c = self._cam(key)
            if c.open_question == review_id:
                c.open_question = None
            if info is None:
                return
            _, kind, place = info
            a = answer.lower()
            if kind == "stage":
                if a.startswith(("stage", "yes", "top", "bottom")):
                    c.stage, c.stage_known = ("bottom" if "bottom" in a else "top"), True
                    c.dirty = True
            else:
                for p in c.places:
                    if p["id"] == place:
                        p["status"] = "seat" if a.startswith("yes") else "not_seat" if a.startswith("no") else "maybe"
                        if p["status"] == "maybe":
                            p["checks"] = []          # ask again later only if it keeps looking like a seat
                c.dirty = True
            self._save(c)

    # ── The seat list ────────────────────────────────────────────────────
    def seats(self, key: str) -> list[dict]:
        """Seats with rows (A = nearest the stage) and numbers (left to right), ids that never change."""
        c = self._cam(key)
        seats = [p for p in c.places if p["status"] == "seat"]
        if not seats:
            return []
        if len(seats) > MAX_SEATS:          # the ones Kyro has seen used most
            seats = sorted(seats, key=lambda p: -(p["seen"] + 5 * p["chairs"]))[:MAX_SEATS]
        h = float(np.median([p["box"][3] - p["box"][1] for p in seats]))
        order = sorted(seats, key=lambda p: (p["box"][1] + p["box"][3]) / 2, reverse=(c.stage == "bottom"))
        rows, row = [], [order[0]]
        for p in order[1:]:
            cy, prev = (p["box"][1] + p["box"][3]) / 2, (row[-1]["box"][1] + row[-1]["box"][3]) / 2
            if abs(cy - prev) > 0.45 * h:
                rows.append(row); row = []
            row.append(p)
        rows.append(row)
        out = []
        for r, members in enumerate(rows):
            label = ROWS[r] if r < len(ROWS) else f"R{r + 1}"
            for n, p in enumerate(sorted(members, key=lambda p: p["box"][0]), start=1):
                out.append({"seat_id": f"K{p['id']}", "row": label, "number": n, "section": "Main",
                            "bbox": [round(v, 1) for v in p["box"]]})
        return out

    def publish(self, server: str, token: str) -> None:
        """Send changed seat lists to the website (from the reporting thread), and start using them."""
        from kyro_box import cloud
        now = time.time()
        for key, c in list(self.cams.items()):
            if not c.dirty or now - c.published_at < PUBLISH_EVERY_S:
                continue
            with self._lock:
                seats = self.seats(key)
                self._save(c)
                c.dirty = False
            c.published_at = now
            if not seats:
                continue
            try:
                res = cloud.auto_seats(server, token, key, seats, c.stage)
                if res.get("active"):
                    self.counter.set_seats(key, res.get("version"), seats)
                log.info("Kyro found %d seats on %s", len(seats), key)
            except cloud.CloudError as e:
                c.dirty = True
                log.info("Couldn't send the seats Kyro found: %s", e)
