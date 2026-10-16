"""
Runs the Camera Box's real person detector (ai/detection/detector.py) on every
frame of the test set and saves what it found, for ai/eval/score.py.

usage: python -m ai.eval.run_box <data_dir> <out.json> [--raw] [--model yolo11l.pt] [--device mps]
  --raw  skip _tidy() (to measure what it changes); otherwise exactly as the Camera Box runs.
Saves every box with confidence ≥ 0.10 (the detector's own floor) and the time per frame.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

import cv2


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("data"); ap.add_argument("out")
    ap.add_argument("--raw", action="store_true")
    ap.add_argument("--model", default="auto"); ap.add_argument("--device", default="")
    a = ap.parse_args()
    if a.raw:   # raw = the detector alone: no clean-up, no lookalike check
        os.environ["DETECTION_LOOKALIKE_CHECK"] = "false"
    if a.model != "auto":
        os.environ["YOLO_MODEL"] = a.model
    if a.device:
        os.environ["DETECTION_DEVICE"] = a.device
    import ai.detection.detector as d
    from ai.config import config
    if a.raw:
        d._tidy = lambda b, s, h: (b, s)
    det = d.PersonDetector(config.detection)
    data = Path(a.data)
    labels = json.loads((data / "labels.json").read_text())
    out = {"path": "camera_box", "model": str(det._cfg.model_path.name if hasattr(det._cfg, "model_path") else a.model),
           "imgsz": config.detection.imgsz, "tiles": config.detection.tiles, "raw": a.raw, "frames": {}}
    for k, l in enumerate(labels):
        img = cv2.imread(str(data / "frames" / l["frame"]))
        t0 = time.perf_counter()
        found = det.detect(img)
        dt = time.perf_counter() - t0
        out["frames"][l["frame"]] = {"sec": round(dt, 3), "boxes": [[*map(lambda v: round(float(v), 1), x.bbox), round(x.confidence, 3)] for x in found]}
        if k % 25 == 0:
            print(f"{k}/{len(labels)} {dt:.2f}s", flush=True)
    Path(a.out).write_text(json.dumps(out))


if __name__ == "__main__":
    main()
