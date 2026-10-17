"""
Judges a detector (the current one or a fine-tuned candidate) on Kyro's three
test sets, the same way for every candidate:

  coco  410 hand-labelled frames (ai/eval/build_testset.py)
  look  133 statue / mannequin / doll frames (ai/eval/build_lookalikes.py)
  mall  200 overhead crowd frames, heads hand-marked (ai/eval/hybrid/build_mall.py),
        run with 2×2 tiles as on a 1080p camera, scored inside the official region

The count threshold is chosen per candidate on the TUNING halves only (a
fine-tuned model's confidences shift), then everything is reported on the
HELD-OUT halves. Clean-up (tidy) is applied; the CLIP lookalike check is not
(it's the same for every candidate).

usage: python -m ai.train.evaluate <eval_dir> <name> <model.pt> [--device mps]
  runs detection once per set (cached in <eval_dir>/found/<name>_*.json) and
  prints / saves <eval_dir>/results/<name>.json
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
THRESHOLDS = (0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5)


def detect(eval_dir: Path, name: str, model: str, device: str) -> dict:
    out = {}
    (eval_dir / "found").mkdir(exist_ok=True)
    for key, data, env in (("coco", eval_dir / "coco", {}), ("look", eval_dir / "look", {}),
                           ("mall", eval_dir / "mallroot" / "mallset", {"DETECTION_TILES": "2"})):
        f = eval_dir / "found" / f"{name}_{key}.json"
        if not f.exists():
            e = dict(os.environ, **env, DETECTION_LOOKALIKE_CHECK="false")
            subprocess.run([sys.executable, "-m", "ai.eval.run_box", str(data), str(f), "--raw", "--model", model,
                            "--device", device], cwd=REPO, env=e, check=True)
        out[key] = json.loads(f.read_text())["frames"]
    return out


def tidy_boxes(boxes, frame_h):
    import ai.detection.detector as d
    b = np.array(boxes, float).reshape(-1, 5)
    if not len(b):
        return b
    bb, ss = d._tidy(b[:, :4].astype(np.float32), b[:, 4].astype(np.float32), frame_h)
    return np.hstack([bb, ss[:, None]])


def score(eval_dir: Path, found: dict, cc: float, split: str) -> dict:
    import ai.eval.score as sc
    sys.path.insert(0, str(REPO / "ai/eval/hybrid"))
    from fuse import score_heads
    res = {}
    # COCO + lookalikes: box ground truth
    for key in ("coco", "look"):
        labels = json.loads((eval_dir / key / "labels.json").read_text())
        rows = []
        for l in labels:
            if l["split"] != split:
                continue
            b = tidy_boxes(found[key][l["frame"]]["boxes"], 1080)
            b = b[b[:, 4] >= cc] if len(b) else np.zeros((0, 5))
            b = b[np.argsort(-b[:, 4])]
            r = sc.score_frame(b[:, :4], l["gt"]); r["sec"] = found[key][l["frame"]]["sec"]; r["scen"] = l["scenario"]
            rows.append(r)
        res[key] = sc.summarise(rows)
        res[key]["empty_rooms_wrong"] = sum(1 for r in rows if r["people"] == 0 and r["counted"] > 0)
        res[key]["empty_rooms"] = sum(1 for r in rows if r["people"] == 0)
        if key == "coco":
            res["coco_hall"] = sc.summarise([r for r in rows if r["scen"] == "whole_hall"])
    # Mall: hand-marked heads, inside the official region
    import scipy.io as sio
    mroot = eval_dir / "mallroot"
    roi = sio.loadmat(mroot / "mall/mall_dataset/perspective_roi.mat")["roi"][0][0]["mask"].astype(bool)
    inr = lambda x, y: roi[min(479, max(0, int(y))), min(639, max(0, int(x)))]
    rows = []
    for l in json.loads((mroot / "mall_labels.json").read_text()):
        if l["split"] != split:
            continue
        b = tidy_boxes(found["mall"][l["frame"]]["boxes"], 480)
        b = [x for x in (b.tolist() if len(b) else []) if x[4] >= cc and inr((x[0] + x[2]) / 2, x[1] + 0.1 * (x[3] - x[1]))]
        rows.append(score_heads(b, [], [h for h in l["heads"] if inr(*h)]))
    P = sum(r["people"] for r in rows); C = sum(r["counted"] for r in rows); TP = sum(r["tp"] for r in rows)
    res["mall"] = {"frames": len(rows), "people": P, "counted": C, "recall": round(TP / P, 3), "precision": round(TP / max(C, 1), 3),
                   "MAE": round(float(np.mean([abs(r["counted"] - r["people"]) for r in rows])), 2)}
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("eval_dir"); ap.add_argument("name"); ap.add_argument("model")
    ap.add_argument("--device", default="mps")
    a = ap.parse_args()
    E = Path(a.eval_dir)
    found = detect(E, a.name, a.model, a.device)
    sys.path.insert(0, str(REPO))
    # Choose the count threshold on the tuning halves: lowest combined error
    # (mean of the COCO and Mall per-frame errors, each relative to the current model's scale).
    tune = {cc: score(E, found, cc, "val") for cc in THRESHOLDS}
    best = min(THRESHOLDS, key=lambda cc: tune[cc]["coco"]["MAE"] / 0.6 + tune[cc]["mall"]["MAE"] / 5.0
               + tune[cc]["look"]["obj"] / 30.0)
    test = score(E, found, best, "test")
    out = {"name": a.name, "model": a.model, "count_threshold": best, "tuning": tune[best], "held_out": test}
    (E / "results").mkdir(exist_ok=True)
    (E / "results" / f"{a.name}.json").write_text(json.dumps(out, indent=1))
    c, m, lk, h = test["coco"], test["mall"], test["look"], test["coco_hall"]
    print(f"{a.name}: count ≥ {best} | COCO MAE {c['MAE']} recall {c['recall']} precision {c['precision']} "
          f"objects {c['obj']} doubles {c['dup']} empty rooms wrong {c['empty_rooms_wrong']}/{c['empty_rooms']} | "
          f"hall MAE {h['MAE']} recall {h['recall']} | MALL MAE {m['MAE']} recall {m['recall']} precision {m['precision']} | "
          f"LOOKALIKES rooms wrong {lk['empty_rooms_wrong']}/{lk['empty_rooms']} objects {lk['obj']} | s/frame {c['sec']}")


if __name__ == "__main__":
    main()
