"""
Builds Kyro's counting test set from COCO val2017 — photos in which every
person was outlined BY HAND (the ground truth never comes from Kyro's AI).

Each test picture is a 1920×1080 frame, like a frame from the Goodmans camera:
a photo scaled to fit (scenarios below), or four crowded photos side by side
("whole hall": people small in the frame). Frames alternate between a "val"
half (allowed for tuning settings) and a "test" half (only for reporting).

usage: python -m ai.eval.build_testset <data_dir>
  <data_dir>/annotations/instances_val2017.json must exist (COCO 2017 annotations).
  Writes <data_dir>/frames/*.png and <data_dir>/labels.json; downloads the photos it needs.

Ground-truth notes
  - Images with an "iscrowd" person region (a crowd labelled as one blob) are left
    out: their exact headcount is unknown.
  - People shorter than MIN_VISIBLE_PX in the original photo are marked "ignore":
    a match on one isn't counted as a mistake, a miss isn't counted as a miss.
  - COCO's "no person" photos are fully labelled, so any person found there is a
    false detection (an object, a poster, a reflection…).
"""
from __future__ import annotations

import json
import random
import sys
import urllib.request
from pathlib import Path

import cv2
import numpy as np

W, H = 1920, 1080
MIN_VISIBLE_PX = 16
PER_SCENARIO = {"one_person": 60, "two_people": 50, "small_group": 50, "overlapping": 50,
                "edge": 50, "dim": 40, "no_people_objects": 80, "whole_hall": 30}
# Things that might be mistaken for a person in a church: chairs, sofas, tables,
# screens, plants, soft toys, umbrellas, bags, benches, beds, clocks, books.
OBJECT_CATS = {62, 63, 67, 72, 64, 88, 28, 27, 31, 15, 65, 85, 84, 33}


def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0])); iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    i = ix * iy
    return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i + 1e-9)


def main(data: Path) -> None:
    ann = json.loads((data / "annotations/instances_val2017.json").read_text())
    imgs = {i["id"]: i for i in ann["images"]}
    people, crowd, objects = {}, set(), {}
    for a in ann["annotations"]:
        if a["category_id"] == 1:
            if a["iscrowd"]:
                crowd.add(a["image_id"])
            else:
                x, y, w, h = a["bbox"]
                people.setdefault(a["image_id"], []).append([x, y, x + w, y + h])
        else:
            objects.setdefault(a["image_id"], set()).add(a["category_id"])

    def boxes(i):
        return people.get(i, [])

    rng = random.Random(2026)
    ok = [i for i in imgs if i not in crowd]
    with_people = [i for i in ok if boxes(i)]
    big = lambda i: [b for b in boxes(i) if b[3] - b[1] >= MIN_VISIBLE_PX]
    area = lambda i: imgs[i]["width"] * imgs[i]["height"]
    cands = {
        "one_person": [i for i in with_people if len(boxes(i)) == 1
                       and (boxes(i)[0][2] - boxes(i)[0][0]) * (boxes(i)[0][3] - boxes(i)[0][1]) > 0.05 * area(i)],
        "two_people": [i for i in with_people if len(boxes(i)) == 2 and len(big(i)) == 2],
        "small_group": [i for i in with_people if 3 <= len(boxes(i)) <= 7 and len(big(i)) >= 3],
        "overlapping": [i for i in with_people if 2 <= len(boxes(i)) <= 12
                        and any(iou(a, b) >= 0.3 for k, a in enumerate(boxes(i)) for b in boxes(i)[k + 1:])],
        "edge": [i for i in with_people if len(boxes(i)) <= 8 and any(
            (b[0] <= 2 or b[1] <= 2 or b[2] >= imgs[i]["width"] - 2 or b[3] >= imgs[i]["height"] - 2)
            and (b[2] - b[0]) * (b[3] - b[1]) > 0.03 * area(i) for b in boxes(i))],
        "dim": [i for i in with_people if len(boxes(i)) <= 10],     # filtered by brightness after download
        "no_people_objects": [i for i in ok if not boxes(i) and objects.get(i, set()) & OBJECT_CATS],
        "whole_hall": [i for i in with_people if len(boxes(i)) >= 8],
    }
    for v in cands.values():
        rng.shuffle(v)

    img_dir = data / "images"; img_dir.mkdir(parents=True, exist_ok=True)
    frame_dir = data / "frames"; frame_dir.mkdir(exist_ok=True)

    def load(i):
        p = img_dir / imgs[i]["file_name"]
        if not p.exists():
            for _ in range(3):
                try:
                    urllib.request.urlretrieve(imgs[i]["coco_url"], p); break
                except Exception:  # noqa: BLE001
                    pass
        return cv2.imread(str(p))

    used, frames = set(), []

    def fit(im, gt):
        h, w = im.shape[:2]; s = min(W / w, H / h)
        canvas = np.full((H, W, 3), 114, np.uint8)
        nw, nh = int(w * s), int(h * s); ox, oy = (W - nw) // 2, (H - nh) // 2
        canvas[oy:oy + nh, ox:ox + nw] = cv2.resize(im, (nw, nh), interpolation=cv2.INTER_LINEAR)
        return canvas, [[x1 * s + ox, y1 * s + oy, x2 * s + ox, y2 * s + oy, (y2 - y1) < MIN_VISIBLE_PX] for x1, y1, x2, y2 in gt]

    for scen, n in PER_SCENARIO.items():
        got = 0
        pool = [i for i in cands[scen] if i not in used]
        if scen == "whole_hall":
            for k in range(0, len(pool) - 3, 4):
                if got >= n: break
                canvas = np.full((H, W, 3), 114, np.uint8); gts = []
                for q, i in enumerate(pool[k:k + 4]):
                    im = load(i); h, w = im.shape[:2]; s = min(960 / w, 540 / h)
                    im = cv2.resize(im, (int(w * s), int(h * s)))
                    ox, oy = (q % 2) * 960, (q // 2) * 540
                    canvas[oy:oy + im.shape[0], ox:ox + im.shape[1]] = im
                    gts += [[x1 * s + ox, y1 * s + oy, x2 * s + ox, y2 * s + oy, (y2 - y1) < MIN_VISIBLE_PX] for x1, y1, x2, y2 in boxes(i)]
                    used.add(i)
                frames.append((scen, canvas, gts, pool[k:k + 4])); got += 1
            continue
        for i in pool:
            if got >= n: break
            im = load(i)
            if im is None: continue
            if scen == "dim" and cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).mean() >= 60:
                continue
            canvas, gt = fit(im, boxes(i))
            frames.append((scen, canvas, gt, [i])); used.add(i); got += 1
        print(f"{scen}: {got} frames", flush=True)

    labels = []
    for k, (scen, canvas, gt, ids) in enumerate(frames):
        name = f"{k:04d}_{scen}.png"
        cv2.imwrite(str(frame_dir / name), canvas)
        labels.append({"frame": name, "scenario": scen, "split": "val" if k % 2 == 0 else "test",
                       "coco_ids": ids, "people": sum(1 for g in gt if not g[4]),
                       "gt": [[round(v, 1) for v in g[:4]] + [bool(g[4])] for g in gt]})
    (data / "labels.json").write_text(json.dumps(labels))
    print(f"{len(labels)} frames, {sum(l['people'] for l in labels)} labelled people")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
