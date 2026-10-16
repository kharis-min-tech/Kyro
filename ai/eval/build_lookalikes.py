"""
Builds the "looks like a person, isn't one" test set: statues, sculptures,
mannequins, figurines, dolls, carved faces — with and without real people.

  lookalike_empty_coco   COCO val2017 photos whose captions mention a statue,
                         sculpture, mannequin, figurine… and that have NO
                         labelled person (COCO labels people exhaustively)
  lookalike_empty_oi     Open Images validation photos labelled "Sculpture" or
                         "Doll" with no person label, each checked by eye for
                         real people (see EXCLUDE_OI)
  lookalike_with_people  COCO val2017 statue/sculpture photos that also contain
                         real (hand-labelled) people: the statue mustn't count,
                         the people must

Neither dataset was used to train Kyro's models (YOLO11 is trained on COCO train2017).
Frames are 1920×1080 like build_testset.py and alternate val/test halves.

usage: python -m ai.eval.build_lookalikes <coco_dir> <oi_dir> <out_dir>
  <coco_dir>: annotations/{instances,captions}_val2017.json (+ images/ cache)
  <oi_dir>: validation-annotations-human-imagelabels-boxable.csv from Open Images
"""
from __future__ import annotations

import csv
import json
import re
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

from ai.eval.build_testset import MIN_VISIBLE_PX, H, W

WORDS = re.compile(r"\b(statues?|sculptures?|mannequins?|manikins?|figurines?|bust|scarecrow|wax figure|dumm(y|ies))\b", re.I)
OI_PERSON = {"/m/01bl7v", "/m/05r655", "/m/02p0tk3", "/m/0dzct", "/m/04yx4", "/m/01g317", "/m/03bt1vf"}
OI_LOOKALIKE = {"/m/06msq", "/m/0167gd"}          # Sculpture, Doll
# Checked by eye: the Trevi Fountain photo is usually full of tourists.
EXCLUDE_OI = {"dc91dc35f77deacb"}
# A room photo where a real person on the sofa can't be ruled out.
EXCLUDE_COCO = {453341}


def fit(im, gt):
    h, w = im.shape[:2]; s = min(W / w, H / h)
    canvas = np.full((H, W, 3), 114, np.uint8)
    nw, nh = int(w * s), int(h * s); ox, oy = (W - nw) // 2, (H - nh) // 2
    canvas[oy:oy + nh, ox:ox + nw] = cv2.resize(im, (nw, nh))
    return canvas, [[x1 * s + ox, y1 * s + oy, x2 * s + ox, y2 * s + oy, (y2 - y1) < MIN_VISIBLE_PX] for x1, y1, x2, y2 in gt]


def main(coco: Path, oi: Path, out: Path) -> None:
    ins = json.loads((coco / "annotations/instances_val2017.json").read_text())
    cap = json.loads((coco / "annotations/captions_val2017.json").read_text())
    imgs = {i["id"]: i for i in ins["images"]}
    people, crowd = defaultdict(list), set()
    for a in ins["annotations"]:
        if a["category_id"] == 1:
            if a["iscrowd"]: crowd.add(a["image_id"])
            else:
                x, y, w, h = a["bbox"]; people[a["image_id"]].append([x, y, x + w, y + h])
    hits = sorted({c["image_id"] for c in cap["annotations"] if WORDS.search(c["caption"])})
    used = set()
    if (coco / "labels.json").exists():          # keep the main test set's photos out
        used = {i for l in json.loads((coco / "labels.json").read_text()) for i in l["coco_ids"]}

    items = []   # (scenario, image, gt boxes, source id)
    for i in hits:
        if i in used or i in crowd or i in EXCLUDE_COCO:
            continue
        p = coco / "images" / imgs[i]["file_name"]
        if not p.exists():
            urllib.request.urlretrieve(imgs[i]["coco_url"], p)
        items.append(("lookalike_with_people" if people[i] else "lookalike_empty_coco", cv2.imread(str(p)), people[i], f"coco:{i}"))

    labels = defaultdict(dict)
    for r in csv.DictReader(open(oi / "validation-annotations-human-imagelabels-boxable.csv")):
        labels[r["ImageID"]][r["LabelName"]] = r["Confidence"]
    oi_ids = sorted(i for i, l in labels.items()
                    if any(l.get(c) == "1" for c in OI_LOOKALIKE) and not any(l.get(c) == "1" for c in OI_PERSON)
                    and i not in EXCLUDE_OI)
    (oi / "img").mkdir(exist_ok=True)
    for i in oi_ids:
        p = oi / "img" / f"{i}.jpg"
        if not p.exists():
            urllib.request.urlretrieve(f"https://s3.amazonaws.com/open-images-dataset/validation/{i}.jpg", p)
        items.append(("lookalike_empty_oi", cv2.imread(str(p)), [], f"oi:{i}"))

    (out / "frames").mkdir(parents=True, exist_ok=True)
    rows = []
    for k, (scen, im, gt, src) in enumerate(items):
        if im is None:
            continue
        canvas, g = fit(im, gt)
        name = f"{k:04d}_{scen}.png"
        cv2.imwrite(str(out / "frames" / name), canvas)
        rows.append({"frame": name, "scenario": scen, "split": "val" if k % 2 == 0 else "test", "coco_ids": [src],
                     "people": sum(1 for x in g if not x[4]), "gt": [[round(v, 1) for v in x[:4]] + [bool(x[4])] for x in g]})
    (out / "labels.json").write_text(json.dumps(rows))
    for s in ("lookalike_empty_coco", "lookalike_empty_oi", "lookalike_with_people"):
        print(s, sum(r["scenario"] == s for r in rows))


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
