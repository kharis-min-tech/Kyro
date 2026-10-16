"""
Runs the Camera Box's real counting code (camera-box/kyro_box/counting.py: the
detector, tracker and headcount) through each test "video" from
build_sequences.py, frame by frame in order, and scores the headcount.

usage: PYTHONPATH=.:camera-box python -m ai.eval.run_sequences <seq_dir> [--legacy]
  --legacy  also report the tracker's headcount (how the Camera Box counted before
            October 2026), for comparison.
Per sequence: the headcount after each frame, how far it was from the people
the camera could see and from the people in the room, and entries counted.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2


def main(seq_dir: Path, legacy: bool) -> None:
    from kyro_box.counting import Counter
    labels = json.loads((seq_dir / "labels.json").read_text())
    seqs: dict = {}
    for l in labels:
        seqs.setdefault(l["seq"], []).append(l)
    report = {}
    for name, frames in seqs.items():
        c = Counter()
        rows = []
        for l in sorted(frames, key=lambda x: x["step"]):
            img = cv2.imread(str(seq_dir / "frames" / l["frame"]))
            c.count(name, img)
            s = c.stats[name]
            p = c._pipelines[name]
            rows.append({"step": l["step"], "visible": l["people"], "present": l["present"], "true_entries": l["entries"],
                         "count": s.current, "tracker_count": p._counter.current_attendance, "entries": s.entries})
        def mae(key, ref):
            return round(sum(abs(r[key] - r[ref]) for r in rows) / len(rows), 2)
        report[name] = {
            "counts": [r["count"] for r in rows], "visible": [r["visible"] for r in rows], "present": [r["present"] for r in rows],
            "MAE_vs_visible": mae("count", "visible"), "MAE_vs_present": mae("count", "present"),
            "over_counted_frames": sum(r["count"] > r["present"] for r in rows),
            "entries_counted": rows[-1]["entries"], "true_entries": rows[-1]["true_entries"],
        }
        if legacy:
            report[name]["tracker_counts"] = [r["tracker_count"] for r in rows]
            report[name]["tracker_MAE_vs_present"] = mae("tracker_count", "present")
        print(name, json.dumps(report[name]), flush=True)
    (seq_dir / "box_results.json").write_text(json.dumps(report))


if __name__ == "__main__":
    main(Path(sys.argv[1]), "--legacy" in sys.argv)
