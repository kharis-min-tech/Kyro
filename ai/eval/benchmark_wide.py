"""
"Wide shot" benchmark: four crowded COCO photos per 1920×1080 frame, like a
church camera covering a whole hall — people are a small part of the frame.
Runs Kyro's real PersonDetector (ai/detection/detector.py) with each setup.

usage: python bench_wide.py <data_dir> <kyro_repo> <model> <imgsz> <tiles> <tta> <conf>
"""
import json, sys, time
from pathlib import Path
import numpy as np, cv2
DATA, REPO = Path(sys.argv[1]), sys.argv[2]
MODEL, IMGSZ, TILES, TTA, CONF = sys.argv[3], int(sys.argv[4]), sys.argv[5], sys.argv[6] == "1", float(sys.argv[7])
sys.path.insert(0, REPO)
import os
os.environ.update({"YOLO_MODEL": MODEL, "DETECTION_IMGSZ": str(IMGSZ), "DETECTION_TILES": TILES,
                   "DETECTION_TTA": "true" if TTA else "false", "DETECTION_CONF": str(CONF), "DETECTION_DEVICE": "mps"})
from ai.config import DetectionConfig
from ai.detection.detector import PersonDetector
cfg = DetectionConfig(); cfg.model_path = Path(MODEL)  # weights in cwd
det = PersonDetector(cfg)

ann = json.load(open(DATA / "annotations/instances_val2017.json"))
by_img, crowd = {}, set()
for a in ann["annotations"]:
    if a["category_id"] != 1: continue
    if a["iscrowd"]: crowd.add(a["image_id"])
    else: by_img.setdefault(a["image_id"], []).append(a["bbox"])
imgs = {i["id"]: i for i in ann["images"]}
chosen = sorted([i for i, b in by_img.items() if len(b) >= 8 and i not in crowd])[:148]

def iou_mat(a, b):
    if len(a) == 0 or len(b) == 0: return np.zeros((len(a), len(b)))
    ix1 = np.maximum(a[:, None, 0], b[None, :, 0]); iy1 = np.maximum(a[:, None, 1], b[None, :, 1])
    ix2 = np.minimum(a[:, None, 2], b[None, :, 2]); iy2 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(ix2 - ix1, 0, None) * np.clip(iy2 - iy1, 0, None)
    aa = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1]); ab = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    return inter / (aa[:, None] + ab[None, :] - inter + 1e-9)

def match(boxes, gt):
    m = iou_mat(boxes, gt); used = set()
    for i in range(len(boxes)):
        cand = [(m[i, j], j) for j in range(len(gt)) if j not in used and m[i, j] >= 0.5]
        if cand: used.add(max(cand)[1])
    return used

COUNT = [0.25, 0.35, 0.45]
tp = gt_n = 0; size = {"small": [0, 0], "medium": [0, 0], "large": [0, 0]}
pr = {c: [0, 0, 0] for c in COUNT}; err = {c: [] for c in COUNT}; t_all = 0.0; frames = 0
for k in range(0, len(chosen) - 3, 4):
    canvas = np.zeros((1080, 1920, 3), np.uint8); gts = []
    for q, img_id in enumerate(chosen[k:k + 4]):
        im = cv2.imread(str(DATA / "images" / imgs[img_id]["file_name"]))
        h, w = im.shape[:2]; s = min(960 / w, 540 / h)
        im = cv2.resize(im, (int(w * s), int(h * s)))
        ox, oy = (q % 2) * 960, (q // 2) * 540
        canvas[oy:oy + im.shape[0], ox:ox + im.shape[1]] = im
        gts += [[x * s + ox, y * s + oy, (x + bw) * s + ox, (y + bh) * s + oy] for x, y, bw, bh in by_img[img_id]]
    gt = np.array(gts)
    t0 = time.perf_counter(); d = det.detect(canvas); t_all += time.perf_counter() - t0; frames += 1
    boxes = np.array([x.bbox for x in d]).reshape(-1, 4); scores = np.array([x.confidence for x in d])
    o = np.argsort(-scores); boxes, scores = boxes[o], scores[o]
    used = match(boxes, gt); tp += len(used); gt_n += len(gt)
    for j, g in enumerate(gt):
        a = (g[2] - g[0]) * (g[3] - g[1]); kk = "small" if a < 32 ** 2 else "medium" if a < 96 ** 2 else "large"
        size[kk][1] += 1; size[kk][0] += j in used
    for c in COUNT:
        sel = boxes[scores >= c]; u = match(sel, gt)
        pr[c][0] += len(u); pr[c][1] += len(sel); pr[c][2] += len(gt); err[c].append(abs(len(sel) - len(gt)))
print(json.dumps({"setup": f"{MODEL}@{IMGSZ} tiles={TILES} tta={int(TTA)}", "frames": frames, "people": gt_n,
    "recall_any": round(tp / gt_n, 4), **{f"recall_{k}": round(v[0] / max(1, v[1]), 4) for k, v in size.items()},
    "at_conf": {str(c): {"recall": round(pr[c][0] / pr[c][2], 4), "precision": round(pr[c][0] / max(1, pr[c][1]), 4),
                          "mean_count_error": round(float(np.mean(err[c])), 2)} for c in COUNT},
    "sec_per_image": round(t_all / frames, 3)}))
