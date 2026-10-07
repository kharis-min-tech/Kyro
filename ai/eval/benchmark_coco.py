"""
Person-detection benchmark on crowded COCO val2017 images.

Measures what matters for Kyro: of all the people really in the picture, how
many does a detector setup find (recall), split by size (small = far away),
plus precision and per-image headcount error.

usage: python bench.py <data_dir> <setup-name> [--limit N]
"""
from __future__ import annotations
import json, sys, time, urllib.request
from pathlib import Path
import numpy as np
import cv2
from ultralytics import YOLO

DATA = Path(sys.argv[1]); SETUP = sys.argv[2]
LIMIT = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 150
IMG_DIR = DATA / "images"; IMG_DIR.mkdir(exist_ok=True)

# ── Pick the crowded images: >= 8 individually-labelled people, no "crowd" blobs ──
ann = json.load(open(DATA / "annotations/instances_val2017.json"))
by_img: dict[int, list] = {}
crowd_imgs = set()
for a in ann["annotations"]:
    if a["category_id"] != 1:
        continue
    if a["iscrowd"]:
        crowd_imgs.add(a["image_id"])
    else:
        by_img.setdefault(a["image_id"], []).append(a["bbox"])
imgs = {i["id"]: i for i in ann["images"]}
chosen = sorted([i for i, b in by_img.items() if len(b) >= 8 and i not in crowd_imgs])[:LIMIT]

def load(img_id):
    info = imgs[img_id]; p = IMG_DIR / info["file_name"]
    if not p.exists():
        urllib.request.urlretrieve(info["coco_url"], p)
    return cv2.imread(str(p))

# ── Detector setups ──
def nms(boxes, scores, iou):
    if len(boxes) == 0:
        return []
    import torchvision, torch
    keep = torchvision.ops.nms(torch.tensor(boxes, dtype=torch.float32), torch.tensor(scores, dtype=torch.float32), iou)
    return keep.numpy().tolist()

_models = {}
def model(name):
    if name not in _models:
        _models[name] = YOLO(name)
    return _models[name]

def predict(m, img, imgsz, conf, augment=False):
    r = model(m).predict(img, imgsz=imgsz, conf=conf, iou=0.6, classes=[0], max_det=1000, verbose=False, augment=augment, device="mps")[0]
    return r.boxes.xyxy.cpu().numpy(), r.boxes.conf.cpu().numpy()

def tiled(m, img, imgsz, conf, grid=2, overlap=0.25, augment=False):
    """Full frame + overlapping tiles, merged. Tiles let a small/far person
    fill more of the model's input, which is where single-pass detectors fail."""
    H, W = img.shape[:2]
    B, S = [], []
    b, s = predict(m, img, imgsz, conf, augment); B.append(b); S.append(s)
    tw, th = int(W / (grid - (grid - 1) * overlap)), int(H / (grid - (grid - 1) * overlap))
    xs = np.linspace(0, W - tw, grid).astype(int); ys = np.linspace(0, H - th, grid).astype(int)
    for y in ys:
        for x in xs:
            b, s = predict(m, img[y:y + th, x:x + tw], imgsz, conf, augment)
            if len(b):
                b = b + np.array([x, y, x, y]); B.append(b); S.append(s)
    boxes = np.concatenate(B); scores = np.concatenate(S)
    keep = nms(boxes, scores, 0.55)
    boxes, scores = boxes[keep], scores[keep]
    # Drop a box that is mostly inside a bigger, kept box (a tile that only
    # saw half a person) — intersection over the smaller box's area.
    order = np.argsort(-(boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1]))
    final = []
    for i in order:
        bi = boxes[i]; ai = (bi[2] - bi[0]) * (bi[3] - bi[1])
        dup = False
        for j in final:
            bj = boxes[j]
            iw = max(0, min(bi[2], bj[2]) - max(bi[0], bj[0])); ih = max(0, min(bi[3], bj[3]) - max(bi[1], bj[1]))
            if ai > 0 and iw * ih / ai > 0.8 and scores[i] <= scores[j] + 0.15:
                dup = True; break
        if not dup:
            final.append(i)
    return boxes[final], scores[final]

SETUPS = {
    # name: (fn, kwargs)
    "current":        lambda img: predict("yolov8n.pt", img, 640, 0.30),
    "v8n-low":        lambda img: predict("yolov8n.pt", img, 640, 0.10),
    "11s-640":        lambda img: predict("yolo11s.pt", img, 640, 0.10),
    "11m-640":        lambda img: predict("yolo11m.pt", img, 640, 0.10),
    "11l-640":        lambda img: predict("yolo11l.pt", img, 640, 0.10),
    "11x-640":        lambda img: predict("yolo11x.pt", img, 640, 0.10),
    "11m-1280":       lambda img: predict("yolo11m.pt", img, 1280, 0.10),
    "11l-1280":       lambda img: predict("yolo11l.pt", img, 1280, 0.10),
    "11x-1280":       lambda img: predict("yolo11x.pt", img, 1280, 0.10),
    "11m-tta":        lambda img: predict("yolo11m.pt", img, 960, 0.10, augment=True),
    "11m-tiled":      lambda img: tiled("yolo11m.pt", img, 640, 0.10),
    "11l-tiled":      lambda img: tiled("yolo11l.pt", img, 640, 0.10),
    "11x-tiled":      lambda img: tiled("yolo11x.pt", img, 640, 0.10),
    "11x-1280-tta":   lambda img: predict("yolo11x.pt", img, 1280, 0.10, augment=True),
}

# ── Evaluate ──
def iou_mat(a, b):
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)))
    ix1 = np.maximum(a[:, None, 0], b[None, :, 0]); iy1 = np.maximum(a[:, None, 1], b[None, :, 1])
    ix2 = np.minimum(a[:, None, 2], b[None, :, 2]); iy2 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(ix2 - ix1, 0, None) * np.clip(iy2 - iy1, 0, None)
    aa = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1]); ab = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    return inter / (aa[:, None] + ab[None, :] - inter + 1e-9)

fn = SETUPS[SETUP]
COUNT_CONF = [0.25, 0.35, 0.45]
stats = {"tp": 0, "gt": 0, "det": 0, "size": {"small": [0, 0], "medium": [0, 0], "large": [0, 0]},
         "count_err": {c: [] for c in COUNT_CONF}, "pr": {c: [0, 0, 0] for c in COUNT_CONF}}
t_total = 0.0
for img_id in chosen:
    img = load(img_id)
    gt = np.array([[x, y, x + w, y + h] for x, y, w, h in by_img[img_id]])
    t0 = time.perf_counter(); boxes, scores = fn(img); t_total += time.perf_counter() - t0
    order = np.argsort(-scores); boxes, scores = boxes[order], scores[order]
    # recall at any confidence the setup emits (what the tracker can use)
    m = iou_mat(boxes, gt); matched_gt = set()
    for i in range(len(boxes)):
        if len(gt) == 0:
            break
        cand = [(m[i, j], j) for j in range(len(gt)) if j not in matched_gt and m[i, j] >= 0.5]
        if cand:
            matched_gt.add(max(cand)[1])
    for j, g in enumerate(gt):
        area = (g[2] - g[0]) * (g[3] - g[1])
        k = "small" if area < 32 ** 2 else "medium" if area < 96 ** 2 else "large"
        stats["size"][k][1] += 1
        if j in matched_gt:
            stats["size"][k][0] += 1
    stats["tp"] += len(matched_gt); stats["gt"] += len(gt); stats["det"] += len(boxes)
    # headcount + precision/recall at counting thresholds
    for c in COUNT_CONF:
        sel = boxes[scores >= c]
        stats["count_err"][c].append(abs(len(sel) - len(gt)))
        mm = iou_mat(sel, gt); used = set(); tp = 0
        for i in range(len(sel)):
            cand = [(mm[i, j], j) for j in range(len(gt)) if j not in used and mm[i, j] >= 0.5]
            if cand:
                used.add(max(cand)[1]); tp += 1
        stats["pr"][c][0] += tp; stats["pr"][c][1] += len(sel); stats["pr"][c][2] += len(gt)

res = {
    "setup": SETUP, "images": len(chosen), "people": stats["gt"],
    "recall_any": round(stats["tp"] / stats["gt"], 4),
    "recall_small": round(stats["size"]["small"][0] / max(1, stats["size"]["small"][1]), 4),
    "recall_medium": round(stats["size"]["medium"][0] / max(1, stats["size"]["medium"][1]), 4),
    "recall_large": round(stats["size"]["large"][0] / max(1, stats["size"]["large"][1]), 4),
    "at_conf": {str(c): {"recall": round(stats["pr"][c][0] / stats["pr"][c][2], 4),
                          "precision": round(stats["pr"][c][0] / max(1, stats["pr"][c][1]), 4),
                          "mean_count_error": round(float(np.mean(stats["count_err"][c])), 2)} for c in COUNT_CONF},
    "sec_per_image": round(t_total / len(chosen), 3),
}
print(json.dumps(res))
