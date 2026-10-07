# Person-detection accuracy

How well Kyro finds people, measured on crowded scenes where every person has
been labelled by hand (COCO val2017 photos with 8+ people, no unlabelled crowd
regions).

## Results (October 2026)

**Whole-hall test**: four crowded photos per 1920×1080 frame, like a camera
covering a whole hall, so people are small in the frame. 37 frames, 1,537
labelled people. Run with Kyro's real detector code (`benchmark_wide.py`).

| Setup | People found | Small / distant | Medium | Near | Headcount error / frame | s / frame* |
|---|---|---|---|---|---|---|
| **Old default**: yolov8n @640 | 28.0% | 0.4% | 20.6% | 68.1% | 28.5 | 0.2 |
| yolo11m @640 | 56.6% | 12.2% | 68.0% | 90.4% | 19.0 | 0.1 |
| yolo11m @1280 | 74.8% | 45.2% | 84.9% | 93.8% | 10.0 | 0.3 |
| yolo11m @1920 | 81.1% | 62.3% | 87.2% | 93.8% | 6.5 | 0.7 |
| yolo11s @1280 + 2×2 tiles | 80.5% | 61.5% | 86.6% | 93.5% | 4.8 | 0.6 |
| yolo11m @1280 + 2×2 tiles | 83.3% | 66.5% | 88.4% | 94.9% | 4.4 | 1.4 |
| **New default (no GPU)**: yolo11l @1280 + 2×2 tiles | **84.2%** | **68.6%** | **89.4%** | **94.4%** | **4.0** | 1.7 |
| **New default (NVIDIA GPU)**: yolo11x @1280 + 2×2 tiles | 86.1% | 72.4% | 90.3% | 95.5% | 4.3 | 3.6 |
| yolo11l @1280 + 3×3 tiles | 86.0% | 76.9% | 88.3% | 93.1% | 6.0 | 3.4 |
| yolo11m @1280 + 2×2 + flip (TTA) | 84.4% | 68.4% | 89.1% | 95.8% | 4.7 | 3.2 |

\*Apple M-series GPU. CPU only: yolo11s ≈1.4 s, yolo11m ≈3.0 s, yolo11l ≈3.9 s per
1080p frame on the same Mac. Expect an office PC to be 1.5–2× slower.

Headcount error is measured at the confidence where the tracker starts
counting someone (0.25). 3×3 tiles find more distant people but add false
detections, so 2×2 gives the better count. TTA didn't pay for its cost.

**Single-photo test** (`benchmark_coco.py`, 150 photos, 1,558 people). The
photos are only ~640 px, so this mainly shows model strength: yolov8n 57% →
yolo11l 83% → yolo11x 84% of people found (at 640).

## What changed to get there

1. **Model**: yolov8n (smallest) → yolo11l / yolo11x (`YOLO_MODEL=auto`).
2. **Resolution**: 640 → 1280, and the AI now sees the camera's full
   resolution instead of a frame shrunk to 1280×720 first.
3. **Tiling**: the frame is checked whole AND as a 2×2 grid of overlapping
   tiles, so people at the back are big enough to recognise. Merging drops
   only half-people cut at a tile edge, never someone sitting behind another.
4. **Tracker**: anyone scored ≥ 0.25 can be counted (it was 0.6, so half-
   hidden and distant people were found and then discarded); optimal
   (Hungarian) matching; a short grace for flickering newcomers; "remember a
   hidden person" is ~4 seconds whatever the frame rate.
5. **Live headcount** includes people momentarily hidden (someone stood in
   front of them) instead of dropping them for that moment.
6. **Latest frame**: the worker always processes the newest camera frame, so
   a slower, stronger model never lags behind.

## Checking a real camera

    python -m ai.check_camera --stream rtsp://user:pass@camera/stream1

Saves a picture with a numbered box on everyone found. Anyone without a box
is someone that camera can't see well enough.

## Re-running the benchmark

    pip install pycocotools
    # data/annotations/instances_val2017.json from cocodataset.org
    python ai/eval/benchmark_wide.py data . auto 1280 auto 0 0.10
