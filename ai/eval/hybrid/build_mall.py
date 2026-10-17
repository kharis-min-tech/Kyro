"""
Mall dataset (CUHK, Chen et al. 2012) as a counting test: a fixed overhead camera
over a busy shopping centre, every head hand-marked in 2,000 frames — close to a
church camera's view. Takes every 10th frame (200), alternating tuning/held-out.

usage: python build_mall.py <dir>     (downloads mall_dataset.zip into <dir>)
Writes <dir>/mall_labels.json (heads per frame), <dir>/mall_list.json (for
p2p_run.py) and <dir>/mallset/ (frames + labels.json for ai.eval.run_box).
"""
import json, shutil, sys, urllib.request, zipfile
from pathlib import Path
import scipy.io as sio

D = Path(sys.argv[1]); D.mkdir(parents=True, exist_ok=True)
z = D / "mall.zip"
if not z.exists():
    urllib.request.urlretrieve("https://personal.ie.cuhk.edu.hk/~ccloy/files/datasets/mall_dataset.zip", z)
zipfile.ZipFile(z).extractall(D / "mall")
fr = sio.loadmat(D / "mall/mall_dataset/mall_gt.mat")["frame"][0]
labels, lst = [], []
(D / "mallset/frames").mkdir(parents=True, exist_ok=True)
for k, i in enumerate(range(0, 2000, 10)):
    name = f"seq_{i + 1:06d}.jpg"; src = D / "mall/mall_dataset/frames" / name
    labels.append({"frame": name, "split": "val" if k % 2 == 0 else "test",
                   "heads": [[round(float(x), 1), round(float(y), 1)] for x, y in fr[i][0][0][0]]})
    lst.append([name, str(src)]); shutil.copy(src, D / "mallset/frames" / name)
(D / "mall_labels.json").write_text(json.dumps(labels)); (D / "mall_list.json").write_text(json.dumps(lst))
(D / "mallset/labels.json").write_text(json.dumps([{"frame": l["frame"], "scenario": "mall", "split": l["split"], "gt": [],
                                                     "people": len(l["heads"])} for l in labels]))
print(len(labels), "frames,", sum(len(l["heads"]) for l in labels), "heads")
