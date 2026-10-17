"""
Mall benchmark: Kyro alone vs Kyro + P2PNet heads (matched with fuse.py).
usage: [ROI=1] python eval_mall.py <dir with mall_labels.json, p2p_mall.json, box_mall_raw.json, box_mall_t2_raw.json> val|test
ROI=1 scores only inside the dataset's official region of interest.
"""
import json, sys, numpy as np
H = sys.argv[1]; sys.path.insert(0, H); sys.path.insert(0, '/Users/ruthhilary/Kyro')
from fuse import fuse, score_heads
import ai.detection.detector as d
split = sys.argv[2]
lab = [l for l in json.load(open(H + "/mall_labels.json")) if split == "all" or l["split"] == split]
import scipy.io as sio, os
ROI = sio.loadmat(H + "/mall/mall_dataset/perspective_roi.mat")["roi"][0][0]["mask"].astype(bool) if os.environ.get("ROI") else np.ones((480, 640), bool)
inr = lambda x, y: ROI[min(479, max(0, int(y))), min(639, max(0, int(x)))]
for l in lab: l["heads"] = [h for h in l["heads"] if inr(*h)]
p2p = json.load(open(H + "/p2p_mall.json"))
def boxes_of(found, f, cc, frame_h=480):
    b = np.array(found[f]["boxes"], float).reshape(-1, 5)
    if len(b):
        bb, ss = d._tidy(b[:, :4].astype(np.float32), b[:, 4].astype(np.float32), frame_h); b = np.hstack([bb, ss[:, None]])
    return [x for x in b.tolist() if x[4] >= cc and inr((x[0] + x[2]) / 2, x[1] + 0.1 * (x[3] - x[1]))]
def run(found, cc, t_add=None):
    rows = []
    for l in lab:
        b = boxes_of(found, l["frame"], cc)
        if t_add is None: r = score_heads(b, [], l["heads"])
        else: kb, add, fl = fuse(b, [p for p in p2p[l["frame"]] if inr(p[0], p[1])], t_add, strict=True); r = score_heads(kb, add, l["heads"])
        rows.append(r)
    P = sum(r["people"] for r in rows); C = sum(r["counted"] for r in rows); TP = sum(r["tp"] for r in rows)
    return f"MAE {np.mean([abs(r['counted'] - r['people']) for r in rows]):5.2f} | counted {C}/{P} | recall {TP/P:.3f} precision {TP/max(C,1):.3f} | missed {P-TP} extra {C-TP}"
for name, f in (("no tiles (as live on 640×480)", "box_mall_raw.json"), ("2×2 tiles (as on a 1080p camera)", "box_mall_t2_raw.json")):
    found = json.load(open(H + "/" + f))["frames"]
    for cc in (0.2, 0.25, 0.3):
        print(f"Kyro {name} ≥{cc}: ", run(found, cc))
    for t in (0.6, 0.8, 0.9):
        print(f"  + P2PNet heads ≥{t} (strict): ", run(found, 0.3, t))
