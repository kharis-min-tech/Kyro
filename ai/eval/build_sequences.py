"""
Builds short "video" tests with a known true count in every frame: real people,
cut out along the outlines COCO annotators drew by hand, placed into a COCO
photo of a room with no people, and moved frame by frame.

  walk        one person crosses the room in big steps (a slow computer only
              sees a picture every second or two, so people jump between looks)
  pillar      two people; one is hidden behind a pillar for 3 frames, then reappears
  enter_leave three people come in one at a time, stay, then leave one at a time
  still       two people who don't move, 15 identical frames

usage: python -m ai.eval.build_sequences <data_dir> <out_dir>
  <data_dir> as for build_testset.py (needs its images/ and annotations/).
Writes <out_dir>/frames/*.png and <out_dir>/labels.json (same format as the
still-photo test set, plus "seq", "step", "present" — people in the room, whether
or not the camera can see them — and "entries" — how many have come in so far).
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
EXCLUDE: set[int] = {2, 4, 7, 9, 12}


def main(data: Path, out: Path) -> None:
    ann = json.loads((data / "annotations/instances_val2017.json").read_text())
    imgs = {i["id"]: i for i in ann["images"]}
    per_img: dict = {}
    for a in ann["annotations"]:
        per_img.setdefault(a["image_id"], []).append(a)
    rng = random.Random(7)

    def load(i):
        p = data / "images" / imgs[i]["file_name"]
        if not p.exists():
            urllib.request.urlretrieve(imgs[i]["coco_url"], p)
        return cv2.imread(str(p))

    # Cut-outs: single, whole, standing-height people with a polygon outline.
    cut_ids = [i for i, a in per_img.items() if sum(x["category_id"] == 1 for x in a) == 1
               and not any(x["iscrowd"] for x in a)]
    rng.shuffle(cut_ids)
    cutouts = []
    for i in cut_ids:
        a = next(x for x in per_img[i] if x["category_id"] == 1)
        x, y, w, h = a["bbox"]
        if h < 250 or h < 1.6 * w or not isinstance(a["segmentation"], list):
            continue
        im = load(i)
        if im is None or x < 2 or y < 2 or x + w > im.shape[1] - 2 or y + h > im.shape[0] - 2:
            continue   # cut off by the photo's edge: not a whole person
        mask = np.zeros(im.shape[:2], np.uint8)
        for poly in a["segmentation"]:
            cv2.fillPoly(mask, [np.array(poly).reshape(-1, 2).astype(np.int32)], 255)
        x, y, w, h = map(int, (x, y, w, h))
        cutouts.append((im[y:y + h, x:x + w].copy(), mask[y:y + h, x:x + w].copy()))
        if len(cutouts) >= 16:
            break
    # Checked by eye (contact sheet <out_dir>/cutouts.jpg): these contain a second,
    # unlabelled person or only part of one, so their true count isn't certain.
    cutouts = [c for k, c in enumerate(cutouts) if k not in EXCLUDE]

    # Backgrounds: indoor photos with chairs/sofas/tables and no people.
    rooms = [i for i, a in per_img.items() if not any(x["category_id"] == 1 for x in a)
             and {x["category_id"] for x in a} & {62, 63, 67}]
    rng.shuffle(rooms)

    def background(k):
        im = load(rooms[k])
        return cv2.resize(im, (W, H), interpolation=cv2.INTER_LINEAR)

    def paste(canvas, cut, cx, foot, height=620):
        im, m = cut
        s = height / im.shape[0]
        im = cv2.resize(im, (max(1, int(im.shape[1] * s)), height)); m = cv2.resize(m, (im.shape[1], height))
        x1, y1 = int(cx - im.shape[1] / 2), int(foot - height)
        X1, Y1, X2, Y2 = max(0, x1), max(0, y1), min(W, x1 + im.shape[1]), min(H, y1 + height)
        if X2 <= X1 or Y2 <= Y1:
            return None
        sub = im[Y1 - y1:Y2 - y1, X1 - x1:X2 - x1]; sm = (m[Y1 - y1:Y2 - y1, X1 - x1:X2 - x1] > 127)[..., None]
        canvas[Y1:Y2, X1:X2] = np.where(sm, sub, canvas[Y1:Y2, X1:X2])
        ys, xs = np.where(sm[..., 0])
        return [X1 + xs.min(), Y1 + ys.min(), X1 + xs.max(), Y1 + ys.max()]

    out.mkdir(parents=True, exist_ok=True)
    sheet = [cv2.resize(np.where((m > 127)[..., None], im, 255), (150, 300)) for im, m in cutouts]
    for k, t in enumerate(sheet):
        cv2.putText(t, str(k), (5, 25), 0, 0.8, (0, 0, 255), 2)
    if sheet:
        cv2.imwrite(str(out / "cutouts.jpg"), np.hstack(sheet))
    frames_dir = out / "frames"; frames_dir.mkdir(parents=True, exist_ok=True)
    labels = []

    def save(seq, step, canvas, boxes, present, entries):
        name = f"{seq}_{step:02d}.png"
        cv2.imwrite(str(frames_dir / name), canvas)
        labels.append({"frame": name, "scenario": seq, "split": "test", "seq": seq, "step": step,
                       "people": len(boxes), "present": present, "entries": entries,
                       "gt": [[float(v) for v in b] + [False] for b in boxes]})

    # walk
    bg = background(0)
    for step, cx in enumerate(np.linspace(250, 1670, 12)):
        c = bg.copy(); b = paste(c, cutouts[0], cx, 1040)
        save("walk", step, c, [b], 1, 1)
    # pillar
    bg = background(1)
    for step in range(12):
        c = bg.copy(); b1 = paste(c, cutouts[1], 600, 1040); b2 = paste(c, cutouts[2], 1300, 1040)
        hidden = 4 <= step <= 6
        if hidden:
            cv2.rectangle(c, (1130, 0), (1480, H), (90, 90, 95), -1)   # the pillar covers person 2
        save("pillar", step, c, [b1] if hidden else [b1, b2], 2, 2)
    # enter_leave
    bg = background(2)
    xs = [450, 960, 1470]
    plan = [1, 1, 2, 2, 3, 3, 3, 3, 2, 2, 1, 1, 0, 0]
    entered = 0
    for step, n in enumerate(plan):
        entered = max(entered, n)
        c = bg.copy(); bs = [paste(c, cutouts[3 + k], xs[k], 1040) for k in range(n)]
        save("enter_leave", step, c, bs, n, entered)
    # still
    bg = background(3)
    c = bg.copy(); b1 = paste(c, cutouts[6], 700, 1040); b2 = paste(c, cutouts[7], 1250, 1040)
    for step in range(15):
        save("still", step, c, [b1, b2], 2, 2)

    (out / "labels.json").write_text(json.dumps(labels))
    print(f"{len(labels)} frames in 4 sequences")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
