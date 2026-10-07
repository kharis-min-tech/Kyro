"""
Kyro — Person Detector

Wraps YOLOv8 to detect every visible person in a camera frame.
Returns normalised bounding boxes, confidence scores, and class IDs.

Design decisions:
- Single responsibility: this module ONLY detects, it does not track.
- Device selection is automatic: CUDA → MPS → CPU fallback.
- Model is loaded once at construction and reused across frames.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from ultralytics import YOLO

from ai.config import DetectionConfig

logger = logging.getLogger(__name__)


@dataclass
class Detection:
    """A single person detection result from one frame."""

    # Bounding box in absolute pixel coordinates [x1, y1, x2, y2]
    bbox: np.ndarray  # shape (4,)

    # Detection confidence [0.0, 1.0]
    confidence: float

    # COCO class ID (always 0 = person for this detector)
    class_id: int = 0

    @property
    def xyxy(self) -> tuple[float, float, float, float]:
        return tuple(self.bbox.tolist())  # type: ignore

    @property
    def center(self) -> tuple[float, float]:
        x1, y1, x2, y2 = self.bbox
        return ((x1 + x2) / 2, (y1 + y2) / 2)

    @property
    def area(self) -> float:
        x1, y1, x2, y2 = self.bbox
        return max(0.0, x2 - x1) * max(0.0, y2 - y1)

    def to_tlwh(self) -> np.ndarray:
        """Convert [x1,y1,x2,y2] → [top, left, width, height] for tracker input."""
        x1, y1, x2, y2 = self.bbox
        return np.array([x1, y1, x2 - x1, y2 - y1], dtype=np.float32)


class PersonDetector:
    """
    GPU-accelerated person detector backed by YOLOv8.

    Usage:
        detector = PersonDetector(config)
        detections = detector.detect(frame)   # frame is a BGR numpy array
    """

    def __init__(self, cfg: DetectionConfig) -> None:
        self._cfg = cfg
        self._device = self._resolve_device(cfg.device)
        if cfg.model_name in ("auto", ""):
            # Most accurate model the hardware can keep up with (see config.py).
            name = "yolo11x.pt" if self._device == "cuda" else "yolo11l.pt"
            cfg.model_name = name
            cfg.model_path = cfg.model_path.parent / name
        self._model = self._load_model(cfg.model_path, cfg.model_name)
        logger.info(
            "PersonDetector ready | model=%s device=%s conf=%.2f",
            cfg.model_name,
            self._device,
            cfg.confidence_threshold,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def detect(self, frame: np.ndarray) -> list[Detection]:
        """
        Run inference on a single BGR frame.

        With tiling on (DETECTION_TILES ≥ 2) the frame is checked twice: once
        whole, and once as a grid of overlapping tiles, each at full model
        resolution. A person at the back of a hall may be only ~20 px tall —
        too small for the model once the whole frame is shrunk to its input
        size, but large enough inside a tile. Results are merged so nobody is
        counted twice.

        Args:
            frame: H×W×3 numpy array in BGR colour order (OpenCV default).

        Returns:
            List of Detection objects, one per visible person.
        """
        boxes, scores = self._predict(frame)
        grid = self._tile_grid(frame)
        if grid > 1:
            H, W = frame.shape[:2]
            all_b, all_s, all_e = [boxes], [scores], [np.zeros(len(boxes), dtype=bool)]
            for (x, y, crop) in self._tiles(frame, grid):
                b, sc = self._predict(crop)
                if not len(b):
                    continue
                th, tw = crop.shape[:2]
                # Is the box cut off by an INNER tile edge (not the frame
                # edge)? Then it may be only part of a person.
                m = 3.0
                edge = ((b[:, 0] <= m) & (x > 0)) | ((b[:, 1] <= m) & (y > 0)) \
                     | ((b[:, 2] >= tw - m) & (x + tw < W)) | ((b[:, 3] >= th - m) & (y + th < H))
                all_b.append(b + np.array([x, y, x, y], dtype=np.float32))
                all_s.append(sc)
                all_e.append(edge)
            boxes, scores = _merge(np.concatenate(all_b), np.concatenate(all_s), np.concatenate(all_e),
                                   self._cfg.merge_iou, self._cfg.merge_containment)

        detections = [
            Detection(bbox=b.astype(np.float32), confidence=float(c), class_id=0)
            for b, c in zip(boxes, scores)
        ]

        if self._cfg.overhead_mode:
            detections = self._filter_overhead(detections, frame.shape[0], frame.shape[1])

        return detections

    def _predict(self, img: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """One model pass → (N×4 xyxy boxes, N scores)."""
        results = self._model.predict(
            source=img,
            conf=self._cfg.confidence_threshold,
            iou=self._cfg.iou_threshold,
            classes=self._cfg.target_classes,
            imgsz=self._cfg.imgsz,
            max_det=self._cfg.max_det,
            device=self._device,
            augment=self._cfg.tta,   # also checks a flipped / rescaled copy
            verbose=False,
        )
        r = results[0]
        if r.boxes is None or len(r.boxes) == 0:
            return np.zeros((0, 4), dtype=np.float32), np.zeros((0,), dtype=np.float32)
        return r.boxes.xyxy.cpu().numpy().astype(np.float32), r.boxes.conf.cpu().numpy().astype(np.float32)

    def _tile_grid(self, frame: np.ndarray) -> int:
        """Tiles per side: the configured number, or for "auto" 2 when the
        frame is meaningfully bigger than the model's input, else 1 (off)."""
        t = self._cfg.tiles
        if t == "auto":
            return 2 if max(frame.shape[:2]) > self._cfg.imgsz * 1.25 else 1
        try:
            return max(1, int(t))
        except ValueError:
            return 1

    def _tiles(self, frame: np.ndarray, grid: int):
        """Overlapping grid×grid crops: yields (x_offset, y_offset, crop)."""
        H, W = frame.shape[:2]
        ov = self._cfg.tile_overlap
        tw = int(W / (grid - (grid - 1) * ov))
        th = int(H / (grid - (grid - 1) * ov))
        for y in np.linspace(0, H - th, grid).astype(int):
            for x in np.linspace(0, W - tw, grid).astype(int):
                yield int(x), int(y), frame[y:y + th, x:x + tw]

    def _filter_overhead(
        self, detections: list[Detection], frame_h: int, frame_w: int
    ) -> list[Detection]:
        """
        Heuristic pass for birds-eye/overhead cameras: keep only boxes whose
        shape and size are plausible for a human head viewed from directly
        above, to reduce false positives on non-human objects. See
        DetectionConfig.overhead_mode docstring for why this is a heuristic
        stop-gap rather than a trained solution.
        """
        frame_area = float(frame_h * frame_w) or 1.0
        kept = []
        for det in detections:
            x1, y1, x2, y2 = det.bbox
            w, h = max(1e-6, x2 - x1), max(1e-6, y2 - y1)
            aspect = w / h
            area_frac = (w * h) / frame_area
            if not (self._cfg.overhead_min_aspect_ratio <= aspect <= self._cfg.overhead_max_aspect_ratio):
                continue
            if not (self._cfg.overhead_min_area_frac <= area_frac <= self._cfg.overhead_max_area_frac):
                continue
            kept.append(det)
        return kept

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_device(requested: str) -> str:
        """
        Resolve the best available compute device.
        Falls back gracefully: CUDA → MPS → CPU.
        """
        if requested == "cuda":
            if torch.cuda.is_available():
                logger.info("CUDA GPU detected: %s", torch.cuda.get_device_name(0))
                return "cuda"
            logger.warning("CUDA requested but not available — falling back to CPU")
            return "cpu"

        if requested == "mps":
            if torch.backends.mps.is_available():
                logger.info("Apple MPS device available")
                return "mps"
            logger.warning("MPS requested but not available — falling back to CPU")
            return "cpu"

        return "cpu"

    @staticmethod
    def _load_model(model_path: Path, model_name: str) -> YOLO:
        """
        Load YOLO model from local path if it exists,
        otherwise let ultralytics download it automatically.
        """
        if model_path.exists():
            logger.info("Loading YOLO model from %s", model_path)
            return YOLO(str(model_path))

        # Download straight into the weights folder (a Docker volume), so the
        # model is fetched once rather than on every container restart.
        logger.info("Model not found locally — downloading %s", model_name)
        try:
            return YOLO(str(model_path))
        except Exception:  # noqa: BLE001 — fall back to Ultralytics' default location
            return YOLO(model_name)


def _merge(boxes: np.ndarray, scores: np.ndarray, at_tile_edge: np.ndarray,
           iou: float, containment: float) -> tuple[np.ndarray, np.ndarray]:
    """
    Merge detections from the whole frame and the tiles.

    1. Non-max suppression removes the same person found twice.
    2. A box cut off by an inner tile edge that lies mostly inside a bigger
       box is a fragment (a tile only saw half that person) and is dropped.

    Only tile-edge boxes can be dropped as fragments. A person sitting behind
    someone else often lies almost entirely inside the front person's box —
    treating every contained box as a fragment deleted those real people.
    """
    if len(boxes) == 0:
        return boxes, scores
    import torch, torchvision  # local: torch is already loaded by ultralytics
    keep = torchvision.ops.nms(torch.from_numpy(boxes), torch.from_numpy(scores), iou).numpy()
    boxes, scores, at_tile_edge = boxes[keep], scores[keep], at_tile_edge[keep]
    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    kept: list[int] = []
    for i in range(len(boxes)):
        if at_tile_edge[i]:
            bi = boxes[i]
            for j in range(len(boxes)):
                if j == i or areas[j] < areas[i] * 1.3:
                    continue
                bj = boxes[j]
                iw = max(0.0, min(bi[2], bj[2]) - max(bi[0], bj[0]))
                ih = max(0.0, min(bi[3], bj[3]) - max(bi[1], bj[1]))
                if areas[i] > 0 and (iw * ih) / areas[i] > containment:
                    break
            else:
                kept.append(i)
            continue
        kept.append(i)
    kept_arr = np.array(kept, dtype=int)
    return boxes[kept_arr], scores[kept_arr]
