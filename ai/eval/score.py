"""
Scores saved detections (ai/eval/run_box.py or dashboard/scripts/eval-camera-mode.mjs)
against the hand-drawn labels from ai/eval/build_testset.py.

usage: python -m ai.eval.score <data_dir> <found.json> [--count-conf 0.25] [--split test|val|all] [--md]

A box counts as a person when its confidence ≥ --count-conf (Camera Box 0.25,
Camera Mode 0.2 — what each one uses live). Matching: a counted box and a
labelled person with overlap (IoU) ≥ 0.5, best first, one-to-one.

Per scenario:
  people     labelled people (ignoring people under 16 px tall in the original photo)
  counted    Kyro's headcount
  MAE        mean |headcount − people| per frame
  exact      share of frames with exactly the right headcount
  recall     share of labelled people found
  precision  share of counted boxes that are a labelled person
  F1         balance of the two
  missed     labelled people not found
  dup/part   extra boxes on top of a labelled person (≥ 0.3 overlap): the same
             person twice, or part of a person
  object     extra boxes not on any person: an object, poster, reflection…
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

SCENARIOS = ["one_person", "two_people", "small_group", "overlapping", "edge", "dim", "no_people_objects", "whole_hall"]


def iou_mat(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    if not len(a) or not len(b):
        return np.zeros((len(a), len(b)))
    ix = np.clip(np.minimum(a[:, None, 2], b[None, :, 2]) - np.maximum(a[:, None, 0], b[None, :, 0]), 0, None)
    iy = np.clip(np.minimum(a[:, None, 3], b[None, :, 3]) - np.maximum(a[:, None, 1], b[None, :, 1]), 0, None)
    inter = ix * iy
    aa = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1]); ab = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    return inter / (aa[:, None] + ab[None, :] - inter + 1e-9)


def score_frame(boxes: np.ndarray, gt: list) -> dict:
    """boxes: counted boxes (N×4), best first. gt: [x1,y1,x2,y2,ignore]."""
    g = np.array([x[:4] for x in gt], dtype=float).reshape(-1, 4)
    ign = np.array([bool(x[4]) for x in gt], dtype=bool)
    m = iou_mat(boxes, g)
    used, tp, ignored, dup, obj = set(), 0, 0, 0, 0
    for i in range(len(boxes)):
        cand = [(m[i, j], j) for j in range(len(g)) if j not in used and m[i, j] >= 0.5]
        if cand:
            j = max(cand)[1]; used.add(j)
            if ign[j]: ignored += 1
            else: tp += 1
            continue
        best = m[i].max() if len(g) else 0.0
        if best >= 0.3 and len(g) and ign[int(m[i].argmax())]:
            ignored += 1           # on a tiny (ignored) person: neither right nor wrong
        elif best >= 0.3:
            dup += 1
        else:
            obj += 1
    people = int((~ign).sum())
    counted = len(boxes) - ignored
    return {"people": people, "counted": counted, "tp": tp, "missed": people - tp, "dup": dup, "obj": obj}


def summarise(rows: list[dict]) -> dict:
    if not rows:
        return {}
    P = sum(r["people"] for r in rows); C = sum(r["counted"] for r in rows); TP = sum(r["tp"] for r in rows)
    prec = TP / C if C else 1.0; rec = TP / P if P else 1.0
    err = [abs(r["counted"] - r["people"]) for r in rows]
    return {"frames": len(rows), "people": P, "counted": C, "MAE": round(float(np.mean(err)), 2),
            "exact": round(float(np.mean([e == 0 for e in err])), 3),
            "recall": round(rec, 3), "precision": round(prec, 3),
            "F1": round(2 * prec * rec / (prec + rec), 3) if prec + rec else 0.0,
            "missed": sum(r["missed"] for r in rows), "dup": sum(r["dup"] for r in rows), "obj": sum(r["obj"] for r in rows),
            "sec": round(float(np.mean([r["sec"] for r in rows])), 2)}


def evaluate(data: Path, found: dict, count_conf: float, split: str, post=None) -> dict:
    labels = json.loads((data / "labels.json").read_text())
    per = {s: [] for s in SCENARIOS}
    for l in labels:
        if split != "all" and l["split"] != split:
            continue
        f = found["frames"][l["frame"]]
        b = np.array(f["boxes"], dtype=float).reshape(-1, 5)
        if post is not None:
            b = post(b)
        b = b[b[:, 4] >= count_conf]
        b = b[np.argsort(-b[:, 4])]
        r = score_frame(b[:, :4], l["gt"]); r["sec"] = f["sec"]
        per[l["scenario"]].append(r)
    res = {s: summarise(v) for s, v in per.items() if v}
    res["ALL"] = summarise([r for v in per.values() for r in v])
    return res


def table(res: dict, title: str) -> str:
    cols = ["frames", "people", "counted", "MAE", "exact", "recall", "precision", "F1", "missed", "dup", "obj", "sec"]
    out = [f"**{title}**", "", "| scenario | " + " | ".join(cols) + " |", "|---" * (len(cols) + 1) + "|"]
    for s, r in res.items():
        out.append(f"| {s} | " + " | ".join(str(r[c]) for c in cols) + " |")
    return "\n".join(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("data"); ap.add_argument("found")
    ap.add_argument("--count-conf", type=float, default=0.25)
    ap.add_argument("--split", default="test")
    ap.add_argument("--title", default="")
    a = ap.parse_args()
    found = json.loads(Path(a.found).read_text())
    res = evaluate(Path(a.data), found, a.count_conf, a.split)
    print(table(res, a.title or f"{found['path']} · {found['model']} · count ≥ {a.count_conf} · {a.split} frames"))


if __name__ == "__main__":
    main()
