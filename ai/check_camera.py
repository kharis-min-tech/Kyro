"""
Camera check — see exactly who Kyro finds in one camera picture.

Grabs a frame from a camera (or opens a photo), runs the same detector the
live system uses, and saves a picture with a numbered box on every person
found, plus the total. Compare it with the room: anyone without a box is
someone the camera can't see well enough — usually fixed by raising or
angling the camera, more light, or a second camera for that area.

    python -m ai.check_camera --stream rtsp://user:pass@camera/stream1
    python -m ai.check_camera --stream 0                 # first USB camera
    python -m ai.check_camera --image service.jpg        # a saved photo

Writes kyro-check-<time>.jpg next to where you run it.
"""
from __future__ import annotations

import argparse
import time

import cv2
import numpy as np

from ai.config import config
from ai.detection.detector import PersonDetector


def grab(stream: str) -> np.ndarray:
    src = int(stream) if stream.isdigit() else stream
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        raise SystemExit(f"Can't open camera: {stream}")
    frame = None
    for _ in range(10):  # skip the first frames some cameras send dark
        ok, f = cap.read()
        if ok:
            frame = f
    cap.release()
    if frame is None:
        raise SystemExit("The camera didn't send a picture")
    return frame


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--stream", help="camera address (RTSP URL) or USB index")
    src.add_argument("--image", help="path to a photo")
    ap.add_argument("--count-conf", type=float, default=config.tracking.new_track_thresh,
                    help="confidence at which a person is counted (default: the live setting)")
    args = ap.parse_args()

    frame = cv2.imread(args.image) if args.image else grab(args.stream)
    if frame is None:
        raise SystemExit("Couldn't read that picture")

    det = PersonDetector(config.detection)
    t = time.perf_counter()
    found = [d for d in det.detect(frame) if d.confidence >= args.count_conf]
    secs = time.perf_counter() - t

    out = frame.copy()
    scale = max(1.0, frame.shape[1] / 1280)
    for i, d in enumerate(sorted(found, key=lambda d: (d.bbox[1], d.bbox[0])), 1):
        x1, y1, x2, y2 = d.bbox.astype(int)
        colour = (80, 220, 80) if d.confidence >= 0.5 else (0, 200, 255)  # green sure, amber less sure
        cv2.rectangle(out, (x1, y1), (x2, y2), colour, max(1, int(2 * scale)))
        cv2.putText(out, str(i), (x1, max(12, y1 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.5 * scale, colour, max(1, int(scale)))
    banner = f"Kyro found {len(found)} people  |  {config.detection.model_name} @ {config.detection.imgsz}  |  {secs:.1f}s"
    cv2.rectangle(out, (0, 0), (out.shape[1], int(34 * scale)), (20, 20, 30), -1)
    cv2.putText(out, banner, (10, int(24 * scale)), cv2.FONT_HERSHEY_SIMPLEX, 0.7 * scale, (255, 255, 255), max(1, int(2 * scale)))
    name = f"kyro-check-{time.strftime('%Y%m%d-%H%M%S')}.jpg"
    cv2.imwrite(name, out)
    print(f"Found {len(found)} people (green = sure, amber = less sure). Saved {name}")


if __name__ == "__main__":
    main()
