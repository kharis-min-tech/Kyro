"""Face matching across cameras — OFF unless an administrator switches it on (Cameras
page → Face matching), after confirming the church has done a data protection
impact assessment and put up notices at the entrances.

What it's for: where two cameras see the same part of the hall, the same person
would be counted by both. When a face is seen clearly by two cameras at the same
moment, the website counts that person once.

What it does and doesn't keep:
  - For each clearly visible face, a list of 128 numbers (a "face code") is made
    with OpenCV's SFace model. No photo of anyone's face is kept or sent.
  - Face codes only exist for the current moment: they're sent with the next
    report, held in the website's memory for under a minute to compare cameras,
    and never written to disk — here or on the website.
  - Nothing is matched against any list of known people. Kyro doesn't know who
    anyone is.

Models (OpenCV Zoo, Apache-2.0, ONNX — data, not code), checked by SHA-256 before use:
  face_detection_yunet_2023mar.onnx, face_recognition_sface_2021dec.onnx
"""
from __future__ import annotations

import base64
import hashlib
import logging
import os
import threading
import urllib.request
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

log = logging.getLogger("kyro.box.faces")

ZOO = "https://github.com/opencv/opencv_zoo/raw/main/models"
MODELS = {
    "yunet": ("face_detection_yunet/face_detection_yunet_2023mar.onnx",
              "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"),
    "sface": ("face_recognition_sface/face_recognition_sface_2021dec.onnx",
              "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"),
}
MIN_FACE_PX = 36          # smaller faces (far away) give unreliable codes: skipped
MIN_FACE_SCORE = 0.85     # how sure the face finder must be that it's a face
MAX_FACES = 250           # per camera per report


def _models_dir() -> Path:
    base = os.environ.get("KYRO_MODELS_DIR")
    d = Path(base) if base else Path.home() / ".kyro-box" / "models"
    (d / "faces").mkdir(parents=True, exist_ok=True)
    return d / "faces"


def _fetch(name: str) -> Path:
    rel, sha = MODELS[name]
    path = _models_dir() / Path(rel).name
    if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != sha:
        log.info("Downloading the %s face model…", name)
        tmp = path.with_suffix(".part")
        urllib.request.urlretrieve(f"{ZOO}/{rel}", tmp)
        got = hashlib.sha256(tmp.read_bytes()).hexdigest()
        if got != sha:
            tmp.unlink(missing_ok=True)
            raise RuntimeError(f"the {name} face model download didn't match its fingerprint — not used")
        tmp.replace(path)
    return path


class FaceCodes:
    """Face codes for the people in a picture. Loads the models on first use."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._det = None
        self._rec = None
        self.error: Optional[str] = None

    def _load(self) -> bool:
        if self._rec is not None:
            return True
        try:
            self._det = cv2.FaceDetectorYN.create(str(_fetch("yunet")), "", (320, 320), MIN_FACE_SCORE, 0.3, 50)
            self._rec = cv2.FaceRecognizerSF.create(str(_fetch("sface")), "")
            self.error = None
            log.info("Face matching ready")
            return True
        except Exception as e:  # noqa: BLE001 — counting carries on without it
            self.error = f"Face matching unavailable: {e}"[:160]
            log.warning(self.error)
            return False

    def codes(self, frame: np.ndarray, person_boxes) -> list[np.ndarray]:
        """One code per clearly visible face, looking only at each person's head area."""
        with self._lock:
            if not self._load():
                return []
            H, W = frame.shape[:2]
            out = []
            for x1, y1, x2, y2 in person_boxes:
                w, h = x2 - x1, y2 - y1
                # The head is in the top part of a person's box.
                X1, Y1 = int(max(0, x1 - 0.15 * w)), int(max(0, y1 - 0.1 * h))
                X2, Y2 = int(min(W, x2 + 0.15 * w)), int(min(H, y1 + 0.6 * h))
                crop = frame[Y1:Y2, X1:X2]
                if crop.shape[0] < MIN_FACE_PX or crop.shape[1] < MIN_FACE_PX:
                    continue
                self._det.setInputSize((crop.shape[1], crop.shape[0]))
                _, faces = self._det.detect(crop)
                if faces is None or not len(faces):
                    continue
                f = max(faces, key=lambda r: r[14])           # the surest face in this person's head area
                if f[2] < MIN_FACE_PX or f[14] < MIN_FACE_SCORE:
                    continue
                aligned = self._rec.alignCrop(crop, f)
                code = self._rec.feature(aligned).reshape(-1).astype(np.float32)
                n = float(np.linalg.norm(code))
                if n > 0:
                    out.append(code / n)
                if len(out) >= MAX_FACES:
                    break
            return out


def pack(codes: list[np.ndarray]) -> list[str]:
    """Compact form for the report (float16, base64): ~350 characters per face."""
    return [base64.b64encode(c.astype(np.float16).tobytes()).decode() for c in codes]
