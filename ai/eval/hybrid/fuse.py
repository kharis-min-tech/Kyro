"""
Matching person boxes (Kyro) with head points (a crowd-counting / head model) so
nobody is counted twice: each box takes at most one head that sits in its head
area; heads with no box are added only if confident and not inside any counted
box (strict); the rest can be flagged as uncertain. Plus head-point scoring
against hand-marked heads (boxes by head area, points by distance R px).
"""
import json, sys, os, numpy as np
R = float(os.environ.get("R", 12))
def head_cost(b, p):
    """How well point p (x, y) sits in box b's head area; None if outside it."""
    x1, y1, x2, y2 = b[:4]; w, h = x2 - x1, y2 - y1
    if not (x1 - 0.1 * w <= p[0] <= x2 + 0.1 * w and y1 - 0.15 * h <= p[1] <= y1 + 0.45 * h): return None
    return np.hypot((p[0] - (x1 + x2) / 2) / max(w, 1), (p[1] - (y1 + 0.1 * h)) / max(h, 1))
def assign(boxes, pts):
    pairs = sorted((c, i, j) for i, b in enumerate(boxes) for j, p in enumerate(pts) if (c := head_cost(b, p)) is not None)
    ub, up, m = set(), set(), {}
    for c, i, j in pairs:
        if i in ub or j in up: continue
        ub.add(i); up.add(j); m[i] = j
    return m
def inside_any(boxes, p, pad=0.05):
    return any(b[0] - pad * (b[2] - b[0]) <= p[0] <= b[2] + pad * (b[2] - b[0]) and b[1] - pad * (b[3] - b[1]) <= p[1] <= b[3] for b in boxes)
def dedupe(pts, r):
    out = []
    for p in sorted(pts, key=lambda p: -p[2]):
        if all(np.hypot(p[0] - q[0], p[1] - q[1]) > r for q in out): out.append(p)
    return out
def fuse(boxes, pts, t_add, t_flag=0.0, strict=False, r=10):
    """boxes: [[x1,y1,x2,y2,s]] counted person boxes; pts: [[x,y,s]] head points.
    Returns (boxes kept, points added as people, points flagged uncertain)."""
    pts = [p for p in pts if p[2] >= min(t_add, t_flag) ]
    m = assign(boxes, pts); used = set(m.values())
    added = [p for j, p in enumerate(pts) if j not in used and p[2] >= t_add and not (strict and inside_any(boxes, p))]
    if strict: added = dedupe(added, r)
    flagged = [p for j, p in enumerate(pts) if j not in used and t_flag <= p[2] < t_add]
    return boxes, added, flagged
def score_heads(boxes, pts, gt, r=R):
    """One-to-one matching to hand-marked heads: boxes by head area, points by distance."""
    gt = [tuple(g) for g in gt]; m = assign(boxes, gt); used = set(m.values()); tp = len(m)
    fp = len(boxes) - len(m)
    for p in sorted(pts, key=lambda p: -p[2]):
        d = [(np.hypot(p[0] - g[0], p[1] - g[1]), k) for k, g in enumerate(gt) if k not in used]
        d = [x for x in d if x[0] <= r]
        if d: used.add(min(d)[1]); tp += 1
        else: fp += 1
    return {"people": len(gt), "counted": len(boxes) + len(pts), "tp": tp, "fp": fp, "missed": len(gt) - tp}
