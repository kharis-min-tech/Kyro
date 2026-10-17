"""
Builds a "person" training set for fine-tuning Kyro's detector, from the Open
Images V6 *test* split (annotations CC BY 4.0, images CC BY 2.0 — attribution in
ai/train/README.md). None of these photos are in Kyro's test sets (those use
COCO val2017, Open Images *validation* and the Mall dataset).

  - Person / Man / Woman / Boy / Girl boxes, merged into one class "person".
  - Boxes marked IsDepiction (statues, paintings, posters, toys of people) are
    NOT people: they're left unlabelled, so the model learns not to count them.
  - Photos with a "group of people" box are skipped (their people aren't
    individually boxed, so they'd teach the model to miss people).
  - Only photos whose person label was verified by a human (so their boxes are
    complete), plus photos verified to contain NO person (what not to count).

usage: python -m ai.train.build_openimages <oi_dir> <out_dir> [n_with_people] [n_without]
  <oi_dir>: test-annotations-bbox.csv, test-annotations-human-imagelabels-boxable.csv
Writes a YOLO dataset: <out_dir>/images/{train,val}, labels/{train,val}, data.yaml.
"""
from __future__ import annotations

import csv
import random
import socket
import zlib
import sys
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2

socket.setdefaulttimeout(30)   # a stuck download mustn't hold up the rest
PERSON = {"/m/01g317", "/m/04yx4", "/m/03bt1vf", "/m/01bl7v", "/m/05r655"}
MAX_SIDE = 1280


def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0])); iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    i = ix * iy
    return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i + 1e-9)


def main(oi: Path, out: Path, n_pos: int, n_neg: int) -> None:
    verified = defaultdict(dict)
    for r in csv.DictReader(open(oi / "test-annotations-human-imagelabels-boxable.csv")):
        if r["LabelName"] in PERSON:
            verified[r["ImageID"]][r["LabelName"]] = r["Confidence"]
    boxes, skip = defaultdict(list), set()
    for r in csv.DictReader(open(oi / "test-annotations-bbox.csv")):
        if r["LabelName"] not in PERSON:
            continue
        if r["IsGroupOf"] == "1":
            skip.add(r["ImageID"]); continue
        if r["IsDepiction"] == "1":
            continue                                   # a statue / painting / poster of a person: not a person
        boxes[r["ImageID"]].append([float(r["XMin"]), float(r["YMin"]), float(r["XMax"]), float(r["YMax"])])

    pos = [i for i, b in boxes.items() if i not in skip and any(v == "1" for v in verified[i].values())]
    neg = [i for i, v in verified.items() if i not in boxes and i not in skip and v and all(c == "0" for c in v.values())]
    rng = random.Random(2026)
    rng.shuffle(pos); rng.shuffle(neg)
    # Favour photos with several people (rows of people are what Kyro sees).
    pos.sort(key=lambda i: -min(len(boxes[i]), 8))
    pos = pos[:n_pos]; neg = neg[:n_neg]
    print(f"{len(pos)} photos with people ({sum(len(boxes[i]) for i in pos)} people), {len(neg)} without", flush=True)

    items = [(i, True) for i in pos] + [(i, False) for i in neg]
    rng.shuffle(items)
    for split in ("train", "val"):
        (out / "images" / split).mkdir(parents=True, exist_ok=True); (out / "labels" / split).mkdir(parents=True, exist_ok=True)

    def get(item):
        i, has_people = item
        split = "val" if zlib.crc32(i.encode()) % 20 == 0 else "train"   # same split every run
        dst = out / "images" / split / f"{i}.jpg"
        if not dst.exists():
            try:
                tmp = dst.with_suffix(".tmp")
                urllib.request.urlretrieve(f"https://s3.amazonaws.com/open-images-dataset/test/{i}.jpg", tmp)
                im = cv2.imread(str(tmp))
                if im is None:
                    tmp.unlink(missing_ok=True); return 0
                s = MAX_SIDE / max(im.shape[:2])
                if s < 1:
                    im = cv2.resize(im, (int(im.shape[1] * s), int(im.shape[0] * s)), interpolation=cv2.INTER_AREA)
                cv2.imwrite(str(dst), im, [cv2.IMWRITE_JPEG_QUALITY, 92]); tmp.unlink(missing_ok=True)
            except Exception:  # noqa: BLE001
                return 0
        kept = []
        for b in sorted(boxes.get(i, []), key=lambda b: -(b[2] - b[0]) * (b[3] - b[1])):
            if all(iou(b, k) < 0.7 for k in kept):      # same person boxed as "Person" and "Woman"
                kept.append(b)
        (out / "labels" / split / f"{i}.txt").write_text(
            "".join(f"0 {(b[0] + b[2]) / 2:.6f} {(b[1] + b[3]) / 2:.6f} {b[2] - b[0]:.6f} {b[3] - b[1]:.6f}\n" for b in kept))
        return 1

    done = 0
    with ThreadPoolExecutor(16) as ex:
        for k, ok in enumerate(ex.map(get, items)):
            done += ok
            if k % 1000 == 0:
                print(f"{k}/{len(items)} downloaded", flush=True)
    (out / "data.yaml").write_text(f"path: {out}\ntrain: images/train\nval: images/val\nnames:\n  0: person\n")
    print(f"{done} photos ready", flush=True)


if __name__ == "__main__":
    a = sys.argv
    main(Path(a[1]), Path(a[2]), int(a[3]) if len(a) > 3 else 12000, int(a[4]) if len(a) > 4 else 3000)
