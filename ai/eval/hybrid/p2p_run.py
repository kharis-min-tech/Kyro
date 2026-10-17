"""
Head points from P2PNet (Song et al., ICCV 2021; github.com/TencentYoutuResearch/CrowdCounting-P2PNet,
ShanghaiTech-A weights) for a list of frames — for the hybrid benchmark only.

P2PNet's licence allows use "only for the purpose of academic research", so it is
NOT part of Kyro's counting; this script exists to measure whether a crowd-counting
model would help. Weights are loaded with torch.load(weights_only=True): tensors
only, no code from the file is run.

usage: python p2p_run.py <P2PNet repo dir> <list.json: [[name, path], …]> <out.json>
(the repo's util/misc.py needs its torchvision version check set to False on
current torchvision; the model runs on the CPU because its anchor code is CUDA-or-CPU.)
"""
import sys, json, time, argparse
from pathlib import Path
import numpy as np, torch, cv2
REPO = Path(sys.argv[1]); sys.path.insert(0, str(REPO))
import models.vgg_ as V
_orig = V.vgg16_bn
V.vgg16_bn = lambda pretrained=False, **k: _orig(pretrained=False, **k)   # all weights come from the checkpoint
from models import build_model
args = argparse.Namespace(backbone="vgg16_bn", row=2, line=2)
model = build_model(args)
ck = torch.load(REPO / "weights/SHTechA.pth", map_location="cpu", weights_only=True)   # tensors only, no code
model.load_state_dict(ck["model"]); dev = "cpu"; model.to(dev).eval()
frames = json.loads(Path(sys.argv[2]).read_text()); out = {}; tt = 0
mean = np.array([0.485, 0.456, 0.406]); std = np.array([0.229, 0.224, 0.225])
for k, (name, path) in enumerate(frames):
    img = cv2.cvtColor(cv2.imread(path), cv2.COLOR_BGR2RGB); H, W = img.shape[:2]
    nw, nh = max(128, W // 128 * 128), max(128, H // 128 * 128)
    x = cv2.resize(img, (nw, nh)).astype(np.float32) / 255.0; x = (x - mean) / std
    t = torch.from_numpy(x.transpose(2, 0, 1)).float()[None].to(dev)
    t0 = time.perf_counter()
    with torch.no_grad():
        o = model(t)
    s = torch.softmax(o["pred_logits"], -1)[0, :, 1].cpu().numpy(); p = o["pred_points"][0].cpu().numpy()
    tt += time.perf_counter() - t0
    keep = s >= 0.3
    pts = p[keep] * np.array([W / nw, H / nh])
    out[name] = [[round(float(a), 1), round(float(b), 1), round(float(c), 3)] for (a, b), c in zip(pts, s[keep])]
    if k % 50 == 0: print(k, len(frames), flush=True)
Path(sys.argv[3]).write_text(json.dumps(out)); print("s/frame", round(tt / len(frames), 3))
