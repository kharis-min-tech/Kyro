"""
Fine-tunes Kyro's person detector (YOLO11, starting from the COCO weights it
already uses) on the Open Images person set from build_openimages.py, as a
single "person" class. Checkpoints are saved every few epochs so each can be
judged with ai/train/evaluate.py; a checkpoint only replaces Kyro's model if it
beats the current one on the held-out test halves.

usage: python -m ai.train.train <dataset_dir> <runs_dir> [--model yolo11l.pt] [--epochs 12]
        [--imgsz 960] [--batch 8] [--device mps] [--name oi_l960]
"""
from __future__ import annotations

import argparse
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("data"); ap.add_argument("runs")
    ap.add_argument("--model", default="yolo11l.pt")
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--imgsz", type=int, default=960)      # people far away need detail; Kyro looks at 1280 + tiles
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--device", default="mps")
    ap.add_argument("--name", default="oi_l960")
    ap.add_argument("--freeze", type=int, default=10)       # keep the backbone (general vision) fixed: faster, forgets less
    ap.add_argument("--fraction", type=float, default=1.0)  # share of the training photos used each run
    a = ap.parse_args()
    from ultralytics import YOLO
    YOLO(a.model).train(
        data=str(Path(a.data) / "data.yaml"), project=a.runs, name=a.name, exist_ok=True,
        epochs=a.epochs, imgsz=a.imgsz, batch=a.batch, device=a.device, workers=4,
        single_cls=True, freeze=a.freeze, fraction=a.fraction,
        # Fine-tuning, not training from scratch: a gentle learning rate, so the
        # model keeps what it learned on COCO and adds what Open Images teaches.
        optimizer="AdamW", lr0=0.0004, lrf=0.1, cos_lr=True, warmup_epochs=1,
        close_mosaic=3, save_period=2, patience=50, plots=False, verbose=True,
    )


if __name__ == "__main__":
    main()
